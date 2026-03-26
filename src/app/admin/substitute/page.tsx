'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Users, CalendarDays, Zap, CheckCircle2, AlertCircle, RefreshCw,
  ChevronRight, Info, TrendingDown, Award, BookOpen, UserCheck,
  ArrowLeft, Sparkles, Clock,
} from 'lucide-react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

type Teacher = { id: string; name: string; abbreviation: string };

type ScoredCandidate = {
  id: string;
  name: string;
  abbreviation: string;
  score: number;
  reasons: string[];
};

type SlotRow = {
  slotId: string;
  timeSlotId: string;
  periodNumber: number;
  dayName: string;
  sectionName: string;
  subjectName: string;
  currentTeacher: { id: string; name: string; abbreviation: string } | null;
  suggestions: ScoredCandidate[];
  topPick: ScoredCandidate | null;
  // UI state
  status: 'pending' | 'assigned' | 'failed';
  assignedTo?: ScoredCandidate;
};

type AutoResult = {
  slotId: string;
  periodNumber: number;
  sectionName: string;
  subjectName: string;
  assigned: ScoredCandidate | null;
  error: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 70) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (score >= 40) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}

function scoreLabel(score: number) {
  if (score >= 70) return 'Excellent';
  if (score >= 40) return 'Good';
  if (score >= 10) return 'Fair';
  return 'Low';
}

function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ─── Criteria Legend ─────────────────────────────────────────────────────────

const CRITERIA = [
  { icon: BookOpen, label: 'Direct class assignment', points: 25, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { icon: Users, label: 'Same department', points: 30, color: 'text-violet-600', bg: 'bg-violet-50' },
  { icon: Award, label: 'Teaches the grade level', points: 20, color: 'text-teal-600', bg: 'bg-teal-50' },
  { icon: TrendingDown, label: 'Lower current workload', points: 20, color: 'text-blue-600', bg: 'bg-blue-50' },
  { icon: UserCheck, label: 'Not HOD (spares heads)', points: 10, color: 'text-amber-600', bg: 'bg-amber-50' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SubstitutePage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => formatLocalDateInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [choiceBySlot, setChoiceBySlot] = useState<Record<string, string>>({});
  const [submittingSlot, setSubmittingSlot] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const selectedTeacher = useMemo(
    () => teachers.find(t => t.id === selectedTeacherId) ?? null,
    [teachers, selectedTeacherId]
  );

  // ── Load teachers ──
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/timetable');
        const data = await r.json();
        setTeachers(data.teachers || []);
        if ((data.teachers || []).length > 0) setSelectedTeacherId((data.teachers || [])[0].id);
      } catch {
        toast.error('Failed to load teachers');
      }
    })();
  }, []);

  // ── Load suggestions ──
  const loadSuggestions = async () => {
    if (!selectedTeacherId || !selectedDate) {
      toast.error('Select teacher and date');
      return;
    }
    try {
      setLoading(true);
      setHasLoaded(false);
      const r = await fetch(`/api/substitute/suggest?teacherId=${selectedTeacherId}&date=${selectedDate}`);
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);
      const slots: SlotRow[] = (data.slots || []).map((s: any) => ({
        ...s,
        status: 'pending' as const,
      }));
      setRows(slots);
      setChoiceBySlot({});
      setHasLoaded(true);
    } catch (err) {
      toast.error('Failed to load substitute suggestions');
    } finally {
      setLoading(false);
    }
  };

  // ── Manual reassign ──
  const reassign = async (slotId: string) => {
    const substituteTeacherId = choiceBySlot[slotId] || rows.find(r => r.slotId === slotId)?.topPick?.id;
    if (!substituteTeacherId) {
      toast.error('Select a substitute teacher first');
      return;
    }
    try {
      setSubmittingSlot(slotId);
      const r = await fetch('/api/substitute/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, substituteTeacherId, markAbsentTeacherId: selectedTeacherId, date: selectedDate }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);
      const assigned = rows.find(row => row.slotId === slotId)?.suggestions.find(s => s.id === substituteTeacherId);
      setRows(prev => prev.map(row =>
        row.slotId === slotId ? { ...row, status: 'assigned', assignedTo: assigned } : row
      ));
      toast.success(`P${rows.find(r => r.slotId === slotId)?.periodNumber} → ${assigned?.name ?? 'Substitute'} assigned`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to reassign slot');
    } finally {
      setSubmittingSlot(null);
    }
  };

  // ── Auto-assign all ──
  const autoAssignAll = async () => {
    if (!selectedTeacherId || !selectedDate) return;
    const pendingSlots = rows.filter(r => r.status === 'pending');
    if (pendingSlots.length === 0) {
      toast.info('No pending slots to assign');
      return;
    }
    try {
      setAutoAssigning(true);
      const r = await fetch('/api/substitute/auto-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: selectedTeacherId, date: selectedDate }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);

      const resultMap = new Map<string, AutoResult>(data.results.map((res: AutoResult) => [res.slotId, res]));
      setRows(prev => prev.map(row => {
        const result = resultMap.get(row.slotId);
        if (!result) return row;
        if (result.assigned) {
          return { ...row, status: 'assigned', assignedTo: result.assigned };
        }
        return { ...row, status: 'failed' };
      }));

      const { assigned, failed } = data.summary;
      if (assigned > 0) toast.success(`Auto-assigned ${assigned} slot${assigned !== 1 ? 's' : ''} successfully`);
      if (failed > 0) toast.warning(`${failed} slot${failed !== 1 ? 's' : ''} could not be auto-assigned`);
    } catch (err: any) {
      toast.error(err.message || 'Auto-assign failed');
    } finally {
      setAutoAssigning(false);
    }
  };

  const pendingCount = rows.filter(r => r.status === 'pending').length;
  const assignedCount = rows.filter(r => r.status === 'assigned').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-violet-50/10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              <Users className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">Substitute Manager</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Mark absence · Auto-assign or manually replace</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* ── Criteria Panel ── */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl card-shadow p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Auto-Assign Scoring Criteria</h2>
            <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">Higher score = better match</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {CRITERIA.map(({ icon: Icon, label, points, color, bg }) => (
              <div key={label} className={`flex flex-col gap-2 p-3 rounded-xl border border-transparent ${bg} dark:bg-opacity-10`}>
                <div className="flex items-center justify-between">
                  <Icon className={`h-4 w-4 ${color}`} />
                  <span className={`text-xs font-bold ${color}`}>+{points}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Selection ── */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl card-shadow p-5">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Mark Absent Teacher</h2>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Absent Teacher</label>
              <Select value={selectedTeacherId} onValueChange={setSelectedTeacherId}>
                <SelectTrigger className="border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <SelectValue placeholder="Select teacher" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.abbreviation})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-44 space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Date of Absence</label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <Button
              onClick={loadSuggestions}
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 shrink-0"
            >
              {loading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <ChevronRight className="h-4 w-4 mr-1" />}
              {loading ? 'Loading…' : 'Load Slots'}
            </Button>
          </div>
        </div>

        {/* ── Results ── */}
        {hasLoaded && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl card-shadow overflow-hidden">
            {/* Results header */}
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedTeacher?.name}'s Slots — {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {rows.length} slot{rows.length !== 1 ? 's' : ''} ·{' '}
                    <span className="text-emerald-600 font-medium">{assignedCount} assigned</span>
                    {pendingCount > 0 && <> · <span className="text-amber-600 font-medium">{pendingCount} pending</span></>}
                  </p>
                </div>
              </div>

              {pendingCount > 0 && (
                <Button
                  onClick={autoAssignAll}
                  disabled={autoAssigning}
                  className="btn-glow text-white text-sm font-semibold px-4 py-2 rounded-xl"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                >
                  {autoAssigning
                    ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Assigning…</>
                    : <><Zap className="h-3.5 w-3.5 mr-1.5" /> Auto-Assign All ({pendingCount})</>
                  }
                </Button>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="h-12 w-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                  <Clock className="h-6 w-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No slots found</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  This teacher has no scheduled classes on the selected day.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((row) => (
                  <SlotCard
                    key={row.slotId}
                    row={row}
                    choiceBySlot={choiceBySlot}
                    submittingSlot={submittingSlot}
                    onChoiceChange={(slotId, val) => setChoiceBySlot(prev => ({ ...prev, [slotId]: val }))}
                    onReassign={reassign}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {!hasLoaded && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-indigo-400" />
            </div>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Select a teacher and date</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs">
              Choose the absent teacher and date above, then click <strong>Load Slots</strong> to see their schedule and substitute options.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Slot Card ─────────────────────────────────────────────────────────────────

function SlotCard({
  row,
  choiceBySlot,
  submittingSlot,
  onChoiceChange,
  onReassign,
}: {
  row: SlotRow;
  choiceBySlot: Record<string, string>;
  submittingSlot: string | null;
  onChoiceChange: (slotId: string, val: string) => void;
  onReassign: (slotId: string) => void;
}) {
  const currentChoice = choiceBySlot[row.slotId] || row.topPick?.id || '';
  const chosenCandidate = row.suggestions.find(s => s.id === currentChoice);

  if (row.status === 'assigned') {
    return (
      <div className="px-5 py-4 flex items-center gap-4 bg-emerald-50/60 dark:bg-emerald-950/20">
        <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 shrink-0">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">P{row.periodNumber}</span>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{row.sectionName}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{row.subjectName}</span>
          </div>
          <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5 font-medium">
            Assigned to {row.assignedTo?.name ?? 'Substitute'} ({row.assignedTo?.abbreviation})
          </p>
        </div>
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Assigned</Badge>
      </div>
    );
  }

  if (row.status === 'failed') {
    return (
      <div className="px-5 py-4 flex items-center gap-4 bg-red-50/60 dark:bg-red-950/20">
        <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-red-100 dark:bg-red-900/30 shrink-0">
          <AlertCircle className="h-5 w-5 text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">P{row.periodNumber}</span>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{row.sectionName}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{row.subjectName}</span>
          </div>
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">No suitable substitute available</p>
        </div>
        <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Unassigned</Badge>
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-start gap-4">
        {/* Period badge */}
        <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 flex flex-col items-center justify-center">
          <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">P</span>
          <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300 leading-none">{row.periodNumber}</span>
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          {/* Slot info */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{row.sectionName}</span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{row.subjectName}</span>
            {row.currentTeacher && (
              <>
                <span className="text-xs text-slate-400">·</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Currently: <span className="font-medium">{row.currentTeacher.abbreviation}</span>
                </span>
              </>
            )}
          </div>

          {/* Top pick score reasoning */}
          {row.topPick && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400">Best match:</span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{row.topPick.name}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${scoreColor(row.topPick.score)}`}>
                {scoreLabel(row.topPick.score)} · {row.topPick.score}pts
              </span>
              <div className="flex flex-wrap gap-1">
                {row.topPick.reasons.slice(0, 3).map(r => (
                  <span key={r} className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {row.suggestions.length === 0 && (
            <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> No eligible substitutes found for this slot
            </p>
          )}
        </div>

        {/* Actions */}
        {row.suggestions.length > 0 && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <Select
              value={currentChoice}
              onValueChange={(v) => onChoiceChange(row.slotId, v)}
            >
              <SelectTrigger className="w-48 text-xs border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl h-9">
                <SelectValue placeholder="Pick substitute" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {row.suggestions.map((s, i) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2 py-0.5">
                      <span className="font-medium">{s.name}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${scoreColor(s.score)}`}>
                        {s.score}pts
                      </span>
                      {i === 0 && <span className="text-[9px] text-indigo-500 font-bold">★ Best</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              onClick={() => onReassign(row.slotId)}
              disabled={submittingSlot === row.slotId || !currentChoice}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white h-9 px-4 text-xs font-semibold"
            >
              {submittingSlot === row.slotId
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : 'Assign'
              }
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
