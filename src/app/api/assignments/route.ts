import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sortSectionsByGradeThenName } from '@/lib/section-sort';

// GET /api/assignments?grade=IX
// Returns all TeacherSubject assignments grouped by section, with teacher + subject info
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const gradeFilter = searchParams.get('grade');

  const where = gradeFilter
    ? { section: { grade: { name: gradeFilter } } }
    : {};

  const [assignments, sections, subjects, teachers] = await Promise.all([
    db.teacherSubject.findMany({
      where,
      include: {
        teacher: { select: { id: true, name: true, abbreviation: true, department: true, targetWorkload: true, teachableGrades: true } },
        subject: { select: { id: true, name: true, code: true, category: true } },
        section: { select: { id: true, name: true, stream: true, grade: { select: { name: true } } } },
      },
      orderBy: [{ section: { name: 'asc' } }, { subject: { name: 'asc' } }],
    }),
    db.section.findMany({
      where: gradeFilter ? { grade: { name: gradeFilter } } : {},
      include: { grade: true },
    }),
    db.subject.findMany({ orderBy: { name: 'asc' } }),
    db.teacher.findMany({
      select: { id: true, name: true, abbreviation: true, department: true, targetWorkload: true, teachableGrades: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const sortedSections = sortSectionsByGradeThenName(sections);

  // Build coverage map: sectionId -> { subjectId -> assignment }
  const coverageMap: Record<string, Record<string, typeof assignments[0]>> = {};
  for (const a of assignments) {
    if (!coverageMap[a.sectionId]) coverageMap[a.sectionId] = {};
    coverageMap[a.sectionId][a.subjectId] = a;
  }

  // Calculate teacher workload (total periods assigned)
  const teacherWorkloadMap: Record<string, number> = {};
  for (const a of assignments) {
    teacherWorkloadMap[a.teacherId] = (teacherWorkloadMap[a.teacherId] || 0) + a.periodsPerWeek;
  }

  // Compute per-grade subjects used
  const gradeSubjectSet: Record<string, Set<string>> = {};
  for (const a of assignments) {
    const gradeName = a.section.grade.name;
    if (!gradeSubjectSet[gradeName]) gradeSubjectSet[gradeName] = new Set();
    gradeSubjectSet[gradeName].add(a.subjectId);
  }
  const gradeSubjects: Record<string, string[]> = {};
  for (const [g, set] of Object.entries(gradeSubjectSet)) {
    gradeSubjects[g] = [...set].sort((a, b) => {
      const sa = subjects.find(s => s.id === a)?.name ?? '';
      const sb = subjects.find(s => s.id === b)?.name ?? '';
      // Sort: Core → Science → Language → Elective → Commerce → Activity
      const order = (cat: string) =>
        ['Core', 'Science', 'Language', 'Elective', 'Commerce', 'Activity'].indexOf(cat);
      const catA = subjects.find(s => s.id === a)?.category ?? '';
      const catB = subjects.find(s => s.id === b)?.category ?? '';
      if (catA !== catB) return order(catA) - order(catB);
      return sa.localeCompare(sb);
    });
  }

  return NextResponse.json({
    assignments,
    sections: sortedSections,
    subjects,
    teachers: teachers.map(t => ({
      ...t,
      teachableGrades: JSON.parse(t.teachableGrades || '[]'),
      assignedPeriods: teacherWorkloadMap[t.id] || 0,
    })),
    coverageMap,
    gradeSubjects,
  });
}

// PATCH /api/assignments — change a teacher on an assignment
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignmentId, newTeacherId } = body;
    if (!assignmentId || !newTeacherId) {
      return NextResponse.json({ error: 'assignmentId and newTeacherId required' }, { status: 400 });
    }
    const updated = await db.teacherSubject.update({
      where: { id: assignmentId },
      data: { teacherId: newTeacherId },
      include: {
        teacher: { select: { id: true, name: true, abbreviation: true, department: true } },
        subject: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ assignment: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/assignments — create a new assignment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { teacherId, subjectId, sectionId, periodsPerWeek } = body;
    if (!teacherId || !subjectId || !sectionId || !periodsPerWeek) {
      return NextResponse.json({ error: 'teacherId, subjectId, sectionId, periodsPerWeek required' }, { status: 400 });
    }
    const assignment = await db.teacherSubject.create({
      data: { teacherId, subjectId, sectionId, periodsPerWeek: Number(periodsPerWeek) },
      include: {
        teacher: { select: { id: true, name: true, abbreviation: true } },
        subject: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ assignment });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Assignment already exists for this teacher-subject-section combination' }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/assignments?id=xxx
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await db.teacherSubject.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
