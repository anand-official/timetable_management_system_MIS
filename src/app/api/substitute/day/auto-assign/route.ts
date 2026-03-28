import { NextRequest, NextResponse } from 'next/server';
import { autoAssignDailySubstitutes } from '@/lib/substitute';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const date = body?.date as string | undefined;
    const teacherIds = Array.isArray(body?.teacherIds)
      ? body.teacherIds.filter((item: unknown): item is string => typeof item === 'string' && item.length > 0)
      : undefined;

    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
      return NextResponse.json({ success: false, error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }

    const result = await autoAssignDailySubstitutes(date, teacherIds);
    const assigned = result.results.filter((row) => row.assigned).length;
    const failed = result.results.filter((row) => !row.assigned).length;

    return NextResponse.json({
      success: true,
      date: result.date,
      dayName: result.dayName,
      results: result.results,
      summary: {
        total: result.results.length,
        assigned,
        failed,
      },
    });
  } catch (error) {
    console.error('[substitute-day-auto-assign] failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to auto-assign daily substitutes' }, { status: 500 });
  }
}
