import { Prisma, PrismaClient } from '@prisma/client';
import { teacherCanCoverSubject } from '@/lib/teacher-eligibility';

type DbClient = Prisma.TransactionClient | PrismaClient;

export async function assertPrimaryTeacherEligibility(
  db: DbClient,
  sectionId: string,
  subjectId: string,
  teacherId: string
) {
  const [section, subject, teacher] = await Promise.all([
    db.section.findUnique({
      where: { id: sectionId },
      include: { grade: { select: { name: true } } },
    }),
    db.subject.findUnique({
      where: { id: subjectId },
      select: { id: true, name: true, category: true },
    }),
    db.teacher.findUnique({
      where: { id: teacherId },
      select: {
        id: true,
        name: true,
        abbreviation: true,
        department: true,
        teachableGrades: true,
        isActive: true,
      },
    }),
  ]);

  if (!section) throw new Error('Section not found');
  if (!subject) throw new Error('Subject not found');
  if (!teacher) throw new Error('Teacher not found');

  if (!teacherCanCoverSubject(teacher, subject, section.grade.name)) {
    throw new Error(
      `${teacher.abbreviation} is not eligible to teach ${subject.name} for grade ${section.grade.name}`
    );
  }

  return { section, subject, teacher };
}

export async function syncPrimaryTeacherForSectionSubject(
  db: DbClient,
  args: {
    sectionId: string;
    subjectId: string;
    teacherId: string;
    periodsPerWeek?: number;
    isLabAssignment?: boolean;
    syncTimetable?: boolean;
  }
) {
  const {
    sectionId,
    subjectId,
    teacherId,
    periodsPerWeek,
    isLabAssignment,
    syncTimetable = true,
  } = args;

  const existingAssignments = await db.teacherSubject.findMany({
    where: { sectionId, subjectId },
  });

  const primaryAssignments = existingAssignments.filter(
    (assignment) => !assignment.isLabAssignment
  );

  const existingForTeacher = primaryAssignments.find((assignment) => assignment.teacherId === teacherId);
  const timetableCount = await db.timetableSlot.count({
    where: { sectionId, subjectId },
  });
  const resolvedPeriodsPerWeek =
    periodsPerWeek ??
    Math.max(
      1,
      timetableCount,
      ...primaryAssignments.map((assignment) => assignment.periodsPerWeek)
    );
  const resolvedIsLabAssignment =
    isLabAssignment ?? primaryAssignments.some((assignment) => assignment.isLabAssignment);

  let assignmentId = existingForTeacher?.id;
  if (existingForTeacher) {
    await db.teacherSubject.update({
      where: { id: existingForTeacher.id },
      data: {
        periodsPerWeek: resolvedPeriodsPerWeek,
        isLabAssignment: resolvedIsLabAssignment,
      },
    });
  } else {
    const created = await db.teacherSubject.create({
      data: {
        teacherId,
        subjectId,
        sectionId,
        periodsPerWeek: resolvedPeriodsPerWeek,
        isLabAssignment: resolvedIsLabAssignment,
      },
    });
    assignmentId = created.id;
  }

  const stalePrimaryIds = primaryAssignments
    .filter((assignment) => assignment.id !== assignmentId)
    .map((assignment) => assignment.id);

  if (stalePrimaryIds.length > 0) {
    await db.teacherSubject.deleteMany({
      where: { id: { in: stalePrimaryIds } },
    });
  }

  const syncedSlots = syncTimetable
    ? (
        await db.timetableSlot.updateMany({
          where: { sectionId, subjectId },
          data: { teacherId },
        })
      ).count
    : 0;

  return {
    assignmentId: assignmentId ?? null,
    syncedSlots,
    periodsPerWeek: resolvedPeriodsPerWeek,
  };
}

export async function assertTeacherAvailableForSectionSubjectSlots(
  db: DbClient,
  args: {
    sectionId: string;
    subjectId: string;
    teacherId: string;
    extraSlot?: {
      dayId: string;
      timeSlotId: string;
      isWE?: boolean;
      isGames?: boolean;
      isYoga?: boolean;
    };
  }
) {
  const targetSlotMap = new Map<
    string,
    { dayId: string; timeSlotId: string; isWE?: boolean; isGames?: boolean; isYoga?: boolean }
  >();

  const existingSlots = await db.timetableSlot.findMany({
    where: { sectionId: args.sectionId, subjectId: args.subjectId },
    select: {
      dayId: true,
      timeSlotId: true,
      isWE: true,
      isGames: true,
      isYoga: true,
    },
  });

  for (const slot of existingSlots) {
    targetSlotMap.set(`${slot.dayId}|${slot.timeSlotId}`, slot);
  }

  if (args.extraSlot) {
    targetSlotMap.set(`${args.extraSlot.dayId}|${args.extraSlot.timeSlotId}`, args.extraSlot);
  }

  const constrainedTargets = [...targetSlotMap.values()].filter(
    (slot) => !(slot.isWE || slot.isGames || slot.isYoga)
  );

  if (constrainedTargets.length === 0) return;

  const conflicts = await db.timetableSlot.findMany({
    where: {
      OR: [
        { teacherId: args.teacherId },
        { labTeacherId: args.teacherId },
      ],
      NOT: { sectionId: args.sectionId },
      AND: [
        {
          OR: constrainedTargets.map((slot) => ({
            dayId: slot.dayId,
            timeSlotId: slot.timeSlotId,
          })),
        },
      ],
    },
    select: {
      day: { select: { name: true } },
      timeSlot: { select: { periodNumber: true } },
      section: { select: { name: true } },
    },
    take: 1,
  });

  if (conflicts.length === 0) return;

  const [firstConflict] = conflicts;
  throw new Error(
    `Teacher already has a clash with ${firstConflict.section.name} on ${firstConflict.day.name} period ${firstConflict.timeSlot.periodNumber}`
  );
}
