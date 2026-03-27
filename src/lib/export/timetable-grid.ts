/**
 * Shared grid-building logic for timetable PDF and Excel exports.
 * Converts raw DB slots into a typed 2-D grid with lab-pair detection.
 */

import {
  getCombinedSlotDisplay,
  getSlotTeacherAbbreviations,
} from '@/lib/combined-slot';
import {
  getSectionDisplayTimeSlot,
  getSectionDisplayTimeSlots,
  getTeacherDisplayTimeSlots,
} from '@/lib/section-time-slots';

export interface DayInfo {
  id: string;
  name: string;
  dayOrder: number;
}

export interface PeriodInfo {
  id: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
}

export interface CellData {
  /** Subject code (e.g. "Phy", "Eng") */
  line1: string;
  /** Teacher abbreviation (class view) or section name (teacher view) */
  line2: string;
  /** Optional metadata line (for example room, actual time, or slot type) */
  line3?: string;
  isLab: boolean;
  isGames: boolean;
  isYoga: boolean;
  isLibrary: boolean;
  isInnovation: boolean;
  isWE: boolean;
  subjectId: string | null;
  /**
   * rowSpan = 2 -> this cell spans 2 rows (lab double period start)
   * rowSpan = 0 -> this cell is consumed by the row above (skip it)
   * undefined   -> normal single-period cell
   */
  rowSpan?: number;
}

export interface TimetableGrid {
  title: string;
  subtitle: string;
  days: DayInfo[];
  periods: PeriodInfo[];
  /** cells[periodIndex][dayIndex] */
  cells: (CellData | null)[][];
}

/** Colour hint for a cell -> used by both PDF and Excel renderers */
export function cellColor(cell: CellData): string {
  if (cell.isLab)        return '#DBEAFE'; // blue-100
  if (cell.isGames)      return '#DCFCE7'; // green-100
  if (cell.isYoga)       return '#F3E8FF'; // purple-100
  if (cell.isLibrary)    return '#FEF9C3'; // yellow-100
  if (cell.isInnovation) return '#FFEDD5'; // orange-100
  if (cell.isWE)         return '#FCE7F3'; // pink-100
  return '#FFFFFF';
}

/** Same palette in ARGB for exceljs */
export function cellColorArgb(cell: CellData): string {
  if (cell.isLab)        return 'FFDBEAFE';
  if (cell.isGames)      return 'FFDCFCE7';
  if (cell.isYoga)       return 'FFF3E8FF';
  if (cell.isLibrary)    return 'FFFEF9C3';
  if (cell.isInnovation) return 'FFFFEDD5';
  if (cell.isWE)         return 'FFFCE7F3';
  return 'FFFFFFFF';
}

// Slot shape returned by Prisma include
type RawSlot = any;

function teacherAbbreviationLabel(slot: RawSlot) {
  return getSlotTeacherAbbreviations(slot).join(' + ');
}

function subjectCodeLabel(slot: RawSlot): string {
  const combinedDisplay = getCombinedSlotDisplay(slot.notes);
  if (slot.isWE) return 'W.E.';
  return combinedDisplay?.code ?? slot.subject?.code ?? slot.subject?.name ?? '-';
}

function slotTypeLabel(slot: RawSlot): string | undefined {
  if (slot.isLab) return 'Lab';
  if (slot.isGames) return 'Games';
  if (slot.isYoga) return 'Yoga';
  if (slot.isLibrary) return 'Library';
  if (slot.isInnovation) return 'Innovation';
  if (slot.isWE) return 'W.E.';
  return undefined;
}

function formatTimeRange(startTime: string, endTime: string) {
  return `${startTime}-${endTime}`;
}

function makeCell(slot: RawSlot, line2: string, line3?: string): CellData {
  return {
    line1: subjectCodeLabel(slot),
    line2,
    line3,
    isLab: slot.isLab ?? false,
    isGames: slot.isGames ?? false,
    isYoga: slot.isYoga ?? false,
    isLibrary: slot.isLibrary ?? false,
    isInnovation: slot.isInnovation ?? false,
    isWE: slot.isWE ?? false,
    subjectId: slot.subjectId ?? null,
  };
}

function detectLabPairs(cells: (CellData | null)[][]): void {
  const nPeriods = cells.length;
  const nDays = cells[0]?.length ?? 0;
  for (let d = 0; d < nDays; d++) {
    for (let p = 0; p < nPeriods - 1; p++) {
      const c1 = cells[p][d];
      const c2 = cells[p + 1][d];
      if (
        c1?.isLab && c2?.isLab &&
        c1.subjectId && c1.subjectId === c2.subjectId &&
        c1.rowSpan === undefined && c2.rowSpan === undefined
      ) {
        c1.rowSpan = 2;
        c2.rowSpan = 0; // consumed by row above
      }
    }
  }
}

export function buildClassGrid(
  sectionName: string,
  slots: RawSlot[],
  days: DayInfo[],
  periods: PeriodInfo[],
  classTeacherName?: string | null,
): TimetableGrid {
  const sortedDays = [...days].sort((a, b) => a.dayOrder - b.dayOrder);
  const sortedPeriods = getSectionDisplayTimeSlots(
    sectionName,
    [...periods].sort((a, b) => a.periodNumber - b.periodNumber)
  );

  const slotMap = new Map<string, RawSlot>();
  for (const s of slots) {
    slotMap.set(`${s.dayId}|${s.timeSlot.periodNumber}`, s);
  }

  const cells: (CellData | null)[][] = sortedPeriods.map(period =>
    sortedDays.map(day => {
      const s = slotMap.get(`${day.id}|${period.periodNumber}`);
      const metaParts = [s?.room?.name, slotTypeLabel(s)].filter(Boolean);
      return s ? makeCell(s, teacherAbbreviationLabel(s), metaParts.join(' | ') || undefined) : null;
    })
  );

  detectLabPairs(cells);

  return {
    title: classTeacherName
      ? `Class Timetable - ${sectionName} (${classTeacherName})`
      : `Class Timetable - ${sectionName}`,
    subtitle: 'Modern Indian School  |  Academic Year 2026-27',
    days: sortedDays,
    periods: sortedPeriods,
    cells,
  };
}

export function buildTeacherGrid(
  teacherName: string,
  teacherAbbr: string,
  slots: RawSlot[],
  days: DayInfo[],
  periods: PeriodInfo[],
): TimetableGrid {
  const sortedDays = [...days].sort((a, b) => a.dayOrder - b.dayOrder);
  const sortedPeriods = getTeacherDisplayTimeSlots(
    slots,
    [...periods].sort((a, b) => a.periodNumber - b.periodNumber)
  );

  const slotMap = new Map<string, RawSlot[]>();
  for (const s of slots) {
    const key = `${s.dayId}|${s.timeSlot.periodNumber}`;
    if (!slotMap.has(key)) slotMap.set(key, []);
    slotMap.get(key)!.push(s);
  }

  const cells: (CellData | null)[][] = sortedPeriods.map(period =>
    sortedDays.map(day => {
      const group = slotMap.get(`${day.id}|${period.periodNumber}`);
      if (!group || group.length === 0) return null;
      const subjectLabel = Array.from(
        new Set(group.map((slot) => subjectCodeLabel(slot)).filter(Boolean))
      ).join(' / ');
      const sectionLabel = Array.from(
        new Set(group.map((slot) => slot.section?.name).filter(Boolean))
      ).join(' / ');
      const displayTimes = Array.from(
        new Set(
          group.map((slot) => {
            const displayTimeSlot = getSectionDisplayTimeSlot(slot.section?.name ?? null, slot.timeSlot);
            return formatTimeRange(displayTimeSlot.startTime, displayTimeSlot.endTime);
          })
        )
      );
      const metaParts = [
        displayTimes.length === 1
          ? (displayTimes[0] === formatTimeRange(period.startTime, period.endTime) ? undefined : displayTimes[0])
          : displayTimes.join(' / '),
        ...Array.from(new Set(group.map((slot) => slot.room?.name).filter(Boolean))),
        ...Array.from(new Set(group.map((slot) => slotTypeLabel(slot)).filter(Boolean))),
      ].filter(Boolean);
      const cell = makeCell(group[0], sectionLabel, metaParts.join(' | ') || undefined);
      return {
        ...cell,
        line1: subjectLabel || cell.line1,
      };
    })
  );

  // No lab merging for teacher view -> different sections per lab slot
  return {
    title: `Teacher Timetable - ${teacherName} (${teacherAbbr})`,
    subtitle: 'Modern Indian School  |  Academic Year 2026-27',
    days: sortedDays,
    periods: sortedPeriods,
    cells,
  };
}
