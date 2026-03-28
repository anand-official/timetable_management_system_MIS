'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { GAMES_PERIOD_ID, GAMES_PERIOD_NAME } from '@/lib/substitute';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
  Users,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type Teacher = { id: string; name: string; abbreviation: string };

type Candidate = {
  id: string;
  name: string;
  abbreviation: string;
  score: number;
  reasons: string[];
};

type SuggestedSlot = {
  slotId: string;
  timeSlotId: string;
  periodNumber: number;
  dayName: string;
  sectionName: string;
  sectionId: string;
  subjectName: string;
  subjectCode: string;
  subjectId: string | null;
  currentTeacher: { id: string; name: string; abbreviation: string } | null;
  assignedSubstitute: { id: string; name: string; abbreviation: string } | null;
  suggestions: Candidate[];
  topPick: Candidate | null;
};

type DailyAbsence = {
  absenceId: string;
  reason?: string | null;
  teacher: { id: string; name: string; abbreviation: string };
  slots: SuggestedSlot[];
};

function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function scoreColor(score: number) {
  if (score >= 70) {
    return 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30';
  }
  if (score >= 40) {
    return 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30';
  }
  return 'text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-700';
}

export default function SubstitutePage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => formatLocalDateInput(new Date()));
  const [absences, setAbsences] = useState<DailyAbsence[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingAbsence, setAddingAbsence] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [deletingAbsenceId, setDeletingAbsenceId] = useState<string | null>(null);
  const [choiceByKey, setChoiceByKey] = useState<Record<string, string>>({});

  const selectedTeacher = useMemo(
    () => teachers.find((teacher) => teacher.id === selectedTeacherId) ?? null,
    [teachers, selectedTeacherId]
  );

  const totalSlots = absences.reduce((sum, absence) => sum + absence.slots.length, 0);
  const assignedSlots = absences.reduce(
    (sum, absence) => sum + absence.slots.filter((slot) => slot.assignedSubstitute).length,
    0
  );
  const pendingSlots = totalSlots - assignedSlots;

  const loadTeachers = async () => {
    try {
      const response = await fetch('/api/timetable', { cache: 'no-store' });
      const data = await response.json();
      const nextTeachers: Teacher[] = data.teachers || [];
      setTeachers(nextTeachers);
      if (!selectedTeacherId && nextTeachers.length > 0) {
        setSelectedTeacherId(nextTeachers[0].id);
      }
    } catch {
      toast.error('Failed to load teachers');
    }
  };

  const loadDayPlan = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/substitute/day?date=${selectedDate}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      setAbsences(data.absences || []);
      setChoiceByKey({});
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to load substitute plan');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTeachers();
  }, []);

  useEffect(() => {
    void loadDayPlan();
  }, [selectedDate]);

  const addAbsence = async () => {
    if (!selectedTeacherId) {
      toast.error('Select a teacher first');
      return;
    }

    try {
      setAddingAbsence(true);
      const response = await fetch('/api/teacher-absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: selectedTeacherId, date: selectedDate }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success(`${selectedTeacher?.name ?? 'Teacher'} marked absent`);
      await loadDayPlan();
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to add absence');
    } finally {
      setAddingAbsence(false);
    }
  };

  const removeAbsence = async (absenceId: string) => {
    try {
      setDeletingAbsenceId(absenceId);
      const response = await fetch(`/api/teacher-absence?id=${absenceId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success('Absence removed');
      await loadDayPlan();
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to remove absence');
    } finally {
      setDeletingAbsenceId(null);
    }
  };

  const assignSlot = async (absenceTeacherId: string, slot: SuggestedSlot) => {
    const slotKey = `${absenceTeacherId}|${slot.slotId}`;
    const substituteTeacherId = choiceByKey[slotKey] || slot.assignedSubstitute?.id || slot.topPick?.id;
    if (!substituteTeacherId) {
      toast.error('Select a substitute teacher first');
      return;
    }

    try {
      setSubmittingKey(slotKey);
      const response = await fetch('/api/substitute/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId: slot.slotId,
          substituteTeacherId,
          markAbsentTeacherId: absenceTeacherId,
          date: selectedDate,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success(`P${slot.periodNumber} ${slot.sectionName} assigned`);
      await loadDayPlan();
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to assign substitute');
    } finally {
      setSubmittingKey(null);
    }
  };

  const autoAssignDay = async () => {
    try {
      setAutoAssigning(true);
      const response = await fetch('/api/substitute/day/auto-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      if (data.summary.assigned > 0) {
        toast.success(`Assigned ${data.summary.assigned} substitute slot${data.summary.assigned !== 1 ? 's' : ''}`);
      }
      if (data.summary.failed > 0) {
        toast.warning(`${data.summary.failed} slot${data.summary.failed !== 1 ? 's' : ''} still need manual assignment`);
      }
      await loadDayPlan();
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to auto-assign substitutes');
    } finally {
      setAutoAssigning(false);
    }
  };

  const downloadReport = (format: 'pdf' | 'csv') => {
    window.location.assign(`/api/substitute/export?date=${selectedDate}&format=${format}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-violet-50/10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">
      <div className="border-b border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
            >
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">Daily Substitute Manager</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add absences, assign substitutes, and export the day report
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadDayPlan()} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadReport('csv')} disabled={totalSlots === 0}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              CSV
            </Button>
            <Button size="sm" onClick={() => downloadReport('pdf')} disabled={totalSlots === 0}>
              <FileText className="mr-1.5 h-4 w-4" />
              PDF
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[
            { label: 'Absent Teachers', value: absences.length, icon: Users, tone: 'text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-500/15' },
            { label: 'Total Slots', value: totalSlots, icon: Clock, tone: 'text-sky-600 bg-sky-50 dark:text-sky-300 dark:bg-sky-500/15' },
            { label: 'Assigned', value: assignedSlots, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/15' },
            { label: 'Pending', value: pendingSlots, icon: UserCheck, tone: 'text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/15' },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-bold leading-none text-slate-900 dark:text-slate-100">{item.value}</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Daily Absence Setup</h2>
          </div>

          <div className="grid grid-cols-1 items-end gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto_auto]">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Date</label>
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Add Absent Teacher</label>
              <Select value={selectedTeacherId} onValueChange={setSelectedTeacherId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select teacher" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.name} ({teacher.abbreviation})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={addAbsence} disabled={addingAbsence || !selectedTeacherId}>
              {addingAbsence ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
              Add Absent
            </Button>

            <Button
              onClick={autoAssignDay}
              disabled={autoAssigning || pendingSlots === 0}
              className="text-white"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
            >
              {autoAssigning ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <Zap className="mr-1.5 h-4 w-4" />}
              Auto-Assign Day
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin text-indigo-500 dark:text-indigo-400" />
            Loading daily substitute board...
          </div>
        ) : absences.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <Users className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              No absent teachers marked for {selectedDate}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Add one or more absences above to generate the day's substitute plan.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {absences.map((absence) => {
              const absenceAssigned = absence.slots.filter((slot) => slot.assignedSubstitute).length;

              return (
                <div
                  key={absence.absenceId}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{absence.teacher.name}</h3>
                        <Badge variant="outline" className="dark:border-slate-700 dark:text-slate-200">
                          {absence.teacher.abbreviation}
                        </Badge>
                        <Badge className="border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {absenceAssigned}/{absence.slots.length} assigned
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {absence.slots.length === 0
                          ? 'No timetable slots on this day.'
                          : `${new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-IN', {
                              weekday: 'long',
                              day: 'numeric',
                              month: 'short',
                            })} substitute plan`}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void removeAbsence(absence.absenceId)}
                      disabled={deletingAbsenceId === absence.absenceId}
                    >
                      {deletingAbsenceId === absence.absenceId ? (
                        <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1.5 h-4 w-4" />
                      )}
                      Remove
                    </Button>
                  </div>

                  {absence.slots.length === 0 ? (
                    <div className="px-5 py-8 text-sm text-slate-500 dark:text-slate-400">
                      This teacher has no scheduled slots on the selected day.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {absence.slots.map((slot) => {
                        const choiceKey = `${absence.teacher.id}|${slot.slotId}`;
                        const currentChoice =
                          choiceByKey[choiceKey] || slot.assignedSubstitute?.id || slot.topPick?.id || '';
                        const submitting = submittingKey === choiceKey;

                        return (
                          <div key={slot.slotId} className="px-5 py-4">
                            <div className="flex flex-wrap items-start gap-4">
                              <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300">
                                <span className="text-[9px] font-bold uppercase">P</span>
                                <span className="text-sm font-bold leading-none">{slot.periodNumber}</span>
                              </div>

                              <div className="min-w-[260px] flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {slot.sectionName}
                                  </span>
                                  <span className="text-xs text-slate-400 dark:text-slate-500">&middot;</span>
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                    {slot.subjectName}
                                  </span>
                                  <span className="text-xs text-slate-400 dark:text-slate-500">&middot;</span>
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    Absent: {absence.teacher.abbreviation}
                                  </span>
                                </div>

                                {slot.assignedSubstitute ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    {slot.assignedSubstitute.id === GAMES_PERIOD_ID ? (
                                      <>
                                        <Badge className="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-300">
                                          Games Period
                                        </Badge>
                                        <span className="text-sm font-medium text-orange-700 dark:text-orange-300">
                                          {GAMES_PERIOD_NAME} — No teacher available
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                                          Assigned
                                        </Badge>
                                        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                                          {slot.assignedSubstitute.name} ({slot.assignedSubstitute.abbreviation})
                                        </span>
                                      </>
                                    )}
                                  </div>
                                ) : slot.topPick ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-slate-500 dark:text-slate-400">Best match:</span>
                                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                      {slot.topPick.name} ({slot.topPick.abbreviation})
                                    </span>
                                    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${scoreColor(slot.topPick.score)}`}>
                                      {slot.topPick.score} pts
                                    </span>
                                    {slot.topPick.reasons.slice(0, 2).map((reason) => (
                                      <span
                                        key={reason}
                                        className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300"
                                      >
                                        {reason}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs text-amber-600 dark:text-amber-300">
                                    No eligible substitute suggestions available for this slot.
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <Select
                                  value={currentChoice}
                                  onValueChange={(value) =>
                                    setChoiceByKey((prev) => ({ ...prev, [choiceKey]: value }))
                                  }
                                  disabled={slot.suggestions.length === 0}
                                >
                                  <SelectTrigger className="w-60">
                                    <SelectValue placeholder="Select substitute teacher" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {slot.suggestions.map((candidate, index) => (
                                      <SelectItem key={candidate.id} value={candidate.id}>
                                        {candidate.id === GAMES_PERIOD_ID
                                          ? 'Games Period — No teacher free'
                                          : `${candidate.name} (${candidate.abbreviation})${index === 0 ? ' • Best' : ''}`}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                <Button
                                  onClick={() => void assignSlot(absence.teacher.id, slot)}
                                  disabled={submitting || !currentChoice}
                                  className="min-w-[110px]"
                                >
                                  {submitting ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Download className="mr-1.5 h-4 w-4" />
                                  )}
                                  {slot.assignedSubstitute ? 'Reassign' : 'Assign'}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
