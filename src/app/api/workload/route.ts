import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function workloadStatus(current: number, target: number): string {
  if (target <= 0) return current > 0 ? 'Over' : 'OK';
  const diff = current - target;
  if (Math.abs(diff) <= 2) return 'OK';
  return diff < 0 ? 'Under' : 'Over';
}

function safeAvg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function mergeTeacherSlots<T extends { id: string }>(...groups: T[][]) {
  const merged = new Map<string, T>();
  for (const group of groups) {
    for (const slot of group) {
      if (!merged.has(slot.id)) {
        merged.set(slot.id, slot);
      }
    }
  }
  return Array.from(merged.values());
}

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teacherId = searchParams.get('teacherId');

    if (teacherId) {
      // Basic ID validation
      if (typeof teacherId !== 'string' || teacherId.length > 128) {
        return NextResponse.json({ error: 'Invalid teacher ID' }, { status: 400 });
      }

      const teacher = await db.teacher.findUnique({
        where: { id: teacherId },
        include: {
          teacherSubjects: { include: { subject: true, section: true } },
          timetableSlots: { include: { day: true, timeSlot: true, subject: true, section: true } },
          labTimetableSlots: { include: { day: true, timeSlot: true, subject: true, section: true } },
        },
      });

      if (!teacher) {
        return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
      }

      const mergedSlots = mergeTeacherSlots(teacher.timetableSlots, teacher.labTimetableSlots);
      const current = mergedSlots.length;
      const target = Math.max(teacher.targetWorkload, 1);

      return NextResponse.json({
        teacher: {
          id: teacher.id,
          name: teacher.name,
          abbreviation: teacher.abbreviation,
          department: teacher.department,
          isHOD: teacher.isHOD,
        },
        targetWorkload: target,
        currentWorkload: current,
        difference: current - teacher.targetWorkload,
        status: workloadStatus(current, teacher.targetWorkload),
        assignments: teacher.teacherSubjects.map(ts => ({
          subject: ts.subject.name,
          section: ts.section.name,
          periods: ts.periodsPerWeek,
        })),
        slots: mergedSlots.map(slot => ({
          day: slot.day.name,
          period: slot.timeSlot.periodNumber,
          subject: slot.subject?.name ?? null,
          section: slot.section?.name ?? null,
        })),
      });
    }

    const teachers = await db.teacher.findMany({
      include: {
        teacherSubjects: { include: { subject: true, section: true } },
        timetableSlots: true,
        labTimetableSlots: true,
      },
      orderBy: { department: 'asc' },
    });

    const workloadData = teachers.map(t => {
      const current = mergeTeacherSlots(t.timetableSlots, t.labTimetableSlots).length;
      const diff = current - t.targetWorkload;
      return {
        id: t.id,
        name: t.name,
        abbreviation: t.abbreviation,
        department: t.department,
        isHOD: t.isHOD,
        targetWorkload: t.targetWorkload,
        currentWorkload: current,
        difference: diff,
        status: workloadStatus(current, t.targetWorkload),
        assignedSections: [...new Set(t.teacherSubjects.map(ts => ts.section.name))],
      };
    });

    return NextResponse.json({
      teachers: workloadData,
      summary: {
        totalTeachers: teachers.length,
        okCount: workloadData.filter(t => t.status === 'OK').length,
        underCount: workloadData.filter(t => t.status === 'Under').length,
        overCount: workloadData.filter(t => t.status === 'Over').length,
        averageWorkload: safeAvg(workloadData.map(t => t.currentWorkload)),
        averageTarget: safeAvg(workloadData.map(t => t.targetWorkload)),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch workload data' }, { status: 500 });
  }
}

// ── POST — validate and save workload records ──────────────────────────────────

export async function POST() {
  try {
    const teachers = await db.teacher.findMany({
      include: { teacherSubjects: true, timetableSlots: true, labTimetableSlots: true },
    });

    await db.workloadValidation.deleteMany();

    const validations = await Promise.all(
      teachers.map(teacher => {
        const current = mergeTeacherSlots(teacher.timetableSlots, teacher.labTimetableSlots).length;
        const diff = current - teacher.targetWorkload;
        const status = Math.abs(diff) <= 2 ? 'OK' : diff < 0 ? 'Under' : 'Over';
        const warnings: string[] = [];
        if (status === 'Over') warnings.push(`Over-assigned by ${Math.abs(diff)} periods`);
        if (status === 'Under') warnings.push(`Under-assigned by ${Math.abs(diff)} periods`);
        if (teacher.isHOD && current > teacher.targetWorkload + 2)
          warnings.push('HOD is over-assigned');

        return db.workloadValidation.create({
          data: {
            teacherId: teacher.id,
            targetWorkload: teacher.targetWorkload,
            actualWorkload: current,
            difference: diff,
            status,
            warnings: warnings.length > 0 ? JSON.stringify(warnings) : null,
          },
        });
      })
    );

    return NextResponse.json({
      success: true,
      validated: validations.length,
      summary: {
        ok: validations.filter(v => v.status === 'OK').length,
        under: validations.filter(v => v.status === 'Under').length,
        over: validations.filter(v => v.status === 'Over').length,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to validate workload' }, { status: 500 });
  }
}
