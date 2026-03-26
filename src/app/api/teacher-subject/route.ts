import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { TeacherSubjectCreateSchema, TeacherSubjectUpdateSchema, validationError } from '@/lib/validation';
import {
  getExpectedLabDepartment,
  isLabDepartment,
  matchesLabDepartmentForSubject,
} from '@/lib/teacher-departments';
import {
  assertPrimaryTeacherEligibility,
  assertTeacherAvailableForSectionSubjectSlots,
  syncPrimaryTeacherForSectionSubject,
} from '@/lib/section-subject-sync';

// ── GET — list assignments (optionally filtered) ────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const teacherId = searchParams.get('teacherId') ?? undefined;
  const sectionId = searchParams.get('sectionId') ?? undefined;
  const subjectId = searchParams.get('subjectId') ?? undefined;

  const assignments = await db.teacherSubject.findMany({
    where: {
      ...(teacherId ? { teacherId } : {}),
      ...(sectionId ? { sectionId } : {}),
      ...(subjectId ? { subjectId } : {}),
    },
    include: {
      teacher: { select: { id: true, name: true, abbreviation: true, department: true } },
      subject: { select: { id: true, name: true, code: true } },
      section: { select: { id: true, name: true } },
    },
    orderBy: [{ section: { name: 'asc' } }, { subject: { name: 'asc' } }],
  });

  return NextResponse.json({ assignments, total: assignments.length });
}

// ── POST — create a single assignment ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body   = await request.json();
  const parsed = TeacherSubjectCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(validationError(parsed.error), { status: 400 });

  const { teacherId, subjectId, sectionId, periodsPerWeek, isLabAssignment } = parsed.data;

  try {
    let assignment;

    if (isLabAssignment) {
      await assertLabAssignmentTeacher(teacherId, subjectId);
      assignment = await db.teacherSubject.upsert({
        where:  { teacherId_subjectId_sectionId: { teacherId, subjectId, sectionId } },
        update: { periodsPerWeek, isLabAssignment: isLabAssignment ?? false },
        create: { teacherId, subjectId, sectionId, periodsPerWeek, isLabAssignment: isLabAssignment ?? false },
        include: {
          teacher: { select: { id: true, name: true, abbreviation: true } },
          subject: { select: { id: true, name: true, code: true } },
          section: { select: { id: true, name: true } },
        },
      });
    } else {
      await assertPrimaryTeacherEligibility(db, sectionId, subjectId, teacherId);
      await assertTeacherAvailableForSectionSubjectSlots(db, {
        sectionId,
        subjectId,
        teacherId,
      });

      const result = await db.$transaction(async (tx) => {
        const syncResult = await syncPrimaryTeacherForSectionSubject(tx, {
          sectionId,
          subjectId,
          teacherId,
          periodsPerWeek,
          isLabAssignment: false,
          syncTimetable: true,
        });

        return syncResult.assignmentId
          ? tx.teacherSubject.findUnique({
              where: { id: syncResult.assignmentId },
              include: {
                teacher: { select: { id: true, name: true, abbreviation: true } },
                subject: { select: { id: true, name: true, code: true } },
                section: { select: { id: true, name: true } },
              },
            })
          : null;
      });

      assignment = result;
    }

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : '';
    const status =
      (message.includes('not eligible') ||
        message.includes('not found') ||
        message.includes('clash') ||
        message.toLowerCase().includes('lab assignment'))
        ? 400
        : 500;
    return NextResponse.json({ error: message || 'Failed to save assignment' }, { status });
  }
}

// ── PUT — update periodsPerWeek / isLabAssignment ──────────────────────────────

export async function PUT(request: NextRequest) {
  const body   = await request.json();
  const parsed = TeacherSubjectUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(validationError(parsed.error), { status: 400 });

  const { id, ...data } = parsed.data;
  try {
    const existing = await db.teacherSubject.findUnique({
      where: { id },
      select: {
        id: true,
        teacherId: true,
        subjectId: true,
        sectionId: true,
        periodsPerWeek: true,
        isLabAssignment: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const nextTeacherId = data.teacherId ?? existing.teacherId;
    const nextSubjectId = data.subjectId ?? existing.subjectId;
    const nextSectionId = data.sectionId ?? existing.sectionId;
    const nextPeriodsPerWeek = data.periodsPerWeek ?? existing.periodsPerWeek;
    const nextIsLabAssignment = data.isLabAssignment ?? existing.isLabAssignment;

    let assignment;
    if (nextIsLabAssignment) {
      await assertLabAssignmentTeacher(nextTeacherId, nextSubjectId);
      assignment = await db.teacherSubject.update({
        where: { id },
        data: {
          teacherId: nextTeacherId,
          subjectId: nextSubjectId,
          sectionId: nextSectionId,
          periodsPerWeek: nextPeriodsPerWeek,
          isLabAssignment: nextIsLabAssignment,
        },
      });
    } else {
      await assertPrimaryTeacherEligibility(db, nextSectionId, nextSubjectId, nextTeacherId);
      await assertTeacherAvailableForSectionSubjectSlots(db, {
        sectionId: nextSectionId,
        subjectId: nextSubjectId,
        teacherId: nextTeacherId,
      });

      assignment = await db.$transaction(async (tx) => {
        const syncResult = await syncPrimaryTeacherForSectionSubject(tx, {
          sectionId: nextSectionId,
          subjectId: nextSubjectId,
          teacherId: nextTeacherId,
          periodsPerWeek: nextPeriodsPerWeek,
          isLabAssignment: false,
          syncTimetable: true,
        });

        return syncResult.assignmentId
          ? tx.teacherSubject.findUnique({ where: { id: syncResult.assignmentId } })
          : null;
      });
    }

    return NextResponse.json({ assignment });
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : '';
    const status =
      (message.includes('not eligible') ||
        message.includes('not found') ||
        message.includes('clash') ||
        message.toLowerCase().includes('lab assignment'))
        ? 400
        : 500;
    return NextResponse.json({ error: message || 'Assignment not found' }, { status });
  }
}

// ── DELETE — remove a single assignment ────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || id.length > 128) {
    return NextResponse.json({ error: 'Valid assignment ID required' }, { status: 400 });
  }
  try {
    await db.teacherSubject.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }
}

async function assertLabAssignmentTeacher(teacherId: string, subjectId: string) {
  const [teacher, subject] = await Promise.all([
    db.teacher.findUnique({
      where: { id: teacherId },
      select: { name: true, abbreviation: true, department: true },
    }),
    db.subject.findUnique({
      where: { id: subjectId },
      select: { name: true },
    }),
  ]);

  if (!teacher) {
    throw new Error('Teacher not found');
  }

  if (!subject) {
    throw new Error('Subject not found');
  }

  if (matchesLabDepartmentForSubject(teacher.department, subject.name)) {
    return;
  }

  const expectedDepartment = getExpectedLabDepartment(subject.name);
  if (expectedDepartment) {
    throw new Error(
      `${teacher.abbreviation || teacher.name} must be in the ${expectedDepartment} department for ${subject.name} lab assignments`
    );
  }

  if (!isLabDepartment(teacher.department)) {
    throw new Error(
      `${teacher.abbreviation || teacher.name} must be in a lab assignment department for ${subject.name}`
    );
  }
}
