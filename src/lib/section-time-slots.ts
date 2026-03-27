type TimeSlotLike = {
  id: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  duration?: number;
  slotType?: string;
};

const CLASS_VI_PERIODS = new Map<number, Pick<TimeSlotLike, 'startTime' | 'endTime' | 'duration'>>([
  [1, { startTime: '9:30', endTime: '10:10', duration: 40 }],
  [2, { startTime: '10:10', endTime: '10:50', duration: 40 }],
  [3, { startTime: '10:50', endTime: '11:30', duration: 40 }],
  [4, { startTime: '12:00', endTime: '12:35', duration: 35 }],
  [5, { startTime: '12:35', endTime: '13:10', duration: 35 }],
  [6, { startTime: '13:10', endTime: '13:45', duration: 35 }],
  [7, { startTime: '13:45', endTime: '14:20', duration: 35 }],
  [8, { startTime: '14:20', endTime: '15:00', duration: 40 }],
]);

export function isClassVISection(sectionName?: string | null): boolean {
  return typeof sectionName === 'string' && /^VI[A-Z]$/.test(sectionName.trim().toUpperCase());
}

export function getSectionDisplayTimeSlots<T extends TimeSlotLike>(
  sectionName: string | null | undefined,
  timeSlots: T[],
): T[] {
  if (!isClassVISection(sectionName)) {
    return timeSlots;
  }

  return timeSlots.map((slot) => {
    const override = CLASS_VI_PERIODS.get(slot.periodNumber);
    return override ? { ...slot, ...override } : slot;
  });
}

export function getSectionDisplayTimeSlot<T extends TimeSlotLike>(
  sectionName: string | null | undefined,
  timeSlot: T,
): T {
  return getSectionDisplayTimeSlots(sectionName, [timeSlot])[0];
}

export function getTeacherDisplayTimeSlots<
  T extends TimeSlotLike,
  S extends { section?: { name?: string | null } | null; timeSlot: T }
>(
  slots: S[],
  timeSlots: T[],
): T[] {
  const labelsByPeriod = new Map<number, T[]>();

  for (const slot of slots) {
    const displaySlot = getSectionDisplayTimeSlot(slot.section?.name ?? null, slot.timeSlot);
    const existing = labelsByPeriod.get(displaySlot.periodNumber) ?? [];
    if (!existing.some((item) => item.startTime === displaySlot.startTime && item.endTime === displaySlot.endTime)) {
      existing.push(displaySlot);
      labelsByPeriod.set(displaySlot.periodNumber, existing);
    }
  }

  return timeSlots.map((timeSlot) => {
    const displaySlots = labelsByPeriod.get(timeSlot.periodNumber) ?? [];
    if (displaySlots.length === 1) {
      return { ...timeSlot, ...displaySlots[0] };
    }
    if (displaySlots.length > 1) {
      return { ...timeSlot, startTime: 'Varies', endTime: 'by class' };
    }
    return timeSlot;
  });
}
