import type { TeacherEligibilityRecord } from '@/lib/teacher-eligibility';

export interface LabTeacherSupportRecord extends TeacherEligibilityRecord {
  id: string;
  name: string;
  abbreviation: string;
}

type LabSupportSpec = {
  teacherName: string;
  teacherAbbreviation: string;
  subjects: string[];
  grades?: string[];
};

const LAB_SUPPORT_SPECS: LabSupportSpec[] = [
  {
    teacherName: 'Ajita Thapaliya',
    teacherAbbreviation: 'AT',
    subjects: ['Physics'],
    grades: ['IX', 'X', 'XI', 'XII'],
  },
  {
    teacherName: 'Sudhanshu Kumar Mishra',
    teacherAbbreviation: 'SKM',
    subjects: ['Chemistry'],
    grades: ['IX', 'X', 'XI', 'XII'],
  },
  {
    teacherName: 'Deepa Dutta',
    teacherAbbreviation: 'DD',
    subjects: ['Biology'],
    grades: ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
  },
  {
    teacherName: 'Ponmani R.K.',
    teacherAbbreviation: 'PA',
    subjects: ['Computer Science'],
    grades: ['V', 'VI', 'VII'],
  },
  {
    teacherName: 'Alina Maharjan',
    teacherAbbreviation: 'AM',
    subjects: ['Computer Science', 'Innovation', 'Informatics Practices'],
    grades: ['VI', 'VII', 'IX', 'X'],
  },
  {
    teacherName: 'Bibek Khadka',
    teacherAbbreviation: 'BK',
    subjects: ['Computer Science', 'Innovation', 'Informatics Practices'],
    grades: ['VIII', 'IX', 'X', 'XI'],
  },
  {
    teacherName: 'Deepika Bhandari',
    teacherAbbreviation: 'DB',
    subjects: ['Physics', 'Chemistry', 'Biology', 'Science'],
    grades: ['IX', 'X'],
  },
];

function normalizeName(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|dr)\.?\s+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCode(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function teacherMatchesSpec(teacher: LabTeacherSupportRecord, spec: LabSupportSpec) {
  return (
    normalizeCode(teacher.abbreviation) === normalizeCode(spec.teacherAbbreviation) ||
    normalizeName(teacher.name) === normalizeName(spec.teacherName)
  );
}

function subjectMatchesSpec(subjectName: string, spec: LabSupportSpec) {
  const normalized = normalizeCode(subjectName);
  return spec.subjects.some((value) => normalizeCode(value) === normalized);
}

function gradeMatchesSpec(_teacher: LabTeacherSupportRecord, spec: LabSupportSpec, grade: string) {
  if (!spec.grades || spec.grades.length === 0) return true;
  return spec.grades.includes(grade);
}

export function getExplicitLabTeacherCandidates<T extends LabTeacherSupportRecord>(
  teachers: T[],
  subjectName: string,
  grade: string
): T[] {
  const matches = LAB_SUPPORT_SPECS
    .filter((spec) => subjectMatchesSpec(subjectName, spec))
    .flatMap((spec) =>
      teachers.filter(
        (teacher) =>
          teacher.isActive !== false &&
          teacherMatchesSpec(teacher, spec) &&
          gradeMatchesSpec(teacher, spec, grade)
      )
    );

  const seen = new Set<string>();
  return matches.filter((teacher) => {
    if (seen.has(teacher.id)) return false;
    seen.add(teacher.id);
    return true;
  });
}
