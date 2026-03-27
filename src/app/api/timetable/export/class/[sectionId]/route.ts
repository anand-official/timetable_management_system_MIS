import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildClassGrid } from '@/lib/export/timetable-grid';
import { generateTimetablePdf } from '@/lib/export/timetable-pdf';
import { generateTimetableXlsx } from '@/lib/export/timetable-xlsx';
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
  { params }: { params: Promise<{ sectionId: string }> }
) {
  const { sectionId } = await params;
  const format = request.nextUrl.searchParams.get('format') ?? 'pdf';

  if (!['pdf', 'xlsx', 'csv'].includes(format)) {
    return NextResponse.json({ error: 'format must be pdf, xlsx, or csv' }, { status: 400 });
  }

  if (!sectionId || sectionId.length > 128) {
    return NextResponse.json({ error: 'Invalid section ID' }, { status: 400 });
  }

  // ── Load data ───────────────────────────────────────────────────────────────
  const [section, slots, days, timeSlots, schoolConfig] = await Promise.all([
    db.section.findUnique({ where: { id: sectionId }, include: { classTeacher: true, grade: true } }),
    db.timetableSlot.findMany({
      where:   { sectionId },
      include: { day: true, timeSlot: true, subject: true, teacher: true, labTeacher: true, room: true, section: { include: { grade: true, classTeacher: true } } },
      orderBy: [{ day: { dayOrder: 'asc' } }, { timeSlot: { periodNumber: 'asc' } }],
    }),
    db.day.findMany({ orderBy: { dayOrder: 'asc' } }),
    db.timeSlot.findMany({ orderBy: { periodNumber: 'asc' } }),
    db.schoolConfig.findFirst(),
  ]);

  if (!section) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }

  // ── Build grid ──────────────────────────────────────────────────────────────
  const grid = buildClassGrid(section.name, slots, days, timeSlots, section.classTeacher?.name ?? null);
  grid.subtitle = schoolSubtitle(schoolConfig?.schoolName ?? null, schoolConfig?.academicYear ?? null);

  // ── Generate file ───────────────────────────────────────────────────────────
  const safeName = buildSafeTimetableName(section.name, 'class');

  try {
    if (format === 'csv') {
      const rows = slots.map((slot) => {
        const displayFields = getSlotDisplayFields(slot);
        return [
          section.name,
          section.grade.name,
          section.classTeacher?.name ?? '',
          slot.day.name,
          displayFields.period,
          displayFields.startTime,
          displayFields.endTime,
          displayFields.timeRange,
          displayFields.subject,
          displayFields.subjectCode,
          displayFields.teacher,
          displayFields.teacherAbbreviation,
          displayFields.labTeacher,
          displayFields.labTeacherAbbreviation,
          displayFields.room,
          displayFields.slotType,
          displayFields.notes,
        ];
      });

      return new NextResponse(
        buildCsv(
          [
            'Section',
            'Grade',
            'Class Teacher',
            'Day',
            'Period',
            'Start Time',
            'End Time',
            'Time Range',
            'Subject',
            'Subject Code',
            'Teacher',
            'Teacher Abbreviation',
            'Lab Teacher',
            'Lab Teacher Abbreviation',
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
    console.error('[export/class]', err);
    const detail =
      process.env.NODE_ENV === 'development' && err instanceof Error ? err.message : undefined;
    return NextResponse.json({ error: 'Export failed', detail }, { status: 500 });
  }
}
