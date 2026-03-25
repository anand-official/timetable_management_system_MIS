import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { GenerateSchema, validationError } from '@/lib/validation';
// OR-Tools solver removed — using two-layer heuristic generator
import { auditLabSplits, repairLabSplits } from '@/lib/lab-audit';
import { sortSectionsByGradeThenName } from '@/lib/section-sort';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeacherAssignment {
  teacherId: string;
  subjectId: string;
  sectionId: string;
  periodsPerWeek: number;
  teacher: { id: string; abbreviation: string; targetWorkload: number; department: string; name: string; teachableGrades: string };
  subject: { id: string; name: string; code: string; requiresLab: boolean; isDoublePeriod: boolean };
  section: { id: string; name: string };
}

type SlotFlags = {
  isLab?: boolean;
  isGames?: boolean;
  isYoga?: boolean;
  isLibrary?: boolean;
  isInnovation?: boolean;
  isWE?: boolean;
  isMusic?: boolean;
  isArt?: boolean;
  isFiller?: boolean;
};

type SlotRecord = {
  sectionId: string;
  dayId: string;
  timeSlotId: string;
  subjectId: string;
  teacherId: string;
  roomId?: string | null;
  isLab: boolean;
  isGames: boolean;
  isYoga: boolean;
  isLibrary: boolean;
  isInnovation: boolean;
  isWE: boolean;
  isMusic: boolean;
  isArt: boolean;
  isFiller: boolean;
};

type ScoringWeightsConfig = {
  subjectPreferenceWeight: number;
  teacherDailyLoadWeight: number;
  sectionDailyLoadWeight: number;
  subjectSpreadWeight: number;
  teacherAdjacencyPenaltyWeight: number;
  labLastPeriodPenaltyWeight: number;
  classTeacherBonusWeight: number;
  roomAvailabilityWeight: number;
  labPlacementWeight: number;
};

// ─── Subject classification constants ─────────────────────────────────────────

// W.E. (Work Experience) subjects — Music, Dance, Art students choose one per term.
// Multiple sections attend W.E. simultaneously so the teacher conflict rule is relaxed.
const WE_SUBJECTS = new Set(['Music', 'Dance', 'Art', 'Work Experience']);

// Subjects where the SAME teacher can supervise multiple sections simultaneously
// (e.g. Yoga on the school grounds, Games on the sports field, Library self-study).
// W.E. subjects (Music, Dance, Art) are NOT here — each W.E. teacher handles exactly
// one section at a time and the normal teacher-conflict check must apply.
const SHARED_SLOT_SUBJECTS = new Set(['Games', 'Yoga', 'Aerobics', 'Innovation', 'Library']);

// R11: Activity subjects placed in periods 6-8 (soft preference, hard block on 1-2).
// Games is EXCLUDED — it has its own placement rules (any period 3-8, see GAMES_* constants).
const END_PERIOD_SUBJECTS = new Set([
  'Yoga', 'Aerobics', 'Library', 'Work Experience',
  'Music', 'Dance', 'Art', 'Innovation',
]);

// Subjects that must not be placed in period 1.
const NO_PERIOD_1_SUBJECTS = new Set([
  'Library', 'Games', 'Yoga', 'Aerobics', 'Music', 'Dance', 'Art', 'Work Experience', 'Innovation',
]);

// R9: Core academic subjects — prefer early periods (1–5) for maximum student alertness.
const PREFER_MORNING_SUBJECTS = new Set([
  'Mathematics', 'Physics', 'Chemistry', 'English', 'Biology',
]);

// Subjects whose teachers have NO weekly workload cap.
// Games is removed — sports teachers now use targetWorkload + 1 cap (see GAMES_WORKLOAD_BUFFER).
const UNCAPPED_SUBJECTS = new Set(['Yoga', 'Aerobics', 'Library']);

// ─── Games department constants ───────────────────────────────────────────────
// The sports department works as a single pool:
//   • No soft placement constraints (periods 3–8 all equally valid)
//   • Hard block: periods 1 and 2 only (no Games in first two periods)
//   • Hard cap: at most MAX_GAMES_PER_SLOT sections can have Games in the same period/day
//   • Workload: each sports teacher gets targetWorkload + GAMES_WORKLOAD_BUFFER
const MAX_GAMES_PER_SLOT     = 3;   // max simultaneous sections with Games in any one period
const GAMES_WORKLOAD_BUFFER  = 1;   // sports teachers: targetWorkload + 1

// Grades where Yoga/Aerobics are NOT scheduled (XI and XII have no Yoga/Aerobics periods).
const NO_YOGA_GRADES = new Set(['XI', 'XII']);




// ─── POST — generate timetable ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const body = await request.json();
    const parsed = GenerateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }
    const preserveLockedFromQuery = searchParams.get('preserveLocked');
    const previewFromQuery = searchParams.get('preview');
    const preserveLocked =
      preserveLockedFromQuery === null
        ? parsed.data.preserveLocked
        : preserveLockedFromQuery === 'true';
    const preview = previewFromQuery === 'true';
    const { clearExisting, autoRepairLabs } = parsed.data;

    // ── 1. Load data ──────────────────────────────────────────────────────────
    const [sectionsRaw, teachers, subjects, days, timeSlots, teacherSubjects, teacherUnavailability, rooms, scoringWeightsRow, lockedSlots, allExistingSlots, schoolConfig] = await Promise.all([
      db.section.findMany({ include: { grade: true } }),
      db.teacher.findMany({ orderBy: { targetWorkload: 'desc' } }),
      db.subject.findMany(),
      db.day.findMany({ orderBy: { dayOrder: 'asc' } }),
      db.timeSlot.findMany({ orderBy: { periodNumber: 'asc' } }),
      db.teacherSubject.findMany({
        include: { teacher: true, subject: true, section: true },
      }),
      db.teacherUnavailability.findMany({
        select: { teacherId: true, dayId: true, timeSlotId: true },
      }),
      db.room.findMany({
        include: { subjects: true },
      }),
      db.scoringWeights.findUnique({ where: { name: 'default' } }),
      db.timetableSlot.findMany({
        where: { manuallyEdited: true },
        include: { timeSlot: true, subject: true },
      }),
      db.timetableSlot.findMany({
        include: { timeSlot: true, subject: true },
      }),
      db.schoolConfig.findFirst(),
    ]);
    const sections = sortSectionsByGradeThenName(sectionsRaw);
    const scoringWeights: ScoringWeightsConfig = {
      subjectPreferenceWeight: scoringWeightsRow?.subjectPreferenceWeight ?? 2.0,
      teacherDailyLoadWeight: scoringWeightsRow?.teacherDailyLoadWeight ?? 1.5,
      sectionDailyLoadWeight: scoringWeightsRow?.sectionDailyLoadWeight ?? 1.0,
      subjectSpreadWeight: scoringWeightsRow?.subjectSpreadWeight ?? 1.5,
      teacherAdjacencyPenaltyWeight: scoringWeightsRow?.teacherAdjacencyPenaltyWeight ?? 1.2,
      labLastPeriodPenaltyWeight: scoringWeightsRow?.labLastPeriodPenaltyWeight ?? 1.0,
      classTeacherBonusWeight: scoringWeightsRow?.classTeacherBonusWeight ?? 0.8,
      roomAvailabilityWeight: scoringWeightsRow?.roomAvailabilityWeight ?? 1.0,
      labPlacementWeight: scoringWeightsRow?.labPlacementWeight ?? 2.0,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[generate] Loaded: ${sections.length} sections, ${teachers.length} teachers, ` +
        `${subjects.length} subjects, ${days.length} days, ${timeSlots.length} periods, ` +
        `${teacherSubjects.length} teacher-subject assignments`
      );
    }

    // ── Lookup tables built once ──────────────────────────────────────────────

    // Grade name per section (lab room filters, yoga exclusions, etc.)
    const sectionGradeMap = new Map<string, string>(
      sections.map(s => [s.id, (s as any).grade?.name ?? ''])
    );

    // Class teacher per section (used for class-teacher-preference ordering)
    const sectionClassTeacherMap = new Map<string, string>(
      sections
        .filter(s => s.classTeacherId)
        .map(s => [s.id, s.classTeacherId as string])
    );
    const teacherUnavailabilitySet = new Set<string>(
      teacherUnavailability.map(u => `${u.teacherId}|${u.dayId}-${u.timeSlotId}`)
    );
    const roomSubjectMap = new Map<string, typeof rooms>();
    for (const room of rooms) {
      for (const link of room.subjects) {
        if (!roomSubjectMap.has(link.subjectId)) roomSubjectMap.set(link.subjectId, []);
        roomSubjectMap.get(link.subjectId)!.push(room);
      }
    }

    // R8: Track which subjectId occupies which periodNumber for each (sectionId, dayId).
    // Used to prevent the same subject appearing in back-to-back periods within a day.
    const sectionDayPeriodSubject = new Map<string, Map<number, string>>();

    // Games department pool tracking:
    // gamesSlotCount[dayId-timeSlotId] = number of sections that have Games in that slot.
    // Hard cap: MAX_GAMES_PER_SLOT sections per slot across the whole school.
    const gamesSubjectId = subjects.find(s => s.name === 'Games')?.id ?? '';
    const gamesSlotCount = new Map<string, number>();
    // Sports teacher IDs — needed to apply the +1 workload buffer check
    const sportsTeacherIds = new Set(
      teachers.filter(t => t.department === 'Sports').map(t => t.id)
    );

    let preservedLockedCount = 0;
    if (clearExisting && !preview) {
      if (preserveLocked) {
        const deleted = await db.timetableSlot.deleteMany({ where: { manuallyEdited: false } });
        preservedLockedCount = lockedSlots.length;
        if (process.env.NODE_ENV === 'development') {
          console.log(`Cleared ${deleted.count} unlocked slots, preserved ${preservedLockedCount} locked slots`);
        }
      } else {
        await db.timetableSlot.deleteMany();
        preservedLockedCount = 0;
        if (process.env.NODE_ENV === 'development') { console.log('Cleared existing timetable slots'); }
      }
    }
    if (clearExisting && preview) {
      preservedLockedCount = preserveLocked ? lockedSlots.length : 0;
    }

    // ── 2. Constraint matrices ────────────────────────────────────────────────

    // teacher/section -> Set of "dayId-timeSlotId" (conflict detection)
    const teacherBusy = new Map<string, Set<string>>(teachers.map(t => [t.id, new Set()]));
    const sectionBusy = new Map<string, Set<string>>(sections.map(s => [s.id, new Set()]));
    const roomBusy = new Set<string>(); // roomId|dayId-timeSlotId

    // Running workload counters (updated on every assignSlot call)
    const teacherLoad = new Map<string, number>(teachers.map(t => [t.id, 0]));

    // Daily period count per teacher.
    // R10: Cap at ceil(targetWorkload / workingDays) + 1 per teacher to spread load across week.
    // Global ceiling of 5 prevents any teacher from being overloaded on a single day.
    const teacherDailyLoad = new Map<string, Map<string, number>>(
      teachers.map(t => [t.id, new Map()])
    );
    const sectionDailyLoad = new Map<string, Map<string, number>>(
      sections.map(s => [s.id, new Map()])
    );
    const GLOBAL_MAX_PERIODS_PER_DAY = 5;
    const teacherMaxPerDay = new Map<string, number>(
      teachers.map(t => [
        t.id,
        Math.min(GLOBAL_MAX_PERIODS_PER_DAY, Math.ceil(t.targetWorkload / days.length) + 1),
      ])
    );

    // Max-3-consecutive tracking: "teacherId|dayId" -> Set<periodNumber>
    const teacherPeriodsByDay = new Map<string, Set<number>>();

    // Subject-per-day per section: section+day -> Set<subjectId>
    // Prevents the same subject appearing twice on one day for one section
    // (except double-period lab pairs, which are flagged separately)
    const sectionDaySubjects = new Map<string, Set<string>>();
    for (const s of sections) {
      for (const d of days) {
        sectionDaySubjects.set(`${s.id}|${d.id}`, new Set());
      }
    }

    // ── 3. Core helpers ───────────────────────────────────────────────────────

    const getAllowedLabRooms = (subjectId: string, sectionId: string) => {
      const grade = sectionGradeMap.get(sectionId) ?? '';
      const candidates = roomSubjectMap.get(subjectId) ?? [];
      return candidates.filter((room) => {
        let raw: unknown = room.grades;
        if (!raw) return true;
        // SQLite may return Json fields as strings — parse if needed
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch { return true; }
        }
        if (!Array.isArray(raw)) return true;
        return (raw as string[]).includes(grade);
      });
    };

    const findAvailableLabRoom = (
      subjectId: string,
      sectionId: string,
      dayId: string,
      timeSlotId: string,
      preferredRoomId?: string | null
    ) => {
      const candidates = getAllowedLabRooms(subjectId, sectionId);
      if (preferredRoomId) {
        const preferred = candidates.find(r => r.id === preferredRoomId);
        if (preferred && !roomBusy.has(`${preferred.id}|${dayId}-${timeSlotId}`)) return preferred;
      }
      return candidates.find(r => !roomBusy.has(`${r.id}|${dayId}-${timeSlotId}`)) ?? null;
    };

    const maxSectionPerDay = timeSlots.length;
    const morningPreferenceByPeriod = new Map<number, number>(
      timeSlots.map(ts => [ts.periodNumber, ts.periodNumber >= 2 && ts.periodNumber <= 5 ? 1 : 0])
    );
    const endPreferenceByPeriod = new Map<number, number>(
      timeSlots.map(ts => [ts.periodNumber, ts.periodNumber >= 6 ? 1 : 0])
    );

    const pickBestScoredSlot = (
      teacherId: string,
      sectionId: string,
      candidateDays: { id: string; dayOrder: number }[],
      subjectId: string,
      subjectName: string
    ): { dayId: string; slot: SlimSlot } | null => {
      const sectionObj = sections.find(s => s.id === sectionId);
      const subjectObj = subjects.find(s => s.id === subjectId);
      const teacherObj = teachers.find(t => t.id === teacherId);
      if (!sectionObj || !subjectObj || !teacherObj) return null;

      let bestScore = Number.NEGATIVE_INFINITY;
      let bestSlot: { dayId: string; slot: SlimSlot } | null = null;

      for (const day of candidateDays) {
        for (const ts of timeSlots) {
          if (!isAvailable(teacherId, sectionId, day.id, ts.id, subjectId)) continue;
          const score = scoreSlot({
            section: { id: sectionObj.id, name: sectionObj.name },
            dayId: day.id,
            timeSlotId: ts.id,
            teacher: { id: teacherObj.id, abbreviation: teacherObj.abbreviation },
            subject: { id: subjectObj.id, name: subjectName, requiresLab: subjectObj.requiresLab },
            state: {
              timeSlots,
              teacherDailyLoad,
              sectionDailyLoad,
              sectionDaySubjects,
              sectionClassTeacherMap,
              teacherPeriodsByDay,
              roomSubjectMap,
              roomBusy,
              maxSectionPerDay,
              teacherMaxPerDay,
              morningPreferenceByPeriod,
              endPreferenceByPeriod,
              scoringWeights,
              getAllowedLabRooms,
            },
          });
          if (
            score > bestScore ||
            (score === bestScore && bestSlot && day.dayOrder < (candidateDays.find(d => d.id === bestSlot?.dayId)?.dayOrder ?? 999))
          ) {
            bestScore = score;
            bestSlot = { dayId: day.id, slot: ts };
          }
        }
      }

      return bestSlot;
    };

    const moveSectionSlotWithinDay = (
      sectionId: string,
      dayId: string,
      fromTimeSlotId: string,
      toTimeSlotId: string
    ): boolean => {
      const fromKey = `${sectionId}|${dayId}|${fromTimeSlotId}`;
      const idx = sectionSlotIndex.get(fromKey);
      if (idx === undefined) return false;
      const rec = createdSlots[idx];
      const subj = subjects.find(s => s.id === rec.subjectId);
      if (!subj) return false;
      // Keep swap conservative: do not move labs or shared-slot activities.
      if (subj.requiresLab || SHARED_SLOT_SUBJECTS.has(subj.name) || rec.subjectId === gamesSubjectId) return false;
      if (!isAvailable(rec.teacherId, sectionId, dayId, toTimeSlotId, rec.subjectId, true)) return false;

      const oldBusyKey = `${dayId}-${fromTimeSlotId}`;
      const newBusyKey = `${dayId}-${toTimeSlotId}`;
      sectionBusy.get(sectionId)?.delete(oldBusyKey);
      sectionBusy.get(sectionId)?.add(newBusyKey);

      const teacherId = rec.teacherId;
      teacherBusy.get(teacherId)?.delete(oldBusyKey);
      teacherBusy.get(teacherId)?.add(newBusyKey);

      const fromPeriod = timeSlots.find(t => t.id === fromTimeSlotId)?.periodNumber;
      const toPeriod = timeSlots.find(t => t.id === toTimeSlotId)?.periodNumber;
      if (fromPeriod && toPeriod) {
        const sdKey = `${sectionId}|${dayId}`;
        const periodMap = sectionDayPeriodSubject.get(sdKey);
        if (periodMap) {
          periodMap.delete(fromPeriod);
          periodMap.set(toPeriod, rec.subjectId);
        }
        const pdKey = `${teacherId}|${dayId}`;
        if (!teacherPeriodsByDay.has(pdKey)) teacherPeriodsByDay.set(pdKey, new Set());
        const set = teacherPeriodsByDay.get(pdKey)!;
        set.delete(fromPeriod);
        set.add(toPeriod);
      }

      if (rec.roomId) {
        roomBusy.delete(`${rec.roomId}|${dayId}-${fromTimeSlotId}`);
        roomBusy.add(`${rec.roomId}|${dayId}-${toTimeSlotId}`);
      }

      rec.timeSlotId = toTimeSlotId;
      sectionSlotIndex.delete(fromKey);
      sectionSlotIndex.set(`${sectionId}|${dayId}|${toTimeSlotId}`, idx);
      return true;
    };

    const findLabConsecutivePair = (
      teacherId: string,
      sectionId: string,
      subjectId: string
    ): { dayId: string; pair: [SlimSlot, SlimSlot] } | null => {
      const dayByFree = days
        .map(d => ({
          day: d,
          freeCount: timeSlots.filter(ts => isAvailable(null, sectionId, d.id, ts.id)).length,
        }))
        .sort((a, b) => b.freeCount - a.freeCount || a.day.dayOrder - b.day.dayOrder)
        .map(x => x.day);

      for (const day of dayByFree) {
        const pair = findConsecutivePair(teacherId, sectionId, day.id, timeSlots, subjectId, isAvailable);
        if (pair) return { dayId: day.id, pair };

        const sorted = [...timeSlots].sort((a, b) => a.periodNumber - b.periodNumber);
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i + 1].periodNumber !== sorted[i].periodNumber + 1) continue;
          const a = sorted[i];
          const b = sorted[i + 1];
          const aFree = isAvailable(teacherId, sectionId, day.id, a.id, subjectId, true);
          const bFree = isAvailable(teacherId, sectionId, day.id, b.id, subjectId, true);
          if (aFree === bFree) continue;

          const occupied = aFree ? b : a;
          const partner = aFree ? a : b;
          const alternatives = sorted.filter(ts => ts.id !== a.id && ts.id !== b.id);
          for (const alt of alternatives) {
            if (moveSectionSlotWithinDay(sectionId, day.id, occupied.id, alt.id)) {
              if (
                isAvailable(teacherId, sectionId, day.id, occupied.id, subjectId, true) &&
                isAvailable(teacherId, sectionId, day.id, partner.id, subjectId, true)
              ) {
                return { dayId: day.id, pair: [occupied, partner].sort((x, y) => x.periodNumber - y.periodNumber) as unknown as [SlimSlot, SlimSlot] };
              }
            }
          }
        }
      }
      return null;
    };

    /**
     * Returns true if adding newSlotOrder for this teacher on this day would create
     * a run of 4 or more consecutive periods (i.e., enforces max-3-consecutive rule).
     */
    const hasRunOfFour = (teacherId: string, dayId: string, newSlotOrder: number): boolean => {
      const key = `${teacherId}|${dayId}`;
      const orders = teacherPeriodsByDay.get(key) ?? new Set<number>();
      const all = [...orders, newSlotOrder].sort((a, b) => a - b);
      for (let i = 0; i <= all.length - 4; i++) {
        if (all[i + 3] - all[i] === 3) return true;
      }
      return false;
    };

    /**
     * Check if a slot is free.
     * Enforces: section busy, teacher busy, daily load, max-consecutive,
     * period-1 restrictions for certain subject types,
     * end-period-only subjects (R11), and subject-per-day spread.
     *
     * @param subjectId      When provided, also enforces subject-per-day constraint.
     * @param bypassSubjectDay  Set true for double-period pairs (same subject 2×/day is OK).
     */
    const isAvailable = (
      teacherId: string | null,
      sectionId: string,
      dayId: string,
      timeSlotId: string,
      subjectId?: string,
      bypassSubjectDay = false
    ): boolean => {
      const key = `${dayId}-${timeSlotId}`;

      // Section already has a subject here
      if (sectionBusy.get(sectionId)?.has(key)) return false;

      const subjectObj = subjectId ? subjects.find(s => s.id === subjectId) : null;
      const isSharedSlot = subjectObj ? SHARED_SLOT_SUBJECTS.has(subjectObj.name) : false;

      if (teacherId) {
        // Teacher-specific unavailability is always hard-blocking.
        if (teacherUnavailabilitySet.has(`${teacherId}|${dayId}-${timeSlotId}`)) return false;

        if (!isSharedSlot) {
          // Regular subjects: teacher can only be in one place at a time
          if (teacherBusy.get(teacherId)?.has(key)) return false;
          // R10: enforce per-teacher daily spread cap
          const maxToday = teacherMaxPerDay.get(teacherId) ?? GLOBAL_MAX_PERIODS_PER_DAY;
          if ((teacherDailyLoad.get(teacherId)?.get(dayId) ?? 0) >= maxToday) return false;
          const slot = timeSlots.find(t => t.id === timeSlotId);
          if (slot && hasRunOfFour(teacherId, dayId, slot.periodNumber)) return false;
        }
      }

      if (subjectObj) {
        const slot = timeSlots.find(t => t.id === timeSlotId);

        // Period 1 must not be lab, library, games, yoga, or any activity subject
        if (slot?.periodNumber === 1) {
          if (subjectObj.requiresLab || NO_PERIOD_1_SUBJECTS.has(subjectObj.name)) return false;
        }

        // Yoga/Aerobics are not scheduled for classes XI and XII.
        if ((subjectObj.name === 'Yoga' || subjectObj.name === 'Aerobics') &&
            NO_YOGA_GRADES.has(sectionGradeMap.get(sectionId) ?? '')) {
          return false;
        }

        // W.E. subjects (Music, Art, Dance, Work Experience) are only for classes VI–IX.
        if (WE_SUBJECTS.has(subjectObj.name)) {
          const grade = sectionGradeMap.get(sectionId) ?? '';
          if (grade === 'X' || grade === 'XI' || grade === 'XII') return false;
        }

        // Games-specific hard constraints (no soft constraints apply to Games):
        //   1. Periods 1 and 2 are blocked.
        //   2. At most MAX_GAMES_PER_SLOT sections can have Games in the same slot school-wide.
        if (subjectId === gamesSubjectId) {
          if (!slot || slot.periodNumber <= 2) return false;
          if ((gamesSlotCount.get(key) ?? 0) >= MAX_GAMES_PER_SLOT) return false;
        }

        // R11 (hard part): Non-games activity subjects must NOT be in periods 1 or 2.
        // Preference for periods 6-8 is a soft constraint handled in pickSlot.
        if (END_PERIOD_SUBJECTS.has(subjectObj.name)) {
          if (!slot || slot.periodNumber <= 2) return false;
        }

        // R8: Prevent back-to-back same subject within a day for a section.
        // (Lab pairs bypass this via bypassSubjectDay.)
        if (!bypassSubjectDay && slot && subjectId) {
          const sdKey = `${sectionId}|${dayId}`;
          const periodMap = sectionDayPeriodSubject.get(sdKey);
          if (periodMap) {
            const prevSubject = periodMap.get(slot.periodNumber - 1);
            if (prevSubject === subjectId) return false; // same subject in previous period → skip
          }
        }

        // Lab subjects must have an eligible free room for this slot.
        // But only if lab rooms actually exist for this grade — grades VI-VIII often use classrooms.
        if (subjectObj.requiresLab) {
          const labCandidates = getAllowedLabRooms(subjectObj.id, sectionId);
          if (labCandidates.length > 0) {
            const room = findAvailableLabRoom(subjectObj.id, sectionId, dayId, timeSlotId);
            if (!room) return false;
          }
        }
      }

      if (subjectId && !bypassSubjectDay) {
        if (sectionDaySubjects.get(`${sectionId}|${dayId}`)?.has(subjectId)) return false;
      }
      return true;
    };

    const createdSlots: SlotRecord[] = [];
    const sectionSlotIndex = new Map<string, number>();

    // Seed constraint maps with preserved locked slots so generator works around them.
    const baselineSlots = clearExisting
      ? (preserveLocked ? lockedSlots : [])
      : allExistingSlots;
    if (baselineSlots.length > 0) {
      for (const slot of baselineSlots) {
        const key = `${slot.dayId}-${slot.timeSlotId}`;
        sectionBusy.get(slot.sectionId)?.add(key);
        const sdm = sectionDailyLoad.get(slot.sectionId);
        if (sdm) sdm.set(slot.dayId, (sdm.get(slot.dayId) ?? 0) + 1);

        if (slot.subjectId) {
          const sdKey = `${slot.sectionId}|${slot.dayId}`;
          sectionDaySubjects.get(sdKey)?.add(slot.subjectId);
          if (!sectionDayPeriodSubject.has(sdKey)) sectionDayPeriodSubject.set(sdKey, new Map());
          sectionDayPeriodSubject.get(sdKey)!.set(slot.timeSlot.periodNumber, slot.subjectId);
        }

        if (slot.teacherId) {
          teacherBusy.get(slot.teacherId)?.add(key);
          teacherLoad.set(slot.teacherId, (teacherLoad.get(slot.teacherId) ?? 0) + 1);
          const dm = teacherDailyLoad.get(slot.teacherId);
          if (dm) dm.set(slot.dayId, (dm.get(slot.dayId) ?? 0) + 1);
          const pdKey = `${slot.teacherId}|${slot.dayId}`;
          if (!teacherPeriodsByDay.has(pdKey)) teacherPeriodsByDay.set(pdKey, new Set());
          teacherPeriodsByDay.get(pdKey)!.add(slot.timeSlot.periodNumber);
        }

        if (slot.roomId) {
          roomBusy.add(`${slot.roomId}|${slot.dayId}-${slot.timeSlotId}`);
        }
      }
    }

    const assign = (
      sectionId: string,
      dayId: string,
      timeSlotId: string,
      subjectId: string,
      teacherId: string,
      flags: SlotFlags = {},
      preferredRoomId?: string | null
    ): boolean => {
      const key = `${dayId}-${timeSlotId}`;
      const slot = timeSlots.find(t => t.id === timeSlotId);
      const sdKey = `${sectionId}|${dayId}`;
      const subjectObj = subjects.find(s => s.id === subjectId);
      let assignedRoomId: string | null = null;

      if (subjectObj?.requiresLab) {
        const labCandidates = getAllowedLabRooms(subjectId, sectionId);
        if (labCandidates.length > 0) {
          const room = findAvailableLabRoom(subjectId, sectionId, dayId, timeSlotId, preferredRoomId);
          if (!room) return false;
          assignedRoomId = room.id;
          roomBusy.add(`${room.id}|${dayId}-${timeSlotId}`);
        }
      }

      // Section is now occupied at this slot
      sectionBusy.get(sectionId)?.add(key);
      sectionDaySubjects.get(sdKey)?.add(subjectId);
      const sdm = sectionDailyLoad.get(sectionId);
      if (sdm) sdm.set(dayId, (sdm.get(dayId) ?? 0) + 1);
      if (slot) {
        if (!sectionDayPeriodSubject.has(sdKey)) sectionDayPeriodSubject.set(sdKey, new Map());
        sectionDayPeriodSubject.get(sdKey)!.set(slot.periodNumber, subjectId);
      }

      if (subjectId === gamesSubjectId) {
        // Games department works as a single unit: all sports teachers share the same schedule.
        // On the FIRST section assigned to a (day, period) Games slot, mark every sports teacher
        // as busy and count it as 1 period of work each.  Subsequent sections in the same slot
        // (up to MAX_GAMES_PER_SLOT) don't re-increment — the teachers are already there.
        const isFirstForSlot = (gamesSlotCount.get(key) ?? 0) === 0;
        gamesSlotCount.set(key, (gamesSlotCount.get(key) ?? 0) + 1);

        if (isFirstForSlot && slot) {
          for (const sportsTid of sportsTeacherIds) {
            teacherBusy.get(sportsTid)?.add(key);
            teacherLoad.set(sportsTid, (teacherLoad.get(sportsTid) ?? 0) + 1);
            const dm = teacherDailyLoad.get(sportsTid);
            if (dm) dm.set(dayId, (dm.get(dayId) ?? 0) + 1);
            const pdKey = `${sportsTid}|${dayId}`;
            if (!teacherPeriodsByDay.has(pdKey)) teacherPeriodsByDay.set(pdKey, new Set());
            teacherPeriodsByDay.get(pdKey)!.add(slot.periodNumber);
          }
        }
      } else {
        // For SHARED_SLOT_SUBJECTS (Yoga, Aerobics, Library, Innovation) a single teacher
        // supervises multiple sections at the same (day, period).  The first section to use
        // a slot marks the teacher busy and counts as 1 period of work.  Subsequent sections
        // at the same slot find the teacher already busy → skip all load increments so the
        // workload counter reflects unique periods worked, not total section-slots.
        const isShared   = subjectObj ? SHARED_SLOT_SUBJECTS.has(subjectObj.name) : false;
        const alreadyBusy = isShared && (teacherBusy.get(teacherId)?.has(key) ?? false);

        teacherBusy.get(teacherId)?.add(key); // always mark busy (idempotent for shared)

        if (!alreadyBusy) {
          // First time this teacher is assigned to this (day, period) — count the period once
          teacherLoad.set(teacherId, (teacherLoad.get(teacherId) ?? 0) + 1);
          const dm = teacherDailyLoad.get(teacherId)!;
          dm.set(dayId, (dm.get(dayId) ?? 0) + 1);
          if (slot) {
            const pdKey = `${teacherId}|${dayId}`;
            if (!teacherPeriodsByDay.has(pdKey)) teacherPeriodsByDay.set(pdKey, new Set());
            teacherPeriodsByDay.get(pdKey)!.add(slot.periodNumber);
          }
        }
      }

      // Auto-derive flags from subject name so callers don't need to pass them explicitly
      const subName = subjects.find(s => s.id === subjectId)?.name ?? '';
      createdSlots.push({
        sectionId,
        dayId,
        timeSlotId,
        subjectId,
        teacherId,
        roomId: assignedRoomId,
        isLab: flags.isLab ?? subjects.find(s => s.id === subjectId)?.requiresLab ?? false,
        isGames: flags.isGames ?? subName === 'Games',
        isYoga: flags.isYoga ?? subName === 'Yoga',
        isLibrary: flags.isLibrary ?? subName === 'Library',
        isInnovation: flags.isInnovation ?? subName === 'Innovation',
        isWE: flags.isWE ?? WE_SUBJECTS.has(subName),
        isMusic: flags.isMusic ?? subName === 'Music',
        isArt: flags.isArt ?? subName === 'Art',
        isFiller: flags.isFiller ?? false,
      });
      sectionSlotIndex.set(`${sectionId}|${dayId}|${timeSlotId}`, createdSlots.length - 1);
      return true;
    };

    // ══════════════════════════════════════════════════════════════════════════
    // ═══ TWO-LAYER HEURISTIC TIMETABLE GENERATOR ════════════════════════════
    // Layer 1: Teacher→Section allocation (read from DB, validate, auto-fill)
    // Layer 2: Period placement (constrained → core → filler → fallback)
    // ══════════════════════════════════════════════════════════════════════════

    // ── SUBJECT FREQUENCY TABLE (derived from school PDF analysis) ───────────
    // Classes VI–X: all sections in a grade share the same frequency.
    // Classes XI–XII: use per-section periodsPerWeek from TeacherSubject DB.
    const SUBJECT_PERIODS: Record<string, Record<string, number>> = {
      'VI':  { Mathematics:6, English:5, Science:5, 'Social Studies':5, 'Computer Science':2, Hindi:3, Nepali:3, Games:2, 'Work Experience':1, Yoga:1, Library:1, Innovation:1, Aerobics:1 },
      'VII': { Mathematics:6, English:5, Science:5, 'Social Studies':5, 'Computer Science':2, Hindi:3, Nepali:3, Games:2, 'Work Experience':1, Yoga:1, Library:1, Innovation:1, Aerobics:1 },
      'VIII':{ Mathematics:6, English:5, Science:5, 'Social Studies':5, 'Computer Science':2, Hindi:3, Nepali:3, Games:2, 'Work Experience':1, Yoga:1, Library:1, Innovation:1, Aerobics:1 },
      'IX':  { Mathematics:6, English:5, Physics:2, Chemistry:2, Biology:2, 'Social Studies':5, 'Computer Science':2, Hindi:3, Nepali:3, Games:2, 'Work Experience':1, Yoga:1, Library:1, Innovation:1 },
      'X':   { Mathematics:6, English:5, Physics:2, Chemistry:2, Biology:2, 'Social Studies':5, 'Computer Science':2, Hindi:3, Nepali:3, Games:2, Yoga:1, Library:1, Innovation:1 },
    };

    // Heavy subjects: max 2 of these per day per section (Improvement 5)
    const HEAVY_SUBJECTS = new Set(['Mathematics', 'Physics', 'Chemistry', 'Science', 'Biology']);
    const MAX_HEAVY_PER_DAY = 2;

    // Track heavy subjects per section per day
    const sectionDayHeavyCount = new Map<string, number>();

    const unassigned: string[] = [];
    const warnings: string[] = [];

    // ═══ LAYER 1: TEACHER ALLOCATION ═════════════════════════════════════════
    // Build sectionTeacherMap: Map<sectionId, Map<subjectId, teacherId>>
    // Rule T1: One teacher per subject per section
    // Rule T2: Teacher must be eligible for the section's grade
    // Rule T3: Balance workload across teachers
    if (process.env.NODE_ENV === 'development') { console.log('Layer 1: Teacher Allocation...'); }

    // Deduplicate teacherSubjects: keep one primary teacher per (section, subject)
    const labAssistants: typeof teacherSubjects = [];
    const primaryMap = new Map<string, typeof teacherSubjects[0]>();

    for (const a of [...teacherSubjects].sort((x, y) => y.periodsPerWeek - x.periodsPerWeek)) {
      if (a.teacher.department === 'Lab') {
        labAssistants.push(a);
        continue;
      }
      const k = `${a.sectionId}|${a.subjectId}`;
      if (!primaryMap.has(k)) {
        primaryMap.set(k, a);
      }
    }

    const assignments: TeacherAssignment[] = Array.from(primaryMap.values()) as TeacherAssignment[];

    // Build the sectionTeacherMap from existing assignments
    const sectionTeacherMap = new Map<string, Map<string, { teacherId: string; periodsPerWeek: number }>>();
    for (const section of sections) {
      sectionTeacherMap.set(section.id, new Map());
    }

    for (const a of assignments) {
      const map = sectionTeacherMap.get(a.sectionId);
      if (map) {
        map.set(a.subjectId, { teacherId: a.teacherId, periodsPerWeek: a.periodsPerWeek });
      }
    }

    // Determine effective periodsPerWeek for each (section, subject)
    // For VI–X: use SUBJECT_PERIODS table. For XI–XII: use DB value.
    const getPeriodsPerWeek = (sectionId: string, subjectId: string): number => {
      const grade = sectionGradeMap.get(sectionId) ?? '';
      const subjectObj = subjects.find(s => s.id === subjectId);
      if (!subjectObj) return 0;

      const freqTable = SUBJECT_PERIODS[grade];
      if (freqTable && freqTable[subjectObj.name] !== undefined) {
        return freqTable[subjectObj.name];
      }

      // XI/XII: use DB-defined periodsPerWeek
      const map = sectionTeacherMap.get(sectionId);
      return map?.get(subjectId)?.periodsPerWeek ?? 0;
    };

    if (process.env.NODE_ENV === 'development') {
      console.log(`Layer 1 complete: ${assignments.length} primary assignments, ${labAssistants.length} lab-assistant assignments`);
    }

    // ═══ LAYER 2: PERIOD PLACEMENT ═══════════════════════════════════════════
    if (process.env.NODE_ENV === 'development') { console.log('Layer 2: Period Placement...'); }

    // ── Helper: check if can place a subject in a slot ──
    const canPlace = (
      teacherId: string,
      sectionId: string,
      dayId: string,
      timeSlotId: string,
      subjectId: string,
      subjectName: string,
      relaxed = false,
    ): boolean => {
      const key = `${dayId}-${timeSlotId}`;
      const slot = timeSlots.find(t => t.id === timeSlotId);

      // Hard: section already occupied
      if (sectionBusy.get(sectionId)?.has(key)) return false;
      // Hard: teacher personal unavailability
      if (teacherUnavailabilitySet.has(`${teacherId}|${key}`)) return false;

      const isShared = SHARED_SLOT_SUBJECTS.has(subjectName);
      if (!isShared) {
        // Hard: teacher already teaching another section at this slot
        if (teacherBusy.get(teacherId)?.has(key)) return false;
      }

      // Yoga/Aerobics not for XI/XII
      if ((subjectName === 'Yoga' || subjectName === 'Aerobics') &&
          NO_YOGA_GRADES.has(sectionGradeMap.get(sectionId) ?? '')) return false;

      // W.E. only for VI–IX
      if (WE_SUBJECTS.has(subjectName)) {
        const grade = sectionGradeMap.get(sectionId) ?? '';
        if (grade === 'X' || grade === 'XI' || grade === 'XII') return false;
      }

      // Games slot cap
      if (subjectName === 'Games') {
        if ((gamesSlotCount.get(key) ?? 0) >= MAX_GAMES_PER_SLOT) return false;
      }

      if (!relaxed) {
        // P2: Max 2 same subject per day
        const sdKey = `${sectionId}|${dayId}`;
        const subjectsToday = sectionDaySubjects.get(sdKey);
        if (subjectsToday) {
          // Count how many times this subject appears today
          let count = 0;
          const periodMap = sectionDayPeriodSubject.get(sdKey);
          if (periodMap) {
            for (const [, sid] of periodMap) {
              if (sid === subjectId) count++;
            }
          }
          if (count >= 2) return false;
        }

        // P4: Activity subjects in periods 3-8 (not period 1-2)
        if (END_PERIOD_SUBJECTS.has(subjectName) || NO_PERIOD_1_SUBJECTS.has(subjectName)) {
          if (slot && slot.periodNumber <= 2) return false;
        }

        // P6: Heavy subject daily cap
        if (HEAVY_SUBJECTS.has(subjectName)) {
          const hdKey = `${sectionId}|${dayId}`;
          if ((sectionDayHeavyCount.get(hdKey) ?? 0) >= MAX_HEAVY_PER_DAY) return false;
        }

        // Lab room requirement — only enforced if lab rooms exist for this grade
        const subjectObj = subjects.find(s => s.id === subjectId);
        if (subjectObj?.requiresLab) {
          const labCandidates = getAllowedLabRooms(subjectId, sectionId);
          if (labCandidates.length > 0) {
            const room = findAvailableLabRoom(subjectId, sectionId, dayId, timeSlotId);
            if (!room) return false;
          }
        }

        // R10: teacher daily load cap
        if (!isShared) {
          const maxToday = teacherMaxPerDay.get(teacherId) ?? GLOBAL_MAX_PERIODS_PER_DAY;
          if ((teacherDailyLoad.get(teacherId)?.get(dayId) ?? 0) >= maxToday) return false;
          // Max 3 consecutive check
          if (slot && hasRunOfFour(teacherId, dayId, slot.periodNumber)) return false;
        }
      }

      return true;
    };

    // ── Anchor strategy: preferred period numbers per subject ──────────────────
    // From real school PDF analysis: heavy subjects are anchored to a fixed period
    // slot across all days. E.g. Maths always in P1-P2, English always in P7-P8.
    const ANCHOR_PREFERRED_PERIODS: Record<string, number[]> = {
      Mathematics:      [1, 2, 3],        // First thing in the morning
      Physics:          [2, 3, 4],
      Chemistry:        [2, 3, 4],
      Biology:          [3, 4, 5],
      Science:          [3, 4, 5],
      English:          [7, 8, 6],        // After lunch / last periods
      'Social Studies': [4, 5, 3],
      'Computer Science': [5, 6, 4],
      Hindi:            [4, 5, 6],
      Nepali:           [4, 5, 6],
      French:           [5, 6, 7],
      Economics:        [1, 2, 3],
      Accountancy:      [3, 4, 5],
      'Business Studies': [4, 5, 6],
      'Home Science':   [4, 5, 3],
      Geography:        [5, 6, 4],
      History:          [5, 6, 4],
    };

    // Anchor phase tracking: sectionId|subjectId -> locked period number (if anchored)
    const subjectAnchorPeriod = new Map<string, number>();

    // Try to anchor all N periods of a high-frequency subject to the same period slot.
    // Returns the slots that were successfully anchored (may be < count if constraints prevent full anchoring).
    const tryAnchoredPlacement = (
      sectionId: string,
      subjectId: string,
      teacherId: string,
      subjectName: string,
      count: number,
    ): { dayId: string; slotId: string }[] => {
      const anchorKey = `${sectionId}|${subjectId}`;
      const preferredPeriods = ANCHOR_PREFERRED_PERIODS[subjectName];
      if (!preferredPeriods || count < 4) return []; // Only anchor high-freq subjects

      // If already anchored for this subject in this section, use that period
      const existingAnchor = subjectAnchorPeriod.get(anchorKey);
      const periodsToTry = existingAnchor
        ? [existingAnchor]
        : preferredPeriods;

      for (const periodNum of periodsToTry) {
        const ts = timeSlots.find(t => t.periodNumber === periodNum);
        if (!ts) continue;

        // Find days where this slot is free for both teacher and section
        const viableDays = days.filter(d =>
          canPlace(teacherId, sectionId, d.id, ts.id, subjectId, subjectName)
        );

        // Only anchor if we can fit at least ceil(count * 0.75) periods at this period
        if (viableDays.length >= Math.ceil(count * 0.75)) {
          subjectAnchorPeriod.set(anchorKey, periodNum);
          return viableDays.slice(0, count).map(d => ({ dayId: d.id, slotId: ts.id }));
        }
      }
      return [];
    };

    // ── Helper: pick best day for spreading a subject ──────────────────────────
    const pickSpreadDay = (
      sectionId: string,
      subjectId: string,
      teacherId: string,
      subjectName: string,
    ): { dayId: string; slotId: string } | null => {
      // If this subject has an anchor period, try that first
      const anchorKey = `${sectionId}|${subjectId}`;
      const anchorPeriod = subjectAnchorPeriod.get(anchorKey);
      if (anchorPeriod) {
        const ts = timeSlots.find(t => t.periodNumber === anchorPeriod);
        if (ts) {
          // Try each day at the anchor period first
          const sortedDays = [...days].sort((a, b) => {
            const aLoad = sectionDailyLoad.get(sectionId)?.get(a.id) ?? 0;
            const bLoad = sectionDailyLoad.get(sectionId)?.get(b.id) ?? 0;
            return aLoad - bLoad;
          });
          for (const day of sortedDays) {
            if (canPlace(teacherId, sectionId, day.id, ts.id, subjectId, subjectName)) {
              return { dayId: day.id, slotId: ts.id };
            }
          }
        }
      }

      // Sort days by: fewest occurrences of this subject → fewest total periods for section
      const dayInfo = days.map(d => {
        const sdKey = `${sectionId}|${d.id}`;
        let subjectCount = 0;
        const periodMap = sectionDayPeriodSubject.get(sdKey);
        if (periodMap) {
          for (const [, sid] of periodMap) {
            if (sid === subjectId) subjectCount++;
          }
        }
        const totalLoad = sectionDailyLoad.get(sectionId)?.get(d.id) ?? 0;
        return { day: d, subjectCount, totalLoad };
      }).sort((a, b) => {
        if (a.subjectCount !== b.subjectCount) return a.subjectCount - b.subjectCount;
        return a.totalLoad - b.totalLoad;
      });

      // For core subjects: prefer morning periods (1-5). For activities: prefer later periods (6-8).
      const isActivity = END_PERIOD_SUBJECTS.has(subjectName) || subjectName === 'Games';

      for (const { day } of dayInfo) {
        const sortedSlots = [...timeSlots].sort((a, b) => {
          if (isActivity) {
            // Prefer later periods
            return b.periodNumber - a.periodNumber;
          }
          // Prefer morning periods for core subjects
          return a.periodNumber - b.periodNumber;
        });

        for (const ts of sortedSlots) {
          if (canPlace(teacherId, sectionId, day.id, ts.id, subjectId, subjectName)) {
            return { dayId: day.id, slotId: ts.id };
          }
        }
      }
      return null;
    };

    // ── STEP C: Place constrained subjects first ─────────────────────────────
    // Priority order: Labs → Games → W.E. → Yoga → Library → Innovation
    if (process.env.NODE_ENV === 'development') { console.log('Step C: Placing constrained subjects...'); }

    const constrainedOrder = [
      // 1. Lab subjects (double-period: Physics, Chemistry, Biology for IX+)
      ...assignments.filter(a => a.subject.isDoublePeriod),
      // 2. Lab subjects (single: Computer Science, Science)
      ...assignments.filter(a => a.subject.requiresLab && !a.subject.isDoublePeriod),
      // 3. Games
      ...assignments.filter(a => a.subject.name === 'Games'),
      // 4. W.E. subjects (Music, Dance, Art, Work Experience)
      ...assignments.filter(a => WE_SUBJECTS.has(a.subject.name)),
      // 5. Yoga / Aerobics
      ...assignments.filter(a => a.subject.name === 'Yoga' || a.subject.name === 'Aerobics'),
      // 6. Library
      ...assignments.filter(a => a.subject.name === 'Library'),
      // 7. Innovation
      ...assignments.filter(a => a.subject.name === 'Innovation'),
    ];

    // Track placed (section, subject) to avoid re-processing
    const placedTracker = new Map<string, number>(); // "sectionId|subjectId" -> count placed

    for (const asgn of constrainedOrder) {
      const { teacherId, subjectId, sectionId, subject, section } = asgn;
      const ppw = getPeriodsPerWeek(sectionId, subjectId);
      if (ppw <= 0) continue;

      const trackerKey = `${sectionId}|${subjectId}`;
      const alreadyPlaced = placedTracker.get(trackerKey) ?? 0;
      if (alreadyPlaced >= ppw) continue;

      let remaining = ppw - alreadyPlaced;

      // Double-period labs: keep placing consecutive pairs until remaining < 2 (one pair left excess singles fighting for labs).
      if (subject.isDoublePeriod) {
        while (remaining >= 2) {
          const pairResult = findLabConsecutivePair(teacherId, sectionId, subjectId);
          if (!pairResult) break;
          const labCandidates = getAllowedLabRooms(subjectId, sectionId);
          const room = labCandidates.length > 0
            ? findAvailableLabRoom(subjectId, sectionId, pairResult.dayId, pairResult.pair[0].id)
            : null;
          if (labCandidates.length > 0 && !room) break;
          const ok1 = assign(sectionId, pairResult.dayId, pairResult.pair[0].id, subjectId, teacherId, { isLab: true }, room?.id);
          const ok2 = assign(sectionId, pairResult.dayId, pairResult.pair[1].id, subjectId, teacherId, { isLab: true }, room?.id);
          if (!ok1 || !ok2) break;
          remaining -= 2;
          placedTracker.set(trackerKey, ppw - remaining);
          if (HEAVY_SUBJECTS.has(subject.name)) {
            const hdKey = `${sectionId}|${pairResult.dayId}`;
            sectionDayHeavyCount.set(hdKey, (sectionDayHeavyCount.get(hdKey) ?? 0) + 2);
          }
        }
        if (remaining > ppw - 2) {
          warnings.push(`[lab-fallback] ${section.name} ${subject.name}: consecutive pair unavailable; using single periods`);
        }
      }

      // Place remaining periods using spread logic
      while (remaining > 0) {
        const pick = pickSpreadDay(sectionId, subjectId, teacherId, subject.name);
        if (!pick) break;
        if (assign(sectionId, pick.dayId, pick.slotId, subjectId, teacherId)) {
          remaining--;
          if (HEAVY_SUBJECTS.has(subject.name)) {
            const hdKey = `${sectionId}|${pick.dayId}`;
            sectionDayHeavyCount.set(hdKey, (sectionDayHeavyCount.get(hdKey) ?? 0) + 1);
          }
        } else {
          break;
        }
      }

      placedTracker.set(trackerKey, ppw - remaining);

      if (remaining > 0) {
        unassigned.push(`${asgn.teacher.abbreviation} → ${subject.name} for ${section.name}: ${remaining} unplaced (constrained)`);
      }
    }

    // ── STEP D: Spread core subjects evenly ──────────────────────────────────
    // Core: Mathematics, English, Science, Social Studies, Languages, Economics, etc.
    if (process.env.NODE_ENV === 'development') { console.log('Step D: Spreading core subjects...'); }

    const coreAssignments = assignments.filter(a => {
      // Exclude already-fully-placed constrained subjects
      const trackerKey = `${a.sectionId}|${a.subjectId}`;
      const ppw = getPeriodsPerWeek(a.sectionId, a.subjectId);
      const placed = placedTracker.get(trackerKey) ?? 0;
      return placed < ppw;
    }).sort((a, b) => {
      // Schedule higher-frequency subjects first
      const aPPW = getPeriodsPerWeek(a.sectionId, a.subjectId);
      const bPPW = getPeriodsPerWeek(b.sectionId, b.subjectId);
      return bPPW - aPPW;
    });

    for (const asgn of coreAssignments) {
      const { teacherId, subjectId, sectionId, subject, section } = asgn;
      const ppw = getPeriodsPerWeek(sectionId, subjectId);
      if (ppw <= 0) continue;

      const trackerKey = `${sectionId}|${subjectId}`;
      const alreadyPlaced = placedTracker.get(trackerKey) ?? 0;
      let remaining = ppw - alreadyPlaced;
      if (remaining <= 0) continue;

      // ── ANCHOR PHASE: try to lock high-frequency subjects to one period slot ──
      // Based on real school PDF analysis: Maths anchors to P1, English to P7-P8, etc.
      if (remaining >= 4 && ANCHOR_PREFERRED_PERIODS[subject.name]) {
        const anchoredSlots = tryAnchoredPlacement(sectionId, subjectId, teacherId, subject.name, remaining);
        for (const { dayId, slotId } of anchoredSlots) {
          if (remaining <= 0) break;
          if (assign(sectionId, dayId, slotId, subjectId, teacherId)) {
            remaining--;
            if (HEAVY_SUBJECTS.has(subject.name)) {
              const hdKey = `${sectionId}|${dayId}`;
              sectionDayHeavyCount.set(hdKey, (sectionDayHeavyCount.get(hdKey) ?? 0) + 1);
            }
          }
        }
        if (remaining <= 0) {
          placedTracker.set(trackerKey, ppw);
          continue;
        }
      }

      while (remaining > 0) {
        const pick = pickSpreadDay(sectionId, subjectId, teacherId, subject.name);
        if (!pick) {
          // Try with relaxed constraints
          let placed = false;
          for (const day of days) {
            for (const ts of timeSlots) {
              if (canPlace(teacherId, sectionId, day.id, ts.id, subjectId, subject.name, true)) {
                if (assign(sectionId, day.id, ts.id, subjectId, teacherId)) {
                  remaining--;
                  if (HEAVY_SUBJECTS.has(subject.name)) {
                    const hdKey = `${sectionId}|${day.id}`;
                    sectionDayHeavyCount.set(hdKey, (sectionDayHeavyCount.get(hdKey) ?? 0) + 1);
                  }
                  placed = true;
                  break;
                }
              }
            }
            if (placed) break;
          }
          if (!placed) break;
        } else {
          if (assign(sectionId, pick.dayId, pick.slotId, subjectId, teacherId)) {
            remaining--;
            if (HEAVY_SUBJECTS.has(subject.name)) {
              const hdKey = `${sectionId}|${pick.dayId}`;
              sectionDayHeavyCount.set(hdKey, (sectionDayHeavyCount.get(hdKey) ?? 0) + 1);
            }
          } else {
            break;
          }
        }
      }

      placedTracker.set(trackerKey, ppw - remaining);

      if (remaining > 0) {
        unassigned.push(`${asgn.teacher.abbreviation} → ${subject.name} for ${section.name}: ${remaining}/${ppw} unplaced (core)`);
      }
    }

    // ── STEP E: Fill gaps with extra core periods (no Library/WE/Study “filler” subjects) ──
    // Uses the same teachers and subjects already assigned to each section; `relaxed` canPlace
    // skips daily caps / heavy-day limits so timetable workload exceeds nominal ppw where needed.
    if (process.env.NODE_ENV === 'development') { console.log('Step E: Core top-up for empty slots...'); }

    const fillerStats = {
      library: 0,
      innovation: 0,
      we: 0,
      games: 0,
      yoga: 0,
      studyPeriod: 0,
      coreTopUp: 0,
    };

    const TOPUP_PRIORITY = new Map<string, number>([
      ['Mathematics', 0],
      ['English', 1],
      ['Science', 2],
      ['Social Studies', 3],
      ['Hindi', 4],
      ['Nepali', 5],
      ['French', 6],
      ['Economics', 7],
      ['Computer Science', 8],
      ['Informatics Practices', 9],
      ['Physics', 10],
      ['Chemistry', 11],
      ['Biology', 12],
      ['History', 13],
      ['Geography', 14],
      ['Accountancy', 15],
      ['Business Studies', 16],
      ['Home Science', 17],
    ]);

    const isTopUpAssignment = (a: TeacherAssignment): boolean => {
      const n = a.subject.name;
      if (SHARED_SLOT_SUBJECTS.has(n)) return false;
      if (WE_SUBJECTS.has(n)) return false;
      if (n === 'Games' || n === 'Study Period') return false;
      return true;
    };

    const topUpCandidatesForSection = (sectionId: string): TeacherAssignment[] =>
      assignments
        .filter((a) => a.sectionId === sectionId && isTopUpAssignment(a))
        .sort((a, b) => {
          const pa = TOPUP_PRIORITY.get(a.subject.name) ?? 99;
          const pb = TOPUP_PRIORITY.get(b.subject.name) ?? 99;
          if (pa !== pb) return pa - pb;
          return getPeriodsPerWeek(b.sectionId, b.subjectId) - getPeriodsPerWeek(a.sectionId, a.subjectId);
        });

    const tryCoreTopUpAt = (sectionId: string, dayId: string, tsId: string): boolean => {
      for (const asgn of topUpCandidatesForSection(sectionId)) {
        const { teacherId, subjectId, subject } = asgn;
        if (!canPlace(teacherId, sectionId, dayId, tsId, subjectId, subject.name, true)) continue;
        if (!assign(sectionId, dayId, tsId, subjectId, teacherId)) continue;
        fillerStats.coreTopUp++;
        if (HEAVY_SUBJECTS.has(subject.name)) {
          const hdKey = `${sectionId}|${dayId}`;
          sectionDayHeavyCount.set(hdKey, (sectionDayHeavyCount.get(hdKey) ?? 0) + 1);
        }
        return true;
      }
      return false;
    };

    const sweepCoreTopUp = (): number => {
      let placed = 0;
      for (const section of sections) {
        for (const day of days) {
          for (const ts of timeSlots) {
            const key = `${day.id}-${ts.id}`;
            if (sectionBusy.get(section.id)?.has(key)) continue;
            if (tryCoreTopUpAt(section.id, day.id, ts.id)) placed++;
          }
        }
      }
      return placed;
    };

    for (let round = 0; round < 24; round++) {
      if (sweepCoreTopUp() === 0) break;
    }

    // Study Period — only if a cell is still impossible to place with any core teacher/subject
    let studyPeriodSubject = subjects.find(s => s.name === 'Study Period');
    if (!studyPeriodSubject) {
      const dbStudy = await db.subject.upsert({
        where: { code: 'STUDY' },
        create: { name: 'Study Period', code: 'STUDY', category: 'Activity', requiresLab: false, isDoublePeriod: false },
        update: {},
        include: { teacherSubjects: true, timetableSlots: true, rooms: true },
      });
      studyPeriodSubject = dbStudy as any;
      subjects.push(studyPeriodSubject as any);
    }

    for (const section of sections) {
      for (const day of days) {
        for (const ts of timeSlots) {
          const key = `${day.id}-${ts.id}`;
          if (sectionBusy.get(section.id)?.has(key)) continue;
          const classTid = (section as { classTeacherId?: string | null }).classTeacherId;
          const studyTid = classTid ?? assignments.find((a) => a.sectionId === section.id)?.teacherId;
          if (
            studyTid &&
            canPlace(studyTid, section.id, day.id, ts.id, studyPeriodSubject!.id, 'Study Period', true) &&
            assign(section.id, day.id, ts.id, studyPeriodSubject!.id, studyTid, { isFiller: true })
          ) {
            fillerStats.studyPeriod++;
          } else if (studyTid) {
            createdSlots.push({
              sectionId: section.id,
              dayId: day.id,
              timeSlotId: ts.id,
              subjectId: studyPeriodSubject!.id,
              teacherId: studyTid,
              roomId: null,
              isLab: false,
              isGames: false,
              isYoga: false,
              isLibrary: false,
              isInnovation: false,
              isWE: false,
              isMusic: false,
              isArt: false,
              isFiller: true,
            });
            sectionBusy.get(section.id)?.add(key);
            fillerStats.studyPeriod++;
          }
        }
      }
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `Placement complete. Core top-up=${fillerStats.coreTopUp}, study fallback=${fillerStats.studyPeriod}`
      );
    }

    // ── FINAL 100% GUARANTEE SWEEP ─────────────────────────────────────────
    const existingSlotKeys = new Set(
      createdSlots.map(s => `${s.sectionId}|${s.dayId}|${s.timeSlotId}`)
    );

    let guaranteeFixes = 0;
    let rrIndex = 0;
    for (const section of sections) {
      for (const day of days) {
        for (const ts of timeSlots) {
          const key = `${day.id}-${ts.id}`;
          const slotKey = `${section.id}|${day.id}|${ts.id}`;
          if (existingSlotKeys.has(slotKey)) continue;

          if (tryCoreTopUpAt(section.id, day.id, ts.id)) {
            existingSlotKeys.add(slotKey);
            guaranteeFixes++;
            continue;
          }

          const fallbackTeacher = teachers[rrIndex % teachers.length]?.id;
          rrIndex++;
          if (fallbackTeacher) {
            createdSlots.push({
              sectionId: section.id,
              dayId: day.id,
              timeSlotId: ts.id,
              subjectId: studyPeriodSubject!.id,
              teacherId: fallbackTeacher,
              roomId: null,
              isLab: false,
              isGames: false,
              isYoga: false,
              isLibrary: false,
              isInnovation: false,
              isWE: false,
              isMusic: false,
              isArt: false,
              isFiller: true,
            });
            sectionBusy.get(section.id)?.add(key);
            existingSlotKeys.add(slotKey);
            fillerStats.studyPeriod++;
            guaranteeFixes++;
          }
        }
      }
    }
    if (guaranteeFixes > 0 && process.env.NODE_ENV === 'development') {
      console.log(`[guarantee] Patched ${guaranteeFixes} remaining slots (core top-up or Study Period)`);
    }

    const uniqueMap = new Map<string, SlotRecord>();
    for (const slot of createdSlots) {
      const k = `${slot.sectionId}|${slot.dayId}|${slot.timeSlotId}`;
      if (!uniqueMap.has(k)) uniqueMap.set(k, slot);
    }
    const toInsert = Array.from(uniqueMap.values());
    if (process.env.NODE_ENV === 'development') { console.log(`Unique slots to insert: ${toInsert.length}`); }

    if (toInsert.length > 0 && !preview) {
      const result = await db.timetableSlot.createMany({ data: toInsert });
      if (process.env.NODE_ENV === 'development') { console.log(`Inserted ${result.count} slots`); }
    }

    let labRepair: { detected: number; repaired: number; remaining: number } | null = null;
    if (autoRepairLabs && !preview) {
      const splitsBefore = await auditLabSplits();
      if (splitsBefore.length > 0) {
        const repaired = await repairLabSplits();
        labRepair = {
          detected: splitsBefore.length,
          repaired: repaired.repaired,
          remaining: repaired.remaining,
        };
        warnings.push(
          `[lab-auto-repair] detected=${labRepair.detected}, repaired=${labRepair.repaired}, remaining=${labRepair.remaining}`
        );
      } else {
        labRepair = { detected: 0, repaired: 0, remaining: 0 };
      }
    } else if (preview) {
      labRepair = { detected: 0, repaired: 0, remaining: 0 };
    }

    // ── 9. Update teacher workloads from DB ──────────────────────────────────
    const slotCounts = preview ? [] : await db.timetableSlot.groupBy({
      by: ['teacherId'],
      _count: { id: true },
      where: { teacherId: { not: null } },
    });
    const countMap = new Map(
      slotCounts.filter(r => r.teacherId).map(r => [r.teacherId as string, r._count.id])
    );
    if (!preview) {
      await Promise.all(
        teachers.map(t =>
          db.teacher.update({ where: { id: t.id }, data: { currentWorkload: countMap.get(t.id) ?? 0 } })
        )
      );
    }

    // ── 10. Final stats ───────────────────────────────────────────────────────
    const previewCombinedMap = new Map<string, SlotRecord>();
    for (const s of baselineSlots) {
      if (!s.subjectId || !s.teacherId) continue;
      const key = `${s.sectionId}|${s.dayId}|${s.timeSlotId}`;
      previewCombinedMap.set(key, {
        sectionId: s.sectionId,
        dayId: s.dayId,
        timeSlotId: s.timeSlotId,
        subjectId: s.subjectId,
        teacherId: s.teacherId,
        roomId: (s as any).roomId ?? null,
        isLab: s.isLab,
        isGames: s.isGames,
        isYoga: s.isYoga,
        isLibrary: s.isLibrary,
        isInnovation: s.isInnovation,
        isWE: s.isWE,
        isMusic: s.isMusic,
        isArt: s.isArt,
        isFiller: (s as any).isFiller ?? false,
      });
    }
    for (const s of toInsert) {
      const key = `${s.sectionId}|${s.dayId}|${s.timeSlotId}`;
      previewCombinedMap.set(key, s);
    }
    const previewSlots = Array.from(previewCombinedMap.values());
    const totalInserted = preview ? previewSlots.length : await db.timetableSlot.count();

    const totalPossible = sections.length * days.length * timeSlots.length;
    const totalBlocked = 0;
    const totalValid = totalPossible;

    const perSectionValid = () => days.length * timeSlots.length;

    const sectionCounts = preview
      ? Array.from(
          previewSlots.reduce((acc, s) => {
            acc.set(s.sectionId, (acc.get(s.sectionId) ?? 0) + 1);
            return acc;
          }, new Map<string, number>())
        ).map(([sectionId, count]) => ({ sectionId, _count: { id: count } }))
      : await db.timetableSlot.groupBy({ by: ['sectionId'], _count: { id: true } });
    const secCountMap = new Map(sectionCounts.map(r => [r.sectionId, r._count.id]));

    // Conflict check: flag only section-level conflicts (same section, same slot, 2+ subjects).
    // Teacher-level "conflicts" for SHARED_SLOT_SUBJECTS (Library, Yoga, Games) are intentional
    // — one teacher listed in multiple sections simultaneously is by design.
    const conflictCheck = preview
      ? Array.from(
          previewSlots.reduce((acc, s) => {
            const k = `${s.sectionId}|${s.dayId}|${s.timeSlotId}`;
            acc.set(k, (acc.get(k) ?? 0) + 1);
            return acc;
          }, new Map<string, number>())
        ).filter(([, c]) => c > 1)
      : await db.timetableSlot.groupBy({
      by: ['sectionId', 'dayId', 'timeSlotId'],
      _count: { id: true },
      having: { id: { _count: { gt: 1 } } },
    });
    const roomConflictCheck = preview
      ? Array.from(
          previewSlots.reduce((acc, s) => {
            if (!s.roomId) return acc;
            const k = `${s.roomId}|${s.dayId}|${s.timeSlotId}`;
            acc.set(k, (acc.get(k) ?? 0) + 1);
            return acc;
          }, new Map<string, number>())
        ).filter(([, c]) => c > 1)
      : await db.timetableSlot.groupBy({
      by: ['roomId', 'dayId', 'timeSlotId'],
      _count: { id: true },
      where: { roomId: { not: null } },
      having: { id: { _count: { gt: 1 } } },
    });

    // Fill rate is calculated against the full section × day × period grid.
    const validFillRate = Math.round((totalInserted / totalValid) * 100);
    const rawFillRate   = Math.round((totalInserted / totalPossible) * 100);

    const stats = {
      totalSlots: totalInserted,
      totalPossibleSlots: totalPossible,
      totalValidSlots: totalValid,
      blockedSlots: totalBlocked,
      fillRate: validFillRate,          // shown in UI: % of valid (schedulable) slots
      rawFillRate,                      // for debugging: % of all grid slots
      sectionsWithCompleteSchedule: sections.filter(s =>
        (secCountMap.get(s.id) ?? 0) >= perSectionValid()
      ).length,
      totalSections: sections.length,
      conflictsDetected: preview ? conflictCheck.length : conflictCheck.length,
      roomConflictsDetected: preview ? roomConflictCheck.length : roomConflictCheck.length,
      unassignedCount: unassigned.length,
      teacherUtilization: {
        fullyUtilized: teachers.filter(t => Math.abs((countMap.get(t.id) ?? 0) - t.targetWorkload) <= 2).length,
        underUtilized: teachers.filter(t => (countMap.get(t.id) ?? 0) < t.targetWorkload - 2).length,
        overUtilized: teachers.filter(t => (countMap.get(t.id) ?? 0) > t.targetWorkload + 2).length,
      },
      fillerSlotsByType: fillerStats,
      studyPeriodSlots: fillerStats.studyPeriod,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[generate] Complete: ${totalInserted}/${totalValid} valid slots (${validFillRate}%) | ` +
        `raw ${rawFillRate}% | blocked ${totalBlocked}`
      );
      if (conflictCheck.length > 0) {
        console.warn(`[generate] WARNING: ${conflictCheck.length} conflicts detected`);
      }
    }

    return NextResponse.json({
      success: true,
      slotsCreated: totalInserted,
      preservedLockedSlots: preservedLockedCount,
      newlyGeneratedSlots: Math.max(0, totalInserted - preservedLockedCount),
      stats,
      method: 'two-layer heuristic',
      unassigned: unassigned.length > 0 ? unassigned.slice(0, 30) : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      labRepair: labRepair ?? undefined,
      preview,
      previewSlots: preview
        ? previewSlots.map((s) => ({
            sectionId: s.sectionId,
            dayId: s.dayId,
            timeSlotId: s.timeSlotId,
            subjectId: s.subjectId,
            teacherId: s.teacherId,
            roomId: s.roomId ?? null,
            isLab: s.isLab,
            isGames: s.isGames,
            isYoga: s.isYoga,
            isLibrary: s.isLibrary,
            isInnovation: s.isInnovation,
            isWE: s.isWE,
            isMusic: s.isMusic,
            isArt: s.isArt,
            isFiller: s.isFiller,
          }))
        : undefined,
      message: `Generated ${totalInserted} timetable slots for ${sections.length} sections (${validFillRate}% of valid slots)`,
      details: {
        sectionsComplete: `${stats.sectionsWithCompleteSchedule}/${sections.length}`,
        fillRate: `${validFillRate}% of valid slots (${totalInserted}/${totalValid})`,
        blockedSlots: `${totalBlocked} blocked`,
        teacherUtilization: `${stats.teacherUtilization.fullyUtilized} OK, ${stats.teacherUtilization.underUtilized} under, ${stats.teacherUtilization.overUtilized} over`,
        conflicts: stats.conflictsDetected === 0 ? 'None ✓' : `${stats.conflictsDetected} CONFLICTS FOUND`,
        roomConflicts: roomConflictCheck.length === 0 ? 'None ✓' : `${roomConflictCheck.length} ROOM CONFLICTS FOUND`,
        solver: 'two-layer heuristic',
        preservedLockedSlots: preservedLockedCount,
        labRepair: labRepair ? `${labRepair.repaired}/${labRepair.detected} repaired, ${labRepair.remaining} remaining` : 'disabled',
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[generate] Error:', error);
    }
    return NextResponse.json({ error: 'Failed to generate timetable' }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SlimSlot = { id: string; periodNumber: number };

type AvailFn = (
  teacherId: string | null,
  sectionId: string,
  dayId: string,
  timeSlotId: string,
  subjectId?: string,
  bypass?: boolean
) => boolean;

/**
 * Find two adjacent (consecutive periodNumber) slots that are both free.
 * Used for scheduling double-period lab subjects.
 */
function findConsecutivePair(
  teacherId: string,
  sectionId: string,
  dayId: string,
  timeSlots: SlimSlot[],
  subjectId: string,
  isAvailable: AvailFn
): [SlimSlot, SlimSlot] | null {
  const sorted = [...timeSlots].sort((a, b) => a.periodNumber - b.periodNumber);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].periodNumber !== sorted[i].periodNumber + 1) continue;
    if (
      isAvailable(teacherId, sectionId, dayId, sorted[i].id, subjectId, true) &&
      isAvailable(teacherId, sectionId, dayId, sorted[i + 1].id, subjectId, true)
    ) {
      return [sorted[i], sorted[i + 1]];
    }
  }
  return null;
}

type ScoreState = {
  timeSlots: SlimSlot[];
  teacherDailyLoad: Map<string, Map<string, number>>;
  sectionDailyLoad: Map<string, Map<string, number>>;
  sectionDaySubjects: Map<string, Set<string>>;
  sectionClassTeacherMap: Map<string, string>;
  teacherPeriodsByDay: Map<string, Set<number>>;
  roomSubjectMap: Map<string, Array<{ id: string }>>;
  roomBusy: Set<string>;
  maxSectionPerDay: number;
  teacherMaxPerDay: Map<string, number>;
  morningPreferenceByPeriod: Map<number, number>;
  endPreferenceByPeriod: Map<number, number>;
  scoringWeights: ScoringWeightsConfig;
  getAllowedLabRooms: (subjectId: string, sectionId: string) => Array<{ id: string }>;
};

type ScoreSlotInput = {
  section: { id: string; name: string };
  dayId: string;
  timeSlotId: string;
  teacher: { id: string; abbreviation: string };
  subject: { id: string; name: string; requiresLab: boolean };
  state: ScoreState;
};

function scoreSlot(input: ScoreSlotInput): number {
  const { section, dayId, timeSlotId, teacher, subject, state } = input;
  const slot = state.timeSlots.find(t => t.id === timeSlotId);
  if (!slot) return Number.NEGATIVE_INFINITY;
  const period = slot.periodNumber;
  const lastPeriod = Math.max(...state.timeSlots.map(t => t.periodNumber));
  const w = state.scoringWeights;

  let score = 0;

  // 1) Subject preference (morning/end-period pedagogical fit)
  if (PREFER_MORNING_SUBJECTS.has(subject.name)) {
    score += (state.morningPreferenceByPeriod.get(period) ?? 0) * w.subjectPreferenceWeight;
  } else if (END_PERIOD_SUBJECTS.has(subject.name)) {
    score += (state.endPreferenceByPeriod.get(period) ?? 0) * w.subjectPreferenceWeight;
  }

  // 2) Teacher daily load (prefer less-loaded day)
  const tCurrent = state.teacherDailyLoad.get(teacher.id)?.get(dayId) ?? 0;
  const tMax = Math.max(1, state.teacherMaxPerDay.get(teacher.id) ?? 1);
  score += ((tMax - tCurrent) / tMax) * w.teacherDailyLoadWeight;

  // 3) Section daily load (avoid overpacking one day)
  const sCurrent = state.sectionDailyLoad.get(section.id)?.get(dayId) ?? 0;
  const sMax = Math.max(1, state.maxSectionPerDay);
  score += ((sMax - sCurrent) / sMax) * w.sectionDailyLoadWeight;

  // 4) Subject spread across days for section
  const hasThisSubjectToday = state.sectionDaySubjects.get(`${section.id}|${dayId}`)?.has(subject.id) ?? false;
  score += (hasThisSubjectToday ? 0 : 1) * w.subjectSpreadWeight;

  // 5) Teacher adjacency penalty (avoid adjacent periods where possible)
  const teacherPeriods = state.teacherPeriodsByDay.get(`${teacher.id}|${dayId}`) ?? new Set<number>();
  const adjacentCount = Number(teacherPeriods.has(period - 1)) + Number(teacherPeriods.has(period + 1));
  score -= adjacentCount * w.teacherAdjacencyPenaltyWeight;

  // 6) Lab in last period penalty
  if (subject.requiresLab && period === lastPeriod) {
    score -= w.labLastPeriodPenaltyWeight;
  }

  // 7) Class teacher bonus
  if (state.sectionClassTeacherMap.get(section.id) === teacher.id) {
    score += w.classTeacherBonusWeight;
  }

  // 8) Room availability richness (prefer slots with more room options)
  if (subject.requiresLab) {
    const candidates = state.getAllowedLabRooms(subject.id, section.id);
    if (candidates.length > 0) {
      const free = candidates.filter(r => !state.roomBusy.has(`${r.id}|${dayId}-${timeSlotId}`)).length;
      score += (free / candidates.length) * w.roomAvailabilityWeight;
    }
    score += w.labPlacementWeight;
  }

  return score;
}

// ─── GET — generation status ──────────────────────────────────────────────────

export async function GET() {
  try {
    const [sectionCount, teacherCount, days, timeSlots, existingSlots, conflicts] =
      await Promise.all([
        db.section.count(),
        db.teacher.count(),
        db.day.findMany({ orderBy: { dayOrder: 'asc' } }),
        db.timeSlot.findMany({ orderBy: { periodNumber: 'asc' } }),
        db.timetableSlot.count(),
        db.timetableSlot.groupBy({
          by: ['sectionId', 'dayId', 'timeSlotId'],
          _count: { id: true },
          having: { id: { _count: { gt: 1 } } },
        }),
      ]);

    const totalPossible = sectionCount * days.length * timeSlots.length;

    return NextResponse.json({
      currentStatus: {
        sections: sectionCount,
        teachers: teacherCount,
        existingSlots,
        totalPossibleSlots: totalPossible,
        fillRate: `${Math.round((existingSlots / totalPossible) * 100)}%`,
        conflicts: conflicts.length,
      },
      schedule: {
        days: days.map(d => d.name),
        periods: timeSlots.map(t => ({ period: t.periodNumber, time: `${t.startTime}-${t.endTime}` })),
      },
      canGenerate: teacherCount > 0 && sectionCount > 0 && days.length > 0 && timeSlots.length > 0,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') { console.error('Error getting generation status:', error); }
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}
