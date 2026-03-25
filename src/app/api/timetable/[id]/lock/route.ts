import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.timetableSlot.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Slot not found' }, { status: 404 });
    }

    const updated = await db.timetableSlot.update({
      where: { id },
      data: { manuallyEdited: !existing.manuallyEdited },
      include: { day: true, timeSlot: true, subject: true, teacher: true, section: true, room: true },
    });

    return NextResponse.json({ success: true, slot: updated });
  } catch (error) {
    console.error('[slot-lock] PATCH failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to toggle slot lock' }, { status: 500 });
  }
}
