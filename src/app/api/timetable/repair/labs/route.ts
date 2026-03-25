import { NextResponse } from 'next/server';
import { repairLabSplits } from '@/lib/lab-audit';

export async function POST() {
  try {
    const result = await repairLabSplits();
    return NextResponse.json({
      success: true,
      ...result,
      message:
        result.repaired > 0
          ? `Repaired ${result.repaired} split lab period(s)`
          : 'No split lab sessions could be repaired',
    });
  } catch (error) {
    console.error('[lab-repair] failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to repair split labs' },
      { status: 500 }
    );
  }
}
