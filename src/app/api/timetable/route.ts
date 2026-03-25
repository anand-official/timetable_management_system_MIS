import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { TimetableSlotSchema, validationError } from '@/lib/validation';
import { sortSectionsByGradeThenName } from '@/lib/section-sort';

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') ?? 'class';
    const id = searchParams.get('id');

    // Validate `type` against allowed values
    if (!['class', 'teacher', 'all'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
    }

    if (id && (typeof id !== 'string' || id.length > 128)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    if (type === 'class' && id) {
      const slots = await db.timetableSlot.findMany({
        where: { sectionId: id },
        include: { day: true, timeSlot: true, subject: true, teacher: true, room: true },
        orderBy: [{ day: { dayOrder: 'asc' } }, { timeSlot: { periodNumber: 'asc' } }],
      });
      return NextResponse.json({ slots });
    }

    if (type === 'teacher' && id) {
      const slots = await db.timetableSlot.findMany({
        where: { teacherId: id },
        include: { day: true, timeSlot: true, subject: true, section: true, room: true },
        orderBy: [{ day: { dayOrder: 'asc' } }, { timeSlot: { periodNumber: 'asc' } }],
      });
      return NextResponse.json({ slots });
    }

    // Default: return everything needed for the timetable page
    const [sectionsRaw, teachers, subjects, days, timeSlots, slots] = await Promise.all([
      db.section.findMany({
        include: { grade: true, classTeacher: true, coordinator: true },
      }),
      db.teacher.findMany({ orderBy: { name: 'asc' } }),
      db.subject.findMany({ orderBy: { name: 'asc' } }),
      db.day.findMany({ orderBy: { dayOrder: 'asc' } }),
      db.timeSlot.findMany({ orderBy: { periodNumber: 'asc' } }),
      db.timetableSlot.findMany({
        include: { day: true, timeSlot: true, subject: true, teacher: true, section: true, room: true },
      }),
    ]);

    const sections = sortSectionsByGradeThenName(sectionsRaw);

    return NextResponse.json({
      sections,
      teachers: teachers.map(t => ({ ...t, teachableGrades: parseGrades(t.teachableGrades) })),
      subjects,
      days,
      timeSlots,
      slots,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}

// ── POST ───────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = TimetableSlotSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }

    const {
      sectionId,
      dayId,
      timeSlotId,
      subjectId,
      teacherId,
      roomId,
      isLab,
      isGames,
      isYoga,
      isLibrary,
      isInnovation,
      isWE,
      manuallyEdited,
      notes,
    } = parsed.data;

    // Period 1 must not be lab, library, games, yoga, or W.E. (Music/Dance/Art)
    if (isLab || isGames || isYoga || isLibrary || isWE) {
      const timeSlot = await db.timeSlot.findUnique({ where: { id: timeSlotId } });
      if (timeSlot?.periodNumber === 1) {
        return NextResponse.json(
          { error: 'Period 1 cannot be a lab, library, games, yoga, or W.E. period' },
          { status: 400 }
        );
      }
    }

    // W.E. and Games allow multiple sections to share the same teacher at the same slot.
    // Only enforce teacher conflicts for regular subjects.
    const isSharedSlot = isWE || isGames || isYoga;
    if (teacherId && !isSharedSlot) {
      const conflict = await db.timetableSlot.findFirst({
        where: { teacherId, dayId, timeSlotId, NOT: { sectionId } },
      });
      if (conflict) {
        return NextResponse.json(
          { error: 'Teacher already assigned to another class at this time' },
          { status: 400 }
        );
      }
    }

    const slot = await db.timetableSlot.upsert({
      where: { sectionId_dayId_timeSlotId: { sectionId, dayId, timeSlotId } },
      update: { subjectId, teacherId, roomId, isLab, isInnovation, isGames, isYoga, isLibrary, isWE, manuallyEdited, notes },
      create: { sectionId, dayId, timeSlotId, subjectId, teacherId, roomId, isLab, isInnovation, isGames, isYoga, isLibrary, isWE, manuallyEdited, notes },
      include: { day: true, timeSlot: true, subject: true, teacher: true, section: true, room: true },
    });

    return NextResponse.json({ slot });
  } catch {
    return NextResponse.json({ error: 'Failed to save slot' }, { status: 500 });
  }
}

// ── DELETE ─────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slotId = searchParams.get('id');

    if (!slotId || typeof slotId !== 'string' || slotId.length > 128) {
      return NextResponse.json({ error: 'Valid slot ID is required' }, { status: 400 });
    }

    await db.timetableSlot.delete({ where: { id: slotId } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete slot' }, { status: 500 });
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
