import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { TimetableSlotSchema, validationError } from '@/lib/validation';
import { sortSectionsByGradeThenName } from '@/lib/section-sort';
import {
  assertPrimaryTeacherEligibility,
  assertTeacherAvailableForSectionSubjectSlots,
  syncPrimaryTeacherForSectionSubject,
} from '@/lib/section-subject-sync';

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
        include: { day: true, timeSlot: true, subject: true, teacher: true, labTeacher: true, room: true },
        orderBy: [{ day: { dayOrder: 'asc' } }, { timeSlot: { periodNumber: 'asc' } }],
      });
      return NextResponse.json({ slots });
    }

    if (type === 'teacher' && id) {
      const slots = await db.timetableSlot.findMany({
        where: {
          OR: [
            { teacherId: id },
            { labTeacherId: id },
          ],
        },
        include: { day: true, timeSlot: true, subject: true, teacher: true, labTeacher: true, section: true, room: true },
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
        include: { day: true, timeSlot: true, subject: true, teacher: true, labTeacher: true, section: true, room: true },
      }),
    ]);

    const sections = sortSectionsByGradeThenName(sectionsRaw);
    const teacherWorkloadMap = buildTeacherWorkloadMap(slots);

    return NextResponse.json({
      sections,
      teachers: teachers.map(t => ({
        ...t,
        teachableGrades: parseGrades(t.teachableGrades),
        currentWorkload: teacherWorkloadMap.get(t.id) ?? 0,
      })),
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
      labTeacherId,
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
    const resolvedLabTeacherId = subjectId && teacherId ? labTeacherId ?? null : null;

    if (teacherId && !subjectId) {
      return NextResponse.json({ error: 'Subject is required when assigning a teacher' }, { status: 400 });
    }

    if (teacherId && subjectId) {
      await assertPrimaryTeacherEligibility(db, sectionId, subjectId, teacherId);
      await assertTeacherAvailableForSectionSubjectSlots(db, {
        sectionId,
        subjectId,
        teacherId,
        extraSlot: { dayId, timeSlotId, isWE, isGames, isYoga },
      });
      if (resolvedLabTeacherId && resolvedLabTeacherId !== teacherId) {
        await assertTeacherAvailableForSectionSubjectSlots(db, {
          sectionId,
          subjectId,
          teacherId: resolvedLabTeacherId,
          extraSlot: { dayId, timeSlotId, isWE, isGames, isYoga },
        });
      }
    }

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

    const result = await db.$transaction(async (tx) => {
      await tx.timetableSlot.upsert({
        where: { sectionId_dayId_timeSlotId: { sectionId, dayId, timeSlotId } },
        update: { subjectId, teacherId, labTeacherId: resolvedLabTeacherId, roomId, isLab, isInnovation, isGames, isYoga, isLibrary, isWE, manuallyEdited, notes },
        create: { sectionId, dayId, timeSlotId, subjectId, teacherId, labTeacherId: resolvedLabTeacherId, roomId, isLab, isInnovation, isGames, isYoga, isLibrary, isWE, manuallyEdited, notes },
      });

      let syncedSlots = 0;
      if (teacherId && subjectId) {
        const syncResult = await syncPrimaryTeacherForSectionSubject(tx, {
          sectionId,
          subjectId,
          teacherId,
          syncTimetable: true,
        });
        syncedSlots = syncResult.syncedSlots;
      }

      const slot = await tx.timetableSlot.findUnique({
        where: { sectionId_dayId_timeSlotId: { sectionId, dayId, timeSlotId } },
        include: { day: true, timeSlot: true, subject: true, teacher: true, labTeacher: true, section: true, room: true },
      });

      return { slot, syncedSlots };
    });

    return NextResponse.json({
      slot: result.slot,
      syncedSlots: result.syncedSlots,
      message:
        result.syncedSlots > 1
          ? `Teacher updated across ${result.syncedSlots} ${result.syncedSlots === 1 ? 'slot' : 'slots'} for this section-subject`
          : 'Slot updated',
    });
  } catch (error: any) {
    const status =
      typeof error?.message === 'string' &&
      (error.message.includes('not eligible') ||
        error.message.includes('not found') ||
        error.message.includes('clash') ||
        error.message.includes('required'))
        ? 400
        : 500;
    return NextResponse.json({ error: error?.message || 'Failed to save slot' }, { status });
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

function buildTeacherWorkloadMap(
  slots: Array<{ teacherId: string | null; labTeacherId: string | null; dayId: string; timeSlotId: string }>
) {
  const teacherSlotKeys = new Map<string, Set<string>>();

  for (const slot of slots) {
    const key = `${slot.dayId}|${slot.timeSlotId}`;
    for (const teacherId of [slot.teacherId, slot.labTeacherId]) {
      if (!teacherId) continue;
      if (!teacherSlotKeys.has(teacherId)) {
        teacherSlotKeys.set(teacherId, new Set());
      }
      teacherSlotKeys.get(teacherId)!.add(key);
    }
  }

  return new Map(
    Array.from(teacherSlotKeys.entries()).map(([teacherId, slotKeys]) => [teacherId, slotKeys.size])
  );
}
