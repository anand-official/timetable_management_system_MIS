import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { TeacherSubjectCreateSchema, TeacherSubjectUpdateSchema, validationError } from '@/lib/validation';

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
    const assignment = await db.teacherSubject.upsert({
      where:  { teacherId_subjectId_sectionId: { teacherId, subjectId, sectionId } },
      update: { periodsPerWeek, isLabAssignment: isLabAssignment ?? false },
      create: { teacherId, subjectId, sectionId, periodsPerWeek, isLabAssignment: isLabAssignment ?? false },
      include: {
        teacher: { select: { id: true, name: true, abbreviation: true } },
        subject: { select: { id: true, name: true, code: true } },
        section: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to save assignment' }, { status: 500 });
  }
}

// ── PUT — update periodsPerWeek / isLabAssignment ──────────────────────────────

export async function PUT(request: NextRequest) {
  const body   = await request.json();
  const parsed = TeacherSubjectUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(validationError(parsed.error), { status: 400 });

  const { id, ...data } = parsed.data;
  try {
    const assignment = await db.teacherSubject.update({ where: { id }, data });
    return NextResponse.json({ assignment });
  } catch {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
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
