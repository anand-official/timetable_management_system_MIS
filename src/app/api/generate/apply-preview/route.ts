import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  assertPrimaryTeacherEligibility,
  assertTeacherAvailableForSectionSubjectSlots,
} from '@/lib/section-subject-sync';
import { validationError } from '@/lib/validation';

const cuid = z.string().min(1).max(128);

const ApplyPreviewRemoveChangeSchema = z.object({
  type: z.literal('remove'),
  sectionId: cuid,
  dayId: cuid,
  timeSlotId: cuid,
});

const ApplyPreviewUpsertChangeSchema = z.object({
  type: z.enum(['add', 'update']),
  sectionId: cuid,
  dayId: cuid,
  timeSlotId: cuid,
  subjectId: cuid,
  teacherId: cuid,
  labTeacherId: cuid.nullable().optional(),
  roomId: cuid.nullable().optional(),
  isLab: z.boolean().optional().default(false),
  isGames: z.boolean().optional().default(false),
  isYoga: z.boolean().optional().default(false),
  isLibrary: z.boolean().optional().default(false),
  isInnovation: z.boolean().optional().default(false),
  isWE: z.boolean().optional().default(false),
  isMusic: z.boolean().optional().default(false),
  isArt: z.boolean().optional().default(false),
});

const ApplyPreviewBodySchema = z.object({
  changes: z.array(z.union([ApplyPreviewRemoveChangeSchema, ApplyPreviewUpsertChangeSchema])).min(1).max(5000),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = ApplyPreviewBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }

    const { changes } = parsed.data;

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

        const [day, timeSlot] = await Promise.all([
          tx.day.findUnique({ where: { id: change.dayId }, select: { id: true } }),
          tx.timeSlot.findUnique({ where: { id: change.timeSlotId }, select: { id: true, periodNumber: true } }),
        ]);

        if (!day) throw new Error('Day not found');
        if (!timeSlot) throw new Error('Time slot not found');

        await assertPrimaryTeacherEligibility(tx, change.sectionId, change.subjectId, change.teacherId);
        await assertTeacherAvailableForSectionSubjectSlots(tx, {
          sectionId: change.sectionId,
          subjectId: change.subjectId,
          teacherId: change.teacherId,
          extraSlot: {
            dayId: change.dayId,
            timeSlotId: change.timeSlotId,
            isWE: change.isWE,
            isGames: change.isGames,
            isYoga: change.isYoga,
          },
        });
        if (change.labTeacherId && change.labTeacherId !== change.teacherId) {
          await assertTeacherAvailableForSectionSubjectSlots(tx, {
            sectionId: change.sectionId,
            subjectId: change.subjectId,
            teacherId: change.labTeacherId,
            extraSlot: {
              dayId: change.dayId,
              timeSlotId: change.timeSlotId,
              isWE: change.isWE,
              isGames: change.isGames,
              isYoga: change.isYoga,
            },
          });
        }

        if ((change.isLab || change.isGames || change.isYoga || change.isLibrary || change.isWE) && timeSlot.periodNumber === 1) {
          throw new Error('Period 1 cannot be a lab, library, games, yoga, or W.E. period');
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
            labTeacherId: change.labTeacherId ?? null,
            roomId: change.roomId ?? null,
            isLab: change.isLab ?? false,
            isGames: change.isGames ?? false,
            isYoga: change.isYoga ?? false,
            isLibrary: change.isLibrary ?? false,
            isInnovation: change.isInnovation ?? false,
            isWE: change.isWE ?? false,
            isMusic: change.isMusic ?? false,
            isArt: change.isArt ?? false,
            manuallyEdited: true,
          },
          create: {
            sectionId: change.sectionId,
            dayId: change.dayId,
            timeSlotId: change.timeSlotId,
            subjectId: change.subjectId,
            teacherId: change.teacherId,
            labTeacherId: change.labTeacherId ?? null,
            roomId: change.roomId ?? null,
            isLab: change.isLab ?? false,
            isGames: change.isGames ?? false,
            isYoga: change.isYoga ?? false,
            isLibrary: change.isLibrary ?? false,
            isInnovation: change.isInnovation ?? false,
            isWE: change.isWE ?? false,
            isMusic: change.isMusic ?? false,
            isArt: change.isArt ?? false,
            manuallyEdited: true,
          },
        });
      }
    });

    return NextResponse.json({ success: true, applied: changes.length });
  } catch (error: any) {
    console.error('[apply-preview] failed:', error);
    const status =
      typeof error?.message === 'string' &&
      (
        error.message.includes('not eligible') ||
        error.message.includes('not found') ||
        error.message.includes('clash') ||
        error.message.includes('required') ||
        error.message.includes('cannot be')
      )
        ? 400
        : 500;
    return NextResponse.json({ success: false, error: error?.message || 'Failed to apply preview changes' }, { status });
  }
}
