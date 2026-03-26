import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { GenerateSchema, validationError } from '@/lib/validation';
// OR-Tools solver removed — using two-layer heuristic generator
import { auditLabSplits, repairLabSplits } from '@/lib/lab-audit';
import { getExplicitLabTeacherCandidates } from '@/lib/lab-teacher-support';
import { sortSectionsByGradeThenName } from '@/lib/section-sort';
import { isLabDepartment } from '@/lib/teacher-departments';
import { teacherCanCoverSubject } from '@/lib/teacher-eligibility';
import {
  type CombinedSlotBucket,
  type CombinedSlotMetadata,
  type CombinedSlotOption,
  type CombinedSlotSharingMode,
  encodeCombinedSlotMetadata,
  getAllSlotTeacherIds,
  parseCombinedSlotMetadata,
} from '@/lib/combined-slot';

export const maxDuration = 60; // seconds — Vercel hobby max

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
  labTeacherId?: string | null;
};

type SlotRecord = {
  sectionId: string;
  dayId: string;
  timeSlotId: string;
  subjectId: string;
  teacherId: string;
  labTeacherId?: string | null;
  roomId?: string | null;
  notes?: string | null;
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

type LanguageBlockOption = CombinedSlotOption;

type LanguageBlockSpec = {
  bucket: CombinedSlotBucket;
  grade: string;
  sectionId: string;
  sectionName: string;
  periodsPerWeek: number;
  displayName: string;
  displayCode: string;
  representativeSubjectId: string;
  options: LanguageBlockOption[];
};

type LanguageSharingRule = {
  mode: CombinedSlotSharingMode;
  groupLimit?: number;
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

// Hindi option classes are taught in combined groups: one teacher can cover up to
// 3 sections of the same grade in the same period. Nepali remains one section per slot.
const GROUPED_SECTION_SUBJECT_LIMITS = new Map<string, number>([
  ['Hindi', 3],
]);

const LANGUAGE_BUCKET_CONFIG: Record<
  CombinedSlotBucket,
  {
    subjectNames: string[];
    getSharingRule: (subjectName: string) => LanguageSharingRule;
  }
> = {
  '2nd Language': {
    subjectNames: ['Hindi', 'Nepali'],
    getSharingRule: (subjectName) =>
      subjectName === 'Hindi'
        ? { mode: 'grouped', groupLimit: 3 }
        : { mode: 'single' },
  },
  '3rd Language': {
    subjectNames: ['Hindi', 'Nepali', 'French'],
    getSharingRule: (subjectName) => {
      if (subjectName === 'Nepali') return { mode: 'grouped', groupLimit: 3 };
      if (subjectName === 'French') return { mode: 'shared' };
      return { mode: 'single' };
    },
  },
};

const LANGUAGE_PERIOD_PRIORITY = [3, 4, 2, 5, 6, 7, 1, 8];

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
const MAX_GAMES_PER_SLOT     = 4;   // max simultaneous sections with Games in any one period
const GAMES_WORKLOAD_BUFFER  = 1;   // sports teachers: targetWorkload + 1

// Grades where Yoga/Aerobics are NOT scheduled (XI and XII have no Yoga/Aerobics periods).
const NO_YOGA_GRADES = new Set(['XI', 'XII']);

// Reference weekly demand reconstructed from the school's class timetables.
// These totals fit the full 6-day x 8-period grid and replace the older stale hardcoded table.
const REFERENCE_GRADE_REQUIREMENTS: Record<string, Record<string, number>> = {
  VI: {
    '2nd Language': 6,
    '3rd Language': 4,
    English: 6,
    Mathematics: 8,
    Science: 6,
    'Social Studies': 6,
    'Computer Science': 3,
    Games: 3,
    'Work Experience': 2,
    Library: 1,
    Innovation: 1,
    Yoga: 1,
    Aerobics: 1,
  },
  VII: {
    '2nd Language': 6,
    '3rd Language': 4,
    English: 6,
    Mathematics: 8,
    Science: 6,
    'Social Studies': 6,
    'Computer Science': 3,
    Games: 3,
    'Work Experience': 2,
    Library: 1,
    Innovation: 1,
    Yoga: 1,
    Aerobics: 1,
  },
  VIII: {
    '2nd Language': 6,
    '3rd Language': 4,
    English: 6,
    Mathematics: 8,
    Science: 6,
    'Social Studies': 6,
    'Computer Science': 3,
    Games: 3,
    'Work Experience': 2,
    Library: 1,
    Innovation: 1,
    Yoga: 1,
    Aerobics: 1,
  },
  IX: {
    '2nd Language': 6,
    English: 7,
    Mathematics: 8,
    Physics: 3,
    Chemistry: 3,
    Biology: 3,
    'Social Studies': 8,
    'Computer Science': 3,
    Games: 3,
    'Work Experience': 2,
    Library: 1,
    Innovation: 1,
  },
  X: {
    '2nd Language': 5,
    English: 6,
    Mathematics: 9,
    Physics: 4,
    Chemistry: 4,
    Biology: 4,
    Geography: 2,
    Economics: 2,
    'Home Science': 3,
    'Computer Science': 3,
    Games: 3,
    'Work Experience': 1,
    Library: 1,
    Innovation: 1,
  },
};

const LANGUAGE_BUCKET_SUBJECTS = ['Hindi', 'Nepali', 'French'];
const WORK_EXPERIENCE_BUCKET_SUBJECTS = ['Work Experience', 'Art', 'Music', 'Dance'];
const SCIENCE_BUCKET_SUBJECTS = ['Science', 'Biology', 'Physics', 'Chemistry'];
const SCIENCE_LAB_SUBJECTS = new Set(['Physics', 'Chemistry', 'Biology']);
const DOUBLE_WE_GRADES = new Set(['VI', 'VII', 'VIII', 'IX']);




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
    const classTeacherIds = new Set(sectionClassTeacherMap.values());
    const coordinatorTeacherIds = new Set(
      sections
        .filter(s => s.coordinatorId)
        .map(s => s.coordinatorId as string)
    );
    const lastPeriodNumber = Math.max(...timeSlots.map(ts => ts.periodNumber));
    const teacherPeriodPriorityByPeriod = new Map<string, Map<number, number>>();
    for (const teacher of teachers) {
      const dutyWeight =
        (teacher.isHOD ? 1.25 : 0) +
        (coordinatorTeacherIds.has(teacher.id) ? 1.5 : 0) +
        (classTeacherIds.has(teacher.id) ? 1 : 0);
      const periodPriority = new Map<number, number>();

      for (const ts of timeSlots) {
        let priority = 0;
        if (dutyWeight > 0) {
          if (ts.periodNumber === 1 || ts.periodNumber === lastPeriodNumber) {
            priority = -0.75 * dutyWeight;
          } else if (ts.periodNumber === 2 || ts.periodNumber === lastPeriodNumber - 1) {
            priority = 0.15 * dutyWeight;
          } else {
            priority = 0.6 * dutyWeight;
          }
        }
        periodPriority.set(ts.periodNumber, priority);
      }

      teacherPeriodPriorityByPeriod.set(teacher.id, periodPriority);
    }
    const getTeacherPeriodPriority = (teacherId: string, periodNumber: number) =>
      teacherPeriodPriorityByPeriod.get(teacherId)?.get(periodNumber) ?? 0;

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
        preservedLockedCount = lockedSlots.length;
        if (process.env.NODE_ENV === 'development') {
          console.log(`Will replace unlocked slots after generation, preserving ${preservedLockedCount} locked slots`);
        }
      } else {
        preservedLockedCount = 0;
        if (process.env.NODE_ENV === 'development') { console.log('Will replace existing timetable slots after generation'); }
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
    const groupedSectionSlotCount = new Map<string, number>();
    const groupedSectionSlotsByTeacherSubjectGrade = new Map<string, Set<string>>();
    const languageGroupedSlotCount = new Map<string, number>();

    // Running workload counters (updated on every assignSlot call)
    const teacherLoad = new Map<string, number>(teachers.map(t => [t.id, 0]));

    // Daily period count per teacher.
    // R10: Cap at ceil(targetWorkload / workingDays) + 1 per teacher to spread load across week.
    // Global ceiling of 6 allows one extra period where needed for high-load teachers.
    const teacherDailyLoad = new Map<string, Map<string, number>>(
      teachers.map(t => [t.id, new Map()])
    );
    const sectionDailyLoad = new Map<string, Map<string, number>>(
      sections.map(s => [s.id, new Map()])
    );
    const GLOBAL_MAX_PERIODS_PER_DAY = 6;
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
      const subject = subjects.find(s => s.id === subjectId);
      if (!subject) return [];
      const grade = sectionGradeMap.get(sectionId) ?? '';

      // Junior Science (VI-VIII) is classroom-based. Dedicated subject labs start from class IX
      // and are mapped by subject (Physics/Chemistry/Biology).
      if (subject.name === 'Science') return [];

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

    const requiresDedicatedLabRoom = (sectionId: string, subjectId: string) => {
      const subject = subjects.find(s => s.id === subjectId);
      if (!subject?.requiresLab) return false;
      return getAllowedLabRooms(subjectId, sectionId).length > 0;
    };

    const requiresLockedDoubleBlock = (sectionId: string, subjectId: string) => {
      const subject = subjects.find(s => s.id === subjectId);
      if (!subject) return false;
      const grade = sectionGradeMap.get(sectionId) ?? '';

      if (WE_SUBJECTS.has(subject.name)) {
        return DOUBLE_WE_GRADES.has(grade);
      }

      if (subject.isDoublePeriod) {
        return SCIENCE_LAB_SUBJECTS.has(subject.name) ? ['IX', 'X', 'XI', 'XII'].includes(grade) : true;
      }

      return false;
    };

    const labTeacherCandidateCache = new Map<string, string[]>();

    const getLabTeacherCandidateIds = (
      sectionId: string,
      subjectId: string,
      primaryTeacherId: string
    ) => {
      if (!requiresDedicatedLabRoom(sectionId, subjectId)) return [];

      const cacheKey = `${sectionId}|${subjectId}|${primaryTeacherId}`;
      const cached = labTeacherCandidateCache.get(cacheKey);
      if (cached) return cached;

      const subject = subjects.find((s) => s.id === subjectId);
      const grade = sectionGradeMap.get(sectionId) ?? '';
      if (!subject || !grade) {
        labTeacherCandidateCache.set(cacheKey, []);
        return [];
      }

      const directLabLinks = teacherSubjects
        .filter(
          (link) =>
            link.sectionId === sectionId &&
            link.subjectId === subjectId &&
            link.teacher.isActive !== false &&
            (
              link.isLabAssignment ||
              isLabDepartment(link.teacher.department) ||
              getExplicitLabTeacherCandidates([link.teacher as any], subject.name, grade).length > 0
            )
        )
        .map((link) => link.teacher);

      const rosterCandidates = getExplicitLabTeacherCandidates(teachers as any, subject.name, grade);
      const ranked = [...directLabLinks, ...rosterCandidates]
        .filter((teacher) => teacher.id !== primaryTeacherId || directLabLinks.length === 0)
        .sort((a, b) => {
          const aDirect = Number(directLabLinks.some((teacher) => teacher.id === a.id));
          const bDirect = Number(directLabLinks.some((teacher) => teacher.id === b.id));
          if (aDirect !== bDirect) return bDirect - aDirect;
          if (a.id === primaryTeacherId || b.id === primaryTeacherId) {
            return Number(a.id === primaryTeacherId) - Number(b.id === primaryTeacherId);
          }
          return a.abbreviation.localeCompare(b.abbreviation);
        });

      const deduped: string[] = [];
      const seen = new Set<string>();
      for (const teacher of ranked) {
        if (seen.has(teacher.id)) continue;
        seen.add(teacher.id);
        deduped.push(teacher.id);
      }
      if (!seen.has(primaryTeacherId)) {
        deduped.push(primaryTeacherId);
      }

      labTeacherCandidateCache.set(cacheKey, deduped);
      return deduped;
    };

    const isTeacherAvailableForSlot = (
      teacherId: string,
      dayId: string,
      timeSlotId: string,
      relaxed = false
    ) => {
      const key = `${dayId}-${timeSlotId}`;
      if (teacherUnavailabilitySet.has(`${teacherId}|${key}`)) return false;
      if (teacherBusy.get(teacherId)?.has(key)) return false;
      if (!relaxed) {
        const maxToday = teacherMaxPerDay.get(teacherId) ?? GLOBAL_MAX_PERIODS_PER_DAY;
        if ((teacherDailyLoad.get(teacherId)?.get(dayId) ?? 0) >= maxToday) return false;
        const slot = timeSlots.find((value) => value.id === timeSlotId);
        if (slot && hasRunOfFour(teacherId, dayId, slot.periodNumber)) return false;
      }
      return true;
    };

    const resolveLabTeacherForSlot = (
      sectionId: string,
      subjectId: string,
      primaryTeacherId: string,
      dayId: string,
      timeSlotId: string,
      relaxed = false,
      preferredLabTeacherId?: string | null
    ): string | undefined | null => {
      if (!requiresDedicatedLabRoom(sectionId, subjectId)) return undefined;

      const candidateIds = preferredLabTeacherId
        ? [preferredLabTeacherId]
        : getLabTeacherCandidateIds(sectionId, subjectId, primaryTeacherId);

      for (const candidateId of candidateIds) {
        if (candidateId === primaryTeacherId || isTeacherAvailableForSlot(candidateId, dayId, timeSlotId, relaxed)) {
          return candidateId;
        }
      }

      return null;
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

    const getGroupedSectionLimit = (subjectName: string) =>
      GROUPED_SECTION_SUBJECT_LIMITS.get(subjectName) ?? null;

    const getGroupedSectionPoolKey = (
      teacherId: string,
      subjectId: string,
      sectionId: string
    ) => `${teacherId}|${subjectId}|${sectionGradeMap.get(sectionId) ?? ''}`;

    const getGroupedSectionSlotKey = (
      teacherId: string,
      subjectId: string,
      sectionId: string,
      dayId: string,
      timeSlotId: string
    ) => `${getGroupedSectionPoolKey(teacherId, subjectId, sectionId)}|${dayId}-${timeSlotId}`;

    const getGroupedSectionCount = (
      teacherId: string,
      subjectId: string,
      sectionId: string,
      dayId: string,
      timeSlotId: string
    ) => groupedSectionSlotCount.get(getGroupedSectionSlotKey(teacherId, subjectId, sectionId, dayId, timeSlotId)) ?? 0;

    const noteGroupedSectionSlot = (
      teacherId: string,
      subjectId: string,
      sectionId: string,
      dayId: string,
      timeSlotId: string
    ) => {
      const poolKey = getGroupedSectionPoolKey(teacherId, subjectId, sectionId);
      const slotKey = getGroupedSectionSlotKey(teacherId, subjectId, sectionId, dayId, timeSlotId);
      groupedSectionSlotCount.set(slotKey, (groupedSectionSlotCount.get(slotKey) ?? 0) + 1);
      if (!groupedSectionSlotsByTeacherSubjectGrade.has(poolKey)) {
        groupedSectionSlotsByTeacherSubjectGrade.set(poolKey, new Set());
      }
      groupedSectionSlotsByTeacherSubjectGrade.get(poolKey)!.add(`${dayId}|${timeSlotId}`);
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
              teacherPeriodPriorityByPeriod,
              morningPreferenceByPeriod,
              endPreferenceByPeriod,
              scoringWeights,
              getAllowedLabRooms,
            },
          });
          const bestDayId = bestSlot?.dayId;
          const currentBestDayOrder = bestDayId
            ? (candidateDays.find(d => d.id === bestDayId)?.dayOrder ?? Number.POSITIVE_INFINITY)
            : Number.POSITIVE_INFINITY;

          if (
            score > bestScore ||
            (score === bestScore && day.dayOrder < currentBestDayOrder)
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
      // Keep swap conservative: do not move labs or grouped/shared-slot activities.
      if (
        requiresDedicatedLabRoom(sectionId, rec.subjectId) ||
        requiresLockedDoubleBlock(sectionId, rec.subjectId) ||
        SHARED_SLOT_SUBJECTS.has(subj.name) ||
        GROUPED_SECTION_SUBJECT_LIMITS.has(subj.name) ||
        rec.subjectId === gamesSubjectId
      ) return false;
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
                const orderedPair: [SlimSlot, SlimSlot] = occupied.periodNumber <= partner.periodNumber
                  ? [occupied, partner]
                  : [partner, occupied];
                return { dayId: day.id, pair: orderedPair };
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
      bypassSubjectDay = false,
      labTeacherId?: string | null
    ): boolean => {
      const key = `${dayId}-${timeSlotId}`;

      // Section already has a subject here
      if (sectionBusy.get(sectionId)?.has(key)) return false;

      const subjectObj = subjectId ? subjects.find(s => s.id === subjectId) : null;
      const isSharedSlot = subjectObj ? SHARED_SLOT_SUBJECTS.has(subjectObj.name) : false;
      const groupedLimit = subjectObj ? getGroupedSectionLimit(subjectObj.name) : null;

      if (teacherId) {
        // Teacher-specific unavailability is always hard-blocking.
        if (teacherUnavailabilitySet.has(`${teacherId}|${dayId}-${timeSlotId}`)) return false;

        if (!isSharedSlot) {
          const teacherBusyAtSlot = teacherBusy.get(teacherId)?.has(key) ?? false;
          const groupedCount = subjectId && groupedLimit !== null
            ? getGroupedSectionCount(teacherId, subjectId, sectionId, dayId, timeSlotId)
            : 0;
          const reusesGroupedSlot = groupedLimit !== null && groupedCount > 0;

          // Regular subjects: teacher can only be in one place at a time unless this is
          // a permitted grouped-language slot for the same grade/subject.
          if (teacherBusyAtSlot && !reusesGroupedSlot) return false;
          if (reusesGroupedSlot && groupedCount >= groupedLimit) return false;

          if (!teacherBusyAtSlot) {
            // R10: enforce per-teacher daily spread cap
            const maxToday = teacherMaxPerDay.get(teacherId) ?? GLOBAL_MAX_PERIODS_PER_DAY;
            if ((teacherDailyLoad.get(teacherId)?.get(dayId) ?? 0) >= maxToday) return false;
            const slot = timeSlots.find(t => t.id === timeSlotId);
            if (slot && hasRunOfFour(teacherId, dayId, slot.periodNumber)) return false;
          }
        }
      }

      if (subjectObj) {
        const slot = timeSlots.find(t => t.id === timeSlotId);
        const usesDedicatedLabRoom = subjectId ? requiresDedicatedLabRoom(sectionId, subjectId) : false;

        if (teacherId && usesDedicatedLabRoom) {
          const resolvedLabTeacherId = resolveLabTeacherForSlot(
            sectionId,
            subjectObj.id,
            teacherId,
            dayId,
            timeSlotId,
            false,
            labTeacherId
          );
          if (resolvedLabTeacherId === null) return false;
        }

        // Period 1 must not be lab, library, games, yoga, or any activity subject
        if (slot?.periodNumber === 1) {
          if (usesDedicatedLabRoom || NO_PERIOD_1_SUBJECTS.has(subjectObj.name)) return false;
        }

        // Yoga/Aerobics are not scheduled for classes XI and XII.
        if ((subjectObj.name === 'Yoga' || subjectObj.name === 'Aerobics') &&
            NO_YOGA_GRADES.has(sectionGradeMap.get(sectionId) ?? '')) {
          return false;
        }

        // W.E. subjects (Music, Art, Dance, Work Experience) are only for classes VI–X.
        if (WE_SUBJECTS.has(subjectObj.name)) {
          const grade = sectionGradeMap.get(sectionId) ?? '';
          if (grade === 'XI' || grade === 'XII') return false;
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
        if (usesDedicatedLabRoom) {
          const room = findAvailableLabRoom(subjectObj.id, sectionId, dayId, timeSlotId);
          if (!room) return false;
        }
      }

      if (subjectId && !bypassSubjectDay) {
        if (sectionDaySubjects.get(`${sectionId}|${dayId}`)?.has(subjectId)) return false;
      }
      return true;
    };

    const createdSlots: SlotRecord[] = [];
    const sectionSlotIndex = new Map<string, number>();

    const baselineSlots = clearExisting
      ? (preserveLocked ? lockedSlots : [])
      : allExistingSlots;
    const resetPlacementState = () => {
      for (const busy of teacherBusy.values()) busy.clear();
      for (const busy of sectionBusy.values()) busy.clear();
      roomBusy.clear();
      groupedSectionSlotCount.clear();
      groupedSectionSlotsByTeacherSubjectGrade.clear();
      languageGroupedSlotCount.clear();
      gamesSlotCount.clear();
      sectionDayPeriodSubject.clear();
      teacherPeriodsByDay.clear();
      sectionSlotIndex.clear();
      sectionDayHeavyCount.clear();

      for (const teacher of teachers) {
        teacherLoad.set(teacher.id, 0);
        teacherDailyLoad.get(teacher.id)?.clear();
      }
      for (const section of sections) {
        sectionDailyLoad.get(section.id)?.clear();
      }
      for (const subjectSet of sectionDaySubjects.values()) {
        subjectSet.clear();
      }
    };

    const applyTeacherSlotState = (
      teacherId: string,
      sectionId: string,
      dayId: string,
      timeSlotId: string,
      subjectId?: string | null
    ) => {
      const key = `${dayId}-${timeSlotId}`;
      const timeSlot = timeSlots.find(t => t.id === timeSlotId);
      const subjectObj = subjectId ? subjects.find(s => s.id === subjectId) : null;
      const isShared = subjectObj ? SHARED_SLOT_SUBJECTS.has(subjectObj.name) : false;
      const groupedLimit = subjectObj ? getGroupedSectionLimit(subjectObj.name) : null;
      const groupedCountBefore = groupedLimit !== null && subjectId
        ? getGroupedSectionCount(teacherId, subjectId, sectionId, dayId, timeSlotId)
        : 0;

      if (groupedLimit !== null && subjectId) {
        noteGroupedSectionSlot(teacherId, subjectId, sectionId, dayId, timeSlotId);
      }

      const alreadyBusy = (isShared || groupedCountBefore > 0) && (teacherBusy.get(teacherId)?.has(key) ?? false);
      teacherBusy.get(teacherId)?.add(key);

      if (!alreadyBusy) {
        teacherLoad.set(teacherId, (teacherLoad.get(teacherId) ?? 0) + 1);
        const dm = teacherDailyLoad.get(teacherId);
        if (dm) dm.set(dayId, (dm.get(dayId) ?? 0) + 1);
        if (timeSlot) {
          const pdKey = `${teacherId}|${dayId}`;
          if (!teacherPeriodsByDay.has(pdKey)) teacherPeriodsByDay.set(pdKey, new Set());
          teacherPeriodsByDay.get(pdKey)!.add(timeSlot.periodNumber);
        }
      }
    };

    const applyScheduledSlotState = (
      slot: {
        sectionId: string;
        dayId: string;
        timeSlotId: string;
        subjectId?: string | null;
        teacherId?: string | null;
        labTeacherId?: string | null;
        roomId?: string | null;
      },
      createdIndex?: number
    ) => {
      const key = `${slot.dayId}-${slot.timeSlotId}`;
      const timeSlot = timeSlots.find(t => t.id === slot.timeSlotId);
      const subjectObj = slot.subjectId ? subjects.find(s => s.id === slot.subjectId) : null;

      sectionBusy.get(slot.sectionId)?.add(key);
      const sdm = sectionDailyLoad.get(slot.sectionId);
      if (sdm) sdm.set(slot.dayId, (sdm.get(slot.dayId) ?? 0) + 1);

      if (slot.subjectId) {
        const sdKey = `${slot.sectionId}|${slot.dayId}`;
        sectionDaySubjects.get(sdKey)?.add(slot.subjectId);
        if (timeSlot) {
          if (!sectionDayPeriodSubject.has(sdKey)) sectionDayPeriodSubject.set(sdKey, new Map());
          sectionDayPeriodSubject.get(sdKey)!.set(timeSlot.periodNumber, slot.subjectId);
        }
        if (subjectObj && HEAVY_SUBJECTS.has(subjectObj.name)) {
          const hdKey = `${slot.sectionId}|${slot.dayId}`;
          sectionDayHeavyCount.set(hdKey, (sectionDayHeavyCount.get(hdKey) ?? 0) + 1);
        }
      }

      if (slot.subjectId === gamesSubjectId) {
        const isFirstForSlot = (gamesSlotCount.get(key) ?? 0) === 0;
        gamesSlotCount.set(key, (gamesSlotCount.get(key) ?? 0) + 1);

        if (isFirstForSlot && timeSlot) {
          for (const sportsTid of sportsTeacherIds) {
            teacherBusy.get(sportsTid)?.add(key);
            teacherLoad.set(sportsTid, (teacherLoad.get(sportsTid) ?? 0) + 1);
            const dm = teacherDailyLoad.get(sportsTid);
            if (dm) dm.set(slot.dayId, (dm.get(slot.dayId) ?? 0) + 1);
            const pdKey = `${sportsTid}|${slot.dayId}`;
            if (!teacherPeriodsByDay.has(pdKey)) teacherPeriodsByDay.set(pdKey, new Set());
            teacherPeriodsByDay.get(pdKey)!.add(timeSlot.periodNumber);
          }
        }
      } else if (slot.teacherId || slot.labTeacherId || (slot as { notes?: string | null }).notes) {
        const combinedMeta = parseCombinedSlotMetadata((slot as { notes?: string | null }).notes ?? null);
        if (combinedMeta?.kind === 'language-block' && combinedMeta.options.length > 0) {
          for (const option of combinedMeta.options) {
            const teacherKey = `${slot.dayId}-${slot.timeSlotId}`;
            const teacherBusyAtSlot = teacherBusy.get(option.teacherId)?.has(teacherKey) ?? false;
            const groupedKey = `${option.teacherId}|${option.subjectId}|${combinedMeta.grade}|${slot.dayId}|${slot.timeSlotId}`;
            const groupedCount = languageGroupedSlotCount.get(groupedKey) ?? 0;
            const reusesGroupedSlot = option.sharing === 'grouped' && groupedCount > 0;
            const skipLoadIncrement = option.sharing === 'shared'
              ? teacherBusyAtSlot
              : reusesGroupedSlot;

            if (option.sharing === 'grouped') {
              languageGroupedSlotCount.set(groupedKey, groupedCount + 1);
            }

            teacherBusy.get(option.teacherId)?.add(teacherKey);

            if (!skipLoadIncrement) {
              teacherLoad.set(option.teacherId, (teacherLoad.get(option.teacherId) ?? 0) + 1);
              const dm = teacherDailyLoad.get(option.teacherId);
              if (dm) dm.set(slot.dayId, (dm.get(slot.dayId) ?? 0) + 1);
              if (timeSlot) {
                const pdKey = `${option.teacherId}|${slot.dayId}`;
                if (!teacherPeriodsByDay.has(pdKey)) teacherPeriodsByDay.set(pdKey, new Set());
                teacherPeriodsByDay.get(pdKey)!.add(timeSlot.periodNumber);
              }
            }
          }
        } else {
          const teacherIds = new Set(
            [slot.teacherId, slot.labTeacherId].filter((value): value is string => Boolean(value))
          );
          for (const assignedTeacherId of teacherIds) {
            applyTeacherSlotState(
              assignedTeacherId,
              slot.sectionId,
              slot.dayId,
              slot.timeSlotId,
              slot.subjectId
            );
          }
        }
      }

      if (slot.roomId) {
        roomBusy.add(`${slot.roomId}|${slot.dayId}-${slot.timeSlotId}`);
      }
      if (createdIndex !== undefined) {
        sectionSlotIndex.set(`${slot.sectionId}|${slot.dayId}|${slot.timeSlotId}`, createdIndex);
      }
    };

    const rebuildPlacementState = (skipCreatedIndex?: number | Set<number>) => {
      const skipIndices = skipCreatedIndex instanceof Set
        ? skipCreatedIndex
        : skipCreatedIndex === undefined
          ? null
          : new Set([skipCreatedIndex]);
      resetPlacementState();
      for (const slot of baselineSlots) {
        if (!slot.subjectId || (!slot.teacherId && !(slot as any).labTeacherId)) continue;
        applyScheduledSlotState(slot);
      }
      createdSlots.forEach((slot, index) => {
        if (skipIndices?.has(index)) return;
        applyScheduledSlotState(slot, index);
      });
    };

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
      const resolvedLabTeacherId = resolveLabTeacherForSlot(
        sectionId,
        subjectId,
        teacherId,
        dayId,
        timeSlotId,
        false,
        flags.labTeacherId
      );
      if (resolvedLabTeacherId === null) return false;
      let assignedRoomId: string | null = null;

      if (requiresDedicatedLabRoom(sectionId, subjectId)) {
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
        const groupedLimit = subjectObj ? getGroupedSectionLimit(subjectObj.name) : null;
        const groupedCountBefore = groupedLimit !== null
          ? getGroupedSectionCount(teacherId, subjectId, sectionId, dayId, timeSlotId)
          : 0;
        if (groupedLimit !== null) {
          noteGroupedSectionSlot(teacherId, subjectId, sectionId, dayId, timeSlotId);
        }
        const alreadyBusy = (isShared || groupedCountBefore > 0) && (teacherBusy.get(teacherId)?.has(key) ?? false);

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

      if (resolvedLabTeacherId && resolvedLabTeacherId !== teacherId) {
        applyTeacherSlotState(resolvedLabTeacherId, sectionId, dayId, timeSlotId, subjectId);
      }

      // Auto-derive flags from subject name so callers don't need to pass them explicitly
      const subName = subjects.find(s => s.id === subjectId)?.name ?? '';
      createdSlots.push({
        sectionId,
        dayId,
        timeSlotId,
        subjectId,
        teacherId,
        labTeacherId: resolvedLabTeacherId ?? null,
        roomId: assignedRoomId,
        isLab: flags.isLab ?? requiresDedicatedLabRoom(sectionId, subjectId),
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
    // Heavy subjects: max 2 of these per day per section (Improvement 5)
    const HEAVY_SUBJECTS = new Set(['Mathematics', 'Physics', 'Chemistry', 'Science', 'Biology']);
    const MAX_HEAVY_PER_DAY = 2;

    // Track heavy subjects per section per day
    const sectionDayHeavyCount = new Map<string, number>();
    rebuildPlacementState();

    const unassigned: string[] = [];
    const warnings: string[] = [];
    const allocationNotes: string[] = [];
    const subjectByName = new Map(subjects.map(s => [s.name, s]));

    // ═══ LAYER 1: TEACHER ALLOCATION ═════════════════════════════════════════
    // Build sectionTeacherMap: Map<sectionId, Map<subjectId, teacherId>>
    // Rule T1: One teacher per subject per section
    // Rule T2: Teacher must be eligible for the section's grade
    // Rule T3: Balance workload across teachers
    if (process.env.NODE_ENV === 'development') { console.log('Layer 1: Teacher Allocation...'); }

    // Deduplicate teacherSubjects: keep one primary teacher per (section, subject)
    const labAssistants: typeof teacherSubjects = [];
    const primaryMap = new Map<string, typeof teacherSubjects[0]>();
    const exactSubjectTeacherIds = new Map<string, Set<string>>();

    for (const link of teacherSubjects) {
      if (!exactSubjectTeacherIds.has(link.subjectId)) {
        exactSubjectTeacherIds.set(link.subjectId, new Set());
      }
      exactSubjectTeacherIds.get(link.subjectId)!.add(link.teacherId);
    }

    for (const a of [...teacherSubjects].sort((x, y) => y.periodsPerWeek - x.periodsPerWeek)) {
      if (a.isLabAssignment) {
        labAssistants.push(a);
        continue;
      }
      const k = `${a.sectionId}|${a.subjectId}`;
      if (!primaryMap.has(k)) {
        primaryMap.set(k, a);
      }
    }

    let assignments: TeacherAssignment[] = Array.from(primaryMap.values()) as TeacherAssignment[];
    const teachersById = new Map(teachers.map(t => [t.id, t]));
    const projectedTeacherLoad = new Map<string, number>(teachers.map(t => [t.id, 0]));
    const projectedLoadIncrement = (
      subjectName: string,
      periodsPerWeek: number,
      groupedCount = 0
    ) => {
      if (subjectName === 'Games') return Math.max(1, Math.ceil(periodsPerWeek / MAX_GAMES_PER_SLOT));
      const groupedLimit = getGroupedSectionLimit(subjectName);
      if (groupedLimit !== null) {
        if (groupedCount <= 0) return periodsPerWeek;
        return Math.max(1, Math.ceil(periodsPerWeek / groupedLimit));
      }
      if (SHARED_SLOT_SUBJECTS.has(subjectName)) return 1;
      return periodsPerWeek;
    };

    // Existing assignments before reference normalization / auto-fill.
    const existingSectionTeacherMap = new Map<string, Map<string, { teacherId: string; periodsPerWeek: number }>>();
    for (const section of sections) {
      existingSectionTeacherMap.set(section.id, new Map());
    }

    for (const a of assignments) {
      const map = existingSectionTeacherMap.get(a.sectionId);
      if (map) {
        map.set(a.subjectId, { teacherId: a.teacherId, periodsPerWeek: a.periodsPerWeek });
      }
    }

    for (const a of assignments) {
      projectedTeacherLoad.set(
        a.teacherId,
        (projectedTeacherLoad.get(a.teacherId) ?? 0) + projectedLoadIncrement(a.subject.name, a.periodsPerWeek)
      );
    }

    const pickBucketSubjectName = (
      sectionId: string,
      candidates: string[],
      usedNames: Set<string>
    ): string | null => {
      const sectionAssignments = existingSectionTeacherMap.get(sectionId);
      const ranked = candidates
        .filter(name => !usedNames.has(name) && subjectByName.has(name))
        .map((name, order) => {
          const subjectId = subjectByName.get(name)?.id ?? '';
          const periodsPerWeek = subjectId
            ? (sectionAssignments?.get(subjectId)?.periodsPerWeek ?? -1)
            : -1;
          return { name, order, periodsPerWeek };
        })
        .sort((a, b) => {
          if (a.periodsPerWeek !== b.periodsPerWeek) return b.periodsPerWeek - a.periodsPerWeek;
          return a.order - b.order;
        });
      return ranked[0]?.name ?? null;
    };

    const resolveReferenceSubjectName = (
      sectionId: string,
      logicalName: string,
      usedNames: Set<string>
    ): string | null => {
      switch (logicalName) {
        case '2nd Language':
          return pickBucketSubjectName(sectionId, LANGUAGE_BUCKET_SUBJECTS, usedNames);
        case '3rd Language':
          return pickBucketSubjectName(sectionId, ['French', 'Nepali', 'Hindi'], usedNames);
        case 'Work Experience':
          return pickBucketSubjectName(sectionId, WORK_EXPERIENCE_BUCKET_SUBJECTS, usedNames);
        case 'Science':
          return pickBucketSubjectName(sectionId, SCIENCE_BUCKET_SUBJECTS, usedNames);
        default:
          return subjectByName.has(logicalName) ? logicalName : null;
      }
    };

    const referencePeriodsBySection = new Map<string, Map<string, number>>();
    const allowedSubjectIdsBySection = new Map<string, Set<string>>();
    const referenceSectionIds = new Set<string>();

    type ReferenceAssignmentSpec = {
      section: typeof sections[number];
      subject: typeof subjects[number];
      grade: string;
      periodsPerWeek: number;
      preferredTeacherId: string | null;
    };
    type CandidateTeacher = {
      teacher: typeof teachers[number];
      relaxed: boolean;
    };

    const referenceSpecs: ReferenceAssignmentSpec[] = [];

    for (const section of sections) {
      const grade = sectionGradeMap.get(section.id) ?? '';
      const template = REFERENCE_GRADE_REQUIREMENTS[grade];
      if (!template) continue;
      referenceSectionIds.add(section.id);

      const usedNames = new Set<string>();
      const periodsMap = new Map<string, number>();
      const allowedSubjectIds = new Set<string>();

      for (const [logicalName, periodsPerWeek] of Object.entries(template)) {
        const resolvedName = resolveReferenceSubjectName(section.id, logicalName, usedNames);
        if (!resolvedName) {
          warnings.push(`[reference-skip] ${section.name} ${logicalName}: no matching subject in current data`);
          continue;
        }

        usedNames.add(resolvedName);
        const subject = subjectByName.get(resolvedName);
        if (!subject) {
          warnings.push(`[reference-missing-subject] ${section.name} ${resolvedName}: subject not found in DB`);
          continue;
        }

        periodsMap.set(subject.id, (periodsMap.get(subject.id) ?? 0) + periodsPerWeek);
        allowedSubjectIds.add(subject.id);
        referenceSpecs.push({
          section,
          subject,
          grade,
          periodsPerWeek,
          preferredTeacherId: existingSectionTeacherMap.get(section.id)?.get(subject.id)?.teacherId ?? null,
        });
      }

      referencePeriodsBySection.set(section.id, periodsMap);
      allowedSubjectIdsBySection.set(section.id, allowedSubjectIds);
    }

    assignments = assignments.filter(a => !referenceSectionIds.has(a.sectionId));
    projectedTeacherLoad.clear();
    for (const teacher of teachers) {
      projectedTeacherLoad.set(teacher.id, 0);
    }
    for (const a of assignments) {
      projectedTeacherLoad.set(
        a.teacherId,
        (projectedTeacherLoad.get(a.teacherId) ?? 0) + projectedLoadIncrement(a.subject.name, a.periodsPerWeek)
      );
    }

    const candidatePoolCache = new Map<string, CandidateTeacher[]>();
    const referenceTeacherSubjectCount = new Map<string, number>();
    const referenceTeacherSubjectGrades = new Map<string, Set<string>>();

    for (const a of assignments) {
      const grade = sectionGradeMap.get(a.sectionId) ?? '';
      const subjectTeacherKey = `${a.subjectId}|${a.teacherId}`;
      if (!referenceTeacherSubjectGrades.has(subjectTeacherKey)) {
        referenceTeacherSubjectGrades.set(subjectTeacherKey, new Set());
      }
      if (grade) {
        referenceTeacherSubjectGrades.get(subjectTeacherKey)!.add(grade);
      }
    }

    const getCandidatePool = (subject: typeof subjects[number], grade: string): CandidateTeacher[] => {
      const cacheKey = `${subject.id}|${grade}`;
      const cached = candidatePoolCache.get(cacheKey);
      if (cached) return cached;

      const strict = teachers.filter(t => teacherCanCoverSubject(t as any, subject, grade));
      const strictIds = new Set(strict.map(t => t.id));
      const relaxedOnly = teachers.filter(
        t => !strictIds.has(t.id) && teacherCanCoverSubject({ ...t, teachableGrades: '[]' } as any, subject, grade)
      );
      const pool = [
        ...strict.map((teacher) => ({ teacher, relaxed: false })),
        ...relaxedOnly.map((teacher) => ({ teacher, relaxed: true })),
      ];
      candidatePoolCache.set(cacheKey, pool);
      return pool;
    };

    const pickTeacherForSubject = (
      spec: ReferenceAssignmentSpec
    ): { teacher: typeof teachers[number]; relaxed: boolean } | null => {
      const { section, subject, grade, periodsPerWeek, preferredTeacherId } = spec;
      const pool = getCandidatePool(subject, grade);
      if (pool.length === 0) return null;
      const classTeacherId = sectionClassTeacherMap.get(section.id);

      const ranked = [...pool].sort((a, b) => {
        const score = (candidate: CandidateTeacher) => {
          const teacher = candidate.teacher;
          const sameGradeKey = `${grade}|${subject.id}|${teacher.id}`;
          const subjectTeacherKey = `${subject.id}|${teacher.id}`;
          const sameGradeSubject = referenceTeacherSubjectCount.get(sameGradeKey) ?? 0;
          const teacherGradesForSubject = referenceTeacherSubjectGrades.get(subjectTeacherKey) ?? new Set<string>();
          const groupedLimit = getGroupedSectionLimit(subject.name);
          const increment = projectedLoadIncrement(subject.name, periodsPerWeek, sameGradeSubject);
          const projected = projectedTeacherLoad.get(teacher.id) ?? 0;
          const target = Math.max(teacher.targetWorkload, 1);
          const projectedAfter = projected + increment;
          const overflow = Math.max(0, projectedAfter - target);
          const ratioAfter = projectedAfter / target;
          const newGradePenalty = teacherGradesForSubject.size > 0 && !teacherGradesForSubject.has(grade)
            ? teacherGradesForSubject.size * (groupedLimit !== null ? 0.35 : subject.name === 'Nepali' ? 0.22 : 0.12)
            : 0;
          const sameGradePenalty = groupedLimit !== null
            ? Math.floor(sameGradeSubject / groupedLimit) * 0.2
            : sameGradeSubject * 0.18;
          const sameGradeBonus = groupedLimit !== null && sameGradeSubject > 0 && sameGradeSubject < groupedLimit
            ? -0.25
            : 0;
          const specialistBonus = subject.name === 'Geography' && (exactSubjectTeacherIds.get(subject.id)?.has(teacher.id) ?? false)
            ? -0.45
            : 0;
          const preferenceBonus = teacher.id === preferredTeacherId ? -0.03 : 0;
          const classTeacherBonus = teacher.id === classTeacherId ? -0.05 : 0;
          const relaxedPenalty = candidate.relaxed ? 0.35 : 0;
          return overflow * 3 + ratioAfter + newGradePenalty + sameGradePenalty + sameGradeBonus + specialistBonus + relaxedPenalty + preferenceBonus + classTeacherBonus;
        };

        const scoreA = score(a);
        const scoreB = score(b);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.teacher.abbreviation.localeCompare(b.teacher.abbreviation);
      });

      const best = ranked[0];
      return best ?? null;
    };

    referenceSpecs.sort((a, b) => {
      const aPool = getCandidatePool(a.subject, a.grade);
      const bPool = getCandidatePool(b.subject, b.grade);
      const aStrict = aPool.filter(c => !c.relaxed).length;
      const bStrict = bPool.filter(c => !c.relaxed).length;
      if (aStrict !== bStrict) return aStrict - bStrict;
      if (aPool.length !== bPool.length) return aPool.length - bPool.length;
      if (a.periodsPerWeek !== b.periodsPerWeek) return b.periodsPerWeek - a.periodsPerWeek;
      return a.section.name.localeCompare(b.section.name);
    });

    for (const spec of referenceSpecs) {
      const picked = pickTeacherForSubject(spec);
      if (!picked) {
        warnings.push(`[missing-teacher] ${spec.section.name} ${spec.subject.name}: no eligible teacher for grade ${spec.grade}`);
        continue;
      }

      const teacher = picked.teacher;
      const sameGradeKey = `${spec.grade}|${spec.subject.id}|${teacher.id}`;
      const subjectTeacherKey = `${spec.subject.id}|${teacher.id}`;
      const sameGradeSubject = referenceTeacherSubjectCount.get(sameGradeKey) ?? 0;
      assignments.push({
        teacherId: teacher.id,
        subjectId: spec.subject.id,
        sectionId: spec.section.id,
        periodsPerWeek: spec.periodsPerWeek,
        teacher: {
          id: teacher.id,
          abbreviation: teacher.abbreviation,
          targetWorkload: teacher.targetWorkload,
          department: teacher.department,
          name: teacher.name,
          teachableGrades: teacher.teachableGrades,
        },
        subject: {
          id: spec.subject.id,
          name: spec.subject.name,
          code: spec.subject.code,
          requiresLab: spec.subject.requiresLab,
          isDoublePeriod: spec.subject.isDoublePeriod,
        },
        section: {
          id: spec.section.id,
          name: spec.section.name,
        },
      });
      existingSectionTeacherMap.get(spec.section.id)?.set(spec.subject.id, {
        teacherId: teacher.id,
        periodsPerWeek: spec.periodsPerWeek,
      });
      projectedTeacherLoad.set(
        teacher.id,
        (projectedTeacherLoad.get(teacher.id) ?? 0) + projectedLoadIncrement(spec.subject.name, spec.periodsPerWeek, sameGradeSubject)
      );
      referenceTeacherSubjectCount.set(
        sameGradeKey,
        sameGradeSubject + 1
      );
      if (!referenceTeacherSubjectGrades.has(subjectTeacherKey)) {
        referenceTeacherSubjectGrades.set(subjectTeacherKey, new Set());
      }
      referenceTeacherSubjectGrades.get(subjectTeacherKey)!.add(spec.grade);

      const previousTeacherId = spec.preferredTeacherId;
      if (!previousTeacherId) {
        allocationNotes.push(
          `[auto-assignment] ${spec.section.name} ${spec.subject.name} -> ${teacher.abbreviation} (${spec.periodsPerWeek}/wk)`
        );
      } else if (previousTeacherId !== teacher.id) {
        const previousTeacher = teachersById.get(previousTeacherId);
        allocationNotes.push(
          `[rebalanced-assignment] ${spec.section.name} ${spec.subject.name} -> ${teacher.abbreviation} (was ${previousTeacher?.abbreviation ?? 'unknown'})`
        );
      } else if (picked.relaxed) {
        allocationNotes.push(
          `[grade-fallback] ${spec.section.name} ${spec.subject.name} -> ${teacher.abbreviation} (${spec.grade} via department match)`
        );
      }
    }

    assignments = assignments.filter(a => {
      const allowedSubjectIds = allowedSubjectIdsBySection.get(a.sectionId);
      return !allowedSubjectIds || allowedSubjectIds.has(a.subjectId);
    });

    const languageBlocks: LanguageBlockSpec[] = [];
    const excludedLanguageAssignments = new Set<string>();

    for (const section of sections) {
      const grade = sectionGradeMap.get(section.id) ?? '';
      const template = REFERENCE_GRADE_REQUIREMENTS[grade];
      if (!template) continue;

      for (const bucket of ['2nd Language', '3rd Language'] as const) {
        const periodsPerWeek = template[bucket];
        if (!periodsPerWeek) continue;

        const config = LANGUAGE_BUCKET_CONFIG[bucket];
        const options: LanguageBlockOption[] = [];

        for (const subjectName of config.subjectNames) {
          const subject = subjectByName.get(subjectName);
          if (!subject) continue;

          const teacherAssignment = existingSectionTeacherMap.get(section.id)?.get(subject.id);
          const teacher = teacherAssignment ? teachersById.get(teacherAssignment.teacherId) : null;
          if (!teacher) continue;

          const sharingRule = config.getSharingRule(subjectName);
          options.push({
            subjectId: subject.id,
            subjectName: subject.name,
            subjectCode: subject.code,
            teacherId: teacher.id,
            teacherName: teacher.name,
            teacherAbbreviation: teacher.abbreviation,
            sharing: sharingRule.mode,
            groupLimit: sharingRule.groupLimit ?? null,
          });

          excludedLanguageAssignments.add(`${section.id}|${subject.id}`);
        }

        if (options.length === 0) {
          warnings.push(`[language-block-skip] ${section.name} ${bucket}: no teacher assignments found`);
          continue;
        }

        const missingOptions = config.subjectNames.filter(
          (subjectName) => !options.some((option) => option.subjectName === subjectName)
        );
        if (missingOptions.length > 0) {
          warnings.push(
            `[language-block-missing] ${section.name} ${bucket}: missing ${missingOptions.join(', ')} teacher assignment(s)`
          );
        }

        const displayOrder = config.subjectNames.filter(
          (subjectName) => options.some((option) => option.subjectName === subjectName)
        );
        const representative = [...options].sort((a, b) => {
          const modeRank = (mode: CombinedSlotSharingMode) =>
            mode === 'single' ? 0 : mode === 'grouped' ? 1 : 2;
          const modeDiff = modeRank(a.sharing) - modeRank(b.sharing);
          if (modeDiff !== 0) return modeDiff;
          return displayOrder.indexOf(a.subjectName) - displayOrder.indexOf(b.subjectName);
        })[0];

        if (!representative) continue;

        languageBlocks.push({
          bucket,
          grade,
          sectionId: section.id,
          sectionName: section.name,
          periodsPerWeek,
          displayName: displayOrder.join(' / '),
          displayCode: displayOrder
            .map((subjectName) => subjectByName.get(subjectName)?.code ?? subjectName)
            .join(' / '),
          representativeSubjectId: representative.subjectId,
          options: displayOrder
            .map((subjectName) => options.find((option) => option.subjectName === subjectName))
            .filter((option): option is LanguageBlockOption => Boolean(option)),
        });
      }
    }

    assignments = assignments.filter(
      (assignment) => !excludedLanguageAssignments.has(`${assignment.sectionId}|${assignment.subjectId}`)
    );

    const sectionTeacherMap = new Map<string, Map<string, { teacherId: string; periodsPerWeek: number }>>();
    for (const section of sections) {
      sectionTeacherMap.set(section.id, new Map());
    }

    for (const a of assignments) {
      const map = sectionTeacherMap.get(a.sectionId);
      if (!map) continue;
      const overridePeriods = referencePeriodsBySection.get(a.sectionId)?.get(a.subjectId);
      map.set(a.subjectId, {
        teacherId: a.teacherId,
        periodsPerWeek: overridePeriods ?? a.periodsPerWeek,
      });
    }

    // Determine effective periodsPerWeek for each (section, subject)
    // For VI–X: use SUBJECT_PERIODS table. For XI–XII: use DB value.
    const getPeriodsPerWeek = (sectionId: string, subjectId: string): number =>
      sectionTeacherMap.get(sectionId)?.get(subjectId)?.periodsPerWeek ?? 0;

    for (const teacher of teachers) {
      const baseMax = Math.min(GLOBAL_MAX_PERIODS_PER_DAY, Math.ceil(teacher.targetWorkload / days.length) + 1);
      const projected = projectedTeacherLoad.get(teacher.id) ?? teacher.targetWorkload;
      const projectedMax = Math.min(GLOBAL_MAX_PERIODS_PER_DAY, Math.ceil(projected / days.length) + 2);
      teacherMaxPerDay.set(teacher.id, Math.max(baseMax, projectedMax));
    }

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
      labTeacherId?: string | null,
    ): boolean => {
      const key = `${dayId}-${timeSlotId}`;
      const slot = timeSlots.find(t => t.id === timeSlotId);

      // Hard: section already occupied
      if (sectionBusy.get(sectionId)?.has(key)) return false;
      // Hard: teacher personal unavailability
      if (teacherUnavailabilitySet.has(`${teacherId}|${key}`)) return false;

      const isShared = SHARED_SLOT_SUBJECTS.has(subjectName);
      const groupedLimit = getGroupedSectionLimit(subjectName);
      if (!isShared) {
        const teacherBusyAtSlot = teacherBusy.get(teacherId)?.has(key) ?? false;
        const groupedCount = groupedLimit !== null
          ? getGroupedSectionCount(teacherId, subjectId, sectionId, dayId, timeSlotId)
          : 0;
        const reusesGroupedSlot = groupedLimit !== null && groupedCount > 0;

        // Hard: teacher already teaching another section at this slot unless this is
        // the same grouped subject/grade and the group cap is not reached.
        if (teacherBusyAtSlot && !reusesGroupedSlot) return false;
        if (reusesGroupedSlot && groupedCount >= groupedLimit) return false;
      }

      if (requiresDedicatedLabRoom(sectionId, subjectId)) {
        const resolvedLabTeacherId = resolveLabTeacherForSlot(
          sectionId,
          subjectId,
          teacherId,
          dayId,
          timeSlotId,
          relaxed,
          labTeacherId
        );
        if (resolvedLabTeacherId === null) return false;
      }

      // Yoga/Aerobics not for XI/XII
      if ((subjectName === 'Yoga' || subjectName === 'Aerobics') &&
          NO_YOGA_GRADES.has(sectionGradeMap.get(sectionId) ?? '')) return false;

      // W.E. only for VI–X
      if (WE_SUBJECTS.has(subjectName)) {
        const grade = sectionGradeMap.get(sectionId) ?? '';
        if (grade === 'XI' || grade === 'XII') return false;
      }

      // Games slot cap
      if (subjectName === 'Games') {
        if (!slot || slot.periodNumber <= 2) return false;
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

        // Lab room requirement — only enforced for subjects that truly use dedicated labs for this grade.
        if (requiresDedicatedLabRoom(sectionId, subjectId)) {
          const labCandidates = getAllowedLabRooms(subjectId, sectionId);
          if (labCandidates.length > 0) {
            const room = findAvailableLabRoom(subjectId, sectionId, dayId, timeSlotId);
            if (!room) return false;
          }
        }

        // R10: teacher daily load cap
        if (!isShared && !(groupedLimit !== null && getGroupedSectionCount(teacherId, subjectId, sectionId, dayId, timeSlotId) > 0)) {
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
          const scoreSlotPriority = (slot: typeof timeSlots[number]) => {
            const subjectPriority = isActivity
              ? slot.periodNumber
              : (lastPeriodNumber - slot.periodNumber + 1);
            return subjectPriority + getTeacherPeriodPriority(teacherId, slot.periodNumber);
          };
          const scoreDiff = scoreSlotPriority(b) - scoreSlotPriority(a);
          if (scoreDiff !== 0) return scoreDiff;
          if (isActivity) {
            return b.periodNumber - a.periodNumber;
          }
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

    const getLanguageGroupKey = (
      option: LanguageBlockOption,
      grade: string,
      dayId: string,
      timeSlotId: string,
    ) => `${option.teacherId}|${option.subjectId}|${grade}|${dayId}|${timeSlotId}`;

    const canPlaceLanguageOption = (
      block: LanguageBlockSpec,
      option: LanguageBlockOption,
      dayId: string,
      timeSlotId: string,
    ) => {
      const key = `${dayId}-${timeSlotId}`;
      const slot = timeSlots.find((item) => item.id === timeSlotId);
      if (teacherUnavailabilitySet.has(`${option.teacherId}|${key}`)) return false;

      const teacherBusyAtSlot = teacherBusy.get(option.teacherId)?.has(key) ?? false;
      const groupedKey = getLanguageGroupKey(option, block.grade, dayId, timeSlotId);
      const groupedCount = languageGroupedSlotCount.get(groupedKey) ?? 0;
      const reusesGroupedSlot = option.sharing === 'grouped' && groupedCount > 0;
      const reusesSharedSlot = option.sharing === 'shared' && teacherBusyAtSlot;

      if (option.sharing === 'single' && teacherBusyAtSlot) return false;
      if (option.sharing === 'grouped') {
        if (teacherBusyAtSlot && !reusesGroupedSlot) return false;
        if (reusesGroupedSlot && groupedCount >= (option.groupLimit ?? 1)) return false;
      }

      if (!reusesGroupedSlot && !reusesSharedSlot) {
        const maxToday = teacherMaxPerDay.get(option.teacherId) ?? GLOBAL_MAX_PERIODS_PER_DAY;
        if ((teacherDailyLoad.get(option.teacherId)?.get(dayId) ?? 0) >= maxToday) return false;
        if (slot && hasRunOfFour(option.teacherId, dayId, slot.periodNumber)) return false;
      }

      return true;
    };

    const canPlaceLanguageBlock = (
      block: LanguageBlockSpec,
      dayId: string,
      timeSlotId: string,
    ) => {
      const key = `${dayId}-${timeSlotId}`;
      if (sectionBusy.get(block.sectionId)?.has(key)) return false;
      return block.options.every((option) => canPlaceLanguageOption(block, option, dayId, timeSlotId));
    };

    const applyLanguageOptionState = (
      block: LanguageBlockSpec,
      option: LanguageBlockOption,
      dayId: string,
      timeSlotId: string,
    ) => {
      const key = `${dayId}-${timeSlotId}`;
      const slot = timeSlots.find((item) => item.id === timeSlotId);
      const teacherBusyAtSlot = teacherBusy.get(option.teacherId)?.has(key) ?? false;
      const groupedKey = getLanguageGroupKey(option, block.grade, dayId, timeSlotId);
      const groupedCount = languageGroupedSlotCount.get(groupedKey) ?? 0;
      const reusesGroupedSlot = option.sharing === 'grouped' && groupedCount > 0;
      const skipLoadIncrement = option.sharing === 'shared'
        ? teacherBusyAtSlot
        : reusesGroupedSlot;

      if (option.sharing === 'grouped') {
        languageGroupedSlotCount.set(groupedKey, groupedCount + 1);
      }

      teacherBusy.get(option.teacherId)?.add(key);

      if (!skipLoadIncrement) {
        teacherLoad.set(option.teacherId, (teacherLoad.get(option.teacherId) ?? 0) + 1);
        const dm = teacherDailyLoad.get(option.teacherId);
        if (dm) dm.set(dayId, (dm.get(dayId) ?? 0) + 1);
        if (slot) {
          const pdKey = `${option.teacherId}|${dayId}`;
          if (!teacherPeriodsByDay.has(pdKey)) teacherPeriodsByDay.set(pdKey, new Set());
          teacherPeriodsByDay.get(pdKey)!.add(slot.periodNumber);
        }
      }
    };

    const assignLanguageBlock = (
      block: LanguageBlockSpec,
      dayId: string,
      timeSlotId: string,
    ) => {
      if (!canPlaceLanguageBlock(block, dayId, timeSlotId)) return false;

      const key = `${dayId}-${timeSlotId}`;
      const slot = timeSlots.find((item) => item.id === timeSlotId);
      const sdKey = `${block.sectionId}|${dayId}`;
      sectionBusy.get(block.sectionId)?.add(key);
      sectionDaySubjects.get(sdKey)?.add(block.representativeSubjectId);
      const sdm = sectionDailyLoad.get(block.sectionId);
      if (sdm) sdm.set(dayId, (sdm.get(dayId) ?? 0) + 1);
      if (slot) {
        if (!sectionDayPeriodSubject.has(sdKey)) sectionDayPeriodSubject.set(sdKey, new Map());
        sectionDayPeriodSubject.get(sdKey)!.set(slot.periodNumber, block.representativeSubjectId);
      }

      for (const option of block.options) {
        applyLanguageOptionState(block, option, dayId, timeSlotId);
      }

      const storageOrder = [...block.options].sort((a, b) => {
        const modeRank = (mode: CombinedSlotSharingMode) =>
          mode === 'single' ? 0 : mode === 'grouped' ? 1 : 2;
        const modeDiff = modeRank(a.sharing) - modeRank(b.sharing);
        if (modeDiff !== 0) return modeDiff;
        return block.options.findIndex((option) => option.subjectId === a.subjectId) -
          block.options.findIndex((option) => option.subjectId === b.subjectId);
      });
      const storedTeacherIds = Array.from(new Set(storageOrder.map((option) => option.teacherId)));
      const metadata: CombinedSlotMetadata = {
        kind: 'language-block',
        bucket: block.bucket,
        grade: block.grade,
        displayName: block.displayName,
        displayCode: block.displayCode,
        options: block.options,
      };

      createdSlots.push({
        sectionId: block.sectionId,
        dayId,
        timeSlotId,
        subjectId: block.representativeSubjectId,
        teacherId: storedTeacherIds[0] ?? block.options[0].teacherId,
        labTeacherId: storedTeacherIds[1] ?? null,
        roomId: null,
        notes: encodeCombinedSlotMetadata(metadata),
        isLab: false,
        isGames: false,
        isYoga: false,
        isLibrary: false,
        isInnovation: false,
        isWE: false,
        isMusic: false,
        isArt: false,
        isFiller: false,
      });
      sectionSlotIndex.set(`${block.sectionId}|${dayId}|${timeSlotId}`, createdSlots.length - 1);
      return true;
    };

    const scheduleLanguageBlocks = () => {
      if (languageBlocks.length === 0) return;

      const groups = new Map<string, LanguageBlockSpec[]>();
      for (const block of languageBlocks) {
        const groupKey = `${block.grade}|${block.bucket}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey)!.push(block);
      }

      const orderedGroups = [...groups.values()].sort((a, b) => {
        const periodDiff = (b[0]?.periodsPerWeek ?? 0) - (a[0]?.periodsPerWeek ?? 0);
        if (periodDiff !== 0) return periodDiff;
        if ((a[0]?.grade ?? '') !== (b[0]?.grade ?? '')) {
          return (a[0]?.grade ?? '').localeCompare(b[0]?.grade ?? '');
        }
        return (a[0]?.bucket ?? '').localeCompare(b[0]?.bucket ?? '');
      });

      for (const group of orderedGroups) {
        const exemplar = group[0];
        if (!exemplar) continue;

        const requiredDays = exemplar.periodsPerWeek;
        const periodCandidates = LANGUAGE_PERIOD_PRIORITY
          .map((periodNumber) => timeSlots.find((slot) => slot.periodNumber === periodNumber))
          .filter((slot): slot is typeof timeSlots[number] => Boolean(slot));

        let chosenTimeSlotId: string | null = null;
        let chosenDayIds: string[] = [];

        for (const periodSlot of periodCandidates) {
          const viableDays = days
            .filter((day) => group.every((block) => canPlaceLanguageBlock(block, day.id, periodSlot.id)))
            .sort((a, b) => {
              const aLoad = group.reduce((sum, block) => sum + (sectionDailyLoad.get(block.sectionId)?.get(a.id) ?? 0), 0);
              const bLoad = group.reduce((sum, block) => sum + (sectionDailyLoad.get(block.sectionId)?.get(b.id) ?? 0), 0);
              if (aLoad !== bLoad) return aLoad - bLoad;
              return a.dayOrder - b.dayOrder;
            });

          if (viableDays.length >= requiredDays) {
            chosenTimeSlotId = periodSlot.id;
            chosenDayIds = viableDays.slice(0, requiredDays).map((day) => day.id);
            break;
          }

          if (!chosenTimeSlotId && viableDays.length > chosenDayIds.length) {
            chosenTimeSlotId = periodSlot.id;
            chosenDayIds = viableDays.map((day) => day.id);
          }
        }

        if (!chosenTimeSlotId) {
          warnings.push(
            `[language-block-fail] ${exemplar.grade} ${exemplar.bucket}: no common fixed period found`
          );
          continue;
        }

        for (const dayId of chosenDayIds) {
          for (const block of group) {
            if (!assignLanguageBlock(block, dayId, chosenTimeSlotId)) {
              warnings.push(
                `[language-block-slot] ${block.sectionName} ${block.bucket}: failed fixed-period placement`
              );
            }
          }
        }

        const periodNumber = timeSlots.find((slot) => slot.id === chosenTimeSlotId)?.periodNumber ?? '?';
        allocationNotes.push(
          `[language-block] ${exemplar.grade} ${exemplar.bucket} anchored to P${periodNumber} for ${chosenDayIds.length}/${requiredDays} day(s)`
        );
        if (chosenDayIds.length < requiredDays) {
          warnings.push(
            `[language-block-partial] ${exemplar.grade} ${exemplar.bucket}: placed ${chosenDayIds.length}/${requiredDays} fixed-period slot(s)`
          );
        }
      }
    };

    scheduleLanguageBlocks();

    const pickRelaxedSlot = (
      sectionId: string,
      subjectId: string,
      teacherId: string,
      subjectName: string,
    ): { dayId: string; slotId: string } | null => {
      const candidateDays = [...days].sort((a, b) => {
        const aLoad = sectionDailyLoad.get(sectionId)?.get(a.id) ?? 0;
        const bLoad = sectionDailyLoad.get(sectionId)?.get(b.id) ?? 0;
        return aLoad - bLoad;
      });
      const sectionObj = sections.find(s => s.id === sectionId);
      const subjectObj = subjects.find(s => s.id === subjectId);
      const teacherObj = teachers.find(t => t.id === teacherId);
      if (!sectionObj || !subjectObj || !teacherObj) return null;

      let bestScore = Number.NEGATIVE_INFINITY;
      let bestPick: { dayId: string; slotId: string; dayOrder: number } | null = null;

      for (const day of candidateDays) {
        for (const ts of timeSlots) {
          if (!canPlace(teacherId, sectionId, day.id, ts.id, subjectId, subjectName, true)) continue;
          if (requiresDedicatedLabRoom(sectionId, subjectId)) {
            const labCandidates = getAllowedLabRooms(subjectId, sectionId);
            if (labCandidates.length > 0 && !findAvailableLabRoom(subjectId, sectionId, day.id, ts.id)) {
              continue;
            }
          }
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
              teacherPeriodPriorityByPeriod,
              morningPreferenceByPeriod,
              endPreferenceByPeriod,
              scoringWeights,
              getAllowedLabRooms,
            },
          });
          if (
            score > bestScore ||
            (score === bestScore && (!bestPick || day.dayOrder < bestPick.dayOrder))
          ) {
            bestScore = score;
            bestPick = { dayId: day.id, slotId: ts.id, dayOrder: day.dayOrder };
          }
        }
      }

      return bestPick ? { dayId: bestPick.dayId, slotId: bestPick.slotId } : null;
    };

    const pickGroupedSectionSlot = (
      sectionId: string,
      subjectId: string,
      teacherId: string,
      subjectName: string,
    ): { dayId: string; slotId: string } | null => {
      const groupedLimit = getGroupedSectionLimit(subjectName);
      if (groupedLimit === null) return null;

      const poolKey = getGroupedSectionPoolKey(teacherId, subjectId, sectionId);
      const existingSlots = groupedSectionSlotsByTeacherSubjectGrade.get(poolKey);
      if (!existingSlots || existingSlots.size === 0) return null;

      const ranked = [...existingSlots]
        .map((slotKey) => {
          const [dayId, timeSlotId] = slotKey.split('|');
          const count = getGroupedSectionCount(teacherId, subjectId, sectionId, dayId, timeSlotId);
          const dayOrder = days.find(d => d.id === dayId)?.dayOrder ?? Number.POSITIVE_INFINITY;
          const period = timeSlots.find(ts => ts.id === timeSlotId)?.periodNumber ?? Number.POSITIVE_INFINITY;
          return { dayId, slotId: timeSlotId, count, dayOrder, period };
        })
        .filter((item) => item.count > 0 && item.count < groupedLimit)
        .sort((a, b) => b.count - a.count || a.dayOrder - b.dayOrder || a.period - b.period);

      for (const candidate of ranked) {
        if (canPlace(teacherId, sectionId, candidate.dayId, candidate.slotId, subjectId, subjectName)) {
          return { dayId: candidate.dayId, slotId: candidate.slotId };
        }
      }
      return null;
    };

    // ── STEP C: Place constrained subjects first ─────────────────────────────
    // Priority order: locked double labs → locked double W.E. → other labs → Games → W.E. → Yoga → Library → Innovation
    if (process.env.NODE_ENV === 'development') { console.log('Step C: Placing constrained subjects...'); }

    const constrainedOrder = [
      // 1. Science labs from class IX onward: required consecutive double blocks
      ...assignments.filter(a => requiresLockedDoubleBlock(a.sectionId, a.subjectId) && a.subject.isDoublePeriod),
      // 2. W.E. till class IX: required consecutive double blocks
      ...assignments.filter(a => requiresLockedDoubleBlock(a.sectionId, a.subjectId) && WE_SUBJECTS.has(a.subject.name)),
      // 3. Other dedicated lab-room subjects
      ...assignments.filter(a => requiresDedicatedLabRoom(a.sectionId, a.subjectId) && !requiresLockedDoubleBlock(a.sectionId, a.subjectId)),
      // 4. Games
      ...assignments.filter(a => a.subject.name === 'Games'),
      // 5. Remaining W.E. subjects
      ...assignments.filter(a => WE_SUBJECTS.has(a.subject.name) && !requiresLockedDoubleBlock(a.sectionId, a.subjectId)),
      // 6. Yoga / Aerobics
      ...assignments.filter(a => a.subject.name === 'Yoga' || a.subject.name === 'Aerobics'),
      // 7. Library
      ...assignments.filter(a => a.subject.name === 'Library'),
      // 8. Innovation
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

      const needsLockedDoubleBlock = requiresLockedDoubleBlock(sectionId, subjectId);

      // Mandatory double-block subjects must secure consecutive pairs first.
      if (needsLockedDoubleBlock) {
        while (remaining >= 2) {
          const pairResult = findLabConsecutivePair(teacherId, sectionId, subjectId);
          if (!pairResult) break;
          const labCandidates = requiresDedicatedLabRoom(sectionId, subjectId)
            ? getAllowedLabRooms(subjectId, sectionId)
            : [];
          const room = labCandidates.length > 0
            ? findAvailableLabRoom(subjectId, sectionId, pairResult.dayId, pairResult.pair[0].id)
            : null;
          if (labCandidates.length > 0 && !room) break;
          const ok1 = assign(
            sectionId,
            pairResult.dayId,
            pairResult.pair[0].id,
            subjectId,
            teacherId,
            { isLab: requiresDedicatedLabRoom(sectionId, subjectId) },
            room?.id
          );
          const ok2 = assign(
            sectionId,
            pairResult.dayId,
            pairResult.pair[1].id,
            subjectId,
            teacherId,
            { isLab: requiresDedicatedLabRoom(sectionId, subjectId) },
            room?.id
          );
          if (!ok1 || !ok2) break;
          remaining -= 2;
          placedTracker.set(trackerKey, ppw - remaining);
          if (HEAVY_SUBJECTS.has(subject.name)) {
            const hdKey = `${sectionId}|${pairResult.dayId}`;
            sectionDayHeavyCount.set(hdKey, (sectionDayHeavyCount.get(hdKey) ?? 0) + 2);
          }
        }
        const missingDoublePeriods = remaining - (remaining % 2);
        if (missingDoublePeriods > 0) {
          warnings.push(
            `[double-block-required] ${section.name} ${subject.name}: ${missingDoublePeriods} period(s) still require consecutive pairing`
          );
        }
      }

      // Place remaining periods using spread logic
      let singlesRemaining = needsLockedDoubleBlock ? (remaining % 2) : remaining;
      while (singlesRemaining > 0) {
        const pick =
          pickSpreadDay(sectionId, subjectId, teacherId, subject.name) ??
          pickRelaxedSlot(sectionId, subjectId, teacherId, subject.name);
        if (!pick) break;
        if (assign(sectionId, pick.dayId, pick.slotId, subjectId, teacherId)) {
          singlesRemaining--;
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

    }

    // ── STEP D: Spread core subjects evenly ──────────────────────────────────
    // Core: Mathematics, English, Science, Social Studies, Languages, Economics, etc.
    if (process.env.NODE_ENV === 'development') { console.log('Step D: Spreading core subjects...'); }

    const coreAssignments = assignments.filter(a => {
      if (requiresLockedDoubleBlock(a.sectionId, a.subjectId)) return false;
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
        const pick =
          pickGroupedSectionSlot(sectionId, subjectId, teacherId, subject.name) ??
          pickSpreadDay(sectionId, subjectId, teacherId, subject.name);
        if (!pick) {
          const relaxedPick = pickRelaxedSlot(sectionId, subjectId, teacherId, subject.name);
          if (!relaxedPick) break;
          if (assign(sectionId, relaxedPick.dayId, relaxedPick.slotId, subjectId, teacherId)) {
            remaining--;
            if (HEAVY_SUBJECTS.has(subject.name)) {
              const hdKey = `${sectionId}|${relaxedPick.dayId}`;
              sectionDayHeavyCount.set(hdKey, (sectionDayHeavyCount.get(hdKey) ?? 0) + 1);
            }
          } else {
            break;
          }
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
          const aPlaced = placedTracker.get(`${a.sectionId}|${a.subjectId}`) ?? 0;
          const bPlaced = placedTracker.get(`${b.sectionId}|${b.subjectId}`) ?? 0;
          const aDeficit = Math.max(0, getPeriodsPerWeek(a.sectionId, a.subjectId) - aPlaced);
          const bDeficit = Math.max(0, getPeriodsPerWeek(b.sectionId, b.subjectId) - bPlaced);
          const aNeeds = aDeficit > 0 ? 0 : 1;
          const bNeeds = bDeficit > 0 ? 0 : 1;
          if (aNeeds !== bNeeds) return aNeeds - bNeeds;
          if (aDeficit !== bDeficit) return bDeficit - aDeficit;
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
        const trackerKey = `${sectionId}|${subjectId}`;
        placedTracker.set(
          trackerKey,
          Math.min(getPeriodsPerWeek(sectionId, subjectId), (placedTracker.get(trackerKey) ?? 0) + 1)
        );
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

    const buildPlacedCountMap = () => {
      const countMap = new Map<string, number>();
      const notePlaced = (sectionId: string, subjectId: string | null | undefined) => {
        if (!subjectId) return;
        const key = `${sectionId}|${subjectId}`;
        countMap.set(key, (countMap.get(key) ?? 0) + 1);
      };

      for (const slot of baselineSlots) {
        notePlaced(slot.sectionId, slot.subjectId);
      }
      for (const slot of createdSlots) {
        notePlaced(slot.sectionId, slot.subjectId);
      }
      return countMap;
    };

    const getRepairTeacherOptions = (asgn: TeacherAssignment): CandidateTeacher[] => {
      const subjectObj = subjects.find(s => s.id === asgn.subjectId);
      if (!subjectObj) return [];
      const grade = sectionGradeMap.get(asgn.sectionId) ?? '';
      return getCandidatePool(subjectObj, grade)
        .filter(candidate => candidate.teacher.id !== asgn.teacherId)
        .sort((a, b) => {
          if (a.relaxed !== b.relaxed) return Number(a.relaxed) - Number(b.relaxed);
          const aRatio = (teacherLoad.get(a.teacher.id) ?? 0) / Math.max(1, a.teacher.targetWorkload);
          const bRatio = (teacherLoad.get(b.teacher.id) ?? 0) / Math.max(1, b.teacher.targetWorkload);
          if (aRatio !== bRatio) return aRatio - bRatio;
          return a.teacher.abbreviation.localeCompare(b.teacher.abbreviation);
        });
    };

    const tryRepairAssignmentWithTeacher = (
      asgn: TeacherAssignment,
      donorIndex: number,
      candidate: CandidateTeacher | null
    ): boolean => {
      const candidateTeacherId = candidate?.teacher.id ?? asgn.teacherId;
      const candidateTeacher = candidate?.teacher ?? teachersById.get(asgn.teacherId);
      if (!candidateTeacher) return false;

      const baselineConflict = baselineSlots.some(slot =>
        slot.sectionId === asgn.sectionId &&
        slot.subjectId === asgn.subjectId &&
        slot.teacherId &&
        slot.teacherId !== candidateTeacherId
      );
      if (baselineConflict) return false;

      const donorSlot = createdSlots[donorIndex];
      if (!donorSlot) return false;

      const affectedIndices = createdSlots
        .map((slot, index) => (slot.sectionId === asgn.sectionId && slot.subjectId === asgn.subjectId ? index : -1))
        .filter((index): index is number => index >= 0);
      const affectedSlots = affectedIndices
        .map(index => ({ ...createdSlots[index] }))
        .sort((a, b) => {
          const dayA = days.find(d => d.id === a.dayId)?.dayOrder ?? Number.POSITIVE_INFINITY;
          const dayB = days.find(d => d.id === b.dayId)?.dayOrder ?? Number.POSITIVE_INFINITY;
          if (dayA !== dayB) return dayA - dayB;
          const periodA = timeSlots.find(ts => ts.id === a.timeSlotId)?.periodNumber ?? Number.POSITIVE_INFINITY;
          const periodB = timeSlots.find(ts => ts.id === b.timeSlotId)?.periodNumber ?? Number.POSITIVE_INFINITY;
          return periodA - periodB;
        });

      const createdSlotsSnapshot = createdSlots.map(slot => ({ ...slot }));
      const previousTeacherId = asgn.teacherId;
      const previousTeacher = { ...asgn.teacher };
      const sectionTeacherEntry = sectionTeacherMap.get(asgn.sectionId)?.get(asgn.subjectId);
      const previousSectionTeacherId = sectionTeacherEntry?.teacherId ?? previousTeacherId;

      const removedIndices = [...affectedIndices, donorIndex].sort((a, b) => b - a);
      for (const index of removedIndices) {
        createdSlots.splice(index, 1);
      }

      asgn.teacherId = candidateTeacherId;
      asgn.teacher = {
        id: candidateTeacher.id,
        abbreviation: candidateTeacher.abbreviation,
        targetWorkload: candidateTeacher.targetWorkload,
        department: candidateTeacher.department,
        name: candidateTeacher.name,
        teachableGrades: candidateTeacher.teachableGrades,
      };
      if (sectionTeacherEntry) {
        sectionTeacherEntry.teacherId = candidateTeacherId;
      }

      rebuildPlacementState();

      for (const slot of affectedSlots) {
        if (
          !canPlace(
            candidateTeacherId,
            slot.sectionId,
            slot.dayId,
            slot.timeSlotId,
            slot.subjectId,
            asgn.subject.name
          ) ||
          !assign(
            slot.sectionId,
            slot.dayId,
            slot.timeSlotId,
            slot.subjectId,
            candidateTeacherId,
            {
              isLab: slot.isLab,
              isGames: slot.isGames,
              isYoga: slot.isYoga,
              isLibrary: slot.isLibrary,
              isInnovation: slot.isInnovation,
              isWE: slot.isWE,
              isMusic: slot.isMusic,
              isArt: slot.isArt,
              isFiller: slot.isFiller,
              labTeacherId: slot.labTeacherId ?? null,
            },
            slot.roomId
          )
        ) {
          createdSlots.length = 0;
          createdSlots.push(...createdSlotsSnapshot.map(slot => ({ ...slot })));
          asgn.teacherId = previousTeacherId;
          asgn.teacher = previousTeacher;
          if (sectionTeacherEntry) {
            sectionTeacherEntry.teacherId = previousSectionTeacherId;
          }
          rebuildPlacementState();
          return false;
        }
      }

      if (
        !canPlace(
          candidateTeacherId,
          asgn.sectionId,
          donorSlot.dayId,
          donorSlot.timeSlotId,
          asgn.subjectId,
          asgn.subject.name
        ) ||
        !assign(
          asgn.sectionId,
          donorSlot.dayId,
          donorSlot.timeSlotId,
          asgn.subjectId,
          candidateTeacherId
        )
      ) {
        createdSlots.length = 0;
        createdSlots.push(...createdSlotsSnapshot.map(slot => ({ ...slot })));
        asgn.teacherId = previousTeacherId;
        asgn.teacher = previousTeacher;
        if (sectionTeacherEntry) {
          sectionTeacherEntry.teacherId = previousSectionTeacherId;
        }
        rebuildPlacementState();
        return false;
      }

      if (candidateTeacherId !== previousTeacherId) {
        allocationNotes.push(
          `[repair-reassign] ${asgn.section.name} ${asgn.subject.name} -> ${candidateTeacher.abbreviation} (was ${previousTeacher.abbreviation})`
        );
      }
      allocationNotes.push(
        `[repair-slot] ${asgn.section.name} ${asgn.subject.name} -> ${candidateTeacher.abbreviation} replaced ${subjects.find(s => s.id === donorSlot.subjectId)?.name ?? 'unknown'}`
      );
      rebuildPlacementState();
      return true;
    };

    const tryRepairUnassignedSlots = () => {
      let repaired = 0;

      while (true) {
        const placedCountMap = buildPlacedCountMap();
        const targets = assignments
          .map((asgn) => {
            const ppw = getPeriodsPerWeek(asgn.sectionId, asgn.subjectId);
            const placed = Math.min(ppw, placedCountMap.get(`${asgn.sectionId}|${asgn.subjectId}`) ?? 0);
            return { asgn, ppw, remaining: ppw - placed };
          })
          .filter(item => item.ppw > 0 && item.remaining > 0)
          .sort((a, b) => {
            const aRatio = a.remaining / a.ppw;
            const bRatio = b.remaining / b.ppw;
            if (aRatio !== bRatio) return bRatio - aRatio;
            if (a.remaining !== b.remaining) return b.remaining - a.remaining;
            if (a.asgn.subject.name !== b.asgn.subject.name) {
              return a.asgn.subject.name.localeCompare(b.asgn.subject.name);
            }
            return a.asgn.section.name.localeCompare(b.asgn.section.name);
          });

        if (targets.length === 0) break;

        let changed = false;

        for (const target of targets) {
          const donorCandidates = createdSlots
            .map((slot, index) => {
              if (slot.sectionId !== target.asgn.sectionId) return null;
              if (slot.subjectId === target.asgn.subjectId) return null;

              const donorSubject = subjects.find(s => s.id === slot.subjectId);
              if (!donorSubject) return null;

              const donorRequired = getPeriodsPerWeek(slot.sectionId, slot.subjectId);
              const donorPlaced = placedCountMap.get(`${slot.sectionId}|${slot.subjectId}`) ?? 0;
              const donorSurplus = Math.max(0, donorPlaced - donorRequired);
              const replaceable = donorSubject.name === 'Study Period' ||
                slot.isFiller ||
                (donorSurplus > 0 &&
                  !requiresDedicatedLabRoom(slot.sectionId, slot.subjectId) &&
                  !requiresLockedDoubleBlock(slot.sectionId, slot.subjectId) &&
                  donorSubject.name !== 'Games' &&
                  !SHARED_SLOT_SUBJECTS.has(donorSubject.name) &&
                  getGroupedSectionLimit(donorSubject.name) === null);
              if (!replaceable) return null;

              return {
                index,
                slot,
                donorSubject,
                donorSurplus,
                priority:
                  donorSubject.name === 'Study Period' ? 0 :
                  slot.isFiller ? 1 :
                  slot.teacherId === target.asgn.teacherId ? 2 : 3,
                period: timeSlots.find(ts => ts.id === slot.timeSlotId)?.periodNumber ?? Number.POSITIVE_INFINITY,
                dayOrder: days.find(d => d.id === slot.dayId)?.dayOrder ?? Number.POSITIVE_INFINITY,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
            .sort((a, b) => {
              if (a.priority !== b.priority) return a.priority - b.priority;
              if (a.donorSurplus !== b.donorSurplus) return b.donorSurplus - a.donorSurplus;
              if (a.dayOrder !== b.dayOrder) return a.dayOrder - b.dayOrder;
              return a.period - b.period;
            });

          for (const donor of donorCandidates) {
            rebuildPlacementState(donor.index);
            const canRepairWithCurrentTeacher = canPlace(
              target.asgn.teacherId,
              target.asgn.sectionId,
              donor.slot.dayId,
              donor.slot.timeSlotId,
              target.asgn.subjectId,
              target.asgn.subject.name
            );
            rebuildPlacementState();

            if (canRepairWithCurrentTeacher) {
              const removed = createdSlots.splice(donor.index, 1)[0];
              rebuildPlacementState();

              if (assign(
                target.asgn.sectionId,
                removed.dayId,
                removed.timeSlotId,
                target.asgn.subjectId,
                target.asgn.teacherId
              )) {
                rebuildPlacementState();
                allocationNotes.push(
                  `[repair-slot] ${target.asgn.section.name} ${target.asgn.subject.name} -> ${target.asgn.teacher.abbreviation} replaced ${donor.donorSubject.name}`
                );
                repaired++;
                changed = true;
                break;
              }

              createdSlots.splice(donor.index, 0, removed);
              rebuildPlacementState();
            }

            for (const candidate of getRepairTeacherOptions(target.asgn)) {
              if (tryRepairAssignmentWithTeacher(target.asgn, donor.index, candidate)) {
                repaired++;
                changed = true;
                break;
              }
            }

            if (changed) break;
          }

          if (changed) break;
        }

        if (!changed) break;
      }

      rebuildPlacementState();
      return repaired;
    };

    const repairedSlots = tryRepairUnassignedSlots();
    if (repairedSlots > 0) {
      warnings.push(`[slot-repair] recovered=${repairedSlots}`);
    }

    const finalPlacedCountMap = buildPlacedCountMap();
    const finalUnassigned = assignments.flatMap((asgn) => {
      const ppw = getPeriodsPerWeek(asgn.sectionId, asgn.subjectId);
      if (ppw <= 0) return [];
      const placed = Math.min(ppw, finalPlacedCountMap.get(`${asgn.sectionId}|${asgn.subjectId}`) ?? 0);
      const remaining = ppw - placed;
      if (remaining <= 0) return [];
      return [`${asgn.teacher.abbreviation} → ${asgn.subject.name} for ${asgn.section.name}: ${remaining}/${ppw} unplaced (final)`];
    });
    unassigned.push(...finalUnassigned);

    const uniqueMap = new Map<string, SlotRecord>();
    for (const slot of createdSlots) {
      const k = `${slot.sectionId}|${slot.dayId}|${slot.timeSlotId}`;
      if (!uniqueMap.has(k)) uniqueMap.set(k, slot);
    }
    const toInsert = Array.from(uniqueMap.values());
    if (process.env.NODE_ENV === 'development') { console.log(`Unique slots to insert: ${toInsert.length}`); }

    if (!preview) {
      const result = await db.$transaction(async (tx) => {
        if (clearExisting) {
          if (preserveLocked) {
            await tx.timetableSlot.deleteMany({ where: { manuallyEdited: false } });
          } else {
            await tx.timetableSlot.deleteMany();
          }
        }

        if (toInsert.length === 0) return { count: 0 };
        return tx.timetableSlot.createMany({ data: toInsert });
      });
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
    const buildTeacherWorkloadMap = (
      slotRows: Array<{ teacherId?: string | null; labTeacherId?: string | null; notes?: string | null; dayId: string; timeSlotId: string }>
    ) => {
      const teacherSlotKeys = new Map<string, Set<string>>();
      for (const row of slotRows) {
        const key = `${row.dayId}|${row.timeSlotId}`;
        for (const teacherId of getAllSlotTeacherIds(row)) {
          if (!teacherId) continue;
          if (!teacherSlotKeys.has(teacherId)) teacherSlotKeys.set(teacherId, new Set());
          teacherSlotKeys.get(teacherId)!.add(key);
        }
      }
      return new Map(
        teachers.map((teacher) => [teacher.id, teacherSlotKeys.get(teacher.id)?.size ?? 0])
      );
    };
    const countMap = preview
      ? new Map(teachers.map(t => [t.id, teacherLoad.get(t.id) ?? 0]))
      : buildTeacherWorkloadMap(
          await db.timetableSlot.findMany({
            select: { teacherId: true, labTeacherId: true, notes: true, dayId: true, timeSlotId: true },
          })
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
      if (!s.subjectId || (!s.teacherId && !(s as any).labTeacherId)) continue;
      const key = `${s.sectionId}|${s.dayId}|${s.timeSlotId}`;
      previewCombinedMap.set(key, {
        sectionId: s.sectionId,
        dayId: s.dayId,
        timeSlotId: s.timeSlotId,
        subjectId: s.subjectId,
        teacherId: s.teacherId ?? ((s as any).labTeacherId as string),
        labTeacherId: (s as any).labTeacherId ?? null,
        roomId: (s as any).roomId ?? null,
        notes: (s as any).notes ?? null,
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
      allocationNotes: allocationNotes.length > 0 ? allocationNotes : undefined,
      labRepair: labRepair ?? undefined,
      preview,
      previewSlots: preview
        ? previewSlots.map((s) => ({
            sectionId: s.sectionId,
            dayId: s.dayId,
            timeSlotId: s.timeSlotId,
            subjectId: s.subjectId,
            teacherId: s.teacherId,
            labTeacherId: s.labTeacherId ?? null,
            roomId: s.roomId ?? null,
            notes: s.notes ?? null,
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
  bypass?: boolean,
  labTeacherId?: string | null
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
  teacherPeriodPriorityByPeriod: Map<string, Map<number, number>>;
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

  // 2b) Duty-aware teacher period preference (keep edge periods freer for teachers with extra roles)
  score += state.teacherPeriodPriorityByPeriod.get(teacher.id)?.get(period) ?? 0;

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

  const labCandidates = subject.requiresLab
    ? state.getAllowedLabRooms(subject.id, section.id)
    : [];

  // 6) Dedicated lab subjects should avoid the last period.
  if (labCandidates.length > 0 && period === lastPeriod) {
    score -= w.labLastPeriodPenaltyWeight;
  }

  // 7) Class teacher bonus
  if (state.sectionClassTeacherMap.get(section.id) === teacher.id) {
    score += w.classTeacherBonusWeight;
  }

  // 8) Room availability richness (prefer slots with more room options)
  if (labCandidates.length > 0) {
    const free = labCandidates.filter(r => !state.roomBusy.has(`${r.id}|${dayId}-${timeSlotId}`)).length;
    if (labCandidates.length > 0) {
      score += (free / labCandidates.length) * w.roomAvailabilityWeight;
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
