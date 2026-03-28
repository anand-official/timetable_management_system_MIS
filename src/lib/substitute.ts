import { db } from '@/lib/db';
import {
  getAllSlotTeacherIds,
  getCombinedSlotOptionForTeacher,
  slotHasTeacherId,
} from '@/lib/combined-slot';
import {
  getSubstituteNoteEntriesForDate,
  getSubstituteNoteEntry,
  upsertSubstituteNoteEntry,
} from '@/lib/substitute-note';

type TeacherLite = {
  id: string;
  name: string;
  abbreviation: string;
  department?: string | null;
};

type SlotLike = {
  id: string;
  sectionId: string;
  subjectId: string | null;
  dayId: string;
  timeSlotId: string;
  notes?: string | null;
  subject?: { id: string; name: string; code: string } | null;
  teacher?: { id: string; name: string; abbreviation: string; department?: string | null } | null;
  day?: { name: string } | null;
  timeSlot?: { periodNumber: number } | null;
  section?: { name: string; grade: { name: string } } | null;
};

const WEIGHTS = {
  SAME_DEPARTMENT: 30,
  DIRECT_SUBJECT_TEACHER: 25,
  TEACHABLE_GRADE: 20,
  LOW_WORKLOAD: 20,
  NOT_HOD: 10,
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
  subjectCode: string;
  subjectId: string | null;
  currentTeacher: { id: string; name: string; abbreviation: string } | null;
  assignedSubstitute: { id: string; name: string; abbreviation: string } | null;
  suggestions: ScoredCandidate[];
  topPick: ScoredCandidate | null;
}

export interface DailySubstituteAbsence {
  absenceId: string;
  reason?: string | null;
  teacher: { id: string; name: string; abbreviation: string };
  slots: SuggestedSlot[];
}

export function normalizeDateOnly(input: string | Date): Date {
  if (typeof input === 'string') {
    const datePart = input.split('T')[0];
    const [y, m, d] = datePart.split('-').map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
  }
  const d = input instanceof Date ? input : new Date(input);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dateKey(input: string | Date) {
  const d = normalizeDateOnly(input);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDayName(date: Date) {
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

function resolveSlotContext(slot: SlotLike, absentTeacher: TeacherLite) {
  const combinedOption = getCombinedSlotOptionForTeacher(slot.notes, absentTeacher.id);
  return {
    subjectId: combinedOption?.subjectId ?? slot.subjectId ?? null,
    subjectName: combinedOption?.subjectName ?? slot.subject?.name ?? '',
    subjectCode: combinedOption?.subjectCode ?? slot.subject?.code ?? '',
    absentTeacher,
  };
}

async function getSubstituteEngineContext(dateInput: string | Date) {
  const date = normalizeDateOnly(dateInput);
  const dayName = getDayName(date);
  const key = dateKey(date);
  const day = await db.day.findUnique({ where: { name: dayName } });

  const [scheduledSlots, absencesToday, unavailabilityToday, teachers] = await Promise.all([
    day
      ? db.timetableSlot.findMany({
          where: { dayId: day.id },
          include: {
            section: { include: { grade: true } },
            subject: true,
            teacher: true,
            day: true,
            timeSlot: true,
          },
          orderBy: { timeSlot: { periodNumber: 'asc' } },
        })
      : Promise.resolve([]),
    db.teacherAbsence.findMany({
      where: { date },
      include: { teacher: { select: { id: true, name: true, abbreviation: true, department: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    day
      ? db.teacherUnavailability.findMany({
          where: { dayId: day.id },
          select: { teacherId: true, timeSlotId: true },
        })
      : Promise.resolve([]),
    db.teacher.findMany({
      select: {
        id: true,
        name: true,
        abbreviation: true,
        department: true,
        isHOD: true,
        targetWorkload: true,
        currentWorkload: true,
        teachableGrades: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  const absentToday = new Set(absencesToday.map((absence) => absence.teacherId));
  const unavailableSet = new Set(unavailabilityToday.map((item) => `${item.teacherId}|${item.timeSlotId}`));
  const liveTeacherWorkload = buildTeacherSlotCountMap(scheduledSlots);
  const teacherBusy = new Set<string>();
  const substituteDayCount = new Map<string, number>();

  for (const slot of scheduledSlots) {
    for (const teacherId of getAllSlotTeacherIds(slot)) {
      if (teacherId) teacherBusy.add(`${teacherId}|${slot.timeSlotId}`);
    }
    for (const substituteEntry of getSubstituteNoteEntriesForDate(slot.notes, key)) {
      teacherBusy.add(`${substituteEntry.substituteTeacherId}|${slot.timeSlotId}`);
      substituteDayCount.set(
        substituteEntry.substituteTeacherId,
        (substituteDayCount.get(substituteEntry.substituteTeacherId) ?? 0) + 1
      );
    }
  }

  return {
    date,
    dateKey: key,
    day,
    dayName,
    scheduledSlots,
    absencesToday,
    absentToday,
    unavailableSet,
    teacherBusy,
    liveTeacherWorkload,
    substituteDayCount,
    teachers,
  };
}

export const MAX_SUBSTITUTE_PERIODS_PER_DAY = 2;

export async function suggestSubstitutes(
  teacherId: string,
  dateInput: string | Date,
  prebuiltContext?: Awaited<ReturnType<typeof getSubstituteEngineContext>>
) {
  const context = prebuiltContext ?? await getSubstituteEngineContext(dateInput);
  const absentTeacher = context.absencesToday.find((absence) => absence.teacherId === teacherId)?.teacher
    ?? await db.teacher.findUnique({
      where: { id: teacherId },
      select: { id: true, name: true, abbreviation: true, department: true },
    });

  if (!context.day || !absentTeacher) {
    return { date: context.date, dayName: context.dayName, slots: [] as SuggestedSlot[] };
  }

  const absentSlots = context.scheduledSlots.filter((slot) => slotHasTeacherId(slot, teacherId));
  const resolvedSlots = absentSlots.map((slot) => ({
    slot,
    context: resolveSlotContext(slot, absentTeacher),
  }));

  const subjectIds = resolvedSlots
    .map((item) => item.context.subjectId)
    .filter((value): value is string => Boolean(value));

  const teacherSubjectMaps = await db.teacherSubject.findMany({
    where: { subjectId: { in: subjectIds } },
    include: {
      teacher: {
        select: {
          id: true,
          name: true,
          abbreviation: true,
          department: true,
          isHOD: true,
          targetWorkload: true,
          currentWorkload: true,
          teachableGrades: true,
          isActive: true,
        },
      },
    },
  });

  const subjectCandidates = new Map<string, typeof teacherSubjectMaps[number]['teacher'][]>();
  for (const mapping of teacherSubjectMaps) {
    if (!subjectCandidates.has(mapping.subjectId)) subjectCandidates.set(mapping.subjectId, []);
    const list = subjectCandidates.get(mapping.subjectId)!;
    if (!list.some((teacher) => teacher.id === mapping.teacherId)) {
      list.push({
        ...mapping.teacher,
        currentWorkload: context.liveTeacherWorkload.get(mapping.teacherId) ?? mapping.teacher.currentWorkload,
      });
    }
  }

  const directAssignments = new Map<string, string>();
  for (const mapping of teacherSubjectMaps) {
    directAssignments.set(`${mapping.subjectId}|${mapping.sectionId}`, mapping.teacherId);
  }

  const slots: SuggestedSlot[] = resolvedSlots.map(({ slot, context: slotContext }) => {
    const rawCandidates = slotContext.subjectId ? (subjectCandidates.get(slotContext.subjectId) ?? []) : [];
    const assignedEntry = getSubstituteNoteEntry(slot.notes, context.dateKey, teacherId);
    const assignedId = assignedEntry?.substituteTeacherId;

    const isEligible = (candidateId: string, isActive: boolean): boolean => {
      if (candidateId === teacherId) return false;
      if (!isActive) return false;
      if (context.absentToday.has(candidateId)) return false;
      if (assignedId !== candidateId && context.teacherBusy.has(`${candidateId}|${slot.timeSlotId}`)) return false;
      if (context.unavailableSet.has(`${candidateId}|${slot.timeSlotId}`)) return false;
      const currentSubCount = context.substituteDayCount.get(candidateId) ?? 0;
      if (assignedId !== candidateId && currentSubCount >= MAX_SUBSTITUTE_PERIODS_PER_DAY) return false;
      return true;
    };

    const scoreCandidate = (candidate: { id: string; name: string; abbreviation: string; department?: string | null; isHOD: boolean; targetWorkload: number; currentWorkload: number; teachableGrades: string }, isGeneralFallback: boolean) => {
      let score = 0;
      const reasons: string[] = [];

      if (isGeneralFallback) {
        reasons.push('General substitute');
      } else if (slotContext.subjectId && directAssignments.get(`${slotContext.subjectId}|${slot.sectionId}`) === candidate.id) {
        score += WEIGHTS.DIRECT_SUBJECT_TEACHER;
        reasons.push('Direct assignment for this class');
      }

      if (absentTeacher.department && candidate.department === absentTeacher.department) {
        score += WEIGHTS.SAME_DEPARTMENT;
        reasons.push('Same department');
      }

      try {
        const teachableGrades: string[] = JSON.parse(candidate.teachableGrades || '[]');
        if (slot.section?.grade?.name && teachableGrades.includes(slot.section.grade.name)) {
          score += WEIGHTS.TEACHABLE_GRADE;
          reasons.push(`Teaches Grade ${slot.section.grade.name}`);
        }
      } catch {
        // Ignore malformed teachable-grade payloads.
      }

      const candidateWorkload = context.liveTeacherWorkload.get(candidate.id) ?? candidate.currentWorkload;
      if (candidate.targetWorkload > 0) {
        const ratio = candidateWorkload / candidate.targetWorkload;
        const workloadScore = Math.round(WEIGHTS.LOW_WORKLOAD * Math.max(0, 1 - ratio));
        if (workloadScore > 0) {
          score += workloadScore;
          reasons.push(`Low workload (${candidateWorkload}/${candidate.targetWorkload})`);
        } else if (ratio > 1) {
          score -= 5;
          reasons.push('Overloaded');
        }
      }

      if (!candidate.isHOD) {
        score += WEIGHTS.NOT_HOD;
        reasons.push('Not HOD');
      } else {
        reasons.push('HOD (lower priority)');
      }

      return { id: candidate.id, name: candidate.name, abbreviation: candidate.abbreviation, score, reasons };
    };

    // Primary: subject-matched eligible teachers
    const eligible = rawCandidates.filter((c) => isEligible(c.id, c.isActive));
    let scored = eligible.map((c) => scoreCandidate(c, false)).sort((a, b) => b.score - a.score);

    // Fallback: if no subject-matched teacher is free, open up to ALL available teachers
    if (scored.length === 0) {
      const primaryIds = new Set(rawCandidates.map((c) => c.id));
      const fallback = context.teachers
        .filter((t) => !primaryIds.has(t.id) && isEligible(t.id, t.isActive))
        .map((t) => ({ ...t, currentWorkload: context.liveTeacherWorkload.get(t.id) ?? t.currentWorkload }));
      scored = fallback.map((c) => scoreCandidate(c, true)).sort((a, b) => b.score - a.score);
    }

    // Always include the currently-assigned substitute in the list so it shows in the dropdown
    if (assignedId && !scored.some((s) => s.id === assignedId)) {
      const assignedTeacher = context.teachers.find((t) => t.id === assignedId);
      if (assignedTeacher) {
        scored.push({
          id: assignedTeacher.id,
          name: assignedTeacher.name,
          abbreviation: assignedTeacher.abbreviation,
          score: 0,
          reasons: ['Currently assigned'],
        });
      }
    }

    return {
      slotId: slot.id,
      timeSlotId: slot.timeSlotId,
      periodNumber: slot.timeSlot?.periodNumber ?? 0,
      dayName: slot.day?.name ?? context.dayName,
      sectionName: slot.section?.name ?? '',
      sectionId: slot.sectionId,
      subjectName: slotContext.subjectName,
      subjectCode: slotContext.subjectCode,
      subjectId: slotContext.subjectId,
      currentTeacher: {
        id: absentTeacher.id,
        name: absentTeacher.name,
        abbreviation: absentTeacher.abbreviation,
      },
      assignedSubstitute: assignedEntry
        ? {
            id: assignedEntry.substituteTeacherId,
            name: assignedEntry.substituteTeacherName,
            abbreviation: assignedEntry.substituteTeacherAbbreviation,
          }
        : null,
      suggestions: scored,
      topPick: scored[0] ?? null,
    };
  });

  return { date: context.date, dayName: context.dayName, slots };
}

export async function getDailySubstitutePlan(dateInput: string | Date) {
  const context = await getSubstituteEngineContext(dateInput);
  const absences = await Promise.all(
    context.absencesToday.map(async (absence) => {
      const suggestionResult = await suggestSubstitutes(absence.teacherId, context.date, context);
      return {
        absenceId: absence.id,
        reason: absence.reason,
        teacher: {
          id: absence.teacher.id,
          name: absence.teacher.name,
          abbreviation: absence.teacher.abbreviation,
        },
        slots: suggestionResult.slots,
      } satisfies DailySubstituteAbsence;
    })
  );

  return {
    date: context.date,
    dateKey: context.dateKey,
    dayName: context.dayName,
    absences,
  };
}

export async function assignSubstituteToSlot(args: {
  slotId: string;
  absentTeacherId: string;
  substituteTeacherId: string;
  date: string | Date;
  mode: 'manual' | 'auto';
}) {
  const normalizedDate = normalizeDateOnly(args.date);
  const normalizedDateKey = dateKey(normalizedDate);
  const dayName = getDayName(normalizedDate);

  const [absentTeacher, substituteTeacher, day] = await Promise.all([
    db.teacher.findUnique({
      where: { id: args.absentTeacherId },
      select: { id: true, name: true, abbreviation: true, department: true },
    }),
    db.teacher.findUnique({
      where: { id: args.substituteTeacherId },
      select: { id: true, name: true, abbreviation: true },
    }),
    db.day.findUnique({ where: { name: dayName } }),
  ]);

  if (!absentTeacher || !substituteTeacher || !day) {
    throw new Error('Invalid substitute assignment request');
  }

  const updated = await db.$transaction(async (tx) => {
    const currentSlot = await tx.timetableSlot.findUnique({
      where: { id: args.slotId },
      include: {
        subject: true,
        teacher: true,
        day: true,
        timeSlot: true,
        section: { include: { grade: true } },
      },
    });

    if (!currentSlot) throw new Error('Slot not found');
    if (currentSlot.dayId !== day.id) throw new Error('Selected date does not match this timetable slot');
    if (!slotHasTeacherId(currentSlot, absentTeacher.id)) {
      throw new Error('Absent teacher is not assigned to this slot');
    }

    const slotContext = resolveSlotContext(currentSlot, absentTeacher);

    // Fetch all slots for the day (needed for both period-conflict and daily-count checks)
    const allSlotsToday = await tx.timetableSlot.findMany({
      where: { dayId: currentSlot.dayId, notes: { not: null } },
      select: { id: true, teacherId: true, labTeacherId: true, timeSlotId: true, notes: true },
    });

    // Check same-period conflict
    const samePeriodSlots = allSlotsToday.filter((s) => s.timeSlotId === currentSlot.timeSlotId);
    const substituteBusy = samePeriodSlots.some((candidate) => {
      if (candidate.id !== currentSlot.id && slotHasTeacherId(candidate, substituteTeacher.id)) return true;
      return getSubstituteNoteEntriesForDate(candidate.notes, normalizedDateKey).some((entry) =>
        entry.absentTeacherId !== absentTeacher.id && entry.substituteTeacherId === substituteTeacher.id
      );
    });
    if (substituteBusy) {
      throw new Error('Substitute teacher is already booked in this period');
    }

    // Enforce max substitute periods per day
    const existingSubCount = allSlotsToday.reduce((count, s) => {
      return count + getSubstituteNoteEntriesForDate(s.notes, normalizedDateKey).filter(
        (e) => e.substituteTeacherId === substituteTeacher.id &&
          !(s.id === currentSlot.id && e.absentTeacherId === absentTeacher.id)
      ).length;
    }, 0);
    if (existingSubCount >= MAX_SUBSTITUTE_PERIODS_PER_DAY) {
      throw new Error(`Substitute teacher already has ${MAX_SUBSTITUTE_PERIODS_PER_DAY} substitute periods today`);
    }

    const nextNotes = upsertSubstituteNoteEntry(currentSlot.notes, {
      date: normalizedDateKey,
      absentTeacherId: absentTeacher.id,
      absentTeacherName: absentTeacher.name,
      absentTeacherAbbreviation: absentTeacher.abbreviation,
      substituteTeacherId: substituteTeacher.id,
      substituteTeacherName: substituteTeacher.name,
      substituteTeacherAbbreviation: substituteTeacher.abbreviation,
      subjectId: slotContext.subjectId,
      subjectName: slotContext.subjectName,
      subjectCode: slotContext.subjectCode,
      mode: args.mode,
    });

    const saved = await tx.timetableSlot.update({
      where: { id: currentSlot.id },
      data: {
        notes: nextNotes,
      },
      include: {
        day: true,
        timeSlot: true,
        subject: true,
        teacher: true,
        section: true,
        room: true,
      },
    });

    await tx.teacherAbsence.upsert({
      where: { teacherId_date: { teacherId: absentTeacher.id, date: normalizedDate } },
      update: {},
      create: { teacherId: absentTeacher.id, date: normalizedDate },
    });

    return {
      slot: saved,
      assigned: {
        id: substituteTeacher.id,
        name: substituteTeacher.name,
        abbreviation: substituteTeacher.abbreviation,
      },
    };
  });

  return updated;
}

export async function autoAssignSubstitutes(teacherId: string, dateInput: string | Date) {
  const { date, dayName, slots } = await suggestSubstitutes(teacherId, dateInput);
  const results: Array<{
    slotId: string;
    periodNumber: number;
    sectionName: string;
    subjectName: string;
    assigned: ScoredCandidate | null;
    error: string | null;
  }> = [];
  const inMemoryBusy = new Set<string>();
  const inMemorySubDayCount = new Map<string, number>();

  for (const slot of slots) {
    if (slot.assignedSubstitute) {
      const subId = slot.assignedSubstitute.id;
      results.push({
        slotId: slot.slotId,
        periodNumber: slot.periodNumber,
        sectionName: slot.sectionName,
        subjectName: slot.subjectName,
        assigned: {
          id: slot.assignedSubstitute.id,
          name: slot.assignedSubstitute.name,
          abbreviation: slot.assignedSubstitute.abbreviation,
          score: 0,
          reasons: ['Already assigned'],
        },
        error: null,
      });
      inMemoryBusy.add(`${subId}|${slot.timeSlotId}`);
      inMemorySubDayCount.set(subId, (inMemorySubDayCount.get(subId) ?? 0) + 1);
      continue;
    }

    let assigned: ScoredCandidate | null = null;
    let error = 'No available substitute found';

    for (const candidate of slot.suggestions) {
      if (inMemoryBusy.has(`${candidate.id}|${slot.timeSlotId}`)) continue;
      if ((inMemorySubDayCount.get(candidate.id) ?? 0) >= MAX_SUBSTITUTE_PERIODS_PER_DAY) continue;
      try {
        await assignSubstituteToSlot({
          slotId: slot.slotId,
          absentTeacherId: teacherId,
          substituteTeacherId: candidate.id,
          date,
          mode: 'auto',
        });
        inMemoryBusy.add(`${candidate.id}|${slot.timeSlotId}`);
        inMemorySubDayCount.set(candidate.id, (inMemorySubDayCount.get(candidate.id) ?? 0) + 1);
        assigned = candidate;
        error = '';
        break;
      } catch (err) {
        error = (err as Error)?.message || 'Database error during assignment';
        if (error.includes('already booked') || error.includes('substitute periods today')) continue;
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

export async function autoAssignDailySubstitutes(dateInput: string | Date, teacherIds?: string[]) {
  const plan = await getDailySubstitutePlan(dateInput);
  const inMemoryBusy = new Set<string>();
  const inMemorySubDayCount = new Map<string, number>();
  const results: Array<{
    absentTeacherId: string;
    slotId: string;
    periodNumber: number;
    sectionName: string;
    subjectName: string;
    assigned: ScoredCandidate | null;
    error: string | null;
  }> = [];

  const targetAbsences = plan.absences.filter((absence) =>
    !teacherIds || teacherIds.length === 0 || teacherIds.includes(absence.teacher.id)
  );

  const flattened = targetAbsences
    .flatMap((absence) =>
      absence.slots.map((slot) => ({
        absence,
        slot,
      }))
    )
    .sort((a, b) => a.slot.periodNumber - b.slot.periodNumber || a.slot.sectionName.localeCompare(b.slot.sectionName));

  for (const item of flattened) {
    if (item.slot.assignedSubstitute) {
      const subId = item.slot.assignedSubstitute.id;
      inMemoryBusy.add(`${subId}|${item.slot.timeSlotId}`);
      inMemorySubDayCount.set(subId, (inMemorySubDayCount.get(subId) ?? 0) + 1);
      results.push({
        absentTeacherId: item.absence.teacher.id,
        slotId: item.slot.slotId,
        periodNumber: item.slot.periodNumber,
        sectionName: item.slot.sectionName,
        subjectName: item.slot.subjectName,
        assigned: {
          id: item.slot.assignedSubstitute.id,
          name: item.slot.assignedSubstitute.name,
          abbreviation: item.slot.assignedSubstitute.abbreviation,
          score: 0,
          reasons: ['Already assigned'],
        },
        error: null,
      });
      continue;
    }

    let assigned: ScoredCandidate | null = null;
    let error = 'No available substitute found';

    for (const candidate of item.slot.suggestions) {
      if (inMemoryBusy.has(`${candidate.id}|${item.slot.timeSlotId}`)) continue;
      if ((inMemorySubDayCount.get(candidate.id) ?? 0) >= MAX_SUBSTITUTE_PERIODS_PER_DAY) continue;
      try {
        await assignSubstituteToSlot({
          slotId: item.slot.slotId,
          absentTeacherId: item.absence.teacher.id,
          substituteTeacherId: candidate.id,
          date: plan.date,
          mode: 'auto',
        });
        inMemoryBusy.add(`${candidate.id}|${item.slot.timeSlotId}`);
        inMemorySubDayCount.set(candidate.id, (inMemorySubDayCount.get(candidate.id) ?? 0) + 1);
        assigned = candidate;
        error = '';
        break;
      } catch (err) {
        error = (err as Error)?.message || 'Database error during assignment';
        if (error.includes('already booked') || error.includes('substitute periods today')) continue;
      }
    }

    results.push({
      absentTeacherId: item.absence.teacher.id,
      slotId: item.slot.slotId,
      periodNumber: item.slot.periodNumber,
      sectionName: item.slot.sectionName,
      subjectName: item.slot.subjectName,
      assigned,
      error: assigned ? null : error,
    });
  }

  return { ...plan, results };
}
