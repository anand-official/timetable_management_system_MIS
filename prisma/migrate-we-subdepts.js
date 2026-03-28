/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Migration: Add W.E. sub-department subjects and update teacher departments
 *
 * Changes:
 * 1. Upsert subjects: Vocal, Keyboard, Instrument, Tabla (Dance already exists)
 * 2. Update teacher departments to their W.E. specialisation:
 *      Sangeeta Pradhan Rana  → Vocal
 *      Bruno Tamang           → Keyboard
 *      Hari Datt Phulara      → Vocal
 *      Sanjok Sharma          → Instrument
 *      Yuson Maharjan         → Tabla
 *      Nirajan Tandukar       → Tabla
 * 3. Re-create their TeacherSubject assignments under the new subject
 *    (old Music-subject assignments for these teachers are deleted and replaced)
 *
 * Run: node prisma/migrate-we-subdepts.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// New subjects to upsert (Dance already exists — will be skipped if present)
const NEW_SUBJECTS = [
  { name: 'Vocal',      code: 'Voc',  category: 'Activity', requiresLab: false, isDoublePeriod: false },
  { name: 'Keyboard',   code: 'Key',  category: 'Activity', requiresLab: false, isDoublePeriod: false },
  { name: 'Instrument', code: 'Inst', category: 'Activity', requiresLab: false, isDoublePeriod: false },
  { name: 'Tabla',      code: 'Tab',  category: 'Activity', requiresLab: false, isDoublePeriod: false },
  { name: 'Dance',      code: 'Dance',category: 'Activity', requiresLab: false, isDoublePeriod: false },
];

// teacher name → new department (only the ones that change)
const DEPT_CHANGES = {
  'Ms. Sangeeta Pradhan Rana': 'Vocal',
  'Mr. Bruno Tamang':          'Keyboard',
  'Mr. Hari Datt Phulara':     'Vocal',
  'Mr. Sanjok Sharma':         'Instrument',
  'Mr. Yuson Maharjan':        'Tabla',
  'Mr. Nirajan Tandukar':      'Tabla',
};

// For each teacher above: their old Music subject assignments will be migrated
// to their new specialisation subject (same sections / same periodsPerWeek).
const MUSIC_TO_NEW = Object.fromEntries(
  Object.entries(DEPT_CHANGES).map(([name, dept]) => [name, dept])
);

async function main() {
  console.log('=== W.E. Sub-Department Migration ===\n');

  const allSubjects = await prisma.subject.findMany();
  const subjectMap = Object.fromEntries(allSubjects.map(s => [s.name, s]));

  // --- 1. Upsert new subjects ---
  for (const subj of NEW_SUBJECTS) {
    const existing = subjectMap[subj.name];
    if (existing) {
      console.log(`  Subject "${subj.name}" already exists — skipping`);
    } else {
      const created = await prisma.subject.create({ data: subj });
      subjectMap[subj.name] = created;
      console.log(`✓ Created subject: ${subj.name} (${subj.code})`);
    }
  }

  // Refresh subject map
  const refreshedSubjects = await prisma.subject.findMany();
  const sMap = Object.fromEntries(refreshedSubjects.map(s => [s.name, s]));

  const musicSubject = sMap['Music'];
  if (!musicSubject) throw new Error('Music subject not found in DB — cannot migrate assignments');

  // --- 2. Load teachers ---
  const allTeachers = await prisma.teacher.findMany();
  const teacherMap = Object.fromEntries(allTeachers.map(t => [t.name, t]));

  // --- 3. Update teacher departments + migrate assignments ---
  for (const [teacherName, newDept] of Object.entries(DEPT_CHANGES)) {
    const teacher = teacherMap[teacherName];
    if (!teacher) {
      console.warn(`  ⚠ Teacher not found: ${teacherName}`);
      continue;
    }

    // 3a. Update department
    if (teacher.department !== newDept) {
      await prisma.teacher.update({ where: { id: teacher.id }, data: { department: newDept } });
      console.log(`✓ ${teacherName}: ${teacher.department} → ${newDept}`);
    } else {
      console.log(`  ${teacherName} already has department "${newDept}"`);
    }

    // 3b. Find their existing Music assignments
    const newSubjectName = MUSIC_TO_NEW[teacherName];
    const newSubject = sMap[newSubjectName];
    if (!newSubject) {
      console.warn(`  ⚠ New subject "${newSubjectName}" not found — skipping assignment migration for ${teacherName}`);
      continue;
    }

    const oldAssignments = await prisma.teacherSubject.findMany({
      where: { teacherId: teacher.id, subjectId: musicSubject.id },
    });

    if (oldAssignments.length === 0) {
      console.log(`  No Music assignments to migrate for ${teacherName}`);
      continue;
    }

    // 3c. Delete old Music assignments for this teacher
    await prisma.teacherSubject.deleteMany({
      where: { teacherId: teacher.id, subjectId: musicSubject.id },
    });

    // 3d. Re-create under new subject (skip if already exists)
    let migrated = 0;
    for (const old of oldAssignments) {
      await prisma.teacherSubject.upsert({
        where: {
          teacherId_subjectId_sectionId: {
            teacherId: teacher.id,
            subjectId: newSubject.id,
            sectionId: old.sectionId,
          },
        },
        update: { periodsPerWeek: old.periodsPerWeek },
        create: {
          teacherId: teacher.id,
          subjectId: newSubject.id,
          sectionId: old.sectionId,
          periodsPerWeek: old.periodsPerWeek,
          isLabAssignment: false,
        },
      });
      migrated++;
    }
    console.log(`✓ Migrated ${migrated} assignment(s) for ${teacherName}: Music → ${newSubjectName}`);
  }

  console.log('\n=== Migration Complete ===');
}

main()
  .catch(e => { console.error('Migration failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
