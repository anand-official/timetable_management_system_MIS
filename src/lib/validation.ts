import { z } from 'zod';

// ── Shared primitives ──────────────────────────────────────────────────────────

const cuid = () => z.string().min(1).max(128);

const GRADES = ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'] as const;

// ── Teacher ────────────────────────────────────────────────────────────────────

export const TeacherCreateSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  abbreviation: z
    .string()
    .min(1)
    .max(10)
    .trim()
    .regex(/^[A-Za-z0-9]+$/, 'Abbreviation must be alphanumeric'),
  department: z.string().min(2).max(60).trim(),
  isHOD: z.boolean().optional().default(false),
  targetWorkload: z.number().int().min(1).max(60).optional().default(30),
  isActive: z.boolean().optional().default(true),
  teachableGrades: z
    .array(z.enum(GRADES))
    .optional()
    .default([]),
});

export const TeacherUpdateSchema = TeacherCreateSchema.partial().extend({
  id: cuid(),
});

// ── Timetable slot ─────────────────────────────────────────────────────────────

export const TimetableSlotSchema = z.object({
  sectionId: cuid(),
  dayId: cuid(),
  timeSlotId: cuid(),
  subjectId: cuid().nullable().optional(),
  teacherId: cuid().nullable().optional(),
  labTeacherId: cuid().nullable().optional(),
  roomId: cuid().nullable().optional(),
  isLab: z.boolean().optional().default(false),
  isGames: z.boolean().optional().default(false),
  isYoga: z.boolean().optional().default(false),
  isLibrary: z.boolean().optional().default(false),
  isInnovation: z.boolean().optional().default(false),
  isWE: z.boolean().optional().default(false),
  manuallyEdited: z.boolean().optional(),
  notes: z.string().max(500).trim().optional(),
});

// ── Export ─────────────────────────────────────────────────────────────────────

export const ALLOWED_FORMATS = ['json', 'csv', 'excel', 'pdf'] as const;
export const ALLOWED_EXPORT_TYPES = ['class', 'teacher', 'workload'] as const;

export const ExportQuerySchema = z.object({
  format: z.enum(ALLOWED_FORMATS).optional().default('json'),
  type: z.enum(ALLOWED_EXPORT_TYPES).optional().default('class'),
});

// ── Import ─────────────────────────────────────────────────────────────────────

export const ALLOWED_IMPORT_TYPES = [
  'timetable',
  'teachers',
  'subjects',
  'assignments',
] as const;

export const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// ── AI Schedule ────────────────────────────────────────────────────────────────

export const AiScheduleSchema = z.object({
  action: z.enum(['analyze', 'optimize', 'suggest']).optional().default('analyze'),
  sectionId: cuid().optional(),
  teacherId: cuid().optional(),
});

// ── TeacherSubject ─────────────────────────────────────────────────────────────

export const TeacherSubjectCreateSchema = z.object({
  teacherId:       cuid(),
  subjectId:       cuid(),
  sectionId:       cuid(),
  periodsPerWeek:  z.number().int().min(1).max(20),
  isLabAssignment: z.boolean().optional().default(false),
});

export const TeacherSubjectUpdateSchema = TeacherSubjectCreateSchema.partial().extend({
  id: cuid(),
});

/** One row from the bulk-import CSV */
export const BulkRowSchema = z.object({
  /** Teacher abbreviation OR full name */
  teacher:         z.string().min(1).max(100).trim(),
  subject:         z.string().min(1).max(100).trim(),
  section:         z.string().min(1).max(20).trim(),
  periodsPerWeek:  z.coerce.number().int().min(1).max(20),
  isLabAssignment: z.coerce.boolean().optional().default(false),
});

export const BulkImportSchema = z.object({
  rows: z.array(BulkRowSchema).min(1).max(2000),
});

// ── Generate ───────────────────────────────────────────────────────────────────

export const GenerateSchema = z.object({
  clearExisting: z.boolean().optional().default(true),
  preserveLocked: z.boolean().optional().default(false),
  autoRepairLabs: z.boolean().optional().default(true),
});

// ── Teacher Unavailability ─────────────────────────────────────────────────────

export const TeacherUnavailabilityCreateSchema = z.object({
  teacherId: cuid(),
  dayId: cuid(),
  timeSlotId: cuid(),
  reason: z.string().max(500).trim().optional(),
});

export const TeacherUnavailabilityUpdateSchema = z.object({
  id: cuid(),
  dayId: cuid().optional(),
  timeSlotId: cuid().optional(),
  reason: z.string().max(500).trim().optional(),
});

// ── Helper ─────────────────────────────────────────────────────────────────────

/** Returns a 400 JSON response with Zod error details. */
export function validationError(err: z.ZodError) {
  return {
    error: 'Validation failed',
    issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  };
}
