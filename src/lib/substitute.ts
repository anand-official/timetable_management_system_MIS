import { db } from '@/lib/db';

export function normalizeDateOnly(input: string | Date): Date {
  const d = input instanceof Date ? new Date(input) : new Date(input);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getDayName(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

export async function suggestSubstitutes(teacherId: string, dateInput: string | Date) {
  const date = normalizeDateOnly(dateInput);
  const dayName = getDayName(date);
  const day = await db.day.findUnique({ where: { name: dayName } });
  if (!day) {
    return { date, dayName, slots: [] as any[] };
  }

  const absentSlots = await db.timetableSlot.findMany({
    where: { teacherId, dayId: day.id },
    include: {
      section: true,
      subject: true,
      teacher: true,
      day: true,
      timeSlot: true,
      room: true,
    },
    orderBy: { timeSlot: { periodNumber: 'asc' } },
  });

  const teacherSubjects = await db.teacherSubject.findMany({
    where: {
      subjectId: { in: absentSlots.map(s => s.subjectId).filter((v): v is string => !!v) },
    },
    include: { teacher: true },
  });

  const subjectToTeachers = new Map<string, { id: string; name: string; abbreviation: string }[]>();
  for (const ts of teacherSubjects) {
    if (!subjectToTeachers.has(ts.subjectId)) subjectToTeachers.set(ts.subjectId, []);
    const list = subjectToTeachers.get(ts.subjectId)!;
    if (!list.some(t => t.id === ts.teacherId)) {
      list.push({ id: ts.teacher.id, name: ts.teacher.name, abbreviation: ts.teacher.abbreviation });
    }
  }

  const daySlots = await db.timetableSlot.findMany({
    where: { dayId: day.id },
    select: { teacherId: true, timeSlotId: true },
  });
  const teacherBusy = new Set(
    daySlots
      .filter((s): s is { teacherId: string; timeSlotId: string } => Boolean(s.teacherId))
      .map(s => `${s.teacherId}|${s.timeSlotId}`)
  );

  const absencesToday = await db.teacherAbsence.findMany({
    where: { date },
    select: { teacherId: true },
  });
  const absentTeachersToday = new Set(absencesToday.map(a => a.teacherId));

  const unavailabilityToday = await db.teacherUnavailability.findMany({
    where: { dayId: day.id },
    select: { teacherId: true, timeSlotId: true },
  });
  const unavailableSet = new Set(unavailabilityToday.map(u => `${u.teacherId}|${u.timeSlotId}`));

  const slots = absentSlots.map(slot => {
    const subjectId = slot.subjectId;
    const candidates = subjectId ? (subjectToTeachers.get(subjectId) ?? []) : [];
    const suggestions = candidates.filter(candidate => {
      if (candidate.id === teacherId) return false;
      if (absentTeachersToday.has(candidate.id)) return false;
      if (teacherBusy.has(`${candidate.id}|${slot.timeSlotId}`)) return false;
      if (unavailableSet.has(`${candidate.id}|${slot.timeSlotId}`)) return false;
      return true;
    });
    return {
      slotId: slot.id,
      periodNumber: slot.timeSlot.periodNumber,
      dayName: slot.day.name,
      sectionName: slot.section.name,
      subjectName: slot.subject?.name ?? '',
      currentTeacher: slot.teacher ? { id: slot.teacher.id, name: slot.teacher.name, abbreviation: slot.teacher.abbreviation } : null,
      suggestions,
    };
  });

  return { date, dayName, slots };
}
