import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ExportQuerySchema, validationError } from '@/lib/validation';
import { ZodError } from 'zod';
import { buildClassGrid, buildTeacherGrid } from '@/lib/export/timetable-grid';
import { sortSectionsByGradeThenName } from '@/lib/section-sort';
import { generateBulkTimetablePdf } from '@/lib/export/timetable-pdf';
import { generateBulkTimetableXlsx } from '@/lib/export/timetable-xlsx';
import type { TimetableGrid } from '@/lib/export/timetable-grid';
import {
  getAllSlotTeacherIds,
  getCombinedSlotDisplay,
  getSlotTeacherAbbreviations,
  getSlotTeacherNames,
  slotHasTeacherId,
} from '@/lib/combined-slot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function schoolSubtitle(schoolName: string | null, academicYear: string | null): string {
  const name = schoolName?.trim() || 'Modern Indian School';
  const year = academicYear?.trim() || '2026-27';
  return `${name}  |  Academic Year ${year}`;
}

function getTeacherExportLabel(slot: { teacher?: { name?: string | null; abbreviation?: string | null } | null; labTeacher?: { name?: string | null; abbreviation?: string | null } | null }) {
  const names = getSlotTeacherNames(slot);
  const abbreviations = getSlotTeacherAbbreviations(slot);
  return {
    names: names.join(' + '),
    abbreviations: abbreviations.join(' + '),
  };
}

// ── GET — Export timetable (CSV/JSON use flat rows; Excel/PDF use native TS generators) ──

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const parsed = ExportQuerySchema.safeParse({
      format: searchParams.get('format') ?? undefined,
      type: searchParams.get('type') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }

    const { format, type } = parsed.data;

    if (type === 'workload' && (format === 'excel' || format === 'pdf')) {
      return NextResponse.json(
        { error: 'Workload export is available as JSON or CSV only. Use format=json or csv.' },
        { status: 400 }
      );
    }

    const [sectionsRaw, teachers, days, timeSlots, allSlots, schoolConfig] = await Promise.all([
      db.section.findMany({
        include: { grade: true, classTeacher: true },
      }),
      db.teacher.findMany({ orderBy: { name: 'asc' } }),
      db.day.findMany({ orderBy: { dayOrder: 'asc' } }),
      db.timeSlot.findMany({ orderBy: { periodNumber: 'asc' } }),
      db.timetableSlot.findMany({
        include: { day: true, timeSlot: true, subject: true, teacher: true, labTeacher: true, section: true },
      }),
      db.schoolConfig.findFirst(),
    ]);

    const sections = sortSectionsByGradeThenName(sectionsRaw);
    const teacherWorkloadMap = buildTeacherWorkloadMap(allSlots);

    const subtitle = schoolSubtitle(schoolConfig?.schoolName ?? null, schoolConfig?.academicYear ?? null);

    const exportData = {
      sections: sections.map(s => ({
        name: s.name,
        grade: s.grade.name,
        stream: s.stream ?? null,
        classTeacher: s.classTeacher?.name ?? null,
      })),
      teachers: teachers.map(t => ({
        name: t.name,
        abbreviation: t.abbreviation,
        department: t.department,
        targetWorkload: t.targetWorkload,
        currentWorkload: teacherWorkloadMap.get(t.id) ?? 0,
      })),
      days: days.map(d => d.name),
      periods: timeSlots.map(t => ({
        period: t.periodNumber,
        start: t.startTime,
        end: t.endTime,
        duration: t.duration,
      })),
      timetable: allSlots.map(slot => ({
        section: slot.section?.name ?? '',
        day: slot.day.name,
        period: slot.timeSlot.periodNumber,
        startTime: slot.timeSlot.startTime,
        endTime: slot.timeSlot.endTime,
        subject: getCombinedSlotDisplay(slot.notes)?.name ?? slot.subject?.name ?? '',
        subjectCode: getCombinedSlotDisplay(slot.notes)?.code ?? slot.subject?.code ?? '',
        teacher: getTeacherExportLabel(slot).names,
        teacherAbbr: getTeacherExportLabel(slot).abbreviations,
        labTeacher: slot.labTeacher?.name ?? '',
        labTeacherAbbr: slot.labTeacher?.abbreviation ?? '',
        isLab: slot.isLab,
        isGames: slot.isGames,
        isYoga: slot.isYoga,
        isLibrary: slot.isLibrary,
      })),
    };

    if (format === 'csv') {
      let csv = 'Section,Day,Period,Start Time,End Time,Subject,Teacher,Lab Teacher\n';
      for (const slot of allSlots) {
        const teacherLabel = getTeacherExportLabel(slot);
        const row = [
          slot.section?.name ?? '',
          slot.day.name,
          String(slot.timeSlot.periodNumber),
          slot.timeSlot.startTime,
          slot.timeSlot.endTime,
          getCombinedSlotDisplay(slot.notes)?.name ?? slot.subject?.name ?? '',
          teacherLabel.names,
          slot.labTeacher?.name ?? '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        csv += row + '\n';
      }
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="timetable.csv"',
        },
      });
    }

    if (format === 'excel') {
      let grids: TimetableGrid[];
      let filename: string;

      if (type === 'teacher') {
        grids = teachers.map(t => {
          const teacherSlots = allSlots.filter((slot) => slotHasTeacherId(slot, t.id));
          const g = buildTeacherGrid(t.name, t.abbreviation, teacherSlots, days, timeSlots);
          g.subtitle = subtitle;
          return g;
        });
        filename = 'timetable_all_teachers.xlsx';
      } else {
        grids = sections.map(sec => {
          const slots = allSlots.filter(s => s.sectionId === sec.id);
          const g = buildClassGrid(sec.name, slots, days, timeSlots);
          g.subtitle = subtitle;
          return g;
        });
        filename = 'timetable_all_classes.xlsx';
      }

      const fileBuffer = await generateBulkTimetableXlsx(grids);
      return new NextResponse(new Uint8Array(fileBuffer), {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (format === 'pdf') {
      let grids: TimetableGrid[];
      let filename: string;

      if (type === 'teacher') {
        grids = teachers.map(t => {
          const teacherSlots = allSlots.filter((slot) => slotHasTeacherId(slot, t.id));
          const g = buildTeacherGrid(t.name, t.abbreviation, teacherSlots, days, timeSlots);
          g.subtitle = subtitle;
          return g;
        });
        filename = 'timetable_all_teachers.pdf';
      } else {
        grids = sections.map(sec => {
          const slots = allSlots.filter(s => s.sectionId === sec.id);
          const g = buildClassGrid(sec.name, slots, days, timeSlots);
          g.subtitle = subtitle;
          return g;
        });
        filename = 'timetable_all_classes.pdf';
      }

      const fileBuffer = await generateBulkTimetablePdf(grids);
      return new NextResponse(new Uint8Array(fileBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json(exportData);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(validationError(error), { status: 400 });
    }
    console.error('[export] Error:', error);
    const detail =
      process.env.NODE_ENV === 'development' && error instanceof Error
        ? error.message
        : undefined;
    return NextResponse.json({ error: 'Export failed', detail }, { status: 500 });
  }
}

function buildTeacherWorkloadMap(
  slots: Array<{ teacherId: string | null; labTeacherId: string | null; notes?: string | null; dayId: string; timeSlotId: string }>
) {
  const teacherSlotKeys = new Map<string, Set<string>>();

  for (const slot of slots) {
    const key = `${slot.dayId}|${slot.timeSlotId}`;
    for (const teacherId of getAllSlotTeacherIds(slot)) {
      if (!teacherId) continue;
      if (!teacherSlotKeys.has(teacherId)) {
        teacherSlotKeys.set(teacherId, new Set());
      }
      teacherSlotKeys.get(teacherId)!.add(key);
    }
  }

  return new Map(
    Array.from(teacherSlotKeys.entries()).map(([teacherId, slotKeys]) => [teacherId, slotKeys.size])
  );
}
