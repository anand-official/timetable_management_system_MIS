import { isLabDepartment } from '@/lib/teacher-departments';

export interface TeacherEligibilityRecord {
  department: string;
  teachableGrades?: string | string[] | null;
  isActive?: boolean | null;
}

export interface SubjectEligibilityRecord {
  name: string;
  category: string;
}

export function parseTeachableGrades(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === 'string');
  }

  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function teacherCanCoverSubject(
  teacher: TeacherEligibilityRecord,
  subject: SubjectEligibilityRecord,
  grade: string
): boolean {
  if (teacher.isActive === false) return false;

  const dept = teacher.department.toLowerCase();
  const subjectName = subject.name.toLowerCase();

  // Activity specialist subjects (Art, Music, Dance, W.E.) are taught by department specialists
  // across all grades — skip the teachableGrades restriction for these subjects.
  const isActivitySpecialist =
    subject.category === 'Activity' ||
    ['art', 'music', 'dance', 'vocal', 'keyboard', 'instrument', 'tabla', 'work experience'].includes(subjectName);

  if (!isActivitySpecialist) {
    const grades = parseTeachableGrades(teacher.teachableGrades);
    if (grades.length > 0 && !grades.includes(grade)) return false;
  }

  if (isLabDepartment(teacher.department) || dept === 'counselling') return false;
  if (subjectName === 'games') return dept === 'sports';
  if (subjectName === 'yoga' || subjectName === 'aerobics') return dept === 'yoga' || dept === 'sports';
  if (subjectName === 'library') return dept === 'library';
  if (subjectName === 'innovation') {
    return ['innovation', 'computer science', 'physics', 'library'].includes(dept);
  }
  if (subjectName === 'music') return dept === 'music' || dept === 'work experience';
  if (subjectName === 'dance') return dept === 'dance' || dept === 'work experience';
  if (subjectName === 'art') return dept === 'art' || dept === 'work experience';
  if (subjectName === 'vocal') return dept === 'vocal' || dept === 'work experience';
  if (subjectName === 'keyboard') return dept === 'keyboard' || dept === 'work experience';
  if (subjectName === 'instrument') return dept === 'instrument' || dept === 'work experience';
  if (subjectName === 'tabla') return dept === 'tabla' || dept === 'work experience';

  if (subjectName === 'work experience') {
    return ['art', 'dance', 'music', 'vocal', 'keyboard', 'instrument', 'tabla'].includes(dept) || dept === 'work experience';
  }

  if (subject.category === 'Activity') {
    return dept === subjectName;
  }

  if (subject.category === 'Commerce') return dept === 'commerce' || dept === 'economics';
  if (subjectName === 'economics') return dept === 'economics' || dept === 'commerce';
  if (subjectName === 'geography' || subjectName === 'history' || subjectName === 'social studies') {
    return dept === 'social studies';
  }
  if (subjectName === 'hindi') return dept === 'hindi';
  if (subjectName === 'nepali') return dept === 'nepali';
  if (subjectName === 'french') return dept === 'french';
  if (subjectName === 'home science') return dept === 'home science';
  if (subjectName === 'informatics practices') return dept === 'computer science';
  if (subjectName === 'computer science') return dept === 'computer science';
  if (subjectName === 'mathematics') return dept === 'mathematics';
  if (subjectName === 'english') return dept === 'english';
  if (subjectName === 'physics') return dept === 'physics';
  if (subjectName === 'chemistry') return dept === 'chemistry';
  if (subjectName === 'biology') return dept === 'biology';
  if (subjectName === 'science') return ['biology', 'physics', 'chemistry', 'science'].includes(dept);

  return dept === subjectName;
}

export function getEligibleTeachersForSectionSubject<T extends TeacherEligibilityRecord>(
  teachers: T[],
  subject: SubjectEligibilityRecord | undefined,
  grade: string | undefined
): T[] {
  if (!subject || !grade) return [];
  return teachers.filter((teacher) => teacherCanCoverSubject(teacher, subject, grade));
}
