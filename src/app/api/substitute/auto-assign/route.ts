import { NextRequest, NextResponse } from 'next/server';
import { autoAssignSubstitutes } from '@/lib/substitute';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const teacherId = body?.teacherId as string | undefined;
    const date = body?.date as string | undefined;

    if (!teacherId || !date) {
      return NextResponse.json(
        { success: false, error: 'teacherId and date are required' },
        { status: 400 }
      );
    }

    const result = await autoAssignSubstitutes(teacherId, date);
    const assigned = result.results.filter(r => r.assigned !== null).length;
    const failed = result.results.filter(r => r.assigned === null).length;

    return NextResponse.json({
      success: true,
      dayName: result.dayName,
      date: result.date,
      results: result.results,
      summary: { total: result.results.length, assigned, failed },
    });
  } catch (error) {
    console.error('[substitute-auto-assign] failed:', error);
    return NextResponse.json(
      { success: false, error: 'Auto-assign failed' },
      { status: 500 }
    );
  }
}
