import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeDateOnly } from '@/lib/substitute';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slotId = body?.slotId as string | undefined;
    const substituteTeacherId = body?.substituteTeacherId as string | undefined;
    const markAbsentTeacherId = body?.markAbsentTeacherId as string | undefined;
    const date = body?.date as string | undefined;

    if (!slotId || !substituteTeacherId) {
      return NextResponse.json({ success: false, error: 'slotId and substituteTeacherId are required' }, { status: 400 });
    }

    const slot = await db.timetableSlot.findUnique({
      where: { id: slotId },
      include: { subject: true, day: true, timeSlot: true },
    });
    if (!slot) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 });
    }
    if (!slot.subjectId) {
      return NextResponse.json({ success: false, error: 'Cannot reassign a slot without a subject' }, { status: 400 });
    }

    const hasSubjectMapping = await db.teacherSubject.findFirst({
      where: { teacherId: substituteTeacherId, subjectId: slot.subjectId },
    });
    if (!hasSubjectMapping) {
      return NextResponse.json({ success: false, error: 'Substitute teacher does not teach this subject' }, { status: 400 });
    }

    const updated = await db.$transaction(async (tx) => {
      const currentSlot = await tx.timetableSlot.findUnique({
        where: { id: slotId },
        select: { id: true, teacherId: true, notes: true, dayId: true, timeSlotId: true },
      });

      if (!currentSlot) throw new Error('Slot not found');
      if (markAbsentTeacherId && currentSlot.teacherId !== markAbsentTeacherId) {
        throw new Error('Slot was already reassigned');
      }

      const busyConflict = await tx.timetableSlot.findFirst({
        where: {
          OR: [
            { teacherId: substituteTeacherId },
            { labTeacherId: substituteTeacherId },
          ],
          dayId: currentSlot.dayId,
          timeSlotId: currentSlot.timeSlotId,
          NOT: { id: currentSlot.id },
        },
        select: { id: true },
      });
      if (busyConflict) {
        throw new Error('Substitute teacher is already booked in this period');
      }

      const saved = await tx.timetableSlot.update({
        where: { id: slotId },
        data: {
          teacherId: substituteTeacherId,
          manuallyEdited: true,
          notes: currentSlot.notes ? `${currentSlot.notes}\nSubstituted` : 'Substituted',
        },
        include: { day: true, timeSlot: true, subject: true, teacher: true, section: true, room: true },
      });

      if (markAbsentTeacherId && date) {
        const dateOnly = normalizeDateOnly(date);
        await tx.teacherAbsence.upsert({
          where: { teacherId_date: { teacherId: markAbsentTeacherId, date: dateOnly } },
          update: {},
          create: { teacherId: markAbsentTeacherId, date: dateOnly },
        });
      }

      return saved;
    });

    return NextResponse.json({ success: true, slot: updated });
  } catch (error) {
    console.error('[substitute-reassign] failed:', error);
    const status =
      typeof (error as Error)?.message === 'string' &&
      (
        (error as Error).message.includes('not found') ||
        (error as Error).message.includes('already booked') ||
        (error as Error).message.includes('already reassigned')
      )
        ? 400
        : 500;
    return NextResponse.json({ success: false, error: (error as Error)?.message || 'Failed to reassign slot' }, { status });
  }
}
