import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { MAX_IMPORT_FILE_SIZE, ALLOWED_IMPORT_TYPES } from '@/lib/validation';

interface ImportRow {
  [key: string]: string | number | undefined;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getString(row: ImportRow, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function getNumber(row: ImportRow, keys: string[], def = 0): number {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'number' && isFinite(v)) return Math.floor(v);
    if (typeof v === 'string' && v.trim()) {
      const n = parseInt(v.trim(), 10);
      if (!isNaN(n)) return n;
    }
  }
  return def;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim()); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(content: string): ImportRow[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows: ImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row: ImportRow = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

// ── POST — import file ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const importTypeRaw = formData.get('type');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // File size guard
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum allowed size is 5 MB.' },
        { status: 400 }
      );
    }

    // Validate import type against whitelist
    const importType = ALLOWED_IMPORT_TYPES.includes(
      importTypeRaw as (typeof ALLOWED_IMPORT_TYPES)[number]
    )
      ? (importTypeRaw as (typeof ALLOWED_IMPORT_TYPES)[number])
      : 'timetable';

    const content = await file.text();
    const fileName = file.name.toLowerCase();

    // Validate file extension
    if (!fileName.endsWith('.csv') && !fileName.endsWith('.json')) {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload a .csv or .json file.' },
        { status: 400 }
      );
    }

    // Parse content
    let rows: ImportRow[];
    if (fileName.endsWith('.json')) {
      try {
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) throw new Error('JSON must be an array of objects');
        rows = parsed;
      } catch {
        return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 });
      }
    } else {
      rows = parseCSV(content);
    }

    // Limit row count to prevent DoS
    if (rows.length > 10_000) {
      return NextResponse.json(
        { error: 'File contains too many rows (max 10,000).' },
        { status: 400 }
      );
    }

    const result = await processImport(rows, importType);

    await db.importHistory.create({
      data: {
        fileName: file.name.slice(0, 255),
        fileType: fileName.endsWith('.csv') ? 'CSV' : 'JSON',
        importType,
        status: result.success ? 'Success' : 'Partial',
        recordsProcessed: result.processed,
        errors: result.errors.length > 0 ? JSON.stringify(result.errors.slice(0, 50)) : null,
      },
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Failed to import file' }, { status: 500 });
  }
}

// ── Process import ─────────────────────────────────────────────────────────────

async function processImport(
  rows: ImportRow[],
  importType: string
): Promise<{ success: boolean; processed: number; errors: string[]; message: string }> {
  const errors: string[] = [];
  let processed = 0;

  try {
    if (importType === 'teachers') {
      for (const row of rows) {
        try {
          const name = getString(row, ['name', 'teacher', 'Teacher']);
          const abbreviation = getString(row, ['abbreviation', 'abbr', 'Abbreviation', 'Abbr']);
          const department = getString(row, ['department', 'Department', 'subject', 'Subject']);
          const targetWorkload = getNumber(row, ['targetWorkload', 'workload', 'Workload'], 25);

          if (!name || !abbreviation) {
            errors.push(`Row ${processed + errors.length + 1}: name and abbreviation are required`);
            continue;
          }

          // Sanitise abbreviation to alphanumeric only
          const cleanAbbr = abbreviation.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10);

          await db.teacher.upsert({
            where: { abbreviation: cleanAbbr },
            update: { name: name.slice(0, 100), department: (department || 'General').slice(0, 60), targetWorkload: Math.min(Math.max(targetWorkload, 1), 60) },
            create: { name: name.slice(0, 100), abbreviation: cleanAbbr, department: (department || 'General').slice(0, 60), targetWorkload: Math.min(Math.max(targetWorkload, 1), 60) },
          });
          processed++;
        } catch {
          errors.push(`Row ${processed + errors.length + 1}: failed to import`);
        }
      }
    } else if (importType === 'subjects') {
      for (const row of rows) {
        try {
          const name = getString(row, ['name', 'subject', 'Subject']);
          const code = getString(row, ['code', 'Code']) || name.substring(0, 4).toUpperCase();
          const category = getString(row, ['category', 'Category']) || 'Core';

          if (!name || !code) {
            errors.push(`Row ${processed + errors.length + 1}: name and code are required`);
            continue;
          }

          await db.subject.upsert({
            where: { code: code.slice(0, 20) },
            update: { name: name.slice(0, 100), category: category.slice(0, 40) },
            create: { name: name.slice(0, 100), code: code.slice(0, 20), category: category.slice(0, 40), requiresLab: false },
          });
          processed++;
        } catch {
          errors.push(`Row ${processed + errors.length + 1}: failed to import`);
        }
      }
    } else if (importType === 'assignments') {
      const [teachers, subjects, sections] = await Promise.all([
        db.teacher.findMany(),
        db.subject.findMany(),
        db.section.findMany(),
      ]);
      const teacherMap = new Map(teachers.map(t => [t.abbreviation.toUpperCase(), t]));
      const subjectMap = new Map(subjects.map(s => [s.name.toLowerCase(), s]));
      const sectionMap = new Map(sections.map(s => [s.name.toUpperCase(), s]));

      for (const row of rows) {
        try {
          const teacherAbbr = getString(row, ['teacherAbbr', 'teacher_abbr', 'TeacherAbbr']).toUpperCase();
          const subjectName = getString(row, ['subject', 'Subject']).toLowerCase();
          const sectionName = getString(row, ['section', 'Section']).toUpperCase();
          const periodsPerWeek = Math.min(Math.max(getNumber(row, ['periodsPerWeek', 'periods', 'Periods'], 6), 1), 14);

          const teacher = teacherMap.get(teacherAbbr);
          const subject = subjectMap.get(subjectName);
          const section = sectionMap.get(sectionName);

          if (teacher && subject && section) {
            await db.teacherSubject.upsert({
              where: { teacherId_subjectId_sectionId: { teacherId: teacher.id, subjectId: subject.id, sectionId: section.id } },
              update: { periodsPerWeek },
              create: { teacherId: teacher.id, subjectId: subject.id, sectionId: section.id, periodsPerWeek },
            });
            processed++;
          } else {
            errors.push(`Row ${processed + errors.length + 1}: could not match teacher/subject/section`);
          }
        } catch {
          errors.push(`Row ${processed + errors.length + 1}: failed to import`);
        }
      }
    } else {
      // timetable import
      const [teachers, subjects, sections, days, timeSlots] = await Promise.all([
        db.teacher.findMany(),
        db.subject.findMany(),
        db.section.findMany(),
        db.day.findMany(),
        db.timeSlot.findMany(),
      ]);
      const teacherMap = new Map(teachers.map(t => [t.abbreviation.toUpperCase(), t]));
      const subjectMap = new Map(subjects.map(s => [s.name.toLowerCase(), s]));
      const sectionMap = new Map(sections.map(s => [s.name.toUpperCase(), s]));
      const dayMap = new Map(days.map(d => [d.name.toLowerCase(), d]));
      const slotMap = new Map(timeSlots.map(t => [t.periodNumber, t]));

      for (const row of rows) {
        try {
          const sectionName = getString(row, ['section', 'Section']).toUpperCase();
          const dayName = getString(row, ['day', 'Day']).toLowerCase();
          const period = getNumber(row, ['period', 'Period', 'periodNumber'], 0);
          const subjectName = getString(row, ['subject', 'Subject']).toLowerCase();
          const teacherAbbr = getString(row, ['teacherAbbr', 'teacher', 'Teacher']).toUpperCase();

          const section = sectionMap.get(sectionName);
          const day = dayMap.get(dayName);
          const timeSlot = slotMap.get(period);
          const subject = subjectMap.get(subjectName);
          const teacher = teacherMap.get(teacherAbbr);

          if (section && day && timeSlot && subject) {
            await db.timetableSlot.upsert({
              where: { sectionId_dayId_timeSlotId: { sectionId: section.id, dayId: day.id, timeSlotId: timeSlot.id } },
              update: { subjectId: subject.id, teacherId: teacher?.id },
              create: { sectionId: section.id, dayId: day.id, timeSlotId: timeSlot.id, subjectId: subject.id, teacherId: teacher?.id },
            });
            processed++;
          } else {
            errors.push(`Row ${processed + errors.length + 1}: missing section/day/period/subject`);
          }
        } catch {
          errors.push(`Row ${processed + errors.length + 1}: failed to import`);
        }
      }
    }

    return {
      success: errors.length === 0,
      processed,
      errors: errors.slice(0, 50),
      message: `Imported ${processed} records${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}`,
    };
  } catch {
    return { success: false, processed: 0, errors: ['Import processing failed'], message: 'Import failed' };
  }
}

// ── GET — import history ───────────────────────────────────────────────────────

export async function GET() {
  try {
    const history = await db.importHistory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return NextResponse.json({ history });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch import history' }, { status: 500 });
  }
}
