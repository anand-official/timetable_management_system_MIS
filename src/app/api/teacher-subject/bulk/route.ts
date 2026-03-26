import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  getExpectedLabDepartment,
  isLabDepartment,
  matchesLabDepartmentForSubject,
} from '@/lib/teacher-departments';
import { BulkImportSchema, validationError } from '@/lib/validation';
import { sortSectionsByGradeThenName } from '@/lib/section-sort';
import {
  assertPrimaryTeacherEligibility,
  assertTeacherAvailableForSectionSubjectSlots,
  syncPrimaryTeacherForSectionSubject,
} from '@/lib/section-subject-sync';

// ── Types ───────────────────────────────────────────────────────────────────────

interface RowError {
  row:     number;
  input:   Record<string, unknown>;
  error:   string;
}

interface RowSuccess {
  row:      number;
  teacher:  string;
  subject:  string;
  section:  string;
  periods:  number;
  action:   'created' | 'updated';
}

// ── POST — validate + upsert all rows ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body   = await request.json();
  const parsed = BulkImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationError(parsed.error), { status: 400 });
  }

  const { rows } = parsed.data;

  // ── Build lookup maps (name/abbr → id) — one DB round-trip each ─────────────
  const [teachers, subjects, sectionsRaw] = await Promise.all([
    db.teacher.findMany({ select: { id: true, name: true, abbreviation: true, department: true } }),
    db.subject.findMany({ select: { id: true, name: true, code: true } }),
    db.section.findMany({ select: { id: true, name: true, grade: { select: { name: true } } } }),
  ]);
  const sections = sortSectionsByGradeThenName(sectionsRaw);

  // Teachers: match by abbreviation first, then by full name (case-insensitive)
  const teacherByAbbr = new Map(teachers.map(t => [t.abbreviation.toLowerCase(), t]));
  const teacherByName = new Map(teachers.map(t => [t.name.toLowerCase(), t]));

  // Subjects: match by name or code (case-insensitive)
  const subjectByName = new Map(subjects.map(s => [s.name.toLowerCase(), s]));
  const subjectByCode = new Map(subjects.map(s => [s.code.toLowerCase(), s]));

  // Sections: exact match (case-insensitive)
  const sectionByName = new Map(sections.map(s => [s.name.toLowerCase(), s]));

  // ── Validate rows ─────────────────────────────────────────────────────────────
  const errors:   RowError[]   = [];
  const valid:    { rowIndex: number; teacherId: string; subjectId: string; sectionId: string; periodsPerWeek: number; isLabAssignment: boolean; teacherName: string; subjectName: string; sectionName: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row       = rows[i];
    const rowNum    = i + 1;
    const rowInput  = row as Record<string, unknown>;
    const errs: string[] = [];

    // Teacher lookup
    const teacherKey = row.teacher.toLowerCase();
    const teacher    = teacherByAbbr.get(teacherKey) ?? teacherByName.get(teacherKey);
    if (!teacher) errs.push(`Teacher "${row.teacher}" not found (try abbreviation like "DRA")`);

    // Subject lookup
    const subjectKey = row.subject.toLowerCase();
    const subject    = subjectByName.get(subjectKey) ?? subjectByCode.get(subjectKey);
    if (!subject) errs.push(`Subject "${row.subject}" not found`);
    if (row.isLabAssignment && teacher && subject && !matchesLabDepartmentForSubject(teacher.department, subject.name)) {
      const expectedDepartment = getExpectedLabDepartment(subject.name);
      errs.push(
        expectedDepartment
          ? `Teacher "${row.teacher}" must be in the ${expectedDepartment} department for ${subject.name} lab assignments`
          : `Teacher "${row.teacher}" must be in a lab assignment department for ${subject.name}`
      );
    }

    // Section lookup
    const sectionKey = row.section.toLowerCase();
    const section    = sectionByName.get(sectionKey);
    if (!section) errs.push(`Section "${row.section}" not found (e.g. "VIA", "XIIB")`);

    if (errs.length > 0) {
      errors.push({ row: rowNum, input: rowInput, error: errs.join('; ') });
      continue;
    }

    valid.push({
      rowIndex:       rowNum,
      teacherId:      teacher!.id,
      subjectId:      subject!.id,
      sectionId:      section!.id,
      periodsPerWeek: row.periodsPerWeek,
      isLabAssignment: row.isLabAssignment ?? false,
      teacherName:    teacher!.abbreviation,
      subjectName:    subject!.name,
      sectionName:    section!.name,
    });
  }

  // ── Upsert valid rows ─────────────────────────────────────────────────────────
  const successes: RowSuccess[] = [];

  for (const v of valid) {
    try {
      const existingAssignments = await db.teacherSubject.findMany({
        where: {
          sectionId: v.sectionId,
          subjectId: v.subjectId,
        },
        include: {
          teacher: {
            select: {
              department: true,
            },
          },
        },
      });
      const existingPrimary = existingAssignments.find((assignment) => !assignment.isLabAssignment);
      const exactExisting = existingAssignments.find((assignment) => assignment.teacherId === v.teacherId);

      if (v.isLabAssignment) {
        await db.teacherSubject.upsert({
          where: {
            teacherId_subjectId_sectionId: {
              teacherId: v.teacherId,
              subjectId: v.subjectId,
              sectionId: v.sectionId,
            },
          },
          update: { periodsPerWeek: v.periodsPerWeek, isLabAssignment: true },
          create: {
            teacherId:       v.teacherId,
            subjectId:       v.subjectId,
            sectionId:       v.sectionId,
            periodsPerWeek:  v.periodsPerWeek,
            isLabAssignment: true,
          },
        });
      } else {
        await assertPrimaryTeacherEligibility(db, v.sectionId, v.subjectId, v.teacherId);
        await assertTeacherAvailableForSectionSubjectSlots(db, {
          sectionId: v.sectionId,
          subjectId: v.subjectId,
          teacherId: v.teacherId,
        });

        await db.$transaction(async (tx) => {
          await syncPrimaryTeacherForSectionSubject(tx, {
            sectionId: v.sectionId,
            subjectId: v.subjectId,
            teacherId: v.teacherId,
            periodsPerWeek: v.periodsPerWeek,
            isLabAssignment: false,
            syncTimetable: true,
          });
        });
      }

      successes.push({
        row:     v.rowIndex,
        teacher: v.teacherName,
        subject: v.subjectName,
        section: v.sectionName,
        periods: v.periodsPerWeek,
        action:  existingPrimary || exactExisting ? 'updated' : 'created',
      });
    } catch (err) {
      errors.push({
        row:   v.rowIndex,
        input: { teacher: v.teacherName, subject: v.subjectName, section: v.sectionName },
        error: `Database error: ${(err as Error).message}`,
      });
    }
  }

  return NextResponse.json({
    summary: {
      total:   rows.length,
      success: successes.length,
      errors:  errors.length,
      created: successes.filter(s => s.action === 'created').length,
      updated: successes.filter(s => s.action === 'updated').length,
    },
    successes,
    errors,
  });
}
