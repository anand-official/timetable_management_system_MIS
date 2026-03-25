import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const conflictGroups = await db.timetableSlot.groupBy({
      by: ['roomId', 'dayId', 'timeSlotId'],
      _count: { id: true },
      where: { roomId: { not: null } },
      having: { id: { _count: { gt: 1 } } },
    });

    const detailed = await Promise.all(
      conflictGroups.map(async (group) => {
        const slots = await db.timetableSlot.findMany({
          where: {
            roomId: group.roomId,
            dayId: group.dayId,
            timeSlotId: group.timeSlotId,
          },
          include: {
            room: true,
            day: true,
            timeSlot: true,
            section: true,
            subject: true,
            teacher: true,
          },
        });

        return {
          roomId: group.roomId,
          roomName: slots[0]?.room?.name ?? 'Unknown Room',
          dayId: group.dayId,
          dayName: slots[0]?.day?.name ?? '',
          timeSlotId: group.timeSlotId,
          periodNumber: slots[0]?.timeSlot?.periodNumber ?? null,
          count: group._count.id,
          slots: slots.map((s) => ({
            slotId: s.id,
            sectionName: s.section.name,
            subjectName: s.subject?.name ?? '',
            teacherAbbreviation: s.teacher?.abbreviation ?? '',
          })),
        };
      })
    );

    return NextResponse.json({
      success: true,
      count: detailed.length,
      conflicts: detailed,
    });
  } catch (error) {
    console.error('[room-audit] failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to audit room conflicts' },
      { status: 500 }
    );
  }
}
