import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { AiScheduleSchema, validationError } from '@/lib/validation';
import { sortSectionsByGradeThenName } from '@/lib/section-sort';

// ── POST ───────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = AiScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }

    const { action, sectionId, teacherId } = parsed.data;

    const [sectionsRaw, teachers, subjects, days, timeSlots, existingSlots] = await Promise.all([
      db.section.findMany({ include: { grade: true, classTeacher: true } }),
      db.teacher.findMany({ include: { timetableSlots: true } }),
      db.subject.findMany(),
      db.day.findMany({ orderBy: { dayOrder: 'asc' } }),
      db.timeSlot.findMany({ orderBy: { periodNumber: 'asc' } }),
      db.timetableSlot.findMany({
        include: { day: true, timeSlot: true, subject: true, teacher: true, section: true },
      }),
    ]);
    const sections = sortSectionsByGradeThenName(sectionsRaw);

    if (action === 'analyze' || action === 'optimize') {
      const analysis = generateAnalysis(teachers, existingSlots, sections, days, timeSlots, subjects);
      return NextResponse.json({
        success: true,
        action,
        analysis,
        recommendations: analysis,
        timestamp: new Date().toISOString(),
        stats: buildStats(teachers, sections, existingSlots),
      });
    }

    if (action === 'suggest') {
      const suggestions = generateSuggestions(
        teachers, existingSlots, sections, days, timeSlots, sectionId, teacherId
      );
      return NextResponse.json({
        success: true,
        action: 'suggest',
        suggestions,
        target: sectionId ?? teacherId ?? null,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const [teachers, sectionsRaw, slots] = await Promise.all([
      db.teacher.findMany({ include: { timetableSlots: true } }),
      db.section.findMany({ include: { grade: true } }),
      db.timetableSlot.findMany(),
    ]);
    const sections = sortSectionsByGradeThenName(sectionsRaw);

    return NextResponse.json({
      success: true,
      stats: buildStats(teachers, sections, slots),
      recommendations: [
        'Run "Analyze" to get a full timetable quality report',
        'Check the Workload tab to identify under/over-assigned teachers',
        'Verify all sections have complete timetables in Class View',
        'Use "Generate Timetable" to rebuild from scratch if needed',
      ],
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Subjects where the same teacher legitimately appears in multiple sections
// simultaneously — not a scheduling conflict.
const SHARED_SLOT_SUBJECTS = new Set(['Games', 'Yoga', 'Aerobics', 'Innovation', 'Library']);

function perSectionValidSlots(_sectionName: string, daysCount: number, periodsCount: number): number {
  return daysCount * periodsCount;
}

function buildStats(teachers: any[], sections: any[], slots: any[]) {
  const workloads = teachers.map((t: any) => t.timetableSlots?.length ?? 0);
  return {
    totalTeachers: teachers.length,
    totalSections: sections.length,
    totalSlots: slots.length,
    averageWorkload: Math.round(
      workloads.reduce((s: number, w: number) => s + w, 0) / Math.max(teachers.length, 1)
    ),
    underloadedTeachers: teachers.filter((t: any) => (t.timetableSlots?.length ?? 0) < t.targetWorkload - 2).length,
    overloadedTeachers: teachers.filter((t: any) => (t.timetableSlots?.length ?? 0) > t.targetWorkload + 2).length,
    slotsPerSection: Math.round(slots.length / Math.max(sections.length, 1)),
  };
}

function generateAnalysis(
  teachers: any[],
  existingSlots: any[],
  sections: any[],
  days: any[],
  timeSlots: any[],
  subjects: any[]
): string {
  const teacherWorkload = (t: any) => t.timetableSlots?.length ?? 0;
  const overworked = teachers.filter((t: any) => teacherWorkload(t) > t.targetWorkload + 2);
  const underworked = teachers.filter((t: any) => teacherWorkload(t) < t.targetWorkload - 2);
  const balanced = teachers.filter((t: any) => Math.abs(teacherWorkload(t) - t.targetWorkload) <= 2);

  const avgWorkload = Math.round(
    teachers.reduce((s: number, t: any) => s + teacherWorkload(t), 0) / Math.max(teachers.length, 1)
  );

  const totalValid = sections.reduce((sum: number, s: any) => {
    return sum + perSectionValidSlots(s.name, days.length, timeSlots.length);
  }, 0);
  const fillRate = totalValid > 0 ? Math.round((existingSlots.length / totalValid) * 100) : 0;

  // Conflict detection — skip SHARED_SLOT_SUBJECTS (intentionally shared)
  const conflictMap = new Map<string, number>();
  existingSlots.forEach((slot: any) => {
    if (!slot.teacherId) return;
    const subjectName: string = slot.subject?.name ?? '';
    if (SHARED_SLOT_SUBJECTS.has(subjectName)) return;
    const key = `${slot.teacherId}-${slot.dayId}-${slot.timeSlotId}`;
    conflictMap.set(key, (conflictMap.get(key) ?? 0) + 1);
  });
  const conflicts = [...conflictMap.values()].filter(v => v > 1).length;

  // Section completeness — use per-section valid slot count
  const sectionMap = new Map<string, number>();
  existingSlots.forEach((s: any) =>
    sectionMap.set(s.sectionId, (sectionMap.get(s.sectionId) ?? 0) + 1)
  );
  const incomplete = sections.filter((s: any) => {
    const valid = perSectionValidSlots(s.name, days.length, timeSlots.length);
    return (sectionMap.get(s.id) ?? 0) < valid;
  });

  const labSlots = existingSlots.filter((s: any) => s.isLab).length;
  const labSubjectNames = subjects.filter((s: any) => s.requiresLab).map((s: any) => s.name);

  const deptWorkload: Record<string, { total: number; count: number }> = {};
  teachers.forEach((t: any) => {
    if (!deptWorkload[t.department]) deptWorkload[t.department] = { total: 0, count: 0 };
    deptWorkload[t.department].total += teacherWorkload(t);
    deptWorkload[t.department].count++;
  });

  let report = `# Timetable Analysis Report\n\n## Overall Assessment\nFill rate: **${fillRate}%** (${existingSlots.length} / ${totalValid} valid slots)\nAverage teacher workload: **${avgWorkload} periods/week**\nTeacher conflicts: **${conflicts}**\n\n`;

  if (conflicts > 0)
    report += `## ⛔ Conflicts (${conflicts})\nThese are genuine double-bookings (shared-slot subjects like Library/Yoga/Games are excluded).\nRegenerating the timetable will fix these.\n\n`;

  if (incomplete.length > 0) {
    report += `## ⚠️ Incomplete Sections (${incomplete.length})\n`;
    incomplete.slice(0, 10).forEach((s: any) => {
      const valid = perSectionValidSlots(s.name, days.length, timeSlots.length);
      report += `- ${s.name}: ${sectionMap.get(s.id) ?? 0}/${valid} slots\n`;
    });
    report += '\n';
  }

  report += `## Workload Distribution\n- Balanced (±2): **${balanced.length}**\n- Overworked: **${overworked.length}**\n- Underworked: **${underworked.length}**\n\n`;

  if (overworked.length > 0) {
    report += `### Overworked Teachers\n| Teacher | Dept | Current | Target |\n|---------|------|---------|--------|\n`;
    overworked.slice(0, 10).forEach((t: any) => {
      report += `| ${t.name} | ${t.department} | ${teacherWorkload(t)} | ${t.targetWorkload} |\n`;
    });
    report += '\n';
  }

  report += `## Department Summary\n| Department | Teachers | Avg Workload |\n|------------|----------|--------------|\n`;
  Object.entries(deptWorkload)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([dept, data]) => {
      report += `| ${dept} | ${data.count} | ${Math.round(data.total / data.count)} |\n`;
    });

  report += `\n## Lab Coverage\n- Lab slots assigned: **${labSlots}**\n- Lab subjects: **${labSubjectNames.join(', ')}**\n\n`;

  report += `## Recommendations\n`;
  if (conflicts > 0) report += `1. **Regenerate timetable** to fix ${conflicts} genuine conflict(s)\n`;
  if (fillRate < 90) report += `- Fill rate is ${fillRate}% — consider regenerating\n`;
  if (overworked.length > 0)
    report += `- Reduce load for: ${overworked.slice(0, 3).map((t: any) => t.name).join(', ')}\n`;
  if (underworked.length > 0)
    report += `- Assign more to: ${underworked.slice(0, 3).map((t: any) => t.name).join(', ')}\n`;
  if (conflicts === 0 && fillRate >= 90 && overworked.length === 0)
    report += `- Timetable looks good!\n`;

  report += `\n---\n*Analysis — ${teachers.length} teachers, ${sections.length} sections, ${existingSlots.length} slots*`;
  return report;
}

function generateSuggestions(
  teachers: any[],
  existingSlots: any[],
  sections: any[],
  days: any[],
  timeSlots: any[],
  sectionId?: string,
  teacherId?: string
): string {
  if (sectionId) {
    const section = sections.find((s: any) => s.id === sectionId);
    const sSlots = existingSlots.filter((s: any) => s.sectionId === sectionId);
    const assigned = [...new Set(sSlots.map((s: any) => s.subject?.name).filter(Boolean))];
    const total = days.length * timeSlots.length;
    return `# Suggestions for ${section?.name ?? 'Section'}\n\n- Slots: ${sSlots.length}/${total} (${Math.round((sSlots.length / total) * 100)}%)\n- Subjects: ${assigned.join(', ') || 'none'}\n- Class teacher: ${section?.classTeacher?.name ?? 'Not assigned'}\n\n## Tips\n1. Ensure lab subjects have consecutive double periods\n2. Distribute core subjects across different days\n3. Avoid more than 2 consecutive periods of the same subject\n`;
  }
  if (teacherId) {
    const teacher = teachers.find((t: any) => t.id === teacherId);
    const tSlots = existingSlots.filter((s: any) => s.teacherId === teacherId);
    const sectionsAssigned = [...new Set(tSlots.map((s: any) => s.section?.name).filter(Boolean))];
    const diff = tSlots.length - (teacher?.targetWorkload ?? 0);
    return `# Suggestions for ${teacher?.name ?? 'Teacher'}\n\n- Department: ${teacher?.department}\n- Workload: ${tSlots.length} / ${teacher?.targetWorkload} (${diff > 0 ? '+' : ''}${diff})\n- Teaching: ${sectionsAssigned.join(', ') || 'none'}\n\n## Tips\n${diff > 2 ? '1. This teacher is overworked — redistribute some periods\n' : diff < -2 ? '1. This teacher has capacity for more periods\n' : '1. Workload is balanced\n'}2. Max 6 periods per day is enforced\n3. HODs should have 18–22 periods\n`;
  }
  return '# No target specified\nSelect a section or teacher to get suggestions.';
}
