import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeDateOnly } from '@/lib/substitute';
import { removeSubstituteNoteEntry } from '@/lib/substitute-note';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teacherId = searchParams.get('teacherId') ?? undefined;
    const dateRaw = searchParams.get('date');
    const date = dateRaw ? normalizeDateOnly(dateRaw) : undefined;

    const absences = await db.teacherAbsence.findMany({
      where: {
        ...(teacherId ? { teacherId } : {}),
        ...(date ? { date } : {}),
      },
      include: {
        teacher: { select: { id: true, name: true, abbreviation: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json({ success: true, absences });
  } catch (error) {
    console.error('[teacher-absence] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch absences' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body?.teacherId || !body?.date) {
      return NextResponse.json({ success: false, error: 'teacherId and date are required' }, { status: 400 });
    }
    if (typeof body.teacherId !== 'string' || body.teacherId.length > 128) {
      return NextResponse.json({ success: false, error: 'Invalid teacherId' }, { status: 400 });
    }
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(body.date)) {
      return NextResponse.json({ success: false, error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    const date = normalizeDateOnly(body.date);
    const absence = await db.teacherAbsence.upsert({
      where: { teacherId_date: { teacherId: body.teacherId, date } },
      update: { reason: body.reason ?? null },
      create: { teacherId: body.teacherId, date, reason: body.reason ?? null },
      include: { teacher: { select: { id: true, name: true, abbreviation: true } } },
    });
    return NextResponse.json({ success: true, absence });
  } catch (error) {
    console.error('[teacher-absence] POST failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to create absence' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || id.length > 128) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }
    const absence = await db.teacherAbsence.findUnique({ where: { id } });
    if (!absence) {
      return NextResponse.json({ success: false, error: 'Absence not found' }, { status: 404 });
    }

    const normalized = normalizeDateOnly(absence.date);
    const dateKey = [
      normalized.getFullYear(),
      String(normalized.getMonth() + 1).padStart(2, '0'),
      String(normalized.getDate()).padStart(2, '0'),
    ].join('-');
    const day = await db.day.findUnique({
      where: { name: normalized.toLocaleDateString('en-US', { weekday: 'long' }) },
    });

    await db.$transaction(async (tx) => {
      if (day) {
        const slots = await tx.timetableSlot.findMany({
          where: {
            dayId: day.id,
            notes: { not: null },
          },
          select: { id: true, notes: true },
        });

        for (const slot of slots) {
          const nextNotes = removeSubstituteNoteEntry(slot.notes, dateKey, absence.teacherId);
          if (nextNotes !== (slot.notes ?? '')) {
            await tx.timetableSlot.update({
              where: { id: slot.id },
              data: { notes: nextNotes || null },
            });
          }
        }
      }

      await tx.teacherAbsence.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[teacher-absence] DELETE failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete absence' }, { status: 500 });
  }
}
