export type CombinedSlotBucket = '2nd Language' | '3rd Language';
export type CombinedSlotSharingMode = 'single' | 'grouped' | 'shared';
export type CombinedSlotKind = 'language-block' | 'combined-slot';

export interface CombinedSlotOption {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  teacherId: string;
  teacherName: string;
  teacherAbbreviation: string;
  sharing: CombinedSlotSharingMode;
  groupLimit?: number | null;
}

export interface CombinedSlotMetadata {
  kind: CombinedSlotKind;
  bucket?: CombinedSlotBucket;
  grade?: string;
  displayName: string;
  displayCode: string;
  options: CombinedSlotOption[];
}

const COMBINED_SLOT_PREFIX = '__MIS_COMBINED_SLOT__=';

function dedupe(values: Array<string | null | undefined>) {
  return values.filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
}

export function encodeCombinedSlotMetadata(
  metadata: CombinedSlotMetadata,
  plainNotes?: string | null
) {
  const encoded = `${COMBINED_SLOT_PREFIX}${JSON.stringify(metadata)}`;
  const trailing = plainNotes?.trim();
  return trailing ? `${encoded}\n${trailing}` : encoded;
}

export function parseCombinedSlotMetadata(notes?: string | null): CombinedSlotMetadata | null {
  if (!notes?.startsWith(COMBINED_SLOT_PREFIX)) return null;
  const firstLineEnd = notes.indexOf('\n');
  const payload = firstLineEnd >= 0
    ? notes.slice(COMBINED_SLOT_PREFIX.length, firstLineEnd)
    : notes.slice(COMBINED_SLOT_PREFIX.length);

  try {
    const parsed = JSON.parse(payload) as CombinedSlotMetadata;
    if (
      parsed &&
      (parsed.kind === 'language-block' || parsed.kind === 'combined-slot') &&
      Array.isArray(parsed.options) &&
      typeof parsed.displayName === 'string' &&
      typeof parsed.displayCode === 'string'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export function getPlainSlotNotes(notes?: string | null) {
  if (!notes?.startsWith(COMBINED_SLOT_PREFIX)) return notes ?? null;
  const firstLineEnd = notes.indexOf('\n');
  if (firstLineEnd < 0) return null;
  const trailing = notes.slice(firstLineEnd + 1).trim();
  return trailing || null;
}

export function getCombinedSlotDisplay(notes?: string | null) {
  const metadata = parseCombinedSlotMetadata(notes);
  if (!metadata) return null;
  return {
    name: metadata.displayName,
    code: metadata.displayCode,
  };
}

export function getCombinedSlotTeacherIds(notes?: string | null) {
  const metadata = parseCombinedSlotMetadata(notes);
  if (!metadata) return [];
  return dedupe(metadata.options.map((option) => option.teacherId));
}

export function getCombinedSlotTeacherNames(notes?: string | null) {
  const metadata = parseCombinedSlotMetadata(notes);
  if (!metadata) return [];
  return dedupe(metadata.options.map((option) => option.teacherName));
}

export function getCombinedSlotTeacherAbbreviations(notes?: string | null) {
  const metadata = parseCombinedSlotMetadata(notes);
  if (!metadata) return [];
  return dedupe(metadata.options.map((option) => option.teacherAbbreviation));
}

export function getAllSlotTeacherIds(slot: { teacherId?: string | null; labTeacherId?: string | null; notes?: string | null }) {
  return dedupe([
    slot.teacherId,
    slot.labTeacherId,
    ...getCombinedSlotTeacherIds(slot.notes),
  ]);
}

export function slotHasTeacherId(
  slot: { teacherId?: string | null; labTeacherId?: string | null; notes?: string | null },
  teacherId: string
) {
  return getAllSlotTeacherIds(slot).includes(teacherId);
}

export function getSlotTeacherNames(slot: {
  teacher?: { name?: string | null } | null;
  labTeacher?: { name?: string | null } | null;
  notes?: string | null;
}) {
  return dedupe([
    slot.teacher?.name,
    slot.labTeacher?.name,
    ...getCombinedSlotTeacherNames(slot.notes),
  ]);
}

export function getSlotTeacherAbbreviations(slot: {
  teacher?: { abbreviation?: string | null } | null;
  labTeacher?: { abbreviation?: string | null } | null;
  notes?: string | null;
}) {
  return dedupe([
    slot.teacher?.abbreviation,
    slot.labTeacher?.abbreviation,
    ...getCombinedSlotTeacherAbbreviations(slot.notes),
  ]);
}
