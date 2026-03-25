import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    let settings = await db.schoolConfig.findFirst();
    if (!settings) {
      settings = await db.schoolConfig.create({
        data: {
          fillEmptySlots: true,
          allowDuplicateActivities: true,
          studyPeriodTeacherPool: "[]"
        } as any
      });
    }
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const payload = data as {
      fillEmptySlots?: boolean;
      allowDuplicateActivities?: boolean;
      studyPeriodTeacherPool?: string;
    };
    let settings = await db.schoolConfig.findFirst();

    if (settings) {
      settings = await db.schoolConfig.update({
        where: { id: settings.id },
        data: {
          fillEmptySlots: payload.fillEmptySlots ?? (settings as any).fillEmptySlots,
          allowDuplicateActivities: payload.allowDuplicateActivities ?? (settings as any).allowDuplicateActivities,
          studyPeriodTeacherPool: payload.studyPeriodTeacherPool ?? (settings as any).studyPeriodTeacherPool,
        } as any
      });
    } else {
      settings = await db.schoolConfig.create({
        data: {
          fillEmptySlots: payload.fillEmptySlots ?? true,
          allowDuplicateActivities: payload.allowDuplicateActivities ?? true,
          studyPeriodTeacherPool: payload.studyPeriodTeacherPool ?? "[]",
        } as any
      });
    }

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ success: false, error: 'Failed to update settings' }, { status: 500 });
  }
}
