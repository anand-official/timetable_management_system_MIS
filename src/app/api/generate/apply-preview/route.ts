import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

type ApplyChange =
  | { type: 'remove'; sectionId: string; dayId: string; timeSlotId: string }
  | {
      type: 'add' | 'update';
      sectionId: string;
      dayId: string;
      timeSlotId: string;
      subjectId: string;
      teacherId: string;
      roomId?: string | null;
      isLab?: boolean;
      isGames?: boolean;
      isYoga?: boolean;
      isLibrary?: boolean;
      isInnovation?: boolean;
      isWE?: boolean;
      isMusic?: boolean;
      isArt?: boolean;
    };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const changes: ApplyChange[] = Array.isArray(body?.changes) ? body.changes : [];
    if (changes.length === 0) {
      return NextResponse.json({ success: false, error: 'No changes provided' }, { status: 400 });
    }

    await db.$transaction(async (tx) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          await tx.timetableSlot.deleteMany({
            where: {
              sectionId: change.sectionId,
              dayId: change.dayId,
              timeSlotId: change.timeSlotId,
            },
          });
          continue;
        }

        await tx.timetableSlot.upsert({
          where: {
            sectionId_dayId_timeSlotId: {
              sectionId: change.sectionId,
              dayId: change.dayId,
              timeSlotId: change.timeSlotId,
            },
          },
          update: {
            subjectId: change.subjectId,
            teacherId: change.teacherId,
            roomId: change.roomId ?? null,
            isLab: !!change.isLab,
            isGames: !!change.isGames,
            isYoga: !!change.isYoga,
            isLibrary: !!change.isLibrary,
            isInnovation: !!change.isInnovation,
            isWE: !!change.isWE,
            isMusic: !!change.isMusic,
            isArt: !!change.isArt,
            manuallyEdited: true,
          },
          create: {
            sectionId: change.sectionId,
            dayId: change.dayId,
            timeSlotId: change.timeSlotId,
            subjectId: change.subjectId,
            teacherId: change.teacherId,
            roomId: change.roomId ?? null,
            isLab: !!change.isLab,
            isGames: !!change.isGames,
            isYoga: !!change.isYoga,
            isLibrary: !!change.isLibrary,
            isInnovation: !!change.isInnovation,
            isWE: !!change.isWE,
            isMusic: !!change.isMusic,
            isArt: !!change.isArt,
            manuallyEdited: true,
          },
        });
      }
    });

    return NextResponse.json({ success: true, applied: changes.length });
  } catch (error) {
    console.error('[apply-preview] failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to apply preview changes' }, { status: 500 });
  }
}
