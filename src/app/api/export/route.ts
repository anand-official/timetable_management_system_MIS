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
  slotHasTeacherId,
} from '@/lib/combined-slot';
import {
  buildCsv,
  getSlotDisplayFields,
  schoolSubtitle,
} from '@/lib/export/timetable-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

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
        include: {
          day: true,
          timeSlot: true,
          subject: true,
          teacher: true,
          labTeacher: true,
          room: true,
          section: {
            include: {
              grade: true,
              classTeacher: true,
            },
          },
        },
      }),
      db.schoolConfig.findFirst(),
    ]);

    const sections = sortSectionsByGradeThenName(sectionsRaw);
    const sectionOrderMap = new Map(sections.map((section, index) => [section.id, index]));
    const sortedAllSlots = [...allSlots].sort((a, b) =>
      (sectionOrderMap.get(a.sectionId) ?? Number.MAX_SAFE_INTEGER) - (sectionOrderMap.get(b.sectionId) ?? Number.MAX_SAFE_INTEGER) ||
      a.day.dayOrder - b.day.dayOrder ||
      a.timeSlot.periodNumber - b.timeSlot.periodNumber
    );
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
      timetable: sortedAllSlots.map(slot => {
        const displayFields = getSlotDisplayFields(slot);
        return {
          section: slot.section?.name ?? '',
          day: slot.day.name,
          period: displayFields.period,
          startTime: displayFields.startTime,
          endTime: displayFields.endTime,
          timeRange: displayFields.timeRange,
          grade: displayFields.grade,
          classTeacher: displayFields.classTeacher,
          subject: displayFields.subject,
          subjectCode: displayFields.subjectCode,
          teacher: displayFields.teacher,
          teacherAbbr: displayFields.teacherAbbreviation,
          labTeacher: displayFields.labTeacher,
          labTeacherAbbr: displayFields.labTeacherAbbreviation,
          room: displayFields.room,
          slotType: displayFields.slotType,
          notes: displayFields.notes,
          isLab: slot.isLab,
          isGames: slot.isGames,
          isYoga: slot.isYoga,
          isLibrary: slot.isLibrary,
        };
      }),
    };

    if (format === 'csv') {
      if (type === 'teacher') {
        const teacherRows = teachers.flatMap((teacher) =>
          sortedAllSlots
            .filter((slot) => slotHasTeacherId(slot, teacher.id))
            .map((slot) => {
              const displayFields = getSlotDisplayFields(slot);
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
            })
        );

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
            teacherRows
          ),
          {
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': 'attachment; filename="timetable_all_teachers.csv"',
            },
          }
        );
      }

      const classRows = sortedAllSlots.map((slot) => {
        const displayFields = getSlotDisplayFields(slot);
        return [
          slot.section?.name ?? '',
          displayFields.grade,
          displayFields.classTeacher,
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
          classRows
        ),
        {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="timetable_all_classes.csv"',
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
          const g = buildClassGrid(sec.name, slots, days, timeSlots, sec.classTeacher?.name ?? null);
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
          const g = buildClassGrid(sec.name, slots, days, timeSlots, sec.classTeacher?.name ?? null);
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
