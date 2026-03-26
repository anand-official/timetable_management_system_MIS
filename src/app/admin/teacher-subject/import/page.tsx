'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import Link from 'next/link';
import { Button }       from '@/components/ui/button';
import { Input }        from '@/components/ui/input';
import { Label }        from '@/components/ui/label';
import { Badge }        from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Upload, FileText, CheckCircle, XCircle, AlertTriangle, Trash2,
  Plus, Download, RefreshCw, ArrowLeft, BookOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getExpectedLabDepartment,
  matchesLabDepartmentForSubject,
} from '@/lib/teacher-departments';
import { getEligibleTeachersForSectionSubject } from '@/lib/teacher-eligibility';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Teacher { id: string; name: string; abbreviation: string; department: string; teachableGrades?: string[]; isActive?: boolean }
interface Subject { id: string; name: string; code: string; category: string }
interface Section { id: string; name: string; grade: { name: string } }

interface ParsedRow {
  /** 1-based row number in the uploaded file */
  rowNum:         number;
  teacher:        string;
  subject:        string;
  section:        string;
  periodsPerWeek: number | '';
  isLabAssignment: boolean;
  /** undefined = not validated yet */
  valid?:         boolean;
  error?:         string;
}

interface SuccessRow {
  row:     number;
  teacher: string;
  subject: string;
  section: string;
  periods: number;
  action:  'created' | 'updated';
}

interface ErrorRow {
  row:   number;
  input: Record<string, unknown>;
  error: string;
}

interface Assignment {
  id:            string;
  periodsPerWeek: number;
  isLabAssignment: boolean;
  teacher: { id: string; name: string; abbreviation: string; department: string };
  subject: { id: string; name: string; code: string };
  section: { id: string; name: string };
}

// ── Column name normaliser ────────────────────────────────────────────────────

function normaliseHeaders(row: Record<string, string>): ParsedRow | null {
  // Accept many column name variants (case-insensitive, with/without spaces/underscores)
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const val = row[k] ?? row[k.toLowerCase()] ?? row[k.replace(/_/g, '')] ?? row[k.replace(/ /g, '_')];
      if (val !== undefined) return String(val).trim();
    }
    return '';
  };

  const teacher        = get('teacherAbbr', 'teacher_abbr', 'teacherName', 'teacher_name', 'teacher', 'abbr');
  const subject        = get('subjectName', 'subject_name', 'subject', 'subjectCode', 'subject_code');
  const section        = get('sectionName', 'section_name', 'section', 'class');
  const periodsRaw     = get('periodsPerWeek', 'periods_per_week', 'periods', 'periodsperweek');
  const labRaw         = get('isLabAssignment', 'is_lab_assignment', 'isLab', 'is_lab', 'lab');

  if (!teacher && !subject && !section) return null; // completely empty row

  const periodsPerWeek = periodsRaw === '' ? '' : (parseInt(periodsRaw, 10) || '');
  const isLabAssignment = ['true', '1', 'yes', 'y'].includes(labRaw.toLowerCase());

  return { rowNum: 0, teacher, subject, section, periodsPerWeek, isLabAssignment };
}

// ── Sample CSV content ────────────────────────────────────────────────────────

const SAMPLE_CSV = `teacherAbbr,subjectName,sectionName,periodsPerWeek,isLabAssignment
DRA,Games,VIA,2,false
NR,Games,VIIA,2,false
BKK,Games,VIIIA,2,false
DKM,Mathematics,VIA,8,false
AP,Mathematics,VIIIA,8,false
SKH,Chemistry,XIA,5,false
SKH,Chemistry,XIA,2,true
FBA,English,VIA,6,false
ST,Yoga,VIA,2,false
PM3,Library,VIA,1,false
`;

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'sample_teacher_subjects.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TeacherSubjectImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Shared data ─────────────────────────────────────────────────────────────
  const [teachers,   setTeachers]   = useState<Teacher[]>([]);
  const [subjects,   setSubjects]   = useState<Subject[]>([]);
  const [sections,   setSections]   = useState<Section[]>([]);
  const [loadingRef, setLoadingRef] = useState(true);

  // ── CSV import state ─────────────────────────────────────────────────────────
  const [parsedRows,   setParsedRows]   = useState<ParsedRow[]>([]);
  const [isDragging,   setIsDragging]   = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [importResult, setImportResult] = useState<{ successes: SuccessRow[]; errors: ErrorRow[]; summary: { total: number; success: number; errors: number; created: number; updated: number } } | null>(null);

  // ── Manual entry state ───────────────────────────────────────────────────────
  const [manualTeacher,   setManualTeacher]   = useState('');
  const [manualSubject,   setManualSubject]   = useState('');
  const [manualSection,   setManualSection]   = useState('');
  const [manualPeriods,   setManualPeriods]   = useState('');
  const [manualIsLab,     setManualIsLab]     = useState(false);
  const [manualSaving,    setManualSaving]    = useState(false);

  // ── Assignments list state ───────────────────────────────────────────────────
  const [assignments,       setAssignments]       = useState<Assignment[]>([]);
  const [loadingList,       setLoadingList]       = useState(false);
  const [filterTeacher,     setFilterTeacher]     = useState('');
  const [filterSection,     setFilterSection]     = useState('');
  const [deletingId,        setDeletingId]        = useState<string | null>(null);

  // ── Load reference data ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/timetable')
      .then(r => r.json())
      .then(data => {
        setTeachers(data.teachers ?? []);
        setSubjects(data.subjects ?? []);
        setSections(data.sections ?? []);
      })
      .catch(() => toast.error('Failed to load reference data'))
      .finally(() => setLoadingRef(false));
  }, []);

  const manualSectionRecord = sections.find((section) => section.id === manualSection);
  const manualSubjectRecord = subjects.find((subject) => subject.id === manualSubject);
  const eligibleManualTeachers = getEligibleTeachersForSectionSubject(
    teachers,
    manualSubjectRecord,
    manualSectionRecord?.grade.name
  );
  const expectedManualLabDepartment = getExpectedLabDepartment(manualSubjectRecord?.name);
  const labManualTeachers = teachers.filter((teacher) =>
    matchesLabDepartmentForSubject(teacher.department, manualSubjectRecord?.name)
  );

  useEffect(() => {
    if (!manualTeacher) return;
    if (manualIsLab) {
      if (labManualTeachers.some((teacher) => teacher.id === manualTeacher)) return;
      setManualTeacher('');
      return;
    }
    if (eligibleManualTeachers.some((teacher) => teacher.id === manualTeacher)) return;
    setManualTeacher('');
  }, [manualTeacher, manualIsLab, eligibleManualTeachers, labManualTeachers]);

  const loadAssignments = useCallback(async () => {
    setLoadingList(true);
    const params = new URLSearchParams();
    if (filterTeacher) params.set('teacherId', filterTeacher);
    if (filterSection) params.set('sectionId', filterSection);
    try {
      const res  = await fetch(`/api/teacher-subject?${params}`);
      const data = await res.json();
      setAssignments(data.assignments ?? []);
    } catch {
      toast.error('Failed to load assignments');
    } finally {
      setLoadingList(false);
    }
  }, [filterTeacher, filterSection]);

  // ── CSV parsing ──────────────────────────────────────────────────────────────

  function parseFile(file: File) {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      toast.error('Please upload a .csv file');
      return;
    }
    setImportResult(null);

    Papa.parse<Record<string, string>>(file, {
      header:         true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: (result) => {
        const rows: ParsedRow[] = [];
        result.data.forEach((raw, idx) => {
          const row = normaliseHeaders(raw);
          if (!row) return;
          row.rowNum = idx + 2; // +2: header row is row 1
          // Client-side validation preview
          const errs: string[] = [];
          if (!row.teacher) errs.push('teacher missing');
          if (!row.subject) errs.push('subject missing');
          if (!row.section) errs.push('section missing');
          if (row.periodsPerWeek === '' || Number(row.periodsPerWeek) < 1 || Number(row.periodsPerWeek) > 20)
            errs.push('periodsPerWeek must be 1–20');
          row.valid = errs.length === 0;
          row.error = errs.join('; ') || undefined;
          rows.push(row);
        });
        setParsedRows(rows);
        if (rows.length === 0) toast.warning('No data rows found in file');
        else toast.success(`Parsed ${rows.length} row(s) — review before importing`);
      },
      error: () => toast.error('Failed to parse CSV'),
    });
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
    e.target.value = '';
  }

  // ── Submit CSV rows ──────────────────────────────────────────────────────────

  async function handleImport() {
    const validRows = parsedRows.filter(r => r.valid);
    if (validRows.length === 0) {
      toast.error('No valid rows to import');
      return;
    }
    setSubmitting(true);
    try {
      const res  = await fetch('/api/teacher-subject/bulk', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          rows: validRows.map(r => ({
            teacher:         r.teacher,
            subject:         r.subject,
            section:         r.section,
            periodsPerWeek:  Number(r.periodsPerWeek),
            isLabAssignment: r.isLabAssignment,
          })),
        }),
      });
      const data = await res.json();
      setImportResult(data);
      if (data.summary.success > 0) {
        toast.success(`${data.summary.created} created, ${data.summary.updated} updated`);
        setParsedRows([]);
      }
      if (data.summary.errors > 0) {
        toast.error(`${data.summary.errors} row(s) failed — see details below`);
      }
    } catch {
      toast.error('Import failed');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Manual save ──────────────────────────────────────────────────────────────

  async function handleManualSave() {
    if (!manualTeacher || !manualSubject || !manualSection || !manualPeriods) {
      toast.error('All fields are required');
      return;
    }
    setManualSaving(true);
    try {
      const res  = await fetch('/api/teacher-subject', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          teacherId:       manualTeacher,
          subjectId:       manualSubject,
          sectionId:       manualSection,
          periodsPerWeek:  parseInt(manualPeriods, 10),
          isLabAssignment: manualIsLab,
        }),
      });
      const data = await res.json();
      if (data.assignment) {
        toast.success(`Saved: ${data.assignment.teacher.abbreviation} → ${data.assignment.subject.name} / ${data.assignment.section.name}`);
        setManualTeacher(''); setManualSubject(''); setManualSection('');
        setManualPeriods(''); setManualIsLab(false);
      } else {
        toast.error(data.error ?? 'Save failed');
      }
    } catch {
      toast.error('Save failed');
    } finally {
      setManualSaving(false);
    }
  }

  // ── Delete assignment ────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('Delete this assignment?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/teacher-subject?id=${id}`, { method: 'DELETE' });
      if ((await res.json()).success) {
        toast.success('Assignment deleted');
        setAssignments(prev => prev.filter(a => a.id !== id));
      }
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const validCount   = parsedRows.filter(r => r.valid).length;
  const invalidCount = parsedRows.filter(r => !r.valid).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-violet-50/10">
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-50 border-b border-indigo-100/60 bg-white/92 backdrop-blur-sm shadow-sm px-6 py-3.5 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span className="text-slate-300">/</span>
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-indigo-500" />
          <span className="font-semibold text-slate-800 text-sm">Teacher–Subject Assignments</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Manage Teacher–Subject Assignments</h1>
          <p className="text-muted-foreground mt-1">
            Bulk-import from CSV, or add assignments one by one. Changes take effect on the next timetable generation.
          </p>
        </div>

        <Tabs defaultValue="csv">
          <TabsList className="mb-6">
            <TabsTrigger value="csv">
              <Upload className="h-4 w-4 mr-2" /> CSV Import
            </TabsTrigger>
            <TabsTrigger value="manual">
              <Plus className="h-4 w-4 mr-2" /> Manual Entry
            </TabsTrigger>
            <TabsTrigger value="list" onClick={loadAssignments}>
              <BookOpen className="h-4 w-4 mr-2" /> View Assignments
            </TabsTrigger>
          </TabsList>

          {/* ════════════════════════════════════════ CSV IMPORT ══════════════ */}
          <TabsContent value="csv" className="space-y-4">

            {/* Help + sample download */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">CSV Format</CardTitle>
                <CardDescription>
                  Your CSV must have these columns (header names are flexible — abbreviations and alternatives are accepted):
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="text-sm w-full border border-border rounded">
                    <thead className="bg-muted">
                      <tr>
                        {['Column', 'Required', 'Accepted names', 'Example'].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[
                        ['Teacher',          'Yes', 'teacherAbbr · teacherName · teacher · abbr', 'DRA'],
                        ['Subject',          'Yes', 'subjectName · subject · subjectCode',         'Mathematics'],
                        ['Section',          'Yes', 'sectionName · section · class',               'VIA'],
                        ['Periods per week', 'Yes', 'periodsPerWeek · periods',                    '8'],
                        ['Is lab?',          'No',  'isLabAssignment · isLab · lab',               'false'],
                      ].map(([col, req, names, ex]) => (
                        <tr key={col}>
                          <td className="px-3 py-1.5 font-medium">{col}</td>
                          <td className="px-3 py-1.5">
                            <Badge variant={req === 'Yes' ? 'destructive' : 'secondary'} className="text-xs">{req}</Badge>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground font-mono text-xs">{names}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{ex}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button variant="outline" size="sm" onClick={downloadSample}>
                  <Download className="h-4 w-4 mr-2" /> Download sample CSV
                </Button>
              </CardContent>
            </Card>

            {/* Drop zone */}
            <Card
              className={`border-2 border-dashed transition-colors cursor-pointer ${
                isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
            >
              <CardContent className="flex flex-col items-center justify-center py-10 gap-3">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Drop your CSV file here, or click to browse</p>
                  <p className="text-sm text-muted-foreground mt-1">Supports .csv files up to 5 MB</p>
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileInput} />
              </CardContent>
            </Card>

            {/* Preview table */}
            {parsedRows.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Preview ({parsedRows.length} rows)</CardTitle>
                      <CardDescription className="mt-1">
                        <Badge variant="default"  className="mr-1">{validCount} valid</Badge>
                        {invalidCount > 0 && <Badge variant="destructive">{invalidCount} invalid</Badge>}
                        {invalidCount > 0 && <span className="ml-2 text-xs">Invalid rows will be skipped.</span>}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => { setParsedRows([]); setImportResult(null); }}>
                        <XCircle className="h-4 w-4 mr-1" /> Clear
                      </Button>
                      <Button onClick={handleImport} disabled={submitting || validCount === 0} size="sm">
                        {submitting
                          ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Importing…</>
                          : <><Upload className="h-4 w-4 mr-2" /> Import {validCount} row{validCount !== 1 ? 's' : ''}</>
                        }
                      </Button>
                    </div>
                  </div>
                  {submitting && <Progress value={undefined} className="h-1 mt-2" />}
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-72">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Teacher</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Section</TableHead>
                          <TableHead className="w-24">Periods/wk</TableHead>
                          <TableHead className="w-16">Lab</TableHead>
                          <TableHead className="w-24">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsedRows.map(row => (
                          <TableRow key={row.rowNum} className={row.valid ? '' : 'bg-red-50 dark:bg-red-950/20'}>
                            <TableCell className="text-muted-foreground text-xs">{row.rowNum}</TableCell>
                            <TableCell className="font-mono text-sm">{row.teacher || <span className="text-destructive italic">empty</span>}</TableCell>
                            <TableCell className="text-sm">{row.subject || <span className="text-destructive italic">empty</span>}</TableCell>
                            <TableCell className="font-mono text-sm">{row.section || <span className="text-destructive italic">empty</span>}</TableCell>
                            <TableCell className="text-center">{String(row.periodsPerWeek) || '—'}</TableCell>
                            <TableCell className="text-center text-xs">{row.isLabAssignment ? 'Yes' : '—'}</TableCell>
                            <TableCell>
                              {row.valid
                                ? <Badge variant="outline" className="text-green-600 border-green-300 text-xs">OK</Badge>
                                : (
                                  <span className="flex items-center gap-1 text-destructive text-xs">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    {row.error}
                                  </span>
                                )
                              }
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Import results */}
            {importResult && (
              <div className="space-y-3">
                {/* Summary bar */}
                <Alert className={importResult.summary.errors === 0 ? 'border-green-300 bg-green-50 dark:bg-green-950/20' : 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20'}>
                  <AlertDescription className="flex flex-wrap gap-3 items-center">
                    <span className="font-semibold">Import complete.</span>
                    <Badge variant="default">{importResult.summary.created} created</Badge>
                    <Badge variant="secondary">{importResult.summary.updated} updated</Badge>
                    {importResult.summary.errors > 0 && (
                      <Badge variant="destructive">{importResult.summary.errors} failed</Badge>
                    )}
                  </AlertDescription>
                </Alert>

                {/* Success rows */}
                {importResult.successes.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        Successful rows ({importResult.successes.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="h-52">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">#</TableHead>
                              <TableHead>Teacher</TableHead>
                              <TableHead>Subject</TableHead>
                              <TableHead>Section</TableHead>
                              <TableHead>Periods</TableHead>
                              <TableHead>Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {importResult.successes.map(s => (
                              <TableRow key={`${s.row}-${s.teacher}-${s.section}`}>
                                <TableCell className="text-muted-foreground text-xs">{s.row}</TableCell>
                                <TableCell className="font-mono text-sm">{s.teacher}</TableCell>
                                <TableCell className="text-sm">{s.subject}</TableCell>
                                <TableCell className="font-mono text-sm">{s.section}</TableCell>
                                <TableCell className="text-center">{s.periods}</TableCell>
                                <TableCell>
                                  <Badge variant={s.action === 'created' ? 'default' : 'secondary'} className="text-xs capitalize">{s.action}</Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {/* Error rows */}
                {importResult.errors.length > 0 && (
                  <Card className="border-destructive/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-destructive" />
                        Failed rows ({importResult.errors.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="h-52">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">Row</TableHead>
                              <TableHead>Input</TableHead>
                              <TableHead>Error</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {importResult.errors.map(e => (
                              <TableRow key={e.row} className="bg-red-50/50 dark:bg-red-950/10">
                                <TableCell className="text-xs text-muted-foreground">{e.row}</TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {Object.values(e.input).join(' / ')}
                                </TableCell>
                                <TableCell className="text-destructive text-xs">{e.error}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* ════════════════════════════════════════ MANUAL ENTRY ════════════ */}
          <TabsContent value="manual">
            <div className="max-w-lg">
              <Card>
                <CardHeader>
                  <CardTitle>Add / Update Assignment</CardTitle>
                  <CardDescription>
                    Select a teacher, subject, and section. If the combination already exists, the periods/week will be updated.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingRef && <p className="text-sm text-muted-foreground">Loading options…</p>}

                  {/* Teacher */}
                  <div className="space-y-1.5">
                    <Label htmlFor="m-teacher">Teacher</Label>
                    <Select
                      value={manualTeacher}
                      onValueChange={setManualTeacher}
                      disabled={loadingRef || !manualSubject || (!manualIsLab && !manualSection)}
                    >
                      <SelectTrigger id="m-teacher">
                        <SelectValue placeholder="Select teacher…" />
                      </SelectTrigger>
                      <SelectContent>
                        {[...(manualIsLab ? labManualTeachers : eligibleManualTeachers)].sort((a, b) => a.name.localeCompare(b.name)).map(t => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name} <span className="text-muted-foreground">({t.abbreviation})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {manualIsLab && labManualTeachers.length === 0 && (
                      <p className="text-xs text-amber-600">
                        {expectedManualLabDepartment
                          ? `No teachers in the ${expectedManualLabDepartment} department are available.`
                          : 'No lab teachers are available for this subject.'}
                      </p>
                    )}
                    {!manualIsLab && manualSubject && manualSection && eligibleManualTeachers.length === 0 && (
                      <p className="text-xs text-amber-600">No eligible teachers found for this section and subject.</p>
                    )}
                  </div>

                  {/* Subject */}
                  <div className="space-y-1.5">
                    <Label htmlFor="m-subject">Subject</Label>
                    <Select value={manualSubject} onValueChange={setManualSubject} disabled={loadingRef}>
                      <SelectTrigger id="m-subject">
                        <SelectValue placeholder="Select subject…" />
                      </SelectTrigger>
                      <SelectContent>
                        {[...subjects].sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} <span className="text-muted-foreground font-mono text-xs">({s.code})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Section */}
                  <div className="space-y-1.5">
                    <Label htmlFor="m-section">Section / Class</Label>
                    <Select value={manualSection} onValueChange={setManualSection} disabled={loadingRef}>
                      <SelectTrigger id="m-section">
                        <SelectValue placeholder="Select section…" />
                      </SelectTrigger>
                      <SelectContent>
                        {[...sections].sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Periods per week */}
                  <div className="space-y-1.5">
                    <Label htmlFor="m-periods">Periods per week</Label>
                    <Input
                      id="m-periods"
                      type="number"
                      min={1}
                      max={20}
                      placeholder="e.g. 8"
                      value={manualPeriods}
                      onChange={e => setManualPeriods(e.target.value)}
                    />
                  </div>

                  {/* Lab checkbox */}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="m-lab"
                      checked={manualIsLab}
                      onCheckedChange={v => setManualIsLab(v === true)}
                    />
                    <Label htmlFor="m-lab" className="cursor-pointer">
                      Lab assignment <span className="text-muted-foreground text-xs">(needs consecutive double periods)</span>
                    </Label>
                  </div>

                  <Button
                    onClick={handleManualSave}
                    disabled={manualSaving || !manualTeacher || !manualSubject || !manualSection || !manualPeriods}
                    className="w-full"
                  >
                    {manualSaving
                      ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
                      : <><Plus className="h-4 w-4 mr-2" /> Save Assignment</>
                    }
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ════════════════════════════════════════ VIEW ASSIGNMENTS ════════ */}
          <TabsContent value="list" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Filter by teacher</Label>
                    <Select value={filterTeacher || '__all__'} onValueChange={v => setFilterTeacher(v === '__all__' ? '' : v)}>
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder="All teachers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All teachers</SelectItem>
                        {[...teachers].sort((a, b) => a.name.localeCompare(b.name)).map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name} ({t.abbreviation})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Filter by section</Label>
                    <Select value={filterSection || '__all__'} onValueChange={v => setFilterSection(v === '__all__' ? '' : v)}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="All sections" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All sections</SelectItem>
                        {[...sections].sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={loadAssignments} disabled={loadingList} variant="outline" size="sm">
                    {loadingList
                      ? <RefreshCw className="h-4 w-4 animate-spin" />
                      : <RefreshCw className="h-4 w-4" />
                    }
                    <span className="ml-2">Load</span>
                  </Button>
                  <span className="text-sm text-muted-foreground ml-auto self-center">
                    {assignments.length} assignment{assignments.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </CardContent>
            </Card>

            {assignments.length > 0 && (
              <Card>
                <CardContent className="p-0">
                  <ScrollArea className="h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Teacher</TableHead>
                          <TableHead>Dept</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Section</TableHead>
                          <TableHead className="w-28 text-center">Periods/wk</TableHead>
                          <TableHead className="w-16 text-center">Lab</TableHead>
                          <TableHead className="w-16" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignments.map(a => (
                          <TableRow key={a.id}>
                            <TableCell>
                              <span className="font-medium">{a.teacher.name}</span>
                              <span className="text-muted-foreground text-xs ml-1">({a.teacher.abbreviation})</span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{a.teacher.department}</Badge>
                            </TableCell>
                            <TableCell>
                              {a.subject.name}
                              <span className="text-muted-foreground font-mono text-xs ml-1">({a.subject.code})</span>
                            </TableCell>
                            <TableCell className="font-mono font-medium">{a.section.name}</TableCell>
                            <TableCell className="text-center font-semibold">{a.periodsPerWeek}</TableCell>
                            <TableCell className="text-center">
                              {a.isLabAssignment
                                ? <Badge variant="secondary" className="text-xs">Lab</Badge>
                                : <span className="text-muted-foreground">—</span>
                              }
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                disabled={deletingId === a.id}
                                onClick={() => handleDelete(a.id)}
                              >
                                {deletingId === a.id
                                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  : <Trash2 className="h-3.5 w-3.5" />
                                }
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {assignments.length === 0 && !loadingList && (
              <div className="text-center py-16 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No assignments loaded. Click <strong>Load</strong> to fetch.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
