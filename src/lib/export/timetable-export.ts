import {
  getCombinedSlotDisplay,
  getPlainSlotNotes,
  getSlotTeacherAbbreviations,
  getSlotTeacherNames,
} from '@/lib/combined-slot';
import { getSectionDisplayTimeSlot } from '@/lib/section-time-slots';

type SlotLike = {
  notes?: string | null;
  section?: {
    name?: string | null;
    grade?: { name?: string | null } | null;
    classTeacher?: { name?: string | null } | null;
  } | null;
  timeSlot: {
    id: string;
    periodNumber: number;
    startTime: string;
    endTime: string;
    duration?: number;
  };
  subject?: { name?: string | null; code?: string | null } | null;
  teacher?: { name?: string | null; abbreviation?: string | null } | null;
  labTeacher?: { name?: string | null; abbreviation?: string | null } | null;
  room?: { name?: string | null } | null;
  isLab?: boolean | null;
  isGames?: boolean | null;
  isYoga?: boolean | null;
  isLibrary?: boolean | null;
  isInnovation?: boolean | null;
  isWE?: boolean | null;
};

export function schoolSubtitle(schoolName: string | null, academicYear: string | null): string {
  const name = schoolName?.trim() || 'Modern Indian School';
  const year = academicYear?.trim() || '2026-27';
  return `${name}  |  Academic Year ${year}`;
}

export function buildSafeTimetableName(raw: string | null | undefined, fallback: string): string {
  const cleaned = raw?.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function formatTimeRange(startTime: string, endTime: string): string {
  return `${startTime}-${endTime}`;
}

export function getTeacherExportLabel(slot: {
  teacher?: { name?: string | null; abbreviation?: string | null } | null;
  labTeacher?: { name?: string | null; abbreviation?: string | null } | null;
  notes?: string | null;
}) {
  const names = getSlotTeacherNames(slot);
  const abbreviations = getSlotTeacherAbbreviations(slot);
  return {
    names: names.join(' + '),
    abbreviations: abbreviations.join(' + '),
  };
}

export function getSlotTypeLabel(slot: Pick<SlotLike, 'isLab' | 'isGames' | 'isYoga' | 'isLibrary' | 'isInnovation' | 'isWE'>): string {
  if (slot.isLab) return 'Lab';
  if (slot.isGames) return 'Games';
  if (slot.isYoga) return 'Yoga';
  if (slot.isLibrary) return 'Library';
  if (slot.isInnovation) return 'Innovation';
  if (slot.isWE) return 'W.E.';
  return 'Regular';
}

export function getSlotDisplayFields(slot: SlotLike) {
  const displayTimeSlot = getSectionDisplayTimeSlot(slot.section?.name ?? null, slot.timeSlot);
  const combinedDisplay = getCombinedSlotDisplay(slot.notes);
  const teacherLabel = getTeacherExportLabel(slot);

  return {
    grade: slot.section?.grade?.name ?? '',
    classTeacher: slot.section?.classTeacher?.name ?? '',
    period: slot.timeSlot.periodNumber,
    startTime: displayTimeSlot.startTime,
    endTime: displayTimeSlot.endTime,
    timeRange: formatTimeRange(displayTimeSlot.startTime, displayTimeSlot.endTime),
    subject: combinedDisplay?.name ?? slot.subject?.name ?? '',
    subjectCode: combinedDisplay?.code ?? slot.subject?.code ?? '',
    teacher: teacherLabel.names,
    teacherAbbreviation: teacherLabel.abbreviations,
    labTeacher: slot.labTeacher?.name ?? '',
    labTeacherAbbreviation: slot.labTeacher?.abbreviation ?? '',
    room: slot.room?.name ?? '',
    slotType: getSlotTypeLabel(slot),
    notes: getPlainSlotNotes(slot.notes) ?? '',
  };
}

export function buildCsv(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>) {
  const escape = (value: string | number | boolean | null | undefined) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;

  const body = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ].join('\r\n');

  return `\uFEFF${body}\r\n`;
}
