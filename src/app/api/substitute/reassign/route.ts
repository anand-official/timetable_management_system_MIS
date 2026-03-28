import { NextRequest, NextResponse } from 'next/server';
import { assignSubstituteToSlot } from '@/lib/substitute';

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

    if (!markAbsentTeacherId || !date) {
      return NextResponse.json(
        { success: false, error: 'markAbsentTeacherId and date are required' },
        { status: 400 }
      );
    }

    const updated = await assignSubstituteToSlot({
      slotId,
      absentTeacherId: markAbsentTeacherId,
      substituteTeacherId,
      date,
      mode: 'manual',
    });

    return NextResponse.json({ success: true, slot: updated.slot, assigned: updated.assigned });
  } catch (error) {
    console.error('[substitute-reassign] failed:', error);
    const status =
      typeof (error as Error)?.message === 'string' &&
      (
        (error as Error).message.includes('not found') ||
        (error as Error).message.includes('already booked') ||
        (error as Error).message.includes('already reassigned') ||
        (error as Error).message.includes('teach this subject') ||
        (error as Error).message.includes('does not match') ||
        (error as Error).message.includes('not assigned to this slot') ||
        (error as Error).message.includes('substitute periods today')
      )
        ? 400
        : 500;
    return NextResponse.json({ success: false, error: (error as Error)?.message || 'Failed to reassign slot' }, { status });
  }
}
