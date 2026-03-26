import { db } from '@/lib/db';
import { getAllSlotTeacherIds, slotHasTeacherId } from '@/lib/combined-slot';

export function normalizeDateOnly(input: string | Date): Date {
  const d = input instanceof Date ? new Date(input) : new Date(input);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getDayName(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

function buildTeacherSlotCountMap(
  slots: Array<{ teacherId: string | null; labTeacherId: string | null; notes?: string | null; dayId: string; timeSlotId: string }>
) {
  const teacherSlotKeys = new Map<string, Set<string>>();

  for (const slot of slots) {
    const key = `${slot.dayId}|${slot.timeSlotId}`;
    for (const teacherId of getAllSlotTeacherIds(slot)) {
      if (!teacherId) continue;
      if (!teacherSlotKeys.has(teacherId)) {
        teacherSlotKeys.set(teacherId, new Set());
      }
      teacherSlotKeys.get(teacherId)!.add(key);
    }
  }

  return new Map(
    Array.from(teacherSlotKeys.entries()).map(([teacherId, slotKeys]) => [teacherId, slotKeys.size])
  );
}

// ─── Scoring criteria weights ───────────────────────────────────────────────
const WEIGHTS = {
  SAME_DEPARTMENT: 30,      // same dept → likely domain expert
  DIRECT_SUBJECT_TEACHER: 25, // already teaches this subject to this section
  TEACHABLE_GRADE: 20,      // grade level within teacher's range
  LOW_WORKLOAD: 20,         // underloaded teachers preferred (linear scale)
  NOT_HOD: 10,              // avoid burdening HODs
  ACTIVE_TEACHER: 5,        // bonus for active (already filtered, just explicit)
};

export interface ScoredCandidate {
  id: string;
  name: string;
  abbreviation: string;
  score: number;
  reasons: string[];
}

export interface SuggestedSlot {
  slotId: string;
  timeSlotId: string;
  periodNumber: number;
  dayName: string;
  sectionName: string;
  sectionId: string;
  subjectName: string;
  subjectId: string | null;
  currentTeacher: { id: string; name: string; abbreviation: string } | null;
  suggestions: ScoredCandidate[];
  topPick: ScoredCandidate | null;
}

// ─── Core suggestion engine ──────────────────────────────────────────────────

export async function suggestSubstitutes(teacherId: string, dateInput: string | Date) {
  const date = normalizeDateOnly(dateInput);
  const dayName = getDayName(date);
  const day = await db.day.findUnique({ where: { name: dayName } });
  if (!day) return { date, dayName, slots: [] as SuggestedSlot[] };

  // Slots belonging to the absent teacher on this day
  const absentSlots = (await db.timetableSlot.findMany({
    where: { dayId: day.id },
    include: {
      section: { include: { grade: true } },
      subject: true,
      teacher: true,
      day: true,
      timeSlot: true,
      room: true,
    },
    orderBy: { timeSlot: { periodNumber: 'asc' } },
  })).filter((slot) => slotHasTeacherId(slot, teacherId));

  // All teachers that can teach any of those subjects
  const subjectIds = absentSlots.map(s => s.subjectId).filter((v): v is string => !!v);
  const teacherSubjectMaps = await db.teacherSubject.findMany({
    where: { subjectId: { in: subjectIds } },
    include: {
      teacher: {
        select: {
          id: true, name: true, abbreviation: true,
          department: true, isHOD: true,
          targetWorkload: true, currentWorkload: true,
          teachableGrades: true, isActive: true,
        },
      },
    },
  });

  // Who's busy this day (period × teacher)
  const scheduledSlots = await db.timetableSlot.findMany({
    select: { teacherId: true, labTeacherId: true, notes: true, dayId: true, timeSlotId: true },
  });
  const liveTeacherWorkload = buildTeacherSlotCountMap(scheduledSlots);
  const teacherBusy = new Set(
    scheduledSlots
      .filter((slot) => slot.dayId === day.id)
      .flatMap((slot) =>
        getAllSlotTeacherIds(slot)
          .filter((busyTeacherId): busyTeacherId is string => Boolean(busyTeacherId))
          .map((busyTeacherId) => `${busyTeacherId}|${slot.timeSlotId}`)
      )
  );

  // Who's absent today
  const absencesToday = await db.teacherAbsence.findMany({
    where: { date },
    select: { teacherId: true },
  });
  const absentToday = new Set(absencesToday.map(a => a.teacherId));

  // Who's marked unavailable for specific periods today
  const unavailabilityToday = await db.teacherUnavailability.findMany({
    where: { dayId: day.id },
    select: { teacherId: true, timeSlotId: true },
  });
  const unavailableSet = new Set(unavailabilityToday.map(u => `${u.teacherId}|${u.timeSlotId}`));

  // Build subject → candidates map
  const subjectCandidates = new Map<string, typeof teacherSubjectMaps[0]['teacher'][]>();
  for (const ts of teacherSubjectMaps) {
    if (!subjectCandidates.has(ts.subjectId)) subjectCandidates.set(ts.subjectId, []);
    const list = subjectCandidates.get(ts.subjectId)!;
    if (!list.some(t => t.id === ts.teacherId)) {
      list.push({
        ...ts.teacher,
        currentWorkload: liveTeacherWorkload.get(ts.teacherId) ?? 0,
      });
    }
  }

  // Direct assignments: subject+section → teacher (strongest match)
  const directAssignments = new Map<string, string>(); // `${subjectId}|${sectionId}` → teacherId
  for (const ts of teacherSubjectMaps) {
    directAssignments.set(`${ts.subjectId}|${ts.sectionId}`, ts.teacherId);
  }

  const slots: SuggestedSlot[] = absentSlots.map(slot => {
    const subjectId = slot.subjectId;
    const sectionId = slot.sectionId;
    const gradeName = slot.section.grade.name; // e.g. "IX"
    const rawCandidates = subjectId ? (subjectCandidates.get(subjectId) ?? []) : [];

    const eligible = rawCandidates.filter(candidate => {
      if (candidate.id === teacherId) return false;          // absent teacher
      if (!candidate.isActive) return false;                 // inactive
      if (absentToday.has(candidate.id)) return false;      // also absent
      if (teacherBusy.has(`${candidate.id}|${slot.timeSlotId}`)) return false; // busy this period
      if (unavailableSet.has(`${candidate.id}|${slot.timeSlotId}`)) return false; // unavailable
      return true;
    });

    // Score each eligible candidate
    const scored: ScoredCandidate[] = eligible.map(candidate => {
      let score = 0;
      const reasons: string[] = [];

      // Criteria 1: same department
      const absentTeacherDept = slot.teacher?.department ?? '';
      // We'll compare against the absent teacher's dept only if known
      // Actually for subject matching we compare candidate's dept to subject category (a proxy)
      // Better: use the absent teacher's department
      // We need the absent teacher's department — fetch from slot.teacher
      // This is available via slot.teacher which is included

      // Criteria 2: direct subject+section assignment (strongest match)
      if (directAssignments.get(`${subjectId}|${sectionId}`) === candidate.id) {
        score += WEIGHTS.DIRECT_SUBJECT_TEACHER;
        reasons.push('Direct assignment for this class');
      }

      // Criteria 1: department match (compare to absent teacher's department)
      if (absentTeacherDept && candidate.department === absentTeacherDept) {
        score += WEIGHTS.SAME_DEPARTMENT;
        reasons.push('Same department');
      }

      // Criteria 3: teachable grade
      try {
        const teachableGrades: string[] = JSON.parse(candidate.teachableGrades || '[]');
        if (teachableGrades.includes(gradeName)) {
          score += WEIGHTS.TEACHABLE_GRADE;
          reasons.push(`Teaches Grade ${gradeName}`);
        }
      } catch { /* ignore parse errors */ }

      // Criteria 4: lower workload (favour underloaded, linear scale)
      const candidateWorkload = liveTeacherWorkload.get(candidate.id) ?? candidate.currentWorkload;
      if (candidate.targetWorkload > 0) {
        const ratio = candidateWorkload / candidate.targetWorkload;
        // ratio 0 → full 20 pts; ratio 1 → 0 pts; ratio > 1 → negative (overloaded)
        const workloadScore = Math.round(WEIGHTS.LOW_WORKLOAD * Math.max(0, 1 - ratio));
        if (workloadScore > 0) {
          score += workloadScore;
          reasons.push(`Low workload (${candidateWorkload}/${candidate.targetWorkload})`);
        } else if (ratio > 1) {
          score -= 5; // slight penalty for overloaded
          reasons.push('Overloaded');
        }
      }

      // Criteria 5: not HOD
      if (!candidate.isHOD) {
        score += WEIGHTS.NOT_HOD;
        reasons.push('Not HOD');
      } else {
        reasons.push('HOD (lower priority)');
      }

      return { id: candidate.id, name: candidate.name, abbreviation: candidate.abbreviation, score, reasons };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return {
      slotId: slot.id,
      timeSlotId: slot.timeSlotId,
      periodNumber: slot.timeSlot.periodNumber,
      dayName: slot.day.name,
      sectionName: slot.section.name,
      sectionId: slot.sectionId,
      subjectName: slot.subject?.name ?? '',
      subjectId,
      currentTeacher: slot.teacher
        ? { id: slot.teacher.id, name: slot.teacher.name, abbreviation: slot.teacher.abbreviation }
        : null,
      suggestions: scored,
      topPick: scored[0] ?? null,
    };
  });

  return { date, dayName, slots };
}

// ─── Auto-assign: pick best available substitute for every slot ──────────────

export async function autoAssignSubstitutes(teacherId: string, dateInput: string | Date) {
  const { date, dayName, slots } = await suggestSubstitutes(teacherId, dateInput);

  // Track in-memory period locks so we don't double-book within this batch
  // key: `${candidateId}|${timeSlotId}`
  const inMemoryBusy = new Set<string>();

  const results: Array<{
    slotId: string;
    periodNumber: number;
    sectionName: string;
    subjectName: string;
    assigned: ScoredCandidate | null;
    error: string | null;
  }> = [];

  for (const slot of slots) {
    let assigned: ScoredCandidate | null = null;
    let error = 'No available substitute found';

    for (const candidate of slot.suggestions) {
      if (inMemoryBusy.has(`${candidate.id}|${slot.timeSlotId}`)) continue;

      try {
        const assignment = await db.$transaction(async (tx) => {
          const currentSlot = await tx.timetableSlot.findUnique({
            where: { id: slot.slotId },
            select: { id: true, teacherId: true, dayId: true, timeSlotId: true },
          });

          if (!currentSlot) return { ok: false as const, reason: 'missing' as const };
          if (currentSlot.teacherId !== teacherId) {
            return { ok: false as const, reason: 'already-reassigned' as const };
          }

          const busyConflict = await tx.timetableSlot.findFirst({
            where: {
              OR: [
                { teacherId: candidate.id },
                { labTeacherId: candidate.id },
              ],
              dayId: currentSlot.dayId,
              timeSlotId: currentSlot.timeSlotId,
              NOT: { id: currentSlot.id },
            },
            select: { id: true },
          });

          if (busyConflict) return { ok: false as const, reason: 'busy' as const };

          await tx.timetableSlot.update({
            where: { id: slot.slotId },
            data: {
              teacherId: candidate.id,
              manuallyEdited: true,
              notes: 'Substituted (auto-assign)',
            },
          });

          await tx.teacherAbsence.upsert({
            where: { teacherId_date: { teacherId, date } },
            update: {},
            create: { teacherId, date },
          });

          return { ok: true as const };
        });

        if (assignment.ok) {
          inMemoryBusy.add(`${candidate.id}|${slot.timeSlotId}`);
          assigned = candidate;
          error = '';
          break;
        }

        if (assignment.reason === 'busy') {
          continue;
        }

        error = assignment.reason === 'already-reassigned'
          ? 'Slot was already reassigned'
          : 'Slot no longer exists';
        break;
      } catch {
        error = 'Database error during assignment';
        break;
      }
    }

    results.push({
      slotId: slot.slotId,
      periodNumber: slot.periodNumber,
      sectionName: slot.sectionName,
      subjectName: slot.subjectName,
      assigned,
      error: assigned ? null : error,
    });
  }

  return { date, dayName, results };
}
