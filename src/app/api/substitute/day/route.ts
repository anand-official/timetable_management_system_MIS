import { NextRequest, NextResponse } from 'next/server';
import { getDailySubstitutePlan } from '@/lib/substitute';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
      return NextResponse.json({ success: false, error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }

    const plan = await getDailySubstitutePlan(date);
    return NextResponse.json({
      success: true,
      date: plan.date,
      dayName: plan.dayName,
      absences: plan.absences,
      summary: {
        absentTeachers: plan.absences.length,
        totalSlots: plan.absences.reduce((sum, absence) => sum + absence.slots.length, 0),
        assignedSlots: plan.absences.reduce(
          (sum, absence) => sum + absence.slots.filter((slot) => slot.assignedSubstitute).length,
          0
        ),
      },
    });
  } catch (error) {
    console.error('[substitute-day] failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to load daily substitute plan' }, { status: 500 });
  }
}
