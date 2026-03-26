'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Users, BookOpen, ChevronLeft, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { isLabDepartment } from '@/lib/teacher-departments';
import { getEligibleTeachersForSectionSubject } from '@/lib/teacher-eligibility';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Category colour chips ─────────────────────────────────────────────────

const CATEGORY_COLOUR: Record<string, string> = {
  Core: 'bg-indigo-100 text-indigo-700',
  Science: 'bg-emerald-100 text-emerald-700',
  Language: 'bg-amber-100 text-amber-700',
  Elective: 'bg-purple-100 text-purple-700',
  Commerce: 'bg-sky-100 text-sky-700',
  Activity: 'bg-rose-100 text-rose-700',
};

const GRADES = ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// ─── Workload bar ─────────────────────────────────────────────────────────

function WorkloadBar({ assigned, target }: { assigned: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((assigned / target) * 100)) : 0;
  const colour =
    pct > 110 ? 'bg-red-500' :
    pct >= 90 ? 'bg-emerald-500' :
    pct >= 70 ? 'bg-amber-400' :
    'bg-slate-300';
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-slate-500">{assigned}/{target}</span>
    </div>
  );
}

// ─── Cell component ────────────────────────────────────────────────────────

function AssignmentCell({
  assignment,
  subjectName,
  onEdit,
}: {
  assignment?: Assignment;
  subjectName: string;
  onEdit: (a?: Assignment, subjectId?: string, subjectName?: string) => void;
}) {
  if (!assignment) {
    return (
      <button
        onClick={() => onEdit(undefined, undefined, subjectName)}
        className="w-full h-full min-h-[40px] rounded text-[10px] text-slate-300 hover:bg-slate-50 hover:text-slate-400 transition border border-dashed border-slate-200 flex items-center justify-center"
      >
        —
      </button>
    );
  }
  return (
    <button
      onClick={() => onEdit(assignment)}
      className="w-full h-full min-h-[40px] rounded px-1.5 py-1 text-left hover:bg-indigo-50 transition group border border-transparent hover:border-indigo-200"
    >
      <div className="font-semibold text-[11px] text-slate-800 group-hover:text-indigo-700 leading-tight">
        {assignment.teacher.abbreviation}
      </div>
      <div className="text-[10px] text-slate-400 leading-tight">{assignment.periodsPerWeek}p/w</div>
    </button>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function AssignmentsPage() {
  const [selectedGrade, setSelectedGrade] = useState('IX');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [gradeSubjects, setGradeSubjects] = useState<Record<string, string[]>>({});
  const [coverageMap, setCoverageMap] = useState<Record<string, Record<string, Assignment>>>({});
  const [loading, setLoading] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editAssignment, setEditAssignment] = useState<Assignment | undefined>();
  const [editSection, setEditSection] = useState<Section | undefined>();
  const [editSubjectId, setEditSubjectId] = useState('');
  const [editSubjectName, setEditSubjectName] = useState('');
  const [newTeacherId, setNewTeacherId] = useState('');
  const [saving, setSaving] = useState(false);

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

  useEffect(() => { load(); }, [load]);

  // Subjects for this grade
  const gradeSubjectIds = gradeSubjects[selectedGrade] || [];
  const gradeSections = sections.filter(s => s.grade.name === selectedGrade);

  // Eligible teachers for a given subject (by department and teachableGrades)
  const eligibleTeachers = (subjectId: string) => {
    const subj = subjects.find(s => s.id === subjectId);
    if (!subj) return teachers;
    return teachers.filter(t => {
      const canTeachGrade = t.teachableGrades.includes(selectedGrade);
      if (!canTeachGrade) return false;
      // Match by department → subject category heuristic
      const dept = t.department.toLowerCase();
      const subName = subj.name.toLowerCase();
      if (dept === 'sports' && subName === 'games') return true;
      if (dept === 'yoga' && (subName === 'yoga' || subName === 'aerobics')) return true;
      if (dept === 'library' && subName === 'library') return true;
      if (isLabDepartment(t.department)) return false; // lab assistants don't get assigned
      if (dept === 'counselling') return false;
      if (subj.category === 'Activity') {
        return ['art', 'dance', 'music', 'sports', 'yoga', 'library'].includes(dept) ||
               dept === subj.name.toLowerCase();
      }
      if (subj.category === 'Commerce') return dept === 'commerce' || dept === 'economics';
      if (subName === 'economics') return dept === 'economics' || dept === 'commerce';
      if (subName === 'geography' || subName === 'history') return dept === 'social studies';
      if (subName === 'social studies') return dept === 'social studies';
      if (subName === 'hindi') return dept === 'hindi';
      if (subName === 'nepali') return dept === 'nepali';
      if (subName === 'french') return dept === 'french';
      if (subName === 'home science') return dept === 'home science';
      if (subName === 'informatics practices') return dept === 'computer science';
      if (subName === 'computer science') return dept === 'computer science';
      if (subName === 'mathematics') return dept === 'mathematics';
      if (subName === 'english') return dept === 'english';
      if (subName === 'physics') return dept === 'physics';
      if (subName === 'chemistry') return dept === 'chemistry';
      if (subName === 'biology' || subName === 'science') return dept === 'biology';
      return false;
    });
  };

  const editGrade = editSection?.grade.name ?? editAssignment?.section.grade.name;
  const editSubject = subjects.find((subject) => subject.id === editSubjectId);
  const editEligibleTeachers = getEligibleTeachersForSectionSubject(teachers, editSubject, editGrade);

  useEffect(() => {
    if (!editOpen || !newTeacherId) return;
    if (editEligibleTeachers.some((teacher) => teacher.id === newTeacherId)) return;
    setNewTeacherId('');
  }, [editOpen, newTeacherId, editEligibleTeachers]);

  const openEdit = (assignment?: Assignment, subjectId?: string, subjectName?: string) => {
    setEditAssignment(assignment);
    setEditSubjectId(subjectId ?? assignment?.subjectId ?? '');
    setEditSubjectName(subjectName ?? assignment?.subject.name ?? '');
    setNewTeacherId(assignment?.teacherId ?? '');
    setEditSection(undefined);
    setEditOpen(true);
  };

  const openEditForCell = (section: Section, assignment?: Assignment, subjId?: string, subjName?: string) => {
    setEditAssignment(assignment);
    setEditSection(section);
    setEditSubjectId(subjId ?? assignment?.subjectId ?? '');
    setEditSubjectName(subjName ?? assignment?.subject.name ?? '');
    setNewTeacherId(assignment?.teacherId ?? '');
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!newTeacherId) { toast.error('Select a teacher'); return; }
    setSaving(true);
    try {
      if (editAssignment) {
        // Update existing
        const res = await fetch('/api/assignments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignmentId: editAssignment.id, newTeacherId }),
        });
        const data = await res.json();
        if (!res.ok) { throw new Error(data.error); }
        toast.success(data.message || 'Assignment updated');
      }
      setEditOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Stats
  const totalAssignments = assignments.length;
  const totalPeriods = assignments.reduce((s, a) => s + a.periodsPerWeek, 0);
  const overloaded = teachers.filter(t => t.assignedPeriods > t.targetWorkload + 2).length;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-violet-50/10 p-4 md:p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg gap-1">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg flex items-center justify-center stat-icon-blue shadow-md shadow-blue-100">
                <Users className="h-3.5 w-3.5 text-white" />
              </div>
              Teacher Assignments
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">One teacher per section per subject — the backbone of timetable generation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-lg border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 stagger-children">
        {[
          { label: 'Assignments', value: totalAssignments, icon: BookOpen, iconClass: 'stat-icon-blue', shadow: 'shadow-blue-100' },
          { label: 'Periods/week', value: totalPeriods, icon: CheckCircle2, iconClass: 'stat-icon-emerald', shadow: 'shadow-emerald-100' },
          { label: 'Teachers involved', value: new Set(assignments.map(a => a.teacherId)).size, icon: Users, iconClass: 'stat-icon-sky', shadow: 'shadow-sky-100' },
          { label: 'Overloaded teachers', value: overloaded, icon: AlertTriangle, iconClass: overloaded ? 'stat-icon-rose' : 'stat-icon-teal', shadow: overloaded ? 'shadow-rose-100' : 'shadow-teal-100' },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-2xl p-4 card-shadow card-interactive animate-fade-in-up flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${stat.iconClass} shadow-md ${stat.shadow} shrink-0`}>
              <stat.icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 leading-none">{stat.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Grade selector */}
      <div className="flex items-center gap-2.5 mb-4">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Grade:</span>
        <div className="flex gap-1.5 flex-wrap">
          {GRADES.map(g => (
            <button
              key={g}
              onClick={() => setSelectedGrade(g)}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold transition-all duration-150 ${
                selectedGrade === g
                  ? 'text-white shadow-md shadow-indigo-200'
                  : 'bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200'
              }`}
              style={selectedGrade === g ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' } : undefined}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Assignment matrix */}
      <Card className="border-0 card-shadow overflow-hidden bg-white rounded-2xl">
        <CardHeader className="py-3.5 px-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50/30">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-indigo-500" />
            Grade {selectedGrade} — Assignment Matrix
            <span className="text-slate-400 font-normal ml-1">({gradeSections.length} sections × {gradeSubjectIds.length} subjects)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Loading…</div>
          ) : gradeSubjectIds.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">No assignments found for grade {selectedGrade}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50 z-10 min-w-[90px]">
                      Section
                    </th>
                    {gradeSubjectIds.map(subjId => {
                      const subj = subjects.find(s => s.id === subjId);
                      return (
                        <th key={subjId} className="px-1.5 py-2 text-center min-w-[72px]">
                          <div className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-block ${CATEGORY_COLOUR[subj?.category ?? ''] ?? 'bg-slate-100 text-slate-600'}`}>
                            {subj?.code ?? subj?.name.slice(0, 6) ?? ''}
                          </div>
                          <div className="text-[9px] text-slate-400 mt-0.5 font-normal leading-tight max-w-[68px] mx-auto truncate" title={subj?.name}>
                            {subj?.name}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {gradeSections.map((section, si) => {
                    const sectionAssignments = coverageMap[section.id] ?? {};
                    const assignedCount = Object.keys(sectionAssignments).length;
                    const totalNeeded = gradeSubjectIds.length;
                    const complete = assignedCount === totalNeeded;

                    return (
                      <tr key={section.id} className={`border-b hover:bg-slate-50/50 transition ${si % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                        <td className="px-3 py-2 sticky left-0 bg-white border-r z-10">
                          <div className="font-bold text-slate-800 text-xs">{section.name}</div>
                          {section.stream && (
                            <div className="text-[10px] text-slate-400">{section.stream}</div>
                          )}
                          <div className={`text-[9px] mt-0.5 ${complete ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {assignedCount}/{totalNeeded}
                          </div>
                        </td>
                        {gradeSubjectIds.map(subjId => {
                          const a = sectionAssignments[subjId];
                          return (
                            <td key={subjId} className="px-0.5 py-0.5">
                              <AssignmentCell
                                assignment={a}
                                subjectName={subjects.find(s => s.id === subjId)?.name ?? ''}
                                onEdit={(assignment, sid, sname) => openEditForCell(section, assignment, sid ?? subjId, sname)}
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

      {/* Teacher workload panel */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-indigo-500" /> Teacher Workload — Grade {selectedGrade}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {teachers
            .filter(t => assignments.some(a => a.teacherId === t.id))
            .sort((a, b) => {
              const aPct = a.targetWorkload > 0 ? a.assignedPeriods / a.targetWorkload : 0;
              const bPct = b.targetWorkload > 0 ? b.assignedPeriods / b.targetWorkload : 0;
              return bPct - aPct;
            })
            .map(t => {
              const pct = t.targetWorkload > 0 ? (t.assignedPeriods / t.targetWorkload) * 100 : 0;
              const status = pct > 110 ? 'over' : pct >= 90 ? 'ok' : pct >= 60 ? 'light' : 'low';
              return (
                <div key={t.id} className={`bg-white rounded-lg p-2.5 border shadow-sm text-xs ${
                  status === 'over' ? 'border-red-200' : status === 'ok' ? 'border-emerald-200' : 'border-slate-100'
                }`}>
                  <div className="flex items-start justify-between gap-1">
                    <div>
                      <span className="font-bold text-slate-800">{t.abbreviation}</span>
                      <span className="text-slate-400 ml-1">·</span>
                      <span className="text-slate-500 ml-1">{t.department.slice(0, 8)}</span>
                    </div>
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 ${
                      status === 'over' ? 'border-red-300 text-red-600 bg-red-50' :
                      status === 'ok' ? 'border-emerald-300 text-emerald-600 bg-emerald-50' :
                      'border-slate-200 text-slate-500'
                    }`}>
                      {status === 'over' ? 'Over' : status === 'ok' ? 'OK' : 'Light'}
                    </Badge>
                  </div>
                  <div className="mt-1.5">
                    <WorkloadBar assigned={t.assignedPeriods} target={t.targetWorkload} />
                  </div>
                  <div className="text-[9px] text-slate-400 mt-1">
                    Grades: {t.teachableGrades.join(', ')}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {editAssignment ? 'Change Teacher' : 'Assign Teacher'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 space-y-1">
              <div><span className="font-medium">Section:</span> {editSection?.name ?? editAssignment?.section.name}</div>
              <div><span className="font-medium">Subject:</span> {editSubjectName}</div>
              {editAssignment && (
                <div><span className="font-medium">Current teacher:</span> {editAssignment.teacher.name} ({editAssignment.teacher.abbreviation})</div>
              )}
              {editAssignment && (
                <div><span className="font-medium">Periods/week:</span> {editAssignment.periodsPerWeek}</div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                {editAssignment ? 'Replace with:' : 'Assign teacher:'}
              </label>
              <Select value={newTeacherId} onValueChange={setNewTeacherId} disabled={!editSubjectId}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Select teacher…" />
                </SelectTrigger>
                <SelectContent>
                  {editEligibleTeachers.map(t => {
                    const pct = t.targetWorkload > 0 ? Math.round((t.assignedPeriods / t.targetWorkload) * 100) : 0;
                    return (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="font-medium">{t.abbreviation}</span>
                        <span className="text-slate-400 ml-1.5">— {t.name}</span>
                        <span className={`ml-1.5 text-xs ${pct > 100 ? 'text-red-500' : pct > 80 ? 'text-amber-500' : 'text-emerald-600'}`}>
                          ({t.assignedPeriods}/{t.targetWorkload})
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {editSubjectId && editEligibleTeachers.length === 0 && (
                <p className="mt-1.5 text-xs text-amber-600">No eligible teachers found for this section and subject.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !newTeacherId}>
              {saving ? 'Saving…' : editAssignment ? 'Update' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
