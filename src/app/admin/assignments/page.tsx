'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, BookOpen, CheckCircle2, ChevronLeft, RefreshCw, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getEligibleTeachersForSectionSubject } from '@/lib/teacher-eligibility';

interface Teacher {
  id: string;
  name: string;
  abbreviation: string;
  department: string;
  isActive?: boolean;
  targetWorkload: number;
  assignedPeriods: number;
  teachableGrades: string[];
}

interface Subject {
  id: string;
  name: string;
  code: string;
  category: string;
}

interface Assignment {
  id: string;
  teacherId: string;
  subjectId: string;
  sectionId: string;
  periodsPerWeek: number;
  teacher: { id: string; name: string; abbreviation: string; department: string };
  subject: { id: string; name: string; code: string };
  section: { id: string; name: string; grade: { name: string } };
}

interface Section {
  id: string;
  name: string;
  stream?: string;
  grade: { name: string };
}

const CATEGORY_COLOUR: Record<string, string> = {
  Core: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  Science: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  Language: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  Elective: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  Commerce: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  Activity: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};

const GRADES = ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function WorkloadBar({ assigned, target }: { assigned: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((assigned / target) * 100)) : 0;
  const colour =
    pct > 110 ? 'bg-red-500' :
    pct >= 90 ? 'bg-emerald-500' :
    pct >= 70 ? 'bg-amber-400' :
    'bg-slate-300 dark:bg-slate-600';

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full transition-all ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-slate-500 dark:text-slate-400">{assigned}/{target}</span>
    </div>
  );
}

function AssignmentCell({
  assignment,
  subjectName,
  onEdit,
}: {
  assignment?: Assignment;
  subjectName: string;
  onEdit: (assignment?: Assignment, subjectId?: string, subjectName?: string) => void;
}) {
  if (!assignment) {
    return (
      <button
        onClick={() => onEdit(undefined, undefined, subjectName)}
        className="flex min-h-[40px] h-full w-full items-center justify-center rounded border border-dashed border-slate-200 text-[10px] text-slate-300 transition hover:bg-slate-50 hover:text-slate-500 dark:border-slate-700 dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      >
        Add
      </button>
    );
  }

  return (
    <button
      onClick={() => onEdit(assignment)}
      className="group h-full min-h-[40px] w-full rounded border border-transparent px-1.5 py-1 text-left transition hover:border-indigo-200 hover:bg-indigo-50 dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/10"
    >
      <div className="text-[11px] font-semibold leading-tight text-slate-800 group-hover:text-indigo-700 dark:text-slate-100 dark:group-hover:text-indigo-300">
        {assignment.teacher.abbreviation}
      </div>
      <div className="text-[10px] leading-tight text-slate-400 dark:text-slate-500">{assignment.periodsPerWeek}p/w</div>
    </button>
  );
}

export default function AssignmentsPage() {
  const [selectedGrade, setSelectedGrade] = useState('IX');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [gradeSubjects, setGradeSubjects] = useState<Record<string, string[]>>({});
  const [coverageMap, setCoverageMap] = useState<Record<string, Record<string, Assignment>>>({});
  const [loading, setLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editAssignment, setEditAssignment] = useState<Assignment | undefined>();
  const [editSection, setEditSection] = useState<Section | undefined>();
  const [editSubjectId, setEditSubjectId] = useState('');
  const [editSubjectName, setEditSubjectName] = useState('');
  const [editPeriodsPerWeek, setEditPeriodsPerWeek] = useState('1');
  const [newTeacherId, setNewTeacherId] = useState('');
  const [saving, setSaving] = useState(false);
  const [weTeacherIds, setWeTeacherIds] = useState<Record<string, string>>({});

  // ── Virtual column IDs ──────────────────────────────────────────────────
  const WE_VIRTUAL_ID      = '__WE_GROUP__';
  const LANG2ND_VIRTUAL_ID = '__LANG2ND__';
  const LANG3RD_VIRTUAL_ID = '__LANG3RD__';

  // W.E. activities (Vocal, Keyboard, Instrument, Tabla, Dance)
  const WE_ACTIVITY_NAMES = ['Vocal', 'Keyboard', 'Instrument', 'Tabla', 'Dance'] as const;
  const weActivitySubjects = WE_ACTIVITY_NAMES
    .map((n) => subjects.find((s) => s.name.toLowerCase() === n.toLowerCase()))
    .filter((s): s is Subject => s !== undefined);
  const weActivityIds = new Set(weActivitySubjects.map((s) => s.id));
  // Legacy W.E. subjects (Art, Music, Work Experience) — suppress as standalone columns
  const WE_LEGACY_NAMES = ['Art', 'Music', 'Work Experience'];
  const weLegacyIds = new Set(
    WE_LEGACY_NAMES
      .map((n) => subjects.find((s) => s.name.toLowerCase() === n.toLowerCase())?.id)
      .filter((id): id is string => id !== undefined)
  );

  // 2nd Language (Hindi 2L + Nepali 2L — separate subjects from 3rd lang, VI–VIII only)
  const LANG2ND_NAMES = ['Hindi 2L', 'Nepali 2L'] as const;
  const lang2ndSubjects = LANG2ND_NAMES
    .map((n) => subjects.find((s) => s.name.toLowerCase() === n.toLowerCase()))
    .filter((s): s is Subject => s !== undefined);

  // 3rd Language (Hindi + Nepali + French, VI–VIII only)
  const LANG3RD_NAMES = ['Hindi', 'Nepali', 'French'] as const;
  const lang3rdSubjects = LANG3RD_NAMES
    .map((n) => subjects.find((s) => s.name.toLowerCase() === n.toLowerCase()))
    .filter((s): s is Subject => s !== undefined);
  const lang3rdIds = new Set(lang3rdSubjects.map((s) => s.id));
  const lang2ndIds = new Set(lang2ndSubjects.map((s) => s.id));

  // Science vs Phy/Chem/Bio split
  const LOWER_GRADES = new Set(['VI', 'VII', 'VIII']);
  const isLowerGrade = LOWER_GRADES.has(selectedGrade);
  const scienceId = subjects.find((s) => s.name.toLowerCase() === 'science')?.id;
  const separateScienceIds = new Set(
    subjects
      .filter((s) => ['physics', 'chemistry', 'biology'].includes(s.name.toLowerCase()))
      .map((s) => s.id)
  );

  const isWESubject   = editSubjectName.toLowerCase() === 'work experience' || editSubjectName === WE_VIRTUAL_ID;
  const isLang2ndEdit = editSubjectName === LANG2ND_VIRTUAL_ID;
  const isLang3rdEdit = editSubjectName === LANG3RD_VIRTUAL_ID;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/assignments?grade=${selectedGrade}`);
      const data = await res.json();
      setAssignments(data.assignments || []);
      setSections(data.sections || []);
      setSubjects(data.subjects || []);
      setTeachers(data.teachers || []);
      setGradeSubjects(data.gradeSubjects || {});
      setCoverageMap(data.coverageMap || {});
    } catch {
      toast.error('Failed to load assignments');
    } finally {
      setLoading(false);
    }
  }, [selectedGrade]);

  useEffect(() => {
    void load();
  }, [load]);

  const rawGradeSubjectIds = gradeSubjects[selectedGrade] || [];
  const gradeSections = sections.filter((section) => section.grade.name === selectedGrade);

  // Build display column list with virtual groupings and grade-based science split
  const gradeSubjectIds = [
    ...rawGradeSubjectIds.filter((id) => {
      if (weActivityIds.has(id) || weLegacyIds.has(id)) return false;    // replaced by W.E. virtual
      if (isLowerGrade && lang2ndIds.has(id)) return false;             // replaced by 2nd Lang virtual
      if (isLowerGrade && lang3rdIds.has(id)) return false;             // replaced by 3rd Lang virtual
      if (isLowerGrade && separateScienceIds.has(id)) return false;     // Phy/Chem/Bio hidden for VI–VIII
      if (!isLowerGrade && scienceId && id === scienceId) return false;  // Science hidden for IX–XII
      return true;
    }),
    ...(weActivitySubjects.length > 0 ? [WE_VIRTUAL_ID] : []),
    ...(isLowerGrade && lang2ndSubjects.length > 0 ? [LANG2ND_VIRTUAL_ID] : []),
    ...(isLowerGrade && lang3rdSubjects.length > 0 ? [LANG3RD_VIRTUAL_ID] : []),
  ];

  const suggestPeriodsPerWeek = (subjectId: string, gradeName: string) => {
    const gradeMatches = assignments.filter(
      (assignment) => assignment.subjectId === subjectId && assignment.section.grade.name === gradeName
    );
    if (gradeMatches.length === 0) return 1;

    const counts = new Map<number, number>();
    for (const match of gradeMatches) {
      counts.set(match.periodsPerWeek, (counts.get(match.periodsPerWeek) ?? 0) + 1);
    }

    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? gradeMatches[0].periodsPerWeek;
  };

  const editGrade = editSection?.grade.name ?? editAssignment?.section.grade.name;
  const editSubject = subjects.find((subject) => subject.id === editSubjectId);
  const editEligibleTeachers = getEligibleTeachersForSectionSubject(teachers, editSubject, editGrade);

  useEffect(() => {
    if (!editOpen || !newTeacherId) return;
    if (editEligibleTeachers.some((teacher) => teacher.id === newTeacherId)) return;
    setNewTeacherId('');
  }, [editOpen, newTeacherId, editEligibleTeachers]);

  const openEditForCell = (section: Section, assignment?: Assignment, subjId?: string, subjName?: string) => {
    const isWE      = subjId === WE_VIRTUAL_ID      || subjName === WE_VIRTUAL_ID;
    const isLang2nd = subjId === LANG2ND_VIRTUAL_ID || subjName === LANG2ND_VIRTUAL_ID;
    const isLang3rd = subjId === LANG3RD_VIRTUAL_ID || subjName === LANG3RD_VIRTUAL_ID;
    const isMulti   = isWE || isLang2nd || isLang3rd;

    const resolvedSubjectId = isMulti
      ? (isWE ? WE_VIRTUAL_ID : isLang2nd ? LANG2ND_VIRTUAL_ID : LANG3RD_VIRTUAL_ID)
      : (subjId ?? assignment?.subjectId ?? '');
    const resolvedName = isMulti
      ? (isWE ? 'Work Experience' : isLang2nd ? LANG2ND_VIRTUAL_ID : LANG3RD_VIRTUAL_ID)
      : (subjName ?? assignment?.subject.name ?? '');
    const wePeriodsDefault = ['VI','VII','VIII','IX'].includes(section.grade.name) ? 2 : 1;
    const resolvedPeriods = isMulti
      ? (isWE ? wePeriodsDefault : isLang2nd ? 6 : isLang3rd ? 4 : 1)
      : (assignment?.periodsPerWeek ?? suggestPeriodsPerWeek(resolvedSubjectId, section.grade.name));

    setEditAssignment(isMulti ? undefined : assignment);
    setEditSection(section);
    setEditSubjectId(resolvedSubjectId);
    setEditSubjectName(resolvedName);
    setEditPeriodsPerWeek(String(resolvedPeriods));
    setNewTeacherId(isMulti ? '' : (assignment?.teacherId ?? ''));

    // Pre-populate multi-teacher selections
    const initWeTeachers: Record<string, string> = {};
    const multiSubjects = isWE ? weActivitySubjects : isLang2nd ? lang2ndSubjects : isLang3rd ? lang3rdSubjects : [];
    for (const subj of multiSubjects) {
      const existing = coverageMap[section.id]?.[subj.id];
      if (existing) initWeTeachers[subj.id] = existing.teacherId;
    }
    setWeTeacherIds(initWeTeachers);
    setEditOpen(true);
  };

  // Shared save helper for multi-subject virtual columns (W.E. and 2nd Language)
  const saveMultiSubjectGroup = async (groupSubjects: Subject[], label: string) => {
    const sectionId = editSection?.id ?? editAssignment?.section.id ?? '';
    if (!sectionId) { toast.error('Section is missing'); return false; }
    const periodsPerWeek = Number(editPeriodsPerWeek);
    if (!Number.isFinite(periodsPerWeek) || periodsPerWeek <= 0) {
      toast.error('Enter a valid periods/week value');
      return false;
    }
    let saved = 0;
    for (const subj of groupSubjects) {
      const teacherId = weTeacherIds[subj.id];
      if (!teacherId) continue;
      const existing = coverageMap[sectionId]?.[subj.id];
      if (existing) {
        const res = await fetch('/api/assignments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignmentId: existing.id, newTeacherId: teacherId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to update ${subj.name} assignment`);
      } else {
        const res = await fetch('/api/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacherId, subjectId: subj.id, sectionId, periodsPerWeek }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to create ${subj.name} assignment`);
      }
      saved++;
    }
    if (saved === 0) { toast.error(`Select at least one ${label} teacher`); return false; }
    toast.success(`${label} — ${saved} assignment${saved === 1 ? '' : 's'} saved`);
    return true;
  };

  const handleSave = async () => {
    // W.E. subject: save Art / Music / Dance assignments separately
    if (isWESubject && weActivitySubjects.length > 0) {
      setSaving(true);
      try {
        const ok = await saveMultiSubjectGroup(weActivitySubjects, 'W.E.');
        if (ok) { setEditOpen(false); await load(); }
      } catch (error) {
        toast.error((error as Error).message || 'Failed to save W.E. assignments');
      } finally {
        setSaving(false);
      }
      return;
    }

    // 2nd Language: save Hindi + Nepali assignments separately
    if (isLang2ndEdit && lang2ndSubjects.length > 0) {
      setSaving(true);
      try {
        const ok = await saveMultiSubjectGroup(lang2ndSubjects, '2nd Language');
        if (ok) { setEditOpen(false); await load(); }
      } catch (error) {
        toast.error((error as Error).message || 'Failed to save 2nd Language assignments');
      } finally {
        setSaving(false);
      }
      return;
    }

    // 3rd Language: save Hindi + Nepali + French assignments separately
    if (isLang3rdEdit && lang3rdSubjects.length > 0) {
      setSaving(true);
      try {
        const ok = await saveMultiSubjectGroup(lang3rdSubjects, '3rd Language');
        if (ok) { setEditOpen(false); await load(); }
      } catch (error) {
        toast.error((error as Error).message || 'Failed to save 3rd Language assignments');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!newTeacherId) {
      toast.error('Select a teacher');
      return;
    }

    if (!editSubjectId) {
      toast.error('Subject is missing for this assignment');
      return;
    }

    if (!editAssignment && !editSection) {
      toast.error('Section is missing for this assignment');
      return;
    }

    const periodsPerWeek = Number(editPeriodsPerWeek);
    if (!Number.isFinite(periodsPerWeek) || periodsPerWeek <= 0) {
      toast.error('Enter a valid periods/week value');
      return;
    }

    setSaving(true);
    try {
      if (editAssignment) {
        const res = await fetch('/api/assignments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignmentId: editAssignment.id, newTeacherId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update assignment');
        toast.success(data.message || 'Assignment updated');
      } else {
        const res = await fetch('/api/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teacherId: newTeacherId,
            subjectId: editSubjectId,
            sectionId: editSection?.id,
            periodsPerWeek,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create assignment');
        toast.success(data.message || 'Assignment created');
      }

      setEditOpen(false);
      await load();
    } catch (error) {
      toast.error((error as Error).message || 'Failed to save assignment');
    } finally {
      setSaving(false);
    }
  };

  const totalAssignments = assignments.length;
  const totalPeriods = assignments.reduce((sum, assignment) => sum + assignment.periodsPerWeek, 0);
  const overloaded = teachers.filter((teacher) => teacher.assignedPeriods > teacher.targetWorkload + 2).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-violet-50/10 p-4 md:p-6 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-slate-100">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 shadow-md shadow-indigo-200 dark:shadow-none">
                <Users className="h-3.5 w-3.5 text-white" />
              </div>
              Teacher Assignments
            </h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              One teacher per section per subject, with direct fixes for missing assignment cells.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="gap-1.5 rounded-lg border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Assignments', value: totalAssignments, icon: BookOpen, tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
          { label: 'Periods/week', value: totalPeriods, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
          { label: 'Teachers involved', value: new Set(assignments.map((assignment) => assignment.teacherId)).size, icon: Users, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
          { label: 'Overloaded teachers', value: overloaded, icon: AlertTriangle, tone: overloaded ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.tone}`}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold leading-none text-slate-900 dark:text-slate-100">{stat.value}</div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Grade:</span>
        <div className="flex flex-wrap gap-1.5">
          {GRADES.map((grade) => (
            <button
              key={grade}
              onClick={() => setSelectedGrade(grade)}
              className={`rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-all duration-150 ${
                selectedGrade === grade
                  ? 'text-white shadow-md shadow-indigo-200 dark:shadow-none'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300'
              }`}
              style={selectedGrade === grade ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' } : undefined}
            >
              {grade}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden rounded-2xl border-0 bg-white shadow-sm dark:bg-slate-900">
        <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50/30 px-5 py-3.5 dark:border-slate-800 dark:from-slate-900 dark:to-slate-900">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <BookOpen className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
            Grade {selectedGrade} - Assignment Matrix
            <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">
              ({gradeSections.length} sections x {gradeSubjectIds.length} subjects)
            </span>
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-sm text-slate-400 dark:text-slate-500">Loading...</div>
          ) : gradeSubjectIds.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-sm text-slate-400 dark:text-slate-500">
              No assignments found for grade {selectedGrade}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60">
                    <th className="sticky left-0 z-10 min-w-[90px] bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
                      Section
                    </th>
                    {gradeSubjectIds.map((subjectId) => {
                      if (subjectId === WE_VIRTUAL_ID) {
                        return (
                          <th key={WE_VIRTUAL_ID} className="min-w-[88px] px-1.5 py-2 text-center">
                            <div className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CATEGORY_COLOUR['Activity']}`}>
                              WE
                            </div>
                            <div className="mx-auto mt-0.5 max-w-[84px] text-[9px] font-normal leading-tight text-slate-400 dark:text-slate-500">
                              Work Experience
                            </div>
                          </th>
                        );
                      }
                      if (subjectId === LANG2ND_VIRTUAL_ID) {
                        return (
                          <th key={LANG2ND_VIRTUAL_ID} className="min-w-[88px] px-1.5 py-2 text-center">
                            <div className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                              2nd Lang
                            </div>
                            <div className="mx-auto mt-0.5 max-w-[84px] text-[9px] font-normal leading-tight text-slate-400 dark:text-slate-500">
                              Hindi / Nepali
                            </div>
                          </th>
                        );
                      }
                      if (subjectId === LANG3RD_VIRTUAL_ID) {
                        return (
                          <th key={LANG3RD_VIRTUAL_ID} className="min-w-[88px] px-1.5 py-2 text-center">
                            <div className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
                              3rd Lang
                            </div>
                            <div className="mx-auto mt-0.5 max-w-[84px] text-[9px] font-normal leading-tight text-slate-400 dark:text-slate-500">
                              Hindi / Nepali / French
                            </div>
                          </th>
                        );
                      }
                      const subject = subjects.find((item) => item.id === subjectId);
                      return (
                        <th key={subjectId} className="min-w-[72px] px-1.5 py-2 text-center">
                          <div className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CATEGORY_COLOUR[subject?.category ?? ''] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                            {subject?.code ?? subject?.name.slice(0, 6) ?? ''}
                          </div>
                          <div
                            className="mx-auto mt-0.5 max-w-[68px] truncate text-[9px] font-normal leading-tight text-slate-400 dark:text-slate-500"
                            title={subject?.name}
                          >
                            {subject?.name}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {gradeSections.map((section, sectionIndex) => {
                    const sectionAssignments = coverageMap[section.id] ?? {};
                    const weAssigned      = weActivitySubjects.some((s) => sectionAssignments[s.id]);
                    const lang2ndAssigned = isLowerGrade && lang2ndSubjects.some((s) => sectionAssignments[s.id]);
                    const lang3rdAssigned = isLowerGrade && lang3rdSubjects.some((s) => sectionAssignments[s.id]);
                    const specialIds      = new Set([...weActivityIds, ...weLegacyIds, ...(isLowerGrade ? [...lang2ndIds, ...lang3rdIds] : [])]);
                    const nonSpecial      = Object.keys(sectionAssignments).filter((id) => !specialIds.has(id)).length;
                    const assignedCount   = nonSpecial + (weAssigned ? 1 : 0) + (lang2ndAssigned ? 1 : 0) + (lang3rdAssigned ? 1 : 0);
                    const totalNeeded = gradeSubjectIds.length;
                    const complete = assignedCount >= totalNeeded;

                    return (
                      <tr
                        key={section.id}
                        className={`border-b transition hover:bg-slate-50/50 dark:border-slate-800 dark:hover:bg-slate-800/30 ${
                          sectionIndex % 2 === 0 ? '' : 'bg-slate-50/30 dark:bg-slate-950/20'
                        }`}
                      >
                        <td className="sticky left-0 z-10 border-r bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{section.name}</div>
                          {section.stream ? (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">{section.stream}</div>
                          ) : null}
                          <div className={`mt-0.5 text-[9px] ${complete ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
                            {assignedCount}/{totalNeeded}
                          </div>
                        </td>

                        {gradeSubjectIds.map((subjectId) => {
                          if (subjectId === LANG2ND_VIRTUAL_ID) {
                            const assigned = lang2ndSubjects.filter((s) => coverageMap[section.id]?.[s.id]);
                            return (
                              <td key={LANG2ND_VIRTUAL_ID} className="px-0.5 py-0.5">
                                <button
                                  onClick={() => openEditForCell(section, undefined, LANG2ND_VIRTUAL_ID)}
                                  className="group h-full min-h-[40px] w-full rounded border border-transparent px-1.5 py-1 text-left transition hover:border-amber-200 hover:bg-amber-50 dark:hover:border-amber-500/30 dark:hover:bg-amber-500/10"
                                >
                                  {assigned.length > 0 ? (
                                    assigned.map((s) => {
                                      const a = coverageMap[section.id][s.id];
                                      return (
                                        <div key={s.id} className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                                          <span className="font-semibold text-slate-700 dark:text-slate-200">{s.name.slice(0, 3)}:</span> {a.teacher.abbreviation}
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <span className="text-[10px] text-slate-300 dark:text-slate-600">Add</span>
                                  )}
                                </button>
                              </td>
                            );
                          }
                          if (subjectId === LANG3RD_VIRTUAL_ID) {
                            const assigned = lang3rdSubjects.filter((s) => coverageMap[section.id]?.[s.id]);
                            return (
                              <td key={LANG3RD_VIRTUAL_ID} className="px-0.5 py-0.5">
                                <button
                                  onClick={() => openEditForCell(section, undefined, LANG3RD_VIRTUAL_ID)}
                                  className="group h-full min-h-[40px] w-full rounded border border-transparent px-1.5 py-1 text-left transition hover:border-teal-200 hover:bg-teal-50 dark:hover:border-teal-500/30 dark:hover:bg-teal-500/10"
                                >
                                  {assigned.length > 0 ? (
                                    assigned.map((s) => {
                                      const a = coverageMap[section.id][s.id];
                                      return (
                                        <div key={s.id} className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                                          <span className="font-semibold text-slate-700 dark:text-slate-200">{s.name.slice(0, 3)}:</span> {a.teacher.abbreviation}
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <span className="text-[10px] text-slate-300 dark:text-slate-600">Add</span>
                                  )}
                                </button>
                              </td>
                            );
                          }
                          if (subjectId === WE_VIRTUAL_ID) {
                            const assigned = weActivitySubjects.filter((s) => coverageMap[section.id]?.[s.id]);
                            return (
                              <td key={WE_VIRTUAL_ID} className="px-0.5 py-0.5">
                                <button
                                  onClick={() => openEditForCell(section, undefined, WE_VIRTUAL_ID)}
                                  className="group h-full min-h-[40px] w-full rounded border border-transparent px-1.5 py-1 text-left transition hover:border-rose-200 hover:bg-rose-50 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/10"
                                >
                                  {assigned.length > 0 ? (
                                    assigned.map((s) => {
                                      const a = coverageMap[section.id][s.id];
                                      return (
                                        <div key={s.id} className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                                          <span className="font-semibold text-slate-700 dark:text-slate-200">{s.name.slice(0, 3)}:</span> {a.teacher.abbreviation}
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <span className="text-[10px] text-slate-300 dark:text-slate-600">Add</span>
                                  )}
                                </button>
                              </td>
                            );
                          }
                          const assignment = sectionAssignments[subjectId];
                          return (
                            <td key={subjectId} className="px-0.5 py-0.5">
                              <AssignmentCell
                                assignment={assignment}
                                subjectName={subjects.find((subject) => subject.id === subjectId)?.name ?? ''}
                                onEdit={(currentAssignment, sid, subjectName) =>
                                  openEditForCell(section, currentAssignment, sid ?? subjectId, subjectName)
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Users className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
          Teacher Workload - Grade {selectedGrade}
        </h2>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {teachers
            .filter((teacher) => assignments.some((assignment) => assignment.teacherId === teacher.id))
            .sort((a, b) => {
              const aPct = a.targetWorkload > 0 ? a.assignedPeriods / a.targetWorkload : 0;
              const bPct = b.targetWorkload > 0 ? b.assignedPeriods / b.targetWorkload : 0;
              return bPct - aPct;
            })
            .map((teacher) => {
              const pct = teacher.targetWorkload > 0 ? (teacher.assignedPeriods / teacher.targetWorkload) * 100 : 0;
              const status = pct > 110 ? 'over' : pct >= 90 ? 'ok' : pct >= 60 ? 'light' : 'low';

              return (
                <div
                  key={teacher.id}
                  className={`rounded-lg border bg-white p-2.5 text-xs shadow-sm dark:bg-slate-900 ${
                    status === 'over'
                      ? 'border-red-200 dark:border-red-500/30'
                      : status === 'ok'
                        ? 'border-emerald-200 dark:border-emerald-500/30'
                        : 'border-slate-100 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div>
                      <span className="font-bold text-slate-800 dark:text-slate-100">{teacher.abbreviation}</span>
                      <span className="ml-1 text-slate-400 dark:text-slate-500">·</span>
                      <span className="ml-1 text-slate-500 dark:text-slate-400">{teacher.department.slice(0, 10)}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={`px-1 py-0 text-[9px] ${
                        status === 'over'
                          ? 'border-red-300 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
                          : status === 'ok'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {status === 'over' ? 'Over' : status === 'ok' ? 'OK' : 'Light'}
                    </Badge>
                  </div>

                  <div className="mt-1.5">
                    <WorkloadBar assigned={teacher.assignedPeriods} target={teacher.targetWorkload} />
                  </div>

                  <div className="mt-1 text-[9px] text-slate-400 dark:text-slate-500">
                    Grades: {teacher.teachableGrades.join(', ')}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-base text-slate-900 dark:text-slate-100">
              {editAssignment ? 'Change Teacher' : 'Assign Teacher'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <div><span className="font-medium">Section:</span> {editSection?.name ?? editAssignment?.section.name}</div>
              <div><span className="font-medium">Subject:</span> {isLang2ndEdit ? '2nd Language (Hindi / Nepali)' : isLang3rdEdit ? '3rd Language (Hindi / Nepali / French)' : editSubjectName}</div>
              {editAssignment ? (
                <div>
                  <span className="font-medium">Current teacher:</span> {editAssignment.teacher.name} ({editAssignment.teacher.abbreviation})
                </div>
              ) : null}
              <div>
                <span className="font-medium">Periods/week:</span> {editPeriodsPerWeek}
              </div>
            </div>

            {!editAssignment ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Periods per week
                </label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={editPeriodsPerWeek}
                  onChange={(event) => setEditPeriodsPerWeek(event.target.value)}
                />
              </div>
            ) : null}

            {isWESubject && weActivitySubjects.length > 0 ? (
              <div className="space-y-3">
                {weActivitySubjects.map((subj) => {
                  const activityTeachers = getEligibleTeachersForSectionSubject(teachers, subj, editGrade);
                  return (
                    <div key={subj.id}>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {subj.name} Teacher
                      </label>
                      <Select
                        value={weTeacherIds[subj.id] ?? ''}
                        onValueChange={(v) => setWeTeacherIds((prev) => ({ ...prev, [subj.id]: v }))}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder={`Select ${subj.name} teacher...`} />
                        </SelectTrigger>
                        <SelectContent>
                          {activityTeachers.map((teacher) => {
                            const pct = teacher.targetWorkload > 0
                              ? Math.round((teacher.assignedPeriods / teacher.targetWorkload) * 100)
                              : 0;
                            return (
                              <SelectItem key={teacher.id} value={teacher.id}>
                                {teacher.abbreviation} - {teacher.name} ({teacher.assignedPeriods}/{teacher.targetWorkload})
                                {pct > 100 ? ' overloaded' : pct > 80 ? ' busy' : ''}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {activityTeachers.length === 0 && (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                          No eligible {subj.name} teachers found.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : isLang2ndEdit && lang2ndSubjects.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">2nd Language — Hindi / Nepali teachers for this section</p>
                {lang2ndSubjects.map((subj) => {
                  const langTeachers = getEligibleTeachersForSectionSubject(teachers, subj, editGrade);
                  return (
                    <div key={subj.id}>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {subj.name} Teacher <span className="font-normal text-slate-400">(2nd Language)</span>
                      </label>
                      <Select
                        value={weTeacherIds[subj.id] ?? ''}
                        onValueChange={(v) => setWeTeacherIds((prev) => ({ ...prev, [subj.id]: v }))}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder={`Select ${subj.name} teacher...`} />
                        </SelectTrigger>
                        <SelectContent>
                          {langTeachers.map((teacher) => {
                            const pct = teacher.targetWorkload > 0
                              ? Math.round((teacher.assignedPeriods / teacher.targetWorkload) * 100)
                              : 0;
                            return (
                              <SelectItem key={teacher.id} value={teacher.id}>
                                {teacher.abbreviation} - {teacher.name} ({teacher.assignedPeriods}/{teacher.targetWorkload})
                                {pct > 100 ? ' overloaded' : pct > 80 ? ' busy' : ''}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {langTeachers.length === 0 && (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                          No eligible {subj.name} teachers found.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : isLang3rdEdit && lang3rdSubjects.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-teal-700 dark:text-teal-300 font-medium">3rd Language — Hindi / Nepali / French teachers for this section</p>
                {lang3rdSubjects.map((subj) => {
                  const langTeachers = getEligibleTeachersForSectionSubject(teachers, subj, editGrade);
                  return (
                    <div key={subj.id}>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {subj.name} Teacher <span className="font-normal text-slate-400">(3rd Language)</span>
                      </label>
                      <Select
                        value={weTeacherIds[subj.id] ?? ''}
                        onValueChange={(v) => setWeTeacherIds((prev) => ({ ...prev, [subj.id]: v }))}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder={`Select ${subj.name} teacher...`} />
                        </SelectTrigger>
                        <SelectContent>
                          {langTeachers.map((teacher) => {
                            const pct = teacher.targetWorkload > 0
                              ? Math.round((teacher.assignedPeriods / teacher.targetWorkload) * 100)
                              : 0;
                            return (
                              <SelectItem key={teacher.id} value={teacher.id}>
                                {teacher.abbreviation} - {teacher.name} ({teacher.assignedPeriods}/{teacher.targetWorkload})
                                {pct > 100 ? ' overloaded' : pct > 80 ? ' busy' : ''}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {langTeachers.length === 0 && (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                          No eligible {subj.name} teachers found.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : isWESubject && weActivitySubjects.length === 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-300">
                Art, Music and Dance subjects not found in the database.
              </p>
            ) : !isWESubject && !isLang2ndEdit && !isLang3rdEdit ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {editAssignment ? 'Replace with:' : 'Assign teacher:'}
                </label>
                <Select value={newTeacherId} onValueChange={setNewTeacherId} disabled={!editSubjectId}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select teacher..." />
                  </SelectTrigger>
                  <SelectContent>
                    {editEligibleTeachers.map((teacher) => {
                      const pct = teacher.targetWorkload > 0
                        ? Math.round((teacher.assignedPeriods / teacher.targetWorkload) * 100)
                        : 0;
                      return (
                        <SelectItem key={teacher.id} value={teacher.id}>
                          {teacher.abbreviation} - {teacher.name} ({teacher.assignedPeriods}/{teacher.targetWorkload})
                          {pct > 100 ? ' overloaded' : pct > 80 ? ' busy' : ''}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {editSubjectId && editEligibleTeachers.length === 0 && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-300">
                    No eligible teachers found for this section and subject.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || ((isWESubject || isLang2ndEdit || isLang3rdEdit) ? Object.values(weTeacherIds).filter(Boolean).length === 0 : !newTeacherId)}
            >
              {saving ? 'Saving...' : editAssignment ? 'Update' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
