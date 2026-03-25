import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

const subjectMap: Record<string, string> = {
  '2nd Language': 'Hindi',
  '3rd Language': 'Nepali',
  'Maths/Chem/Home Sci': 'Mathematics',
  'Maths': 'Mathematics'
};

async function main() {
  const csvPath = path.join(__dirname, '../class_subject_periods.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found');
    return;
  }
  
  const csvStr = fs.readFileSync(csvPath, 'utf8');
  const lines = csvStr.split('\n').filter(l => l.trim().length > 0).slice(1);
  
  const dbSections = await prisma.section.findMany();
  const dbSubjects = await prisma.subject.findMany();
  const dbTeachers = await prisma.teacher.findMany();
  const dbAssignments = await prisma.teacherSubject.findMany({
      include: { section: true, subject: true }
  });

  let updated = 0;
  let created = 0;

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const secNameRaw = parts[0].trim();
    let csvSubj = parts[1].trim();
    const count = parseInt(parts[2].trim(), 10);
    
    if (subjectMap[csvSubj]) csvSubj = subjectMap[csvSubj];
    
    const dbSubj = dbSubjects.find(s => s.name.toLowerCase() === csvSubj.toLowerCase());
    if (!dbSubj) {
      if (!['Physics/Chem/Bio', 'Maths/Chem/Home Sci'].includes(csvSubj)) {
          console.log(`Could not find subject ${csvSubj} in DB.`);
      }
      continue;
    }
    
    const secNameLookup = secNameRaw.replace(/\s+/g, '').toUpperCase();
    const dbSec = dbSections.find(s => s.name.toUpperCase() === secNameLookup);
    if (!dbSec) {
      console.log(`Could not find section ${secNameRaw} (looked for ${secNameLookup}) in DB.`);
      continue;
    }
    
    const matches = dbAssignments.filter(a => a.sectionId === dbSec.id && a.subjectId === dbSubj.id);
    
    if (matches.length > 0) {
      await prisma.teacherSubject.update({
        where: { id: matches[0].id },
        data: { periodsPerWeek: count }
      });
      updated++;
    } else {
       // Create newly discovered assignment
       const eligibleTeachers = dbTeachers.filter(t => {
           let tg: string[] = [];
           try { tg = JSON.parse(t.teachableGrades) || []; } catch(e) {}
           // check if instructor teaches this subject/department
           return (t.department === dbSubj.name || t.department === dbSubj.category) 
                  && tg.includes(secNameLookup.replace(/[A-Z]$/, ''));
       });
       
       let teacherId = eligibleTeachers.length > 0 ? eligibleTeachers[0].id : null;
       
       if (!teacherId) {
           const fallback = dbTeachers.find(t => t.department === dbSubj.name || t.department === dbSubj.category);
           teacherId = fallback ? fallback.id : dbTeachers[0].id;
       }

       if (teacherId) {
         await prisma.teacherSubject.create({
           data: {
             sectionId: dbSec.id,
             subjectId: dbSubj.id,
             teacherId: teacherId,
             periodsPerWeek: count
           }
         });
         created++;
       }
    }
  }
  
  console.log(`Successfully processed CSV. Updated ${updated} assignments. Created ${created} new assignments.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
