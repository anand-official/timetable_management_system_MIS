import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST() {
  try {
    const result = await db.timetableSlot.updateMany({
      where: { manuallyEdited: true },
      data: { manuallyEdited: false },
    });
    return NextResponse.json({ success: true, unlocked: result.count });
  } catch (error) {
    console.error('[slot-lock] unlock-all failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to unlock slots' }, { status: 500 });
  }
}
