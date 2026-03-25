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
        }
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
    let settings = await db.schoolConfig.findFirst();

    if (settings) {
      settings = await db.schoolConfig.update({
        where: { id: settings.id },
        data: {
          fillEmptySlots: data.fillEmptySlots ?? settings.fillEmptySlots,
          allowDuplicateActivities: data.allowDuplicateActivities ?? settings.allowDuplicateActivities,
          studyPeriodTeacherPool: data.studyPeriodTeacherPool ?? settings.studyPeriodTeacherPool,
        }
      });
    } else {
      settings = await db.schoolConfig.create({
        data: {
          fillEmptySlots: data.fillEmptySlots ?? true,
          allowDuplicateActivities: data.allowDuplicateActivities ?? true,
          studyPeriodTeacherPool: data.studyPeriodTeacherPool ?? "[]",
        }
      });
    }

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ success: false, error: 'Failed to update settings' }, { status: 500 });
  }
}
