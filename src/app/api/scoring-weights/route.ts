import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEFAULT_WEIGHTS = {
  name: 'default',
  subjectPreferenceWeight: 2.0,
  teacherDailyLoadWeight: 1.5,
  sectionDailyLoadWeight: 1.0,
  subjectSpreadWeight: 1.5,
  teacherAdjacencyPenaltyWeight: 1.2,
  labLastPeriodPenaltyWeight: 1.0,
  classTeacherBonusWeight: 0.8,
  roomAvailabilityWeight: 1.0,
  labPlacementWeight: 2.0,
};

export async function GET() {
  try {
    let weights = await db.scoringWeights.findUnique({ where: { name: 'default' } });
    if (!weights) {
      weights = await db.scoringWeights.create({ data: DEFAULT_WEIGHTS });
    }
    return NextResponse.json({ success: true, weights });
  } catch (error) {
    console.error('[scoring-weights] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to load scoring weights' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const toNum = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;

    const weights = await db.scoringWeights.upsert({
      where: { name: 'default' },
      update: {
        subjectPreferenceWeight: toNum(body.subjectPreferenceWeight, DEFAULT_WEIGHTS.subjectPreferenceWeight),
        teacherDailyLoadWeight: toNum(body.teacherDailyLoadWeight, DEFAULT_WEIGHTS.teacherDailyLoadWeight),
        sectionDailyLoadWeight: toNum(body.sectionDailyLoadWeight, DEFAULT_WEIGHTS.sectionDailyLoadWeight),
        subjectSpreadWeight: toNum(body.subjectSpreadWeight, DEFAULT_WEIGHTS.subjectSpreadWeight),
        teacherAdjacencyPenaltyWeight: toNum(body.teacherAdjacencyPenaltyWeight, DEFAULT_WEIGHTS.teacherAdjacencyPenaltyWeight),
        labLastPeriodPenaltyWeight: toNum(body.labLastPeriodPenaltyWeight, DEFAULT_WEIGHTS.labLastPeriodPenaltyWeight),
        classTeacherBonusWeight: toNum(body.classTeacherBonusWeight, DEFAULT_WEIGHTS.classTeacherBonusWeight),
        roomAvailabilityWeight: toNum(body.roomAvailabilityWeight, DEFAULT_WEIGHTS.roomAvailabilityWeight),
        labPlacementWeight: toNum(body.labPlacementWeight, DEFAULT_WEIGHTS.labPlacementWeight),
      },
      create: {
        ...DEFAULT_WEIGHTS,
        subjectPreferenceWeight: toNum(body.subjectPreferenceWeight, DEFAULT_WEIGHTS.subjectPreferenceWeight),
        teacherDailyLoadWeight: toNum(body.teacherDailyLoadWeight, DEFAULT_WEIGHTS.teacherDailyLoadWeight),
        sectionDailyLoadWeight: toNum(body.sectionDailyLoadWeight, DEFAULT_WEIGHTS.sectionDailyLoadWeight),
        subjectSpreadWeight: toNum(body.subjectSpreadWeight, DEFAULT_WEIGHTS.subjectSpreadWeight),
        teacherAdjacencyPenaltyWeight: toNum(body.teacherAdjacencyPenaltyWeight, DEFAULT_WEIGHTS.teacherAdjacencyPenaltyWeight),
        labLastPeriodPenaltyWeight: toNum(body.labLastPeriodPenaltyWeight, DEFAULT_WEIGHTS.labLastPeriodPenaltyWeight),
        classTeacherBonusWeight: toNum(body.classTeacherBonusWeight, DEFAULT_WEIGHTS.classTeacherBonusWeight),
        roomAvailabilityWeight: toNum(body.roomAvailabilityWeight, DEFAULT_WEIGHTS.roomAvailabilityWeight),
        labPlacementWeight: toNum(body.labPlacementWeight, DEFAULT_WEIGHTS.labPlacementWeight),
      },
    });
    return NextResponse.json({ success: true, weights });
  } catch (error) {
    console.error('[scoring-weights] PUT failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to update scoring weights' }, { status: 500 });
  }
}
