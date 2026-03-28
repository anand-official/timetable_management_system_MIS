import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getDailySubstitutePlan } from '@/lib/substitute';
import { buildCsv, schoolSubtitle } from '@/lib/export/timetable-export';
import { generateDailySubstitutePdf } from '@/lib/export/substitute-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const format = searchParams.get('format') ?? 'pdf';

    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!['pdf', 'csv', 'json'].includes(format)) {
      return NextResponse.json({ error: 'format must be pdf, csv, or json' }, { status: 400 });
    }

    const [plan, periods, schoolConfig] = await Promise.all([
      getDailySubstitutePlan(date),
      db.timeSlot.findMany({
        orderBy: { periodNumber: 'asc' },
        select: {
          periodNumber: true,
          startTime: true,
          endTime: true,
        },
      }),
      db.schoolConfig.findFirst({
        select: {
          schoolName: true,
          academicYear: true,
        },
      }),
    ]);
    const rows = plan.absences.flatMap((absence) =>
      absence.slots.map((slot) => ({
        period: slot.periodNumber,
        sectionName: slot.sectionName,
        subjectName: slot.subjectName,
        absentTeacher: `${absence.teacher.name} (${absence.teacher.abbreviation})`,
        substituteTeacher: slot.assignedSubstitute
          ? `${slot.assignedSubstitute.name} (${slot.assignedSubstitute.abbreviation})`
          : '',
        status: slot.assignedSubstitute ? 'Assigned' as const : 'Unassigned' as const,
      }))
    ).sort((a, b) => a.period - b.period || a.sectionName.localeCompare(b.sectionName));

    if (format === 'json') {
      return NextResponse.json({
        date,
        dayName: plan.dayName,
        absences: plan.absences,
        rows,
      });
    }

    if (format === 'csv') {
      return new NextResponse(
        buildCsv(
          ['Period', 'Section', 'Subject', 'Absent Teacher', 'Substitute Teacher', 'Status'],
          rows.map((row) => [
            row.period,
            row.sectionName,
            row.subjectName,
            row.absentTeacher,
            row.substituteTeacher,
            row.status,
          ])
        ),
        {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="substitute_timetable_${date}.csv"`,
          },
        }
      );
    }

    const teachers = plan.absences.map((absence) => ({
      teacherId: absence.teacher.id,
      teacherLabel: `${absence.teacher.abbreviation} - ${absence.teacher.name}`,
    }));

    const cells = plan.absences.flatMap((absence) =>
      absence.slots.map((slot) => ({
        teacherId: absence.teacher.id,
        periodNumber: slot.periodNumber,
        sectionName: slot.sectionName,
        subjectName: slot.subjectName,
        subjectCode: slot.subjectCode,
        substituteTeacher: slot.assignedSubstitute
          ? `${slot.assignedSubstitute.abbreviation} - ${slot.assignedSubstitute.name}`
          : undefined,
        status: slot.assignedSubstitute ? 'Assigned' as const : 'Unassigned' as const,
      }))
    );

    const fileBuffer = await generateDailySubstitutePdf({
      title: 'Daily Substitute Duty Chart',
      subtitle: schoolSubtitle(schoolConfig?.schoolName ?? null, schoolConfig?.academicYear ?? null),
      schoolName: schoolConfig?.schoolName?.trim() || 'Modern Indian School',
      academicYear: schoolConfig?.academicYear?.trim() || '2026-27',
      reportDate: date,
      reportDay: plan.dayName,
      periods,
      teachers,
      cells,
    });

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="substitute_timetable_${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[substitute-export] failed:', error);
    return NextResponse.json({ error: 'Failed to export substitute timetable' }, { status: 500 });
  }
}
