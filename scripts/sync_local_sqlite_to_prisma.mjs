import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const sqlitePath = path.join(root, 'prisma', 'dev.db');

const runtimeUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  '';

if (!runtimeUrl.startsWith('postgres://') && !runtimeUrl.startsWith('postgresql://')) {
  console.error('Expected a Postgres DATABASE_URL for the Prisma target.');
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const prisma = new PrismaClient();

function rows(tableName) {
  return sqlite.prepare(`SELECT * FROM "${tableName}"`).all();
}

function rowMap(rowsIn, key) {
  return new Map(rowsIn.map((row) => [row[key], row]));
}

function bool(value) {
  return Boolean(value);
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) {
      return new Date(Number(value));
    }
    if (value.includes('T')) {
      return new Date(value);
    }
    return new Date(value.replace(' ', 'T') + 'Z');
  }
  return new Date();
}

async function upsertBaseData(local) {
  for (const grade of local.grades) {
    await prisma.grade.upsert({
      where: { name: grade.name },
      update: { level: grade.level },
      create: { name: grade.name, level: grade.level },
    });
  }

  for (const subject of local.subjects) {
    await prisma.subject.upsert({
      where: { code: subject.code },
      update: {
        name: subject.name,
        category: subject.category,
        requiresLab: bool(subject.requiresLab),
        isDoublePeriod: bool(subject.isDoublePeriod),
      },
      create: {
        name: subject.name,
        code: subject.code,
        category: subject.category,
        requiresLab: bool(subject.requiresLab),
        isDoublePeriod: bool(subject.isDoublePeriod),
      },
    });
  }

  for (const day of local.days) {
    await prisma.day.upsert({
      where: { name: day.name },
      update: { dayOrder: day.dayOrder },
      create: { name: day.name, dayOrder: day.dayOrder },
    });
  }

  for (const timeSlot of local.timeSlots) {
    await prisma.timeSlot.upsert({
      where: { periodNumber: timeSlot.periodNumber },
      update: {
        startTime: timeSlot.startTime,
        endTime: timeSlot.endTime,
        duration: timeSlot.duration,
        slotType: timeSlot.slotType,
      },
      create: {
        periodNumber: timeSlot.periodNumber,
        startTime: timeSlot.startTime,
        endTime: timeSlot.endTime,
        duration: timeSlot.duration,
        slotType: timeSlot.slotType,
      },
    });
  }

  for (const teacher of local.teachers) {
    await prisma.teacher.upsert({
      where: { abbreviation: teacher.abbreviation },
      update: {
        name: teacher.name,
        department: teacher.department,
        isHOD: bool(teacher.isHOD),
        targetWorkload: teacher.targetWorkload,
        currentWorkload: teacher.currentWorkload,
        isActive: bool(teacher.isActive),
        teachableGrades: teacher.teachableGrades,
      },
      create: {
        name: teacher.name,
        abbreviation: teacher.abbreviation,
        department: teacher.department,
        isHOD: bool(teacher.isHOD),
        targetWorkload: teacher.targetWorkload,
        currentWorkload: teacher.currentWorkload,
        isActive: bool(teacher.isActive),
        teachableGrades: teacher.teachableGrades,
      },
    });
  }

  for (const room of local.rooms) {
    await prisma.room.upsert({
      where: { name: room.name },
      update: { grades: room.grades ? JSON.parse(room.grades) : null },
      create: { name: room.name, grades: room.grades ? JSON.parse(room.grades) : null },
    });
  }
}

async function syncSections(local) {
  const remoteGrades = rowMap(await prisma.grade.findMany(), 'name');
  const remoteTeachers = rowMap(await prisma.teacher.findMany(), 'abbreviation');
  const localGradesById = rowMap(local.grades, 'id');
  const localTeachersById = rowMap(local.teachers, 'id');

  for (const section of local.sections) {
    const localGrade = localGradesById.get(section.gradeId);
    if (!localGrade) {
      throw new Error(`Missing local grade for section ${section.name}`);
    }
    const remoteGrade = remoteGrades.get(localGrade.name);
    if (!remoteGrade) {
      throw new Error(`Missing remote grade ${localGrade.name}`);
    }

    const localClassTeacher = section.classTeacherId
      ? localTeachersById.get(section.classTeacherId)
      : null;
    const localCoordinator = section.coordinatorId
      ? localTeachersById.get(section.coordinatorId)
      : null;

    await prisma.section.upsert({
      where: { name: section.name },
      update: {
        gradeId: remoteGrade.id,
        stream: section.stream,
        classTeacherId: localClassTeacher
          ? remoteTeachers.get(localClassTeacher.abbreviation)?.id ?? null
          : null,
        coordinatorId: localCoordinator
          ? remoteTeachers.get(localCoordinator.abbreviation)?.id ?? null
          : null,
      },
      create: {
        name: section.name,
        gradeId: remoteGrade.id,
        stream: section.stream,
        classTeacherId: localClassTeacher
          ? remoteTeachers.get(localClassTeacher.abbreviation)?.id ?? null
          : null,
        coordinatorId: localCoordinator
          ? remoteTeachers.get(localCoordinator.abbreviation)?.id ?? null
          : null,
      },
    });
  }
}

async function syncSubjectRooms(local) {
  const remoteSubjects = rowMap(await prisma.subject.findMany(), 'code');
  const remoteRooms = rowMap(await prisma.room.findMany(), 'name');
  const localSubjectsById = rowMap(local.subjects, 'id');
  const localRoomsById = rowMap(local.rooms, 'id');

  await prisma.subjectRoom.deleteMany();

  const payload = [];
  for (const row of local.subjectRooms) {
    const localSubject = localSubjectsById.get(row.subjectId);
    const localRoom = localRoomsById.get(row.roomId);
    if (!localSubject || !localRoom) continue;

    const remoteSubject = remoteSubjects.get(localSubject.code);
    const remoteRoom = remoteRooms.get(localRoom.name);
    if (!remoteSubject || !remoteRoom) continue;

    payload.push({
      subjectId: remoteSubject.id,
      roomId: remoteRoom.id,
    });
  }

  if (payload.length > 0) {
    await prisma.subjectRoom.createMany({ data: payload, skipDuplicates: true });
  }
}

async function syncTeacherSubjects(local) {
  const remoteSubjects = rowMap(await prisma.subject.findMany(), 'code');
  const remoteTeachers = rowMap(await prisma.teacher.findMany(), 'abbreviation');
  const remoteSections = rowMap(await prisma.section.findMany(), 'name');
  const localSubjectsById = rowMap(local.subjects, 'id');
  const localTeachersById = rowMap(local.teachers, 'id');
  const localSectionsById = rowMap(local.sections, 'id');

  await prisma.teacherSubject.deleteMany();

  const payload = [];
  for (const row of local.teacherSubjects) {
    const localSubject = localSubjectsById.get(row.subjectId);
    const localTeacher = localTeachersById.get(row.teacherId);
    const localSection = localSectionsById.get(row.sectionId);
    if (!localSubject || !localTeacher || !localSection) continue;

    const remoteSubject = remoteSubjects.get(localSubject.code);
    const remoteTeacher = remoteTeachers.get(localTeacher.abbreviation);
    const remoteSection = remoteSections.get(localSection.name);
    if (!remoteSubject || !remoteTeacher || !remoteSection) continue;

    payload.push({
      id: row.id,
      teacherId: remoteTeacher.id,
      subjectId: remoteSubject.id,
      sectionId: remoteSection.id,
      periodsPerWeek: row.periodsPerWeek,
      isLabAssignment: bool(row.isLabAssignment),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    });
  }

  if (payload.length > 0) {
    await prisma.teacherSubject.createMany({ data: payload });
  }
}

async function syncTimetableSlots(local) {
  const remoteSubjects = rowMap(await prisma.subject.findMany(), 'code');
  const remoteTeachers = rowMap(await prisma.teacher.findMany(), 'abbreviation');
  const remoteSections = rowMap(await prisma.section.findMany(), 'name');
  const remoteDays = rowMap(await prisma.day.findMany(), 'name');
  const remoteTimeSlots = rowMap(await prisma.timeSlot.findMany(), 'periodNumber');
  const remoteRooms = rowMap(await prisma.room.findMany(), 'name');

  const localSubjectsById = rowMap(local.subjects, 'id');
  const localTeachersById = rowMap(local.teachers, 'id');
  const localSectionsById = rowMap(local.sections, 'id');
  const localDaysById = rowMap(local.days, 'id');
  const localTimeSlotsById = rowMap(local.timeSlots, 'id');
  const localRoomsById = rowMap(local.rooms, 'id');

  await prisma.timetableSlot.deleteMany();

  const payload = [];
  for (const row of local.timetableSlots) {
    const localSection = localSectionsById.get(row.sectionId);
    const localDay = localDaysById.get(row.dayId);
    const localTimeSlot = localTimeSlotsById.get(row.timeSlotId);
    if (!localSection || !localDay || !localTimeSlot) continue;

    const remoteSection = remoteSections.get(localSection.name);
    const remoteDay = remoteDays.get(localDay.name);
    const remoteTimeSlot = remoteTimeSlots.get(localTimeSlot.periodNumber);
    if (!remoteSection || !remoteDay || !remoteTimeSlot) continue;

    const localSubject = row.subjectId ? localSubjectsById.get(row.subjectId) : null;
    const localTeacher = row.teacherId ? localTeachersById.get(row.teacherId) : null;
    const localLabTeacher = row.labTeacherId ? localTeachersById.get(row.labTeacherId) : null;
    const localRoom = row.roomId ? localRoomsById.get(row.roomId) : null;

    payload.push({
      id: row.id,
      sectionId: remoteSection.id,
      dayId: remoteDay.id,
      timeSlotId: remoteTimeSlot.id,
      subjectId: localSubject ? remoteSubjects.get(localSubject.code)?.id ?? null : null,
      teacherId: localTeacher ? remoteTeachers.get(localTeacher.abbreviation)?.id ?? null : null,
      labTeacherId: localLabTeacher ? remoteTeachers.get(localLabTeacher.abbreviation)?.id ?? null : null,
      roomId: localRoom ? remoteRooms.get(localRoom.name)?.id ?? null : null,
      isLab: bool(row.isLab),
      isInnovation: bool(row.isInnovation),
      isGames: bool(row.isGames),
      isYoga: bool(row.isYoga),
      isLibrary: bool(row.isLibrary),
      isWE: bool(row.isWE),
      isMusic: bool(row.isMusic),
      isArt: bool(row.isArt),
      isFiller: bool(row.isFiller),
      manuallyEdited: bool(row.manuallyEdited),
      notes: row.notes,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    });
  }

  const chunkSize = 250;
  for (let index = 0; index < payload.length; index += chunkSize) {
    await prisma.timetableSlot.createMany({
      data: payload.slice(index, index + chunkSize),
    });
  }
}

async function syncSchoolConfig(local) {
  const latestLocal = local.schoolConfig[0];
  if (!latestLocal) return;

  const existing = await prisma.schoolConfig.findFirst();
  const data = {
    schoolName: latestLocal.schoolName,
    academicYear: latestLocal.academicYear,
    seniorStartTime: latestLocal.seniorStartTime,
    seniorEndTime: latestLocal.seniorEndTime,
    juniorStartTime: latestLocal.juniorStartTime,
    juniorEndTime: latestLocal.juniorEndTime,
    totalPeriodsSenior: latestLocal.totalPeriodsSenior,
    totalPeriodsJunior: latestLocal.totalPeriodsJunior,
    workingDays: latestLocal.workingDays,
    fillEmptySlots: bool(latestLocal.fillEmptySlots),
    allowDuplicateActivities: bool(latestLocal.allowDuplicateActivities),
    studyPeriodTeacherPool: latestLocal.studyPeriodTeacherPool,
  };

  if (existing) {
    await prisma.schoolConfig.update({
      where: { id: existing.id },
      data,
    });
  } else {
    await prisma.schoolConfig.create({ data });
  }
}

async function main() {
  const local = {
    grades: rows('Grade'),
    sections: rows('Section'),
    subjects: rows('Subject'),
    teachers: rows('Teacher'),
    teacherSubjects: rows('TeacherSubject'),
    days: rows('Day'),
    timeSlots: rows('TimeSlot'),
    timetableSlots: rows('TimetableSlot'),
    rooms: rows('Room'),
    subjectRooms: rows('SubjectRoom'),
    schoolConfig: sqlite.prepare('SELECT * FROM "SchoolConfig" ORDER BY createdAt DESC LIMIT 1').all(),
  };

  console.log(`Source SQLite: ${sqlitePath}`);
  console.log(`Teachers: ${local.teachers.length}`);
  console.log(`TeacherSubject rows: ${local.teacherSubjects.length}`);
  console.log(`Timetable slots: ${local.timetableSlots.length}`);

  await upsertBaseData(local);
  await syncSections(local);
  await syncSubjectRooms(local);
  await syncTeacherSubjects(local);
  await syncTimetableSlots(local);
  await syncSchoolConfig(local);

  const teacherCount = await prisma.teacher.count();
  const teacherSubjectCount = await prisma.teacherSubject.count();
  const timetableSlotCount = await prisma.timetableSlot.count();
  const academicYear = (await prisma.schoolConfig.findFirst())?.academicYear ?? null;

  console.log('Sync complete');
  console.log(`Remote teachers: ${teacherCount}`);
  console.log(`Remote TeacherSubject rows: ${teacherSubjectCount}`);
  console.log(`Remote timetable slots: ${timetableSlotCount}`);
  console.log(`Remote academic year: ${academicYear}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    sqlite.close();
  });
