import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const createdAt = text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`);
const updatedAt = text('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`);

export const grades = sqliteTable('Grade', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  level: text('level').notNull(),
  createdAt,
  updatedAt,
}, (table) => ({
  nameUnique: uniqueIndex('grade_name_unique').on(table.name),
}));

export const sections = sqliteTable('Section', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  gradeId: text('gradeId').notNull(),
  classTeacherId: text('classTeacherId'),
  coordinatorId: text('coordinatorId'),
  stream: text('stream'),
  createdAt,
  updatedAt,
}, (table) => ({
  nameUnique: uniqueIndex('section_name_unique').on(table.name),
}));

export const subjects = sqliteTable('Subject', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  category: text('category').notNull(),
  requiresLab: integer('requiresLab', { mode: 'boolean' }).notNull().default(false),
  isDoublePeriod: integer('isDoublePeriod', { mode: 'boolean' }).notNull().default(false),
  createdAt,
  updatedAt,
}, (table) => ({
  nameUnique: uniqueIndex('subject_name_unique').on(table.name),
  codeUnique: uniqueIndex('subject_code_unique').on(table.code),
}));

export const teachers = sqliteTable('Teacher', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  abbreviation: text('abbreviation').notNull(),
  department: text('department').notNull(),
  isHOD: integer('isHOD', { mode: 'boolean' }).notNull().default(false),
  targetWorkload: integer('targetWorkload').notNull().default(0),
  currentWorkload: integer('currentWorkload').notNull().default(0),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  teachableGrades: text('teachableGrades').notNull().default('[]'),
  createdAt,
  updatedAt,
}, (table) => ({
  abbreviationUnique: uniqueIndex('teacher_abbreviation_unique').on(table.abbreviation),
}));

export const teacherSubjects = sqliteTable('TeacherSubject', {
  id: text('id').primaryKey(),
  teacherId: text('teacherId').notNull(),
  subjectId: text('subjectId').notNull(),
  sectionId: text('sectionId').notNull(),
  periodsPerWeek: integer('periodsPerWeek').notNull().default(0),
  isLabAssignment: integer('isLabAssignment', { mode: 'boolean' }).notNull().default(false),
  createdAt,
  updatedAt,
}, (table) => ({
  uniqueAssignment: uniqueIndex('teacher_subject_unique').on(table.teacherId, table.subjectId, table.sectionId),
}));

export const timeSlots = sqliteTable('TimeSlot', {
  id: text('id').primaryKey(),
  periodNumber: integer('periodNumber').notNull(),
  startTime: text('startTime').notNull(),
  endTime: text('endTime').notNull(),
  duration: integer('duration').notNull(),
  slotType: text('slotType').notNull(),
  createdAt,
  updatedAt,
}, (table) => ({
  periodNumberUnique: uniqueIndex('timeslot_period_number_unique').on(table.periodNumber),
}));

export const days = sqliteTable('Day', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  dayOrder: integer('dayOrder').notNull(),
  createdAt,
  updatedAt,
}, (table) => ({
  nameUnique: uniqueIndex('day_name_unique').on(table.name),
  orderUnique: uniqueIndex('day_order_unique').on(table.dayOrder),
}));

export const teacherUnavailabilities = sqliteTable('TeacherUnavailability', {
  id: text('id').primaryKey(),
  teacherId: text('teacherId').notNull(),
  dayId: text('dayId').notNull(),
  timeSlotId: text('timeSlotId').notNull(),
  reason: text('reason'),
  createdAt,
  updatedAt,
}, (table) => ({
  uniqueTeacherSlot: uniqueIndex('teacher_unavailability_unique').on(table.teacherId, table.dayId, table.timeSlotId),
}));

export const timetableSlots = sqliteTable('TimetableSlot', {
  id: text('id').primaryKey(),
  sectionId: text('sectionId').notNull(),
  dayId: text('dayId').notNull(),
  timeSlotId: text('timeSlotId').notNull(),
  subjectId: text('subjectId'),
  teacherId: text('teacherId'),
  labTeacherId: text('labTeacherId'),
  roomId: text('roomId'),
  isLab: integer('isLab', { mode: 'boolean' }).notNull().default(false),
  isInnovation: integer('isInnovation', { mode: 'boolean' }).notNull().default(false),
  isGames: integer('isGames', { mode: 'boolean' }).notNull().default(false),
  isYoga: integer('isYoga', { mode: 'boolean' }).notNull().default(false),
  isLibrary: integer('isLibrary', { mode: 'boolean' }).notNull().default(false),
  isWE: integer('isWE', { mode: 'boolean' }).notNull().default(false),
  isMusic: integer('isMusic', { mode: 'boolean' }).notNull().default(false),
  isArt: integer('isArt', { mode: 'boolean' }).notNull().default(false),
  isFiller: integer('isFiller', { mode: 'boolean' }).notNull().default(false),
  manuallyEdited: integer('manuallyEdited', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  createdAt,
  updatedAt,
}, (table) => ({
  uniqueSectionSlot: uniqueIndex('timetable_slot_unique').on(table.sectionId, table.dayId, table.timeSlotId),
}));

export const rooms = sqliteTable('Room', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  grades: text('grades', { mode: 'json' }).$type<string[] | null>(),
  createdAt,
  updatedAt,
}, (table) => ({
  nameUnique: uniqueIndex('room_name_unique').on(table.name),
}));

export const subjectRooms = sqliteTable('SubjectRoom', {
  id: text('id').primaryKey(),
  subjectId: text('subjectId').notNull(),
  roomId: text('roomId').notNull(),
}, (table) => ({
  uniqueSubjectRoom: uniqueIndex('subject_room_unique').on(table.subjectId, table.roomId),
}));

export const schoolConfig = sqliteTable('SchoolConfig', {
  id: text('id').primaryKey(),
  schoolName: text('schoolName').notNull().default('Modern Indian School'),
  academicYear: text('academicYear').notNull().default('2025-26'),
  seniorStartTime: text('seniorStartTime').notNull().default('7:35'),
  seniorEndTime: text('seniorEndTime').notNull().default('13:45'),
  juniorStartTime: text('juniorStartTime').notNull().default('9:15'),
  juniorEndTime: text('juniorEndTime').notNull().default('15:10'),
  totalPeriodsSenior: integer('totalPeriodsSenior').notNull().default(8),
  totalPeriodsJunior: integer('totalPeriodsJunior').notNull().default(8),
  workingDays: integer('workingDays').notNull().default(6),
  fillEmptySlots: integer('fillEmptySlots', { mode: 'boolean' }).notNull().default(true),
  allowDuplicateActivities: integer('allowDuplicateActivities', { mode: 'boolean' }).notNull().default(true),
  studyPeriodTeacherPool: text('studyPeriodTeacherPool').notNull().default('[]'),
  createdAt,
  updatedAt,
});

export const scoringWeights = sqliteTable('ScoringWeights', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default('default'),
  subjectPreferenceWeight: real('subjectPreferenceWeight').notNull().default(2),
  teacherDailyLoadWeight: real('teacherDailyLoadWeight').notNull().default(1.5),
  sectionDailyLoadWeight: real('sectionDailyLoadWeight').notNull().default(1),
  subjectSpreadWeight: real('subjectSpreadWeight').notNull().default(1.5),
  teacherAdjacencyPenaltyWeight: real('teacherAdjacencyPenaltyWeight').notNull().default(1.2),
  labLastPeriodPenaltyWeight: real('labLastPeriodPenaltyWeight').notNull().default(1),
  classTeacherBonusWeight: real('classTeacherBonusWeight').notNull().default(0.8),
  roomAvailabilityWeight: real('roomAvailabilityWeight').notNull().default(1),
  labPlacementWeight: real('labPlacementWeight').notNull().default(2),
  createdAt,
  updatedAt,
}, (table) => ({
  nameUnique: uniqueIndex('scoring_weights_name_unique').on(table.name),
}));

export const importHistory = sqliteTable('ImportHistory', {
  id: text('id').primaryKey(),
  fileName: text('fileName').notNull(),
  fileType: text('fileType').notNull(),
  importType: text('importType').notNull(),
  status: text('status').notNull(),
  recordsProcessed: integer('recordsProcessed').notNull().default(0),
  errors: text('errors'),
  createdAt,
});

export const workloadValidations = sqliteTable('WorkloadValidation', {
  id: text('id').primaryKey(),
  teacherId: text('teacherId').notNull(),
  targetWorkload: integer('targetWorkload').notNull(),
  actualWorkload: integer('actualWorkload').notNull(),
  difference: integer('difference').notNull(),
  status: text('status').notNull(),
  warnings: text('warnings'),
  validatedAt: text('validatedAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const teacherAbsences = sqliteTable('TeacherAbsence', {
  id: text('id').primaryKey(),
  teacherId: text('teacherId').notNull(),
  date: text('date').notNull(),
  reason: text('reason'),
  createdAt,
  updatedAt,
}, (table) => ({
  uniqueTeacherDate: uniqueIndex('teacher_absence_unique').on(table.teacherId, table.date),
}));

export const drizzleSchema = {
  grades,
  sections,
  subjects,
  teachers,
  teacherSubjects,
  timeSlots,
  days,
  teacherUnavailabilities,
  timetableSlots,
  rooms,
  subjectRooms,
  schoolConfig,
  scoringWeights,
  importHistory,
  workloadValidations,
  teacherAbsences,
};

export type SchoolConfigRow = typeof schoolConfig.$inferSelect;
export type ScoringWeightsRow = typeof scoringWeights.$inferSelect;
