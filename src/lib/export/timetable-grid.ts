/**
 * Shared grid-building logic for timetable PDF and Excel exports.
 * Converts raw DB slots into a typed 2-D grid with lab-pair detection.
 */

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
  isLab: boolean;
  isGames: boolean;
  isYoga: boolean;
  isLibrary: boolean;
  isInnovation: boolean;
  isWE: boolean;
  subjectId: string | null;
  /**
   * rowSpan = 2 → this cell spans 2 rows (lab double period start)
   * rowSpan = 0 → this cell is consumed by the row above (skip it)
   * undefined   → normal single-period cell
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

/** Colour hint for a cell — used by both PDF and Excel renderers */
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

// ── Slot shape returned by Prisma include ─────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawSlot = any;

function makeCell(slot: RawSlot, line2: string): CellData {
  return {
    line1: slot.subject?.code ?? slot.subject?.name ?? '—',
    line2,
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
): TimetableGrid {
  const sortedDays    = [...days].sort((a, b) => a.dayOrder - b.dayOrder);
  const sortedPeriods = [...periods].sort((a, b) => a.periodNumber - b.periodNumber);

  const slotMap = new Map<string, RawSlot>();
  for (const s of slots) {
    slotMap.set(`${s.dayId}|${s.timeSlot.periodNumber}`, s);
  }

  const cells: (CellData | null)[][] = sortedPeriods.map(period =>
    sortedDays.map(day => {
      const s = slotMap.get(`${day.id}|${period.periodNumber}`);
      return s ? makeCell(s, s.teacher?.abbreviation ?? '') : null;
    })
  );

  detectLabPairs(cells);

  return {
    title:    `Class Timetable — ${sectionName}`,
    subtitle: 'Modern Indian School  |  Academic Year 2025-26',
    days:    sortedDays,
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
  const sortedDays    = [...days].sort((a, b) => a.dayOrder - b.dayOrder);
  const sortedPeriods = [...periods].sort((a, b) => a.periodNumber - b.periodNumber);

  const slotMap = new Map<string, RawSlot>();
  for (const s of slots) {
    slotMap.set(`${s.dayId}|${s.timeSlot.periodNumber}`, s);
  }

  const cells: (CellData | null)[][] = sortedPeriods.map(period =>
    sortedDays.map(day => {
      const s = slotMap.get(`${day.id}|${period.periodNumber}`);
      return s ? makeCell(s, s.section?.name ?? '') : null;
    })
  );

  // No lab merging for teacher view — different sections per lab slot
  return {
    title:    `Teacher Timetable — ${teacherName} (${teacherAbbr})`,
    subtitle: 'Modern Indian School  |  Academic Year 2025-26',
    days:    sortedDays,
    periods: sortedPeriods,
    cells,
  };
}
