import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  TeacherUnavailabilityCreateSchema,
  TeacherUnavailabilityUpdateSchema,
  validationError,
} from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teacherId = searchParams.get('teacherId') ?? undefined;

    const records = await db.teacherUnavailability.findMany({
      where: teacherId ? { teacherId } : undefined,
      include: {
        teacher: { select: { id: true, name: true, abbreviation: true } },
        day: true,
        timeSlot: true,
      },
      orderBy: [{ day: { dayOrder: 'asc' } }, { timeSlot: { periodNumber: 'asc' } }],
    });

    return NextResponse.json({ success: true, records });
  } catch (error) {
    console.error('[teacher-unavailability] GET failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch teacher unavailability' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = TeacherUnavailabilityCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }

    const { teacherId, dayId, timeSlotId, reason } = parsed.data;
    const created = await db.teacherUnavailability.upsert({
      where: { teacherId_dayId_timeSlotId: { teacherId, dayId, timeSlotId } },
      update: { reason },
      create: { teacherId, dayId, timeSlotId, reason },
      include: {
        teacher: { select: { id: true, name: true, abbreviation: true } },
        day: true,
        timeSlot: true,
      },
    });

    return NextResponse.json({ success: true, record: created });
  } catch (error) {
    console.error('[teacher-unavailability] POST failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create teacher unavailability' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = TeacherUnavailabilityUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }

    const { id, dayId, timeSlotId, reason } = parsed.data;
    const updated = await db.teacherUnavailability.update({
      where: { id },
      data: {
        ...(dayId ? { dayId } : {}),
        ...(timeSlotId ? { timeSlotId } : {}),
        ...(reason !== undefined ? { reason } : {}),
      },
      include: {
        teacher: { select: { id: true, name: true, abbreviation: true } },
        day: true,
        timeSlot: true,
      },
    });

    return NextResponse.json({ success: true, record: updated });
  } catch (error) {
    console.error('[teacher-unavailability] PUT failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update teacher unavailability' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    // deleteMany avoids P2025 "record not found" errors on double-click / stale state
    await db.teacherUnavailability.deleteMany({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[teacher-unavailability] DELETE failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete teacher unavailability' },
      { status: 500 }
    );
  }
}
