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

  // 3. Fix W.E. periods: VI–IX → 2/week, X → 1/week
  const weSubjects = await db.subject.findMany({
    where: { name: { in: ['Vocal','Keyboard','Instrument','Tabla','Dance','Art','Music','Work Experience'] } },
    select: { id: true },
  });
  const weSubjectIds = weSubjects.map(s => s.id);
  const allSections = await db.section.findMany({ include: { grade: { select: { name: true } } } });
  const lowerSectionIds = allSections.filter(s => ['VI','VII','VIII','IX'].includes(s.grade.name)).map(s => s.id);
  const xSectionIds     = allSections.filter(s => s.grade.name === 'X').map(s => s.id);

  const fix2 = await db.teacherSubject.updateMany({
    where: { subjectId: { in: weSubjectIds }, sectionId: { in: lowerSectionIds }, periodsPerWeek: { not: 2 } },
    data: { periodsPerWeek: 2 },
  });
  const fix1 = await db.teacherSubject.updateMany({
    where: { subjectId: { in: weSubjectIds }, sectionId: { in: xSectionIds }, periodsPerWeek: { not: 1 } },
    data: { periodsPerWeek: 1 },
  });
  log.push(`Fixed W.E. periods: ${fix2.count} → 2/week (VI–IX), ${fix1.count} → 1/week (X)`);

  // 4. Fix language periods: 2nd Lang → 6/week, 3rd Lang → 4/week
  const lang2ndSubs = await db.subject.findMany({ where: { name: { in: ['Hindi 2L','Nepali 2L'] } }, select: { id: true } });
  const lang3rdSubs = await db.subject.findMany({ where: { name: { in: ['Hindi','Nepali','French'] } }, select: { id: true } });
  const fl2 = await db.teacherSubject.updateMany({ where: { subjectId: { in: lang2ndSubs.map(s=>s.id) } }, data: { periodsPerWeek: 6 } });
  const fl3 = await db.teacherSubject.updateMany({ where: { subjectId: { in: lang3rdSubs.map(s=>s.id) } }, data: { periodsPerWeek: 4 } });
  log.push(`Lang periods: ${fl2.count} × 2nd Lang → 6/week, ${fl3.count} × 3rd Lang → 4/week`);

  // 5. Fix Innovation periods → 1/week
  const innovationSubject = await db.subject.findFirst({ where: { name: 'Innovation' } });
  if (innovationSubject) {
    const fixInnovation = await db.teacherSubject.updateMany({
      where: { subjectId: innovationSubject.id, periodsPerWeek: { not: 1 } },
      data: { periodsPerWeek: 1 },
    });
    log.push(`Fixed Innovation periods: ${fixInnovation.count} → 1/week`);
  } else {
    log.push('Innovation subject not found — skipped');
  }

  // 6. Remove non-existent section VIIF and all its data
  const viif = await db.section.findUnique({ where: { name: 'VIIF' } });
  if (viif) {
    await db.timetableSlot.deleteMany({ where: { sectionId: viif.id } });
    await db.teacherSubject.deleteMany({ where: { sectionId: viif.id } });
    await db.section.delete({ where: { id: viif.id } });
    log.push('Deleted section VIIF and all its timetable/assignment data');
  } else {
    log.push('Section VIIF not found — already removed or never existed');
  }

  // 7. Fix Ms. Deepa Devi Subedi abbreviation DS2 → DS
  const dds = await db.teacher.findFirst({ where: { name: 'Ms. Deepa Devi Subedi' } });
  if (dds && dds.abbreviation !== 'DS') {
    const conflict = await db.teacher.findFirst({ where: { abbreviation: 'DS' } });
    if (!conflict) {
      await db.teacher.update({ where: { id: dds.id }, data: { abbreviation: 'DS' } });
      log.push(`Updated Ms. Deepa Devi Subedi abbreviation → DS`);
    } else {
      log.push(`Abbreviation DS already taken by ${conflict.name}`);
    }
  } else {
    log.push(`Ms. Deepa Devi Subedi abbreviation already DS`);
  }

  return NextResponse.json({ success: true, log });
}
