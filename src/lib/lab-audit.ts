import { db } from '@/lib/db';

const LAB_SUBJECT_NAMES = new Set(['Physics', 'Chemistry', 'Biology', 'Computer Science', 'IP']);

type LabSlotRow = {
  id: string;
  sectionId: string;
  subjectId: string | null;
  dayId: string;
  timeSlotId: string;
  teacherId: string | null;
  sectionName: string;
  subjectName: string;
  dayName: string;
  periodNumber: number;
};

export type SplitLabSession = {
  key: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  dayId: string;
  dayName: string;
  slotIds: string[];
  periodNumbers: number[];
  unpairedPeriodNumbers: number[];
};

export type RepairChange = {
  slotId: string;
  sectionName: string;
  subjectName: string;
  dayName: string;
  fromPeriod: number;
  toPeriod: number;
  teacherId: string | null;
};

export async function fetchLabSlots(): Promise<LabSlotRow[]> {
  const rows = await db.timetableSlot.findMany({
    where: {
      OR: [
        { isLab: true },
        { subject: { name: { in: Array.from(LAB_SUBJECT_NAMES) } } },
      ],
      subjectId: { not: null },
    },
    include: {
      section: true,
      subject: true,
      day: true,
      timeSlot: true,
    },
    orderBy: [{ day: { dayOrder: 'asc' } }, { timeSlot: { periodNumber: 'asc' } }],
  });

  return rows
    .filter((r) => r.subject && LAB_SUBJECT_NAMES.has(r.subject.name))
    .map((r) => ({
      id: r.id,
      sectionId: r.sectionId,
      subjectId: r.subjectId,
      dayId: r.dayId,
      timeSlotId: r.timeSlotId,
      teacherId: r.teacherId,
      sectionName: r.section.name,
      subjectName: r.subject!.name,
      dayName: r.day.name,
      periodNumber: r.timeSlot.periodNumber,
    }));
}

function getUnpairedPeriods(periods: number[]): number[] {
  const sorted = [...periods].sort((a, b) => a - b);
  const unpaired: number[] = [];
  let i = 0;
  while (i < sorted.length) {
    const cur = sorted[i];
    const nxt = sorted[i + 1];
    if (nxt !== undefined && nxt === cur + 1) {
      i += 2;
      continue;
    }
    unpaired.push(cur);
    i += 1;
  }
  return unpaired;
}

export function detectSplitLabSessions(rows: LabSlotRow[]): SplitLabSession[] {
  const grouped = new Map<string, LabSlotRow[]>();
  for (const row of rows) {
    if (!row.subjectId) continue;
    const key = `${row.sectionId}|${row.subjectId}|${row.dayId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const splits: SplitLabSession[] = [];
  for (const [key, group] of grouped.entries()) {
    const periodNumbers = group.map((g) => g.periodNumber).sort((a, b) => a - b);
    const unpairedPeriodNumbers = getUnpairedPeriods(periodNumbers);
    if (unpairedPeriodNumbers.length === 0) continue;
    splits.push({
      key,
      sectionId: group[0].sectionId,
      sectionName: group[0].sectionName,
      subjectId: group[0].subjectId!,
      subjectName: group[0].subjectName,
      dayId: group[0].dayId,
      dayName: group[0].dayName,
      slotIds: group.map((g) => g.id),
      periodNumbers,
      unpairedPeriodNumbers,
    });
  }
  return splits;
}

export async function auditLabSplits(): Promise<SplitLabSession[]> {
  const rows = await fetchLabSlots();
  return detectSplitLabSessions(rows);
}

export async function repairLabSplits(): Promise<{
  repaired: number;
  attempted: number;
  remaining: number;
  changes: RepairChange[];
}> {
  const [timeSlots, allSlots] = await Promise.all([
    db.timeSlot.findMany({ orderBy: { periodNumber: 'asc' } }),
    db.timetableSlot.findMany({
      include: { subject: true, timeSlot: true },
    }),
  ]);

  const periodToSlotId = new Map<number, string>(timeSlots.map((t) => [t.periodNumber, t.id]));
  const slotIdToPeriod = new Map<string, number>(timeSlots.map((t) => [t.id, t.periodNumber]));

  const sectionBusy = new Map<string, string>(); // sectionId|dayId|timeSlotId -> slotId
  const teacherBusy = new Map<string, string>(); // teacherId|dayId|timeSlotId -> slotId
  for (const s of allSlots) {
    sectionBusy.set(`${s.sectionId}|${s.dayId}|${s.timeSlotId}`, s.id);
    if (s.teacherId) {
      teacherBusy.set(`${s.teacherId}|${s.dayId}|${s.timeSlotId}`, s.id);
    }
  }

  const rows = await fetchLabSlots();
  const splits = detectSplitLabSessions(rows);
  const changes: RepairChange[] = [];

  const tryMove = async (
    split: SplitLabSession,
    moveSlotId: string,
    teacherId: string | null,
    fromPeriod: number,
    toPeriod: number
  ): Promise<boolean> => {
    if (toPeriod <= 1) return false;
    const toTimeSlotId = periodToSlotId.get(toPeriod);
    if (!toTimeSlotId) return false;
    const sectionKey = `${split.sectionId}|${split.dayId}|${toTimeSlotId}`;
    const sectionOccupiedBy = sectionBusy.get(sectionKey);
    if (sectionOccupiedBy && sectionOccupiedBy !== moveSlotId) return false;

    if (teacherId) {
      const teacherKey = `${teacherId}|${split.dayId}|${toTimeSlotId}`;
      const teacherOccupiedBy = teacherBusy.get(teacherKey);
      if (teacherOccupiedBy && teacherOccupiedBy !== moveSlotId) return false;
    }

    await db.timetableSlot.update({
      where: { id: moveSlotId },
      data: { timeSlotId: toTimeSlotId },
    });

    const fromTimeSlotId = periodToSlotId.get(fromPeriod);
    if (fromTimeSlotId) sectionBusy.delete(`${split.sectionId}|${split.dayId}|${fromTimeSlotId}`);
    sectionBusy.set(sectionKey, moveSlotId);
    if (teacherId) {
      if (fromTimeSlotId) teacherBusy.delete(`${teacherId}|${split.dayId}|${fromTimeSlotId}`);
      teacherBusy.set(`${teacherId}|${split.dayId}|${toTimeSlotId}`, moveSlotId);
    }

    changes.push({
      slotId: moveSlotId,
      sectionName: split.sectionName,
      subjectName: split.subjectName,
      dayName: split.dayName,
      fromPeriod,
      toPeriod,
      teacherId,
    });
    return true;
  };

  for (const split of splits) {
    const groupRows = rows
      .filter(
        (r) =>
          r.sectionId === split.sectionId &&
          r.subjectId === split.subjectId &&
          r.dayId === split.dayId
      )
      .sort((a, b) => a.periodNumber - b.periodNumber);
    const periodSet = new Set(groupRows.map((r) => r.periodNumber));
    const unpairedSet = new Set(split.unpairedPeriodNumbers);

    for (const moveRow of groupRows) {
      if (!unpairedSet.has(moveRow.periodNumber)) continue;
      let moved = false;

      for (const anchor of groupRows) {
        if (anchor.id === moveRow.id) continue;
        for (const candidate of [anchor.periodNumber - 1, anchor.periodNumber + 1]) {
          if (candidate === moveRow.periodNumber) continue;
          if (periodSet.has(candidate)) continue;
          moved = await tryMove(
            split,
            moveRow.id,
            moveRow.teacherId,
            moveRow.periodNumber,
            candidate
          );
          if (moved) {
            periodSet.delete(moveRow.periodNumber);
            periodSet.add(candidate);
            moveRow.periodNumber = candidate;
            break;
          }
        }
        if (moved) break;
      }
    }
  }

  const remaining = await auditLabSplits();
  if (changes.length > 0) {
    console.warn(
      `[lab-repair] repaired=${changes.length} remaining=${remaining.length} :: ` +
      changes
        .map((c) => `${c.sectionName} ${c.subjectName} ${c.dayName} P${c.fromPeriod}->P${c.toPeriod}`)
        .join(' | ')
    );
  }

  return {
    repaired: changes.length,
    attempted: splits.length,
    remaining: remaining.length,
    changes,
  };
}
