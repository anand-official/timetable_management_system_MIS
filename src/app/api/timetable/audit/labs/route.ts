import { NextResponse } from 'next/server';
import { auditLabSplits } from '@/lib/lab-audit';

export async function GET() {
  try {
    const splits = await auditLabSplits();
    return NextResponse.json({
      success: true,
      count: splits.length,
      splitLabSessions: splits.map((s) => ({
        sectionId: s.sectionId,
        sectionName: s.sectionName,
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        dayId: s.dayId,
        dayName: s.dayName,
        periodNumbers: s.periodNumbers,
        unpairedPeriodNumbers: s.unpairedPeriodNumbers,
      })),
    });
  } catch (error) {
    console.error('[lab-audit] failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to audit lab splits' },
      { status: 500 }
    );
  }
}
