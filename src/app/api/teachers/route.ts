import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { TeacherCreateSchema, TeacherUpdateSchema, validationError } from '@/lib/validation';

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const department = searchParams.get('department');

    if (id) {
      if (typeof id !== 'string' || id.length > 128) {
        return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
      }

      const teacher = await db.teacher.findUnique({
        where: { id },
        include: {
          teacherSubjects: {
            include: {
              subject: true,
              section: { include: { grade: true } },
            },
          },
          teacherSections: { include: { grade: true } },
          coordinatorFor: { include: { grade: true } },
          _count: { select: { timetableSlots: true, labTimetableSlots: true } },
        },
      });

      if (!teacher) {
        return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
      }

      return NextResponse.json({
        teacher: { ...teacher, teachableGrades: parseGrades(teacher.teachableGrades) },
      });
    }

    const where = department ? { department: String(department).slice(0, 60) } : {};

    const teachers = await db.teacher.findMany({
      where,
      include: {
        _count: {
          select: { teacherSubjects: true, timetableSlots: true, labTimetableSlots: true },
        },
      },
      orderBy: [{ department: 'asc' }, { name: 'asc' }],
    });

    const departments = await db.teacher.groupBy({
      by: ['department'],
      _count: { id: true },
      orderBy: { department: 'asc' },
    });

    return NextResponse.json({
      teachers: teachers.map(t => ({
        ...t,
        teachableGrades: parseGrades(t.teachableGrades),
      })),
      departments,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch teachers' }, { status: 500 });
  }
}

// ── POST ───────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = TeacherCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }

    const { name, abbreviation, department, isHOD, targetWorkload, isActive, teachableGrades } =
      parsed.data;

    const existing = await db.teacher.findUnique({ where: { abbreviation } });
    if (existing) {
      return NextResponse.json(
        { error: 'A teacher with this abbreviation already exists' },
        { status: 400 }
      );
    }

    const teacher = await db.teacher.create({
      data: {
        name,
        abbreviation: abbreviation.toUpperCase(),
        department,
        isHOD,
        targetWorkload,
        currentWorkload: 0,
        isActive,
        teachableGrades: JSON.stringify(teachableGrades),
      },
    });

    return NextResponse.json({
      teacher: { ...teacher, teachableGrades: parseGrades(teacher.teachableGrades) },
      success: true,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to create teacher' }, { status: 500 });
  }
}

// ── PUT ────────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = TeacherUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }

    const { id, teachableGrades, ...rest } = parsed.data;

    const existing = await db.teacher.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
    }

    if (rest.abbreviation && rest.abbreviation !== existing.abbreviation) {
      const dup = await db.teacher.findUnique({ where: { abbreviation: rest.abbreviation } });
      if (dup) {
        return NextResponse.json(
          { error: 'A teacher with this abbreviation already exists' },
          { status: 400 }
        );
      }
    }

    const teacher = await db.teacher.update({
      where: { id },
      data: {
        ...rest,
        teachableGrades:
          teachableGrades !== undefined
            ? JSON.stringify(teachableGrades)
            : existing.teachableGrades,
      },
    });

    return NextResponse.json({
      teacher: { ...teacher, teachableGrades: parseGrades(teacher.teachableGrades) },
      success: true,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to update teacher' }, { status: 500 });
  }
}

// ── DELETE ─────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id || typeof id !== 'string' || id.length > 128) {
      return NextResponse.json({ error: 'Teacher ID is required' }, { status: 400 });
    }

    const teacher = await db.teacher.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            teacherSubjects: true,
            timetableSlots: true,
            labTimetableSlots: true,
            teacherSections: true,
            coordinatorFor: true,
          },
        },
      },
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
    }

    const totalTimetableSlots = teacher._count.timetableSlots + teacher._count.labTimetableSlots;
    if (totalTimetableSlots > 0) {
      return NextResponse.json(
        { error: `Cannot delete: teacher has ${totalTimetableSlots} timetable slot(s). Remove assignments first.` },
        { status: 400 }
      );
    }

    if (teacher._count.teacherSections > 0) {
      return NextResponse.json(
        { error: `Cannot delete: teacher is class teacher for ${teacher._count.teacherSections} section(s). Reassign first.` },
        { status: 400 }
      );
    }

    if (teacher._count.coordinatorFor > 0) {
      return NextResponse.json(
        { error: `Cannot delete: teacher is coordinator for ${teacher._count.coordinatorFor} section(s). Reassign first.` },
        { status: 400 }
      );
    }

    if (teacher._count.teacherSubjects > 0) {
      await db.teacherSubject.deleteMany({ where: { teacherId: id } });
    }

    await db.teacher.delete({ where: { id } });

    return NextResponse.json({ success: true, message: 'Teacher deleted successfully' });
  } catch {
    return NextResponse.json({ error: 'Failed to delete teacher' }, { status: 500 });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseGrades(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
