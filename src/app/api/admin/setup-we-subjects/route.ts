import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const WE_SUBJECTS = [
  { name: 'Vocal',      code: 'Voc',  category: 'Activity', requiresLab: false, isDoublePeriod: false },
  { name: 'Keyboard',   code: 'Key',  category: 'Activity', requiresLab: false, isDoublePeriod: false },
  { name: 'Instrument', code: 'Inst', category: 'Activity', requiresLab: false, isDoublePeriod: false },
  { name: 'Tabla',      code: 'Tab',  category: 'Activity', requiresLab: false, isDoublePeriod: false },
];

const LANG_SUBJECTS = [
  { name: 'Hindi 2L',  code: 'Hi2', category: 'Language', requiresLab: false, isDoublePeriod: false },
  { name: 'Nepali 2L', code: 'Ne2', category: 'Language', requiresLab: false, isDoublePeriod: false },
];

const DEPT_CHANGES: Record<string, string> = {
  'Ms. Sangeeta Pradhan Rana': 'Vocal',
  'Mr. Bruno Tamang':          'Keyboard',
  'Mr. Hari Datt Phulara':     'Vocal',
  'Mr. Sanjok Sharma':         'Instrument',
  'Mr. Yuson Maharjan':        'Tabla',
  'Mr. Nirajan Tandukar':      'Tabla',
};

export async function POST() {
  const log: string[] = [];

  // 1. Upsert subjects (W.E. + 2nd Language)
  for (const subj of [...WE_SUBJECTS, ...LANG_SUBJECTS]) {
    const existing = await db.subject.findFirst({ where: { name: subj.name } });
    if (existing) {
      log.push(`Subject "${subj.name}" already exists`);
    } else {
      await db.subject.create({ data: subj });
      log.push(`Created subject: ${subj.name}`);
    }
  }

  // 2. Update teacher departments + migrate their Music assignments
  const musicSubject = await db.subject.findFirst({ where: { name: 'Music' } });

  for (const [teacherName, newDept] of Object.entries(DEPT_CHANGES)) {
    const teacher = await db.teacher.findFirst({ where: { name: teacherName } });
    if (!teacher) { log.push(`Teacher not found: ${teacherName}`); continue; }

    if (teacher.department !== newDept) {
      await db.teacher.update({ where: { id: teacher.id }, data: { department: newDept } });
      log.push(`${teacherName}: ${teacher.department} → ${newDept}`);
    } else {
      log.push(`${teacherName} already has dept "${newDept}"`);
    }

    if (musicSubject) {
      const newSubject = await db.subject.findFirst({ where: { name: newDept } });
      if (!newSubject) continue;

      const oldAssignments = await db.teacherSubject.findMany({
        where: { teacherId: teacher.id, subjectId: musicSubject.id },
      });

      if (oldAssignments.length > 0) {
        await db.teacherSubject.deleteMany({
          where: { teacherId: teacher.id, subjectId: musicSubject.id },
        });
        for (const old of oldAssignments) {
          await db.teacherSubject.upsert({
            where: { teacherId_subjectId_sectionId: { teacherId: teacher.id, subjectId: newSubject.id, sectionId: old.sectionId } },
            update: { periodsPerWeek: old.periodsPerWeek },
            create: { teacherId: teacher.id, subjectId: newSubject.id, sectionId: old.sectionId, periodsPerWeek: old.periodsPerWeek, isLabAssignment: false },
          });
        }
        log.push(`Migrated ${oldAssignments.length} Music→${newDept} assignments for ${teacherName}`);
      }
    }
  }

  return NextResponse.json({ success: true, log });
}
