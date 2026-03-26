import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildClassGrid } from '@/lib/export/timetable-grid';
import { generateTimetablePdf } from '@/lib/export/timetable-pdf';
import { generateTimetableXlsx } from '@/lib/export/timetable-xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  const { sectionId } = await params;
  const format = request.nextUrl.searchParams.get('format') ?? 'pdf';

  if (!['pdf', 'xlsx'].includes(format)) {
    return NextResponse.json({ error: 'format must be pdf or xlsx' }, { status: 400 });
  }

  if (!sectionId || sectionId.length > 128) {
    return NextResponse.json({ error: 'Invalid section ID' }, { status: 400 });
  }

  // ── Load data ───────────────────────────────────────────────────────────────
  const [section, slots, days, timeSlots, schoolConfig] = await Promise.all([
    db.section.findUnique({ where: { id: sectionId } }),
    db.timetableSlot.findMany({
      where:   { sectionId },
      include: { day: true, timeSlot: true, subject: true, teacher: true, labTeacher: true },
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
  const grid = buildClassGrid(section.name, slots, days, timeSlots);
  const sn = schoolConfig?.schoolName?.trim() || 'Modern Indian School';
  const yr = schoolConfig?.academicYear?.trim() || '2025-26';
  grid.subtitle = `${sn}  |  Academic Year ${yr}`;

  // ── Generate file ───────────────────────────────────────────────────────────
  const safeName = section.name.replace(/[^A-Za-z0-9]/g, '_');

  try {
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
