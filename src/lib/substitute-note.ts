export const SUBSTITUTE_NOTE_PREFIX = '__MIS_SUBSTITUTE__=';
const COMBINED_SLOT_PREFIX = '__MIS_COMBINED_SLOT__=';

export interface SubstituteNoteEntry {
  date: string;
  absentTeacherId: string;
  absentTeacherName: string;
  absentTeacherAbbreviation: string;
  substituteTeacherId: string;
  substituteTeacherName: string;
  substituteTeacherAbbreviation: string;
  subjectId?: string | null;
  subjectName: string;
  subjectCode?: string | null;
  mode: 'manual' | 'auto';
}

function splitNoteLines(notes?: string | null) {
  return (notes ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseSubstituteNoteEntries(notes?: string | null): SubstituteNoteEntry[] {
  const line = splitNoteLines(notes).find((item) => item.startsWith(SUBSTITUTE_NOTE_PREFIX));
  if (!line) return [];

  try {
    const parsed = JSON.parse(line.slice(SUBSTITUTE_NOTE_PREFIX.length));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SubstituteNoteEntry => (
      entry &&
      typeof entry.date === 'string' &&
      typeof entry.absentTeacherId === 'string' &&
      typeof entry.substituteTeacherId === 'string' &&
      typeof entry.subjectName === 'string' &&
      (entry.mode === 'manual' || entry.mode === 'auto')
    ));
  } catch {
    return [];
  }
}

export function getSubstituteNoteEntry(
  notes: string | null | undefined,
  date: string,
  absentTeacherId: string
) {
  return parseSubstituteNoteEntries(notes).find(
    (entry) => entry.date === date && entry.absentTeacherId === absentTeacherId
  ) ?? null;
}

export function getSubstituteNoteEntriesForDate(notes: string | null | undefined, date: string) {
  return parseSubstituteNoteEntries(notes).filter((entry) => entry.date === date);
}

export function upsertSubstituteNoteEntry(
  notes: string | null | undefined,
  nextEntry: SubstituteNoteEntry
) {
  const lines = splitNoteLines(notes).filter((line) => !line.startsWith(SUBSTITUTE_NOTE_PREFIX));
  const combinedLine = lines.find((line) => line.startsWith(COMBINED_SLOT_PREFIX));
  const otherLines = lines.filter((line) => !line.startsWith(COMBINED_SLOT_PREFIX));
  const entries = parseSubstituteNoteEntries(notes).filter(
    (entry) => !(entry.date === nextEntry.date && entry.absentTeacherId === nextEntry.absentTeacherId)
  );
  entries.push(nextEntry);

  const metadataLine = `${SUBSTITUTE_NOTE_PREFIX}${JSON.stringify(entries)}`;
  return [combinedLine, metadataLine, ...otherLines].filter(Boolean).join('\n');
}

export function removeSubstituteNoteEntry(
  notes: string | null | undefined,
  date: string,
  absentTeacherId: string
) {
  const lines = splitNoteLines(notes).filter((line) => !line.startsWith(SUBSTITUTE_NOTE_PREFIX));
  const combinedLine = lines.find((line) => line.startsWith(COMBINED_SLOT_PREFIX));
  const otherLines = lines.filter((line) => !line.startsWith(COMBINED_SLOT_PREFIX));
  const entries = parseSubstituteNoteEntries(notes).filter(
    (entry) => !(entry.date === date && entry.absentTeacherId === absentTeacherId)
  );

  const rebuiltLines: string[] = [];
  if (combinedLine) rebuiltLines.push(combinedLine);
  if (entries.length > 0) {
    rebuiltLines.push(`${SUBSTITUTE_NOTE_PREFIX}${JSON.stringify(entries)}`);
  }
  rebuiltLines.push(...otherLines);
  return rebuiltLines.join('\n');
}
