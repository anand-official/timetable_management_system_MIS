/** Canonical progression: VI → VII → … → XII (matches school structure). */
const GRADE_ORDER = ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'] as const;

export function gradeSortIndex(gradeName: string): number {
  const i = GRADE_ORDER.indexOf(gradeName as (typeof GRADE_ORDER)[number]);
  return i === -1 ? 999 : i;
}

export type SectionWithGrade = {
  name: string;
  grade: { name: string };
};

/** Sort sections VI A… through XII … then by section name within grade. */
export function sortSectionsByGradeThenName<T extends SectionWithGrade>(sections: T[]): T[] {
  return [...sections].sort((a, b) => {
    const g = gradeSortIndex(a.grade.name) - gradeSortIndex(b.grade.name);
    if (g !== 0) return g;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}
