import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildTeacherGrid } from '@/lib/export/timetable-grid';
import { generateTimetablePdf } from '@/lib/export/timetable-pdf';
import { generateTimetableXlsx } from '@/lib/export/timetable-xlsx';
import { slotHasTeacherId } from '@/lib/combined-slot';
import {
  buildCsv,
  buildSafeTimetableName,
  getSlotDisplayFields,
  schoolSubtitle,
} from '@/lib/export/timetable-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teacherId: string }> }
) {
  const { teacherId } = await params;
  const format = request.nextUrl.searchParams.get('format') ?? 'pdf';

  if (!['pdf', 'xlsx', 'csv'].includes(format)) {
    return NextResponse.json({ error: 'format must be pdf, xlsx, or csv' }, { status: 400 });
  }

  if (!teacherId || teacherId.length > 128) {
    return NextResponse.json({ error: 'Invalid teacher ID' }, { status: 400 });
  }

  // ── Load data ───────────────────────────────────────────────────────────────
  const [teacher, slots, days, timeSlots, schoolConfig] = await Promise.all([
    db.teacher.findUnique({ where: { id: teacherId } }),
    db.timetableSlot.findMany({
      include: {
        day: true,
        timeSlot: true,
        subject: true,
        teacher: true,
        labTeacher: true,
        room: true,
        section: { include: { grade: true, classTeacher: true } },
      },
      orderBy: [{ day: { dayOrder: 'asc' } }, { timeSlot: { periodNumber: 'asc' } }],
    }),
    db.day.findMany({ orderBy: { dayOrder: 'asc' } }),
    db.timeSlot.findMany({ orderBy: { periodNumber: 'asc' } }),
    db.schoolConfig.findFirst(),
  ]);

  if (!teacher) {
    return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
  }

  // ── Build grid ──────────────────────────────────────────────────────────────
  const grid = buildTeacherGrid(
    teacher.name,
    teacher.abbreviation,
    teacherId,
    slots.filter((slot) => slotHasTeacherId(slot, teacherId)),
    days,
    timeSlots
  );
  grid.subtitle = schoolSubtitle(schoolConfig?.schoolName ?? null, schoolConfig?.academicYear ?? null);

  // ── Generate file ───────────────────────────────────────────────────────────
  const safeName = buildSafeTimetableName(teacher.abbreviation, 'teacher');
  const teacherSlots = slots.filter((slot) => slotHasTeacherId(slot, teacherId));

  try {
    if (format === 'csv') {
      const rows = teacherSlots.map((slot) => {
        const displayFields = getSlotDisplayFields(slot, teacherId);
        return [
          teacher.name,
          teacher.abbreviation,
          teacher.department,
          slot.day.name,
          displayFields.period,
          displayFields.startTime,
          displayFields.endTime,
          displayFields.timeRange,
          slot.section?.name ?? '',
          displayFields.grade,
          displayFields.subject,
          displayFields.subjectCode,
          displayFields.room,
          displayFields.slotType,
          displayFields.notes,
        ];
      });

      return new NextResponse(
        buildCsv(
          [
            'Teacher',
            'Teacher Abbreviation',
            'Department',
            'Day',
            'Period',
            'Start Time',
            'End Time',
            'Time Range',
            'Section',
            'Grade',
            'Subject',
            'Subject Code',
            'Room',
            'Slot Type',
            'Notes',
          ],
          rows
        ),
        {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="timetable_${safeName}.csv"`,
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    if (format === 'xlsx') {
      const buffer = await generateTimetableXlsx(grid);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="timetable_${safeName}.xlsx"`,
          'Cache-Control':       'no-store',
        },
      });
    }

    const buffer = await generateTimetablePdf(grid);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="timetable_${safeName}.pdf"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (err) {
    console.error('[export/teacher]', err);
    const detail =
      process.env.NODE_ENV === 'development' && err instanceof Error ? err.message : undefined;
    return NextResponse.json({ error: 'Export failed', detail }, { status: 500 });
  }
}
