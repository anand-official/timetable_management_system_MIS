export const LAB_DEPARTMENTS = [
  'Physics Lab',
  'Chemistry Lab',
  'Biology Lab',
  'Computer Lab',
] as const;

export const DEFAULT_TEACHER_DEPARTMENTS = [
  'Administration',
  'Art',
  'Biology',
  'Biology Lab',
  'Chemistry',
  'Chemistry Lab',
  'Commerce',
  'Computer Lab',
  'Computer Science',
  'Counselling',
  'Dance',
  'Economics',
  'English',
  'French',
  'General',
  'Hindi',
  'Home Science',
  'Library',
  'Mathematics',
  'Music',
  'Nepali',
  'Physics',
  'Physics Lab',
  'Science',
  'Social Studies',
  'Sports',
  'Yoga',
] as const;

function normalizeDepartment(department: string | null | undefined) {
  return (department ?? '').trim().toLowerCase();
}

export function isLegacyGenericLabDepartment(department: string | null | undefined) {
  return normalizeDepartment(department) === 'lab';
}

export function isLabDepartment(department: string | null | undefined) {
  const normalized = normalizeDepartment(department);
  if (normalized === 'lab') return true;
  return LAB_DEPARTMENTS.some((value) => value.toLowerCase() === normalized);
}

export function getExpectedLabDepartment(subjectName: string | null | undefined) {
  const normalized = (subjectName ?? '').trim().toLowerCase();
  if (normalized === 'physics') return 'Physics Lab';
  if (normalized === 'chemistry') return 'Chemistry Lab';
  if (normalized === 'biology' || normalized === 'science') return 'Biology Lab';
  if (
    normalized === 'computer science' ||
    normalized === 'informatics practices' ||
    normalized === 'innovation'
  ) {
    return 'Computer Lab';
  }
  return null;
}

export function getPreferredLabDepartmentsForSubject(subjectName: string | null | undefined) {
  const expected = getExpectedLabDepartment(subjectName);
  return expected ? [expected] : [...LAB_DEPARTMENTS];
}

export function matchesLabDepartmentForSubject(
  department: string | null | undefined,
  subjectName: string | null | undefined
) {
  if (isLegacyGenericLabDepartment(department)) return true;

  const expected = getExpectedLabDepartment(subjectName);
  if (!expected) return isLabDepartment(department);

  return normalizeDepartment(department) === expected.toLowerCase();
}
