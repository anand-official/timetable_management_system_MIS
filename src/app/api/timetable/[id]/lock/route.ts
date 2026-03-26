import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const sectionId = typeof body?.sectionId === 'string' ? body.sectionId : null;
    const dayId = typeof body?.dayId === 'string' ? body.dayId : null;
    const timeSlotId = typeof body?.timeSlotId === 'string' ? body.timeSlotId : null;

    let existing =
      id && id !== 'undefined' && id !== 'null'
        ? await db.timetableSlot.findUnique({ where: { id } })
        : null;

    if (!existing && sectionId && dayId && timeSlotId) {
      existing = await db.timetableSlot.findUnique({
        where: { sectionId_dayId_timeSlotId: { sectionId, dayId, timeSlotId } },
      });
    }

    if (!existing) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 });
    }

    const result = await db.$transaction(async (tx) => {
      const toggled = await tx.timetableSlot.updateMany({
        where: { id: existing.id, manuallyEdited: existing.manuallyEdited },
        data: { manuallyEdited: !existing.manuallyEdited },
      });

      const slot = await tx.timetableSlot.findUnique({
        where: { id: existing.id },
        include: { day: true, timeSlot: true, subject: true, teacher: true, section: true, room: true },
      });

      return {
        slot,
        stale: toggled.count === 0,
      };
    });

    if (!result.slot) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 });
    }
    if (result.stale) {
      return NextResponse.json({ success: false, error: 'Slot lock state changed, please retry', slot: result.slot }, { status: 409 });
    }

    return NextResponse.json({ success: true, slot: result.slot });
  } catch (error) {
    console.error('[slot-lock] PATCH failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to toggle slot lock' }, { status: 500 });
  }
}
