import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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

    const hasSubjectMapping = await db.teacherSubject.findFirst({
      where: { teacherId: substituteTeacherId, subjectId: slot.subjectId ?? undefined },
    });
    if (!hasSubjectMapping) {
      return NextResponse.json({ success: false, error: 'Substitute teacher does not teach this subject' }, { status: 400 });
    }

    const busyConflict = await db.timetableSlot.findFirst({
      where: {
        teacherId: substituteTeacherId,
        dayId: slot.dayId,
        timeSlotId: slot.timeSlotId,
        NOT: { id: slot.id },
      },
    });
    if (busyConflict) {
      return NextResponse.json({ success: false, error: 'Substitute teacher is already booked in this period' }, { status: 400 });
    }

    const updated = await db.timetableSlot.update({
      where: { id: slotId },
      data: {
        teacherId: substituteTeacherId,
        manuallyEdited: true,
        notes: slot.notes ? `${slot.notes}\nSubstituted` : 'Substituted',
      },
      include: { day: true, timeSlot: true, subject: true, teacher: true, section: true, room: true },
    });

    if (markAbsentTeacherId && date) {
      const d = new Date(date);
      const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      await db.teacherAbsence.upsert({
        where: { teacherId_date: { teacherId: markAbsentTeacherId, date: dateOnly } },
        update: {},
        create: { teacherId: markAbsentTeacherId, date: dateOnly },
      });
    }

    return NextResponse.json({ success: true, slot: updated });
  } catch (error) {
    console.error('[substitute-reassign] failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to reassign slot' }, { status: 500 });
  }
}
