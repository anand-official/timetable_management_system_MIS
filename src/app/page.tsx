'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CalendarDays, Users, BookOpen, Upload, Brain, AlertTriangle,
  CheckCircle, Clock, GraduationCap, RefreshCw, FileSpreadsheet, FileText,
  Plus, Trash2, Edit, Search, BarChart3, Wrench, Lock, Unlock,
  TrendingUp, TrendingDown, Sparkles, Activity, Shield, Zap,
  ChevronRight, ChevronDown, Settings2, BookMarked, Award, Settings,
  Moon, Sun, Menu, X, ChevronLeft
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { DEFAULT_TEACHER_DEPARTMENTS } from '@/lib/teacher-departments';
import { getEligibleTeachersForSectionSubject } from '@/lib/teacher-eligibility';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  getAllSlotTeacherIds,
  getCombinedSlotDisplay,
  getSlotTeacherAbbreviations as getCombinedSlotTeacherAbbreviations,
  getSlotTeacherNames as getCombinedSlotTeacherNames,
} from '@/lib/combined-slot';

// Types
interface Teacher {
  id: string;
  name: string;
  abbreviation: string;
  department: string;
  isActive?: boolean;
  isHOD: boolean;
  targetWorkload: number;
  currentWorkload: number;
  teachableGrades: string[];
}

interface Section {
  id: string;
  name: string;
  stream?: string;
  grade: { name: string };
  classTeacher?: Teacher;
}

interface Subject {
  id: string;
  name: string;
  code: string;
  category: string;
  requiresLab: boolean;
}

interface Day {
  id: string;
  name: string;
  dayOrder: number;
}

interface TimeSlot {
  id: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  duration: number;
}

interface TimetableSlot {
  id: string;
  sectionId: string;
  dayId: string;
  timeSlotId: string;
  subjectId?: string;
  teacherId?: string;
  labTeacherId?: string | null;
  subject?: Subject;
  teacher?: Teacher;
  labTeacher?: Teacher | null;
  section?: Section;
  room?: { id: string; name: string } | null;
  day: Day;
  timeSlot: TimeSlot;
  isLab: boolean;
  isInnovation: boolean;
  isGames: boolean;
  isYoga: boolean;
  isLibrary: boolean;
  isWE: boolean;
  isFiller?: boolean;
  manuallyEdited?: boolean;
  notes?: string | null;
}

interface WorkloadData {
  id: string;
  name: string;
  abbreviation: string;
  department: string;
  targetWorkload: number;
  currentWorkload: number;
  difference: number;
  status: string;
}

interface Stats {
  totalTeachers: number;
  totalSections: number;
  totalSlots: number;
  averageWorkload: number;
  underloadedTeachers: number;
  overloadedTeachers: number;
}

interface PreviewSlotPayload {
  sectionId: string;
  dayId: string;
  timeSlotId: string;
  subjectId: string;
  teacherId: string;
  labTeacherId?: string | null;
  roomId?: string | null;
  notes?: string | null;
  isLab?: boolean;
  isGames?: boolean;
  isYoga?: boolean;
  isLibrary?: boolean;
  isInnovation?: boolean;
  isWE?: boolean;
  isMusic?: boolean;
  isArt?: boolean;
}

interface PreviewDiffRow {
  key: string;
  type: 'add' | 'remove' | 'update';
  sectionId: string;
  dayId: string;
  timeSlotId: string;
  current?: TimetableSlot;
  preview?: PreviewSlotPayload;
}

interface TeacherUnavailabilityRecord {
  id: string;
  teacherId: string;
  dayId: string;
  timeSlotId: string;
  reason?: string;
  day?: Day;
  timeSlot?: TimeSlot;
}

interface LabSplitSession {
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  dayId: string;
  dayName: string;
  periodNumbers: number[];
  unpairedPeriodNumbers: number[];
}

interface LabRepairChange {
  slotId: string;
  sectionName: string;
  subjectName: string;
  dayName: string;
  fromPeriod: number;
  toPeriod: number;
  teacherId: string | null;
}

export default function TimetableManagementSystem() {
  // State
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [darkMode, setDarkMode] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [workloadData, setWorkloadData] = useState<WorkloadData[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preserveLockedOnGenerate, setPreserveLockedOnGenerate] = useState(true);
  const [lastGenerationSummary, setLastGenerationSummary] = useState<{ preserved: number; generated: number } | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewDiffRows, setPreviewDiffRows] = useState<PreviewDiffRow[]>([]);
  const [selectedPreviewKeys, setSelectedPreviewKeys] = useState<Set<string>>(new Set());
  const [applyingPreview, setApplyingPreview] = useState(false);
  const [previewStats, setPreviewStats] = useState<{
    stats: { fillRate: number; conflictsDetected: number; roomConflictsDetected: number; totalSlots: number; teacherUtilization: { fullyUtilized: number; underUtilized: number; overUtilized: number } };
    warnings: string[];
    unassigned: { teacherName: string; subjectName: string; sectionName: string }[];
    totalPreviewSlots: number;
  } | null>(null);
  const [previewFilterType, setPreviewFilterType] = useState<'all' | 'add' | 'remove' | 'update'>('all');
  const [previewFilterSection, setPreviewFilterSection] = useState<string>('all');
  const [previewFilterDay, setPreviewFilterDay] = useState<string>('all');
  const [previewSearch, setPreviewSearch] = useState<string>('');
  
  // Selections
  const [selectedSection, setSelectedSection] = useState<string>('');
  const [selectedTeacher, setSelectedTeacher] = useState<string>('');
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  
  // Edit Dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<Partial<TimetableSlot>>({});
  
  // AI Analysis
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [labSplitSessions, setLabSplitSessions] = useState<LabSplitSession[]>([]);
  const [labRepairChanges, setLabRepairChanges] = useState<LabRepairChange[]>([]);
  const [labAuditLoading, setLabAuditLoading] = useState(false);
  const [labRepairLoading, setLabRepairLoading] = useState(false);
  
  // Import/Export
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importType, setImportType] = useState('timetable');
  
  // Teacher Management
  const [teacherDialogOpen, setTeacherDialogOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Partial<Teacher> & { id?: string }>({});
  const [teacherSearchQuery, setTeacherSearchQuery] = useState('');
  const [teacherDeptFilter, setTeacherDeptFilter] = useState('all');
  const [deletingTeacher, setDeletingTeacher] = useState<string | null>(null);
  const [teacherUnavailability, setTeacherUnavailability] = useState<TeacherUnavailabilityRecord[]>([]);
  const [unavailabilityLoading, setUnavailabilityLoading] = useState(false);
  const [unavailabilityReason, setUnavailabilityReason] = useState('');
  const [unavailabilityDayId, setUnavailabilityDayId] = useState('');
  const [unavailabilityTimeSlotId, setUnavailabilityTimeSlotId] = useState('');

  // Settings
  const [fillEmptySlots, setFillEmptySlots] = useState(true);
  const [allowDuplicateActivities, setAllowDuplicateActivities] = useState(true);
  const [studyPeriodTeacherPool, setStudyPeriodTeacherPool] = useState<string[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const sidebarCompact = sidebarCollapsed && !isMobile;

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      if (data.success && data.settings) {
        setFillEmptySlots(data.settings.fillEmptySlots);
        setAllowDuplicateActivities(data.settings.allowDuplicateActivities);
        try {
          const pool = JSON.parse(data.settings.studyPeriodTeacherPool);
          setStudyPeriodTeacherPool(Array.isArray(pool) ? pool : []);
        } catch(e) {}
      }
    } catch(error) {
       console.error('Error fetching settings', error);
    }
  }, []);

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true);
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fillEmptySlots,
          allowDuplicateActivities,
          studyPeriodTeacherPool: JSON.stringify(studyPeriodTeacherPool)
        }),
      });
      const data = await response.json();
      if (data.success) {
        toast.success('Settings saved successfully');
      } else {
        toast.error('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Error saving settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/timetable');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      setSections(data.sections || []);
      setTeachers(data.teachers || []);
      setSubjects(data.subjects || []);
      setDays(data.days || []);
      setTimeSlots(data.timeSlots || []);
      setSlots(data.slots || []);

      // Set default selections only if not already set (use functional updater to avoid deps)
      if (data.sections?.length > 0) {
        setSelectedSection(prev => prev || data.sections[0].id);
      }
      if (data.teachers?.length > 0) {
        setSelectedTeacher(prev => prev || data.teachers[0].id);
      }
      if (data.days?.length > 0) {
        setSelectedDay(prev => prev || data.days[0].id);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []); // No selection deps — avoids re-fetching on every selection change

  // Fetch workload data
  const fetchWorkload = useCallback(async () => {
    try {
      const response = await fetch('/api/workload');
      const data = await response.json();
      setWorkloadData(data.teachers || []);
    } catch (error) {
      console.error('Error fetching workload:', error);
    }
  }, []);

  // Fetch AI stats
  const fetchAIStats = useCallback(async () => {
    try {
      const response = await fetch('/api/ai-schedule');
      const data = await response.json();
      setStats(data.stats);
    } catch (error) {
      console.error('Error fetching AI stats:', error);
    }
  }, []);

  const fetchLabAudit = useCallback(async () => {
    try {
      setLabAuditLoading(true);
      const response = await fetch('/api/timetable/audit/labs');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      setLabSplitSessions(data.splitLabSessions || []);
    } catch (error) {
      console.error('Error auditing lab splits:', error);
      toast.error('Failed to audit lab splits');
    } finally {
      setLabAuditLoading(false);
    }
  }, []);

  // Dark mode — read from localStorage on mount, then apply on change
  useEffect(() => {
    const stored = localStorage.getItem('darkMode');
    if (stored === 'true') setDarkMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // Close mobile sidebar on tab switch
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [activeTab]);

  useEffect(() => {
    fetchData();
    fetchWorkload();
    fetchAIStats();
    fetchLabAudit();
    fetchSettings();
  }, [fetchData, fetchWorkload, fetchAIStats, fetchLabAudit, fetchSettings]);

  // Validate workload — calls POST to create validation records, then refreshes
  const handleValidateWorkload = useCallback(async () => {
    try {
      const response = await fetch('/api/workload', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        toast.success(`Validated ${data.validated} teachers: ${data.summary.ok} OK, ${data.summary.under} under, ${data.summary.over} over`);
        fetchWorkload();
      } else {
        toast.error('Workload validation failed');
      }
    } catch (error) {
      console.error('Error validating workload:', error);
      toast.error('Failed to validate workload');
    }
  }, [fetchWorkload]);

  // Generate timetable
  const handleGenerate = async () => {
    if (!confirm('This will clear the existing timetable and regenerate from scratch. Are you sure?')) return;
    try {
      setGenerating(true);
      toast.info('Starting automated timetable generation... This may take a minute.');
      
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearExisting: true, preserveLocked: preserveLockedOnGenerate, strategy: 'balanced' }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success(data.message || `Generated ${data.slotsCreated} timetable slots`);
        setLastGenerationSummary({
          preserved: data.preservedLockedSlots || 0,
          generated: data.newlyGeneratedSlots || data.slotsCreated || 0,
        });
        setGenerationWarnings(data.warnings || []);
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          toast.warning(`Generation warnings: ${data.warnings.length} lab fallback event(s)`);
        }
        fetchData();
        fetchWorkload();
        fetchLabAudit();
      } else {
        toast.error(data.error || 'Generation failed');
      }
    } catch (error) {
      console.error('Error generating timetable:', error);
      toast.error('Failed to generate timetable - please try again');
    } finally {
      setGenerating(false);
    }
  };

  const handlePreviewGenerate = async () => {
    try {
      setPreviewing(true);
      const response = await fetch('/api/generate?preview=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clearExisting: true,
          preserveLocked: preserveLockedOnGenerate,
          autoRepairLabs: true,
          strategy: 'balanced',
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);

      const liveMap = new Map<string, TimetableSlot>();
      for (const s of slots) liveMap.set(`${s.sectionId}|${s.dayId}|${s.timeSlotId}`, s);
      const previewMap = new Map<string, PreviewSlotPayload>();
      const previewSlots: PreviewSlotPayload[] = data.previewSlots || [];
      for (const s of previewSlots) previewMap.set(`${s.sectionId}|${s.dayId}|${s.timeSlotId}`, s);

      const allKeys = new Set<string>([...liveMap.keys(), ...previewMap.keys()]);
      const diffs: PreviewDiffRow[] = [];
      for (const key of allKeys) {
        const current = liveMap.get(key);
        const preview = previewMap.get(key);
        if (!current && preview) {
          diffs.push({
            key,
            type: 'add',
            sectionId: preview.sectionId,
            dayId: preview.dayId,
            timeSlotId: preview.timeSlotId,
            preview,
          });
          continue;
        }
        if (current && !preview) {
          diffs.push({
            key,
            type: 'remove',
            sectionId: current.sectionId,
            dayId: current.dayId,
            timeSlotId: current.timeSlotId,
            current,
          });
          continue;
        }
        if (current && preview) {
          const changed =
            current.subjectId !== preview.subjectId ||
            current.teacherId !== preview.teacherId ||
            (current.labTeacherId ?? null) !== (preview.labTeacherId ?? null) ||
            (current.room?.id ?? null) !== (preview.roomId ?? null) ||
            (current.notes ?? null) !== (preview.notes ?? null);
          if (changed) {
            diffs.push({
              key,
              type: 'update',
              sectionId: current.sectionId,
              dayId: current.dayId,
              timeSlotId: current.timeSlotId,
              current,
              preview,
            });
          }
        }
      }

      setPreviewDiffRows(diffs);
      setSelectedPreviewKeys(new Set(diffs.map(d => d.key)));
      setPreviewStats({
        stats: data.stats,
        warnings: data.warnings || [],
        unassigned: data.unassigned || [],
        totalPreviewSlots: data.slotsCreated,
      });
      // Reset filters when opening fresh preview
      setPreviewFilterType('all');
      setPreviewFilterSection('all');
      setPreviewFilterDay('all');
      setPreviewSearch('');
      setPreviewDialogOpen(true);
      toast.success(`Preview ready — ${diffs.length} slot${diffs.length !== 1 ? 's' : ''} changed`);
    } catch (error) {
      console.error('Error previewing generation:', error);
      toast.error('Failed to preview generation');
    } finally {
      setPreviewing(false);
    }
  };

  const handleApplyPreviewSelected = async () => {
    const selected = previewDiffRows.filter(r => selectedPreviewKeys.has(r.key));
    if (selected.length === 0) {
      toast.info('No preview changes selected');
      return;
    }
    try {
      setApplyingPreview(true);
      const changes = selected.map((row) => {
        if (row.type === 'remove') {
          return {
            type: 'remove',
            sectionId: row.sectionId,
            dayId: row.dayId,
            timeSlotId: row.timeSlotId,
          };
        }
        const preview = row.preview as PreviewSlotPayload;
        return {
          type: row.type,
          subjectId: preview.subjectId,
          teacherId: preview.teacherId,
          labTeacherId: preview.labTeacherId ?? null,
          roomId: preview.roomId ?? null,
          notes: preview.notes ?? null,
          isLab: preview.isLab,
          isGames: preview.isGames,
          isYoga: preview.isYoga,
          isLibrary: preview.isLibrary,
          isInnovation: preview.isInnovation,
          isWE: preview.isWE,
          isMusic: preview.isMusic,
          isArt: preview.isArt,
          sectionId: row.sectionId,
          dayId: row.dayId,
          timeSlotId: row.timeSlotId,
        };
      });
      const response = await fetch('/api/generate/apply-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success(`Applied ${data.applied} change(s)`);
      setPreviewDialogOpen(false);
      fetchData();
      fetchWorkload();
      fetchLabAudit();
    } catch (error) {
      console.error('Error applying preview:', error);
      toast.error('Failed to apply preview changes');
    } finally {
      setApplyingPreview(false);
    }
  };

  const handleToggleSlotLock = async (slot: Pick<TimetableSlot, 'id' | 'sectionId' | 'dayId' | 'timeSlotId'>) => {
    try {
      const response = await fetch(`/api/timetable/${slot.id}/lock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: slot.sectionId,
          dayId: slot.dayId,
          timeSlotId: slot.timeSlotId,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success(data.slot?.manuallyEdited ? 'Slot locked' : 'Slot unlocked');
      fetchData();
    } catch (error) {
      console.error('Error toggling slot lock:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to toggle slot lock');
    }
  };

  const handleUnlockAllSlots = async () => {
    try {
      const response = await fetch('/api/timetable/unlock-all', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success(`Unlocked ${data.unlocked || 0} slot(s)`);
      fetchData();
    } catch (error) {
      console.error('Error unlocking all slots:', error);
      toast.error('Failed to unlock slots');
    }
  };

  const handleRepairLabSplits = async () => {
    try {
      setLabRepairLoading(true);
      const response = await fetch('/api/timetable/repair/labs', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);

      setLabRepairChanges(data.changes || []);
      if (data.repaired > 0) {
        toast.success(`Repaired ${data.repaired} split lab period(s)`);
      } else {
        toast.info('No split lab periods were repaired');
      }
      fetchData();
      fetchWorkload();
      fetchLabAudit();
    } catch (error) {
      console.error('Error repairing lab splits:', error);
      toast.error('Failed to repair lab splits');
    } finally {
      setLabRepairLoading(false);
    }
  };

  // Update timetable slot
  const handleUpdateSlot = async () => {
    if (!editingSlot.sectionId || !editingSlot.dayId || !editingSlot.timeSlotId) {
      toast.error('Missing required fields');
      return;
    }

    try {
      const response = await fetch('/api/timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingSlot),
      });
      const data = await response.json();
      
      if (data.slot) {
        toast.success(data.message || 'Slot updated');
        fetchData();
        setEditDialogOpen(false);
        setEditingSlot({});
      } else if (data.error) {
        toast.error(data.error);
      }
    } catch (error) {
      console.error('Error updating slot:', error);
      toast.error('Failed to update slot');
    }
  };

  // Delete slot
  const handleDeleteSlot = async (slotId: string) => {
    try {
      const response = await fetch(`/api/timetable?id=${slotId}`, { method: 'DELETE' });
      const data = await response.json();
      
      if (data.success) {
        toast.success('Slot deleted');
        fetchData();
      }
    } catch (error) {
      console.error('Error deleting slot:', error);
      toast.error('Failed to delete slot');
    }
  };

  // AI Analysis
  const handleAIAnalysis = async (action: string) => {
    try {
      setAiLoading(true);
      const response = await fetch('/api/ai-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      
      if (data.success) {
        setAiAnalysis(data.analysis || data.recommendations || data.suggestions || '');
        toast.success('AI analysis complete');
      }
    } catch (error) {
      console.error('Error in AI analysis:', error);
      toast.error('AI analysis failed');
    } finally {
      setAiLoading(false);
    }
  };

  // Teacher Management Functions
  const handleSaveTeacher = async () => {
    if (!editingTeacher.name || !editingTeacher.abbreviation || !editingTeacher.department) {
      toast.error('Name, abbreviation, and department are required');
      return;
    }

    try {
      const url = '/api/teachers';
      const method = editingTeacher.id ? 'PUT' : 'POST';
      const body = editingTeacher.id 
        ? { id: editingTeacher.id, ...editingTeacher }
        : editingTeacher;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      const data = await response.json();
      
      if (data.success || data.teacher) {
        toast.success(editingTeacher.id ? 'Teacher updated successfully' : 'Teacher added successfully');
        fetchData();
        fetchWorkload();
        setTeacherDialogOpen(false);
        setEditingTeacher({});
      } else {
        toast.error(data.error || 'Failed to save teacher');
      }
    } catch (error) {
      console.error('Error saving teacher:', error);
      toast.error('Failed to save teacher');
    }
  };

  const handleDeleteTeacher = async (teacherId: string) => {
    if (!confirm('Are you sure you want to delete this teacher?')) return;
    
    setDeletingTeacher(teacherId);
    try {
      const response = await fetch(`/api/teachers?id=${teacherId}`, { method: 'DELETE' });
      const data = await response.json();
      
      if (data.success) {
        toast.success('Teacher deleted successfully');
        fetchData();
        fetchWorkload();
      } else {
        toast.error(data.error || 'Failed to delete teacher');
      }
    } catch (error) {
      console.error('Error deleting teacher:', error);
      toast.error('Failed to delete teacher');
    } finally {
      setDeletingTeacher(null);
    }
  };

  const openEditTeacherDialog = (teacher: Teacher) => {
    setEditingTeacher({
      id: teacher.id,
      name: teacher.name,
      abbreviation: teacher.abbreviation,
      department: teacher.department,
      isHOD: teacher.isHOD,
      targetWorkload: teacher.targetWorkload,
      teachableGrades: teacher.teachableGrades ?? [],
    });
    setTeacherDialogOpen(true);
  };

  const openAddTeacherDialog = () => {
    setEditingTeacher({
      name: '',
      abbreviation: '',
      department: '',
      isHOD: false,
      targetWorkload: 30,
      teachableGrades: [],
    });
    setTeacherDialogOpen(true);
  };

  // Filter teachers for management view
  const filteredTeachers = teachers.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(teacherSearchQuery.toLowerCase()) ||
                         t.abbreviation.toLowerCase().includes(teacherSearchQuery.toLowerCase());
    const matchesDept = teacherDeptFilter === 'all' || t.department === teacherDeptFilter;
    return matchesSearch && matchesDept;
  });

  // Get unique departments
  const departments = [...new Set(teachers.map(t => t.department))].sort();
  const teacherDepartmentOptions = [...new Set([...DEFAULT_TEACHER_DEPARTMENTS, ...departments])].sort((a, b) =>
    a.localeCompare(b)
  );
  const editingSection = sections.find((section) => section.id === editingSlot.sectionId);
  const editingSubject = subjects.find((subject) => subject.id === editingSlot.subjectId);
  const eligibleTeachersForEditingSlot = getEligibleTeachersForSectionSubject(
    teachers,
    editingSubject,
    editingSection?.grade.name
  );
  const sectionSubjectSlotCount =
    editingSlot.sectionId && editingSlot.subjectId
      ? slots.filter(
          (slot) => slot.sectionId === editingSlot.sectionId && slot.subjectId === editingSlot.subjectId
        ).length
      : 0;

  useEffect(() => {
    if (!editDialogOpen || !editingSlot.teacherId) return;
    if (!editingSubject || !editingSection) return;
    if (eligibleTeachersForEditingSlot.some((teacher) => teacher.id === editingSlot.teacherId)) return;
    setEditingSlot((prev) => ({ ...prev, teacherId: undefined }));
  }, [
    editDialogOpen,
    editingSlot.teacherId,
    editingSection,
    editingSubject,
    eligibleTeachersForEditingSlot,
  ]);

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Full-school export via /api/export (multi-sheet Excel or multi-page PDF). */
  const handleExport = async (format: string, type: string = 'class') => {
    try {
      const response = await fetch(`/api/export?format=${format}&type=${type}`);
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string; detail?: string };
        const msg = [err.error, err.detail].filter(Boolean).join(': ') || 'Export failed';
        toast.error(msg);
        return;
      }

      if (format === 'csv') {
        const blob = await response.blob();
        triggerBlobDownload(blob, 'timetable.csv');
      } else if (format === 'excel') {
        const blob = await response.blob();
        const name = type === 'teacher' ? 'timetable_all_teachers.xlsx' : 'timetable_all_classes.xlsx';
        triggerBlobDownload(blob, name);
      } else if (format === 'pdf') {
        const blob = await response.blob();
        const name = type === 'teacher' ? 'timetable_all_teachers.pdf' : 'timetable_all_classes.pdf';
        triggerBlobDownload(blob, name);
      } else {
        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        triggerBlobDownload(blob, 'timetable.json');
      }
      toast.success(`Exported (${format.toUpperCase()})`);
    } catch (error) {
      console.error('Error exporting:', error);
      toast.error('Export failed');
    }
  };

  /** Single class or teacher export (one sheet / one page). */
  const downloadTimetableFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string; detail?: string };
        const msg = [err.error, err.detail].filter(Boolean).join(': ') || 'Download failed';
        toast.error(msg);
        return;
      }
      const blob = await response.blob();
      triggerBlobDownload(blob, filename);
      toast.success('Download started');
    } catch (e) {
      console.error(e);
      toast.error('Download failed');
    }
  };

  // Import
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', importType);

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      
      if (data.success) {
        toast.success(data.message);
        fetchData();
        fetchWorkload();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error('Error importing:', error);
      toast.error('Import failed');
    }
    setImportDialogOpen(false);
  };

  const fetchTeacherUnavailability = useCallback(async (teacherId?: string) => {
    const id = teacherId || selectedTeacher;
    if (!id) {
      setTeacherUnavailability([]);
      return;
    }
    try {
      setUnavailabilityLoading(true);
      const response = await fetch(`/api/teacher-unavailability?teacherId=${id}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      setTeacherUnavailability(data.records || []);
    } catch (error) {
      console.error('Error fetching teacher unavailability:', error);
      toast.error('Failed to load teacher unavailability');
    } finally {
      setUnavailabilityLoading(false);
    }
  }, [selectedTeacher]);

  const handleAddUnavailability = async () => {
    if (!selectedTeacher || !unavailabilityDayId || !unavailabilityTimeSlotId) {
      toast.error('Select teacher, day, and period');
      return;
    }
    try {
      const response = await fetch('/api/teacher-unavailability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId: selectedTeacher,
          dayId: unavailabilityDayId,
          timeSlotId: unavailabilityTimeSlotId,
          reason: unavailabilityReason || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success('Unavailability saved');
      setUnavailabilityReason('');
      fetchTeacherUnavailability(selectedTeacher);
    } catch (error) {
      console.error('Error adding teacher unavailability:', error);
      toast.error('Failed to save unavailability');
    }
  };

  const handleDeleteUnavailability = async (id: string) => {
    try {
      const response = await fetch(`/api/teacher-unavailability?id=${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      toast.success('Unavailability removed');
      fetchTeacherUnavailability(selectedTeacher);
    } catch (error) {
      console.error('Error deleting teacher unavailability:', error);
      toast.error('Failed to remove unavailability');
    }
  };

  const handleToggleUnavailability = async (dayId: string, timeSlotId: string) => {
    if (!selectedTeacher) return;
    const existing = teacherUnavailability.find(
      (u) => u.dayId === dayId && u.timeSlotId === timeSlotId
    );
    if (existing) {
      await handleDeleteUnavailability(existing.id);
      return;
    }
    try {
      const response = await fetch('/api/teacher-unavailability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId: selectedTeacher,
          dayId,
          timeSlotId,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      fetchTeacherUnavailability(selectedTeacher);
    } catch (error) {
      console.error('Error toggling teacher unavailability:', error);
      toast.error('Failed to update unavailability');
    }
  };

  // Get timetable grid for a section
  const getSectionTimetable = (sectionId: string) => {
    return slots.filter(s => s.sectionId === sectionId);
  };

  // Get timetable grid for a teacher
  const getTeacherTimetable = (teacherId: string) => {
    return slots.filter(s => getAllSlotTeacherIds(s).includes(teacherId));
  };

  const getTeacherWorkloadCount = (teacherId: string) => {
    return new Set(
      getTeacherTimetable(teacherId).map((slot) => `${slot.dayId}|${slot.timeSlotId}`)
    ).size;
  };

  const getTeacherCellSlots = (teacherSlots: TimetableSlot[], dayId: string, timeSlotId: string) =>
    teacherSlots.filter((slot) => slot.dayId === dayId && slot.timeSlotId === timeSlotId);

  // Get slot for specific day/period
  const getSlot = (sectionSlots: TimetableSlot[], dayId: string, timeSlotId: string) => {
    return sectionSlots.find(s => s.dayId === dayId && s.timeSlotId === timeSlotId);
  };

  const getDisplayedSubject = (slot: TimetableSlot) => {
    const combinedDisplay = getCombinedSlotDisplay(slot.notes);
    if (combinedDisplay) {
      return combinedDisplay;
    }
    if (slot.isWE) {
      return { code: 'W.E.', name: 'Work Experience' };
    }
    return {
      code: slot.subject?.code || slot.subject?.name || '—',
      name: slot.subject?.name || slot.subject?.code || '—',
    };
  };

  const getSlotTeacherAbbreviation = (slot: Partial<Pick<TimetableSlot, 'teacher' | 'labTeacher'>>) =>
    getCombinedSlotTeacherAbbreviations(slot).join(' + ');

  const getSlotTeacherNames = (slot: Partial<Pick<TimetableSlot, 'teacher' | 'labTeacher'>>) =>
    getCombinedSlotTeacherNames(slot).join(' + ');

  const getPreviewDisplayedSubject = (slot?: PreviewSlotPayload | null) => {
    if (!slot) return null;
    const combinedDisplay = getCombinedSlotDisplay(slot.notes);
    if (combinedDisplay) return combinedDisplay;
    const subject = subjects.find((item) => item.id === slot.subjectId);
    return {
      code: subject?.code || subject?.name || '—',
      name: subject?.name || subject?.code || slot.subjectId,
    };
  };

  const getPreviewTeacherNames = (slot?: PreviewSlotPayload | null) => {
    if (!slot) return '';
    const combinedNames = getCombinedSlotTeacherNames(slot);
    if (combinedNames.length > 0) return combinedNames.join(' + ');
    return getAllSlotTeacherIds(slot)
      .map((id) => teachers.find((teacher) => teacher.id === id)?.name ?? '')
      .filter((value, index, list) => value && list.indexOf(value) === index)
      .join(' + ');
  };

  const getPreviewTeacherAbbreviation = (slot?: PreviewSlotPayload | null) => {
    if (!slot) return '';
    const combinedAbbreviations = getCombinedSlotTeacherAbbreviations(slot);
    if (combinedAbbreviations.length > 0) return combinedAbbreviations.join(' + ');
    return getAllSlotTeacherIds(slot)
      .map((id) => teachers.find((teacher) => teacher.id === id)?.abbreviation ?? '')
      .filter((value, index, list) => value && list.indexOf(value) === index)
      .join(' + ');
  };

  // Status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OK': return 'bg-green-500';
      case 'Under': return 'bg-yellow-500';
      case 'Over': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  // Slot type color coding for timetable cells
  const getSlotCellClass = (slot: TimetableSlot) => {
    if (slot.isFiller) return 'slot-filler';
    if (slot.isLab) return 'slot-lab';
    if (slot.isGames) return 'slot-games';
    if (slot.isYoga) return 'slot-yoga';
    if (slot.isLibrary) return 'slot-library';
    if (slot.isInnovation) return 'slot-innovation';
    if (slot.isWE) return 'slot-we';
    if ((slot as any).isMusic) return 'slot-music';
    if ((slot as any).isArt) return 'slot-art';
    return 'slot-regular';
  };

  // Slot type label
  const getSlotTypeLabel = (slot: TimetableSlot) => {
    if (slot.isLab) return { label: 'LAB', color: 'text-blue-600' };
    if (slot.isGames) return { label: 'GAMES', color: 'text-emerald-600' };
    if (slot.isYoga) return { label: 'YOGA', color: 'text-violet-600' };
    if (slot.isLibrary) return { label: 'LIB', color: 'text-amber-600' };
    if (slot.isInnovation) return { label: 'INNOV', color: 'text-teal-600' };
    if (slot.isWE) return { label: 'W.E.', color: 'text-pink-600' };
    if ((slot as any).isMusic) return { label: 'MUSIC', color: 'text-pink-600' };
    if ((slot as any).isArt) return { label: 'ART', color: 'text-rose-600' };
    return null;
  };

  // Consistent workload status using ±2 tolerance (matches API)
  const getWorkloadStatus = (currentWorkload: number, targetWorkload: number) => {
    const diff = currentWorkload - targetWorkload;
    if (Math.abs(diff) <= 2) return 'OK';
    return diff > 0 ? 'Over' : 'Under';
  };

  // Fill rate for the dashboard
  const fillRate = sections.length && days.length && timeSlots.length
    ? Math.round((slots.length / (sections.length * days.length * timeSlots.length)) * 100)
    : 0;

  const fillerSlotsCount = slots.filter((s: any) => s.isFiller).length;

  useEffect(() => {
    if (!selectedTeacher && teachers.length > 0) return;
    fetchTeacherUnavailability(selectedTeacher);
  }, [selectedTeacher, teachers.length, fetchTeacherUnavailability]);

  useEffect(() => {
    if (!unavailabilityDayId && days.length > 0) setUnavailabilityDayId(days[0].id);
    if (!unavailabilityTimeSlotId && timeSlots.length > 0) setUnavailabilityTimeSlotId(timeSlots[0].id);
  }, [days, timeSlots, unavailabilityDayId, unavailabilityTimeSlotId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mesh-purple">
        <div className="absolute inset-0 bg-dot-grid opacity-30 pointer-events-none" />
        <div className="relative text-center space-y-6 animate-scale-in">
          <div className="relative mx-auto w-24 h-24">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-100" style={{ animation: 'pulse-ring 2s ease-in-out infinite' }} />
            <div className="absolute inset-0 rounded-full border-4 border-t-indigo-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
            <div
              className="absolute inset-3 rounded-full flex items-center justify-center shadow-lg shadow-indigo-200"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
            >
              <GraduationCap className="h-8 w-8 text-white" />
            </div>
          </div>
          <div>
            <p className="text-lg font-bold text-slate-900 tracking-tight">Loading Timetable</p>
            <p className="text-sm text-slate-500 mt-1.5">Preparing your schedule data…</p>
          </div>
          <div className="flex gap-2 justify-center">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="h-2 w-2 rounded-full bg-indigo-400"
                style={{ animation: 'bounce-dot 1.4s ease-in-out infinite', animationDelay: `${i * 0.22}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const NAV_LABELS: Record<string, string> = {
    dashboard: 'Dashboard',
    class: 'Class Timetable',
    teacher: 'Teacher Timetable',
    workload: 'Workload',
    ai: 'Analysis',
    'manage-teachers': 'Manage Teachers',
    settings: 'Settings',
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-50 via-indigo-50/20 to-violet-50/10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">

      {/* ── Mobile sidebar backdrop ── */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Sidebar ── */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 shadow-[2px_0_24px_0_rgba(99,102,241,0.07)] transition-[width] duration-300 ease-in-out lg:translate-x-0 ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${sidebarCompact ? 'w-[68px]' : 'w-60'}`}>

        {/* ── Floating collapse toggle (desktop only) ── */}
        <button
          onClick={() => setSidebarCollapsed(c => !c)}
          className="hidden lg:flex absolute -right-3 top-16 z-10 h-6 w-6 items-center justify-center rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-indigo-100 transition-all duration-200"
          aria-label={sidebarCompact ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft className={`h-3.5 w-3.5 transition-transform duration-300 ${sidebarCompact ? 'rotate-180' : ''}`} />
        </button>

        {/* ── Branding ── */}
        <div className="flex items-center h-14 px-3 border-b border-slate-100 dark:border-slate-800 overflow-hidden shrink-0">
          {/* Logo */}
          <div className={`flex items-center justify-center rounded-xl shadow-md shadow-indigo-100/60 shrink-0 overflow-hidden transition-all duration-300 ${sidebarCompact ? 'h-8 w-8' : 'h-9 w-9'}`} style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            <img src="/logo.png" alt="Logo" className="h-full w-full object-contain p-0.5" />
          </div>
          {/* Text — fades & slides on collapse */}
          <div className={`ml-3 min-w-0 flex-1 transition-all duration-300 ${sidebarCompact ? 'opacity-0 w-0 ml-0 overflow-hidden' : 'opacity-100'}`}>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight whitespace-nowrap">Modern Indian School</div>
            <div className="text-[10px] text-indigo-400 font-semibold tracking-wide whitespace-nowrap">Timetable · 2025–26</div>
          </div>
          {/* Mobile close */}
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden ml-auto p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Nav ── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 dark:bg-slate-900">

          {/* Section: Views */}
          <div className={`transition-all duration-200 ${sidebarCompact ? 'px-2' : 'px-2'}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 pb-1.5 transition-all duration-200 ${sidebarCompact ? 'text-center text-[8px] opacity-50' : 'px-3 pt-1'}`}>
              {sidebarCompact ? '···' : 'Views'}
            </p>
            <div className="space-y-0.5">
              {[
                { value: 'dashboard', icon: BarChart3, label: 'Dashboard' },
                { value: 'class', icon: CalendarDays, label: 'Class Timetable' },
                { value: 'teacher', icon: Users, label: 'Teacher Timetable' },
                { value: 'workload', icon: Activity, label: 'Workload' },
                { value: 'ai', icon: Sparkles, label: 'Analysis' },
              ].map(({ value, icon: Icon, label }) => {
                const isActive = activeTab === value;
                return (
                  <button
                    key={value}
                    onClick={() => setActiveTab(value)}
                    title={sidebarCompact ? label : undefined}
                    className={`group relative w-full flex items-center py-2 rounded-lg text-sm font-medium transition-all duration-150 text-left overflow-hidden ${
                      sidebarCompact ? 'justify-center px-0' : 'px-3 gap-2.5'
                    } ${isActive ? 'nav-active' : 'nav-inactive'}`}
                  >
                    {/* Active pip when collapsed */}
                    {isActive && sidebarCompact && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r-full bg-indigo-500" />
                    )}
                    <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} />
                    <span className={`whitespace-nowrap transition-all duration-300 ${sidebarCompact ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'}`}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800 my-3 mx-3" />

          {/* Section: Manage */}
          <div className="px-2">
            <p className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 pb-1.5 transition-all duration-200 ${sidebarCompact ? 'text-center text-[8px] opacity-50' : 'px-3'}`}>
              {sidebarCompact ? '···' : 'Manage'}
            </p>
            <div className="space-y-0.5">
              {[
                { value: 'manage-teachers', icon: Settings2, label: 'Teachers' },
                { value: 'settings', icon: Settings, label: 'Settings' },
              ].map(({ value, icon: Icon, label }) => {
                const isActive = activeTab === value;
                return (
                  <button
                    key={value}
                    onClick={() => setActiveTab(value)}
                    title={sidebarCompact ? label : undefined}
                    className={`group relative w-full flex items-center py-2 rounded-lg text-sm font-medium transition-all duration-150 text-left overflow-hidden ${
                      sidebarCompact ? 'justify-center px-0' : 'px-3 gap-2.5'
                    } ${isActive ? 'nav-active' : 'nav-inactive'}`}
                  >
                    {isActive && sidebarCompact && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r-full bg-indigo-500" />
                    )}
                    <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} />
                    <span className={`whitespace-nowrap transition-all duration-300 ${sidebarCompact ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'}`}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800 my-3 mx-3" />

          {/* Section: Admin */}
          <div className="px-2">
            <p className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 pb-1.5 transition-all duration-200 ${sidebarCompact ? 'text-center text-[8px] opacity-50' : 'px-3'}`}>
              {sidebarCompact ? '···' : 'Admin'}
            </p>
            <div className="space-y-0.5">
              {[
                { href: '/admin/assignments', icon: Users, label: 'Assignments' },
                { href: '/admin/teacher-subject/import', icon: BookOpen, label: 'Import' },
                { href: '/admin/substitute', icon: Shield, label: 'Substitutes' },
              ].map(({ href, icon: Icon, label }) => (
                <a
                  key={href}
                  href={href}
                  title={sidebarCompact ? label : undefined}
                  className={`group relative nav-inactive w-full flex items-center py-2 rounded-lg text-sm font-medium transition-all duration-150 overflow-hidden ${
                    sidebarCompact ? 'justify-center px-0' : 'px-3 gap-2.5'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                  <span className={`whitespace-nowrap transition-all duration-300 ${sidebarCompact ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'}`}>
                    {label}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </nav>

        {/* ── Footer CTA ── */}
        <div className="shrink-0 p-3 border-t border-slate-100 dark:border-slate-800 bg-gradient-to-b from-white dark:from-slate-900 to-slate-50/80 dark:to-slate-900 space-y-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            title={sidebarCompact ? 'Generate Timetable' : undefined}
            className={`relative overflow-hidden flex items-center justify-center gap-2 rounded-xl text-white font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed btn-glow transition-all duration-300 ${sidebarCompact ? 'w-10 h-10 mx-auto p-0' : 'w-full px-3 py-2.5'}`}
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            <RefreshCw className={`h-4 w-4 shrink-0 ${generating ? 'animate-spin' : ''}`} />
            <span className={`whitespace-nowrap transition-all duration-300 ${sidebarCompact ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'}`}>
              {generating ? 'Generating…' : 'Generate Timetable'}
            </span>
          </button>
          <button
            onClick={handlePreviewGenerate}
            disabled={previewing}
            title={sidebarCompact ? 'Preview Changes' : undefined}
            className={`flex items-center justify-center gap-2 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-800 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300 border border-slate-200/80 dark:border-slate-700 hover:border-indigo-200 text-slate-600 dark:text-slate-400 font-semibold text-sm transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed ${sidebarCompact ? 'w-10 h-10 mx-auto p-0' : 'w-full px-3 py-2'}`}
          >
            {previewing ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : <Search className="h-4 w-4 shrink-0" />}
            <span className={`whitespace-nowrap transition-all duration-300 ${sidebarCompact ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'}`}>
              {previewing ? 'Previewing…' : 'Preview Changes'}
            </span>
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className={`flex-1 flex flex-col min-h-screen transition-[margin] duration-300 ease-in-out ${sidebarCompact ? 'lg:ml-[68px]' : 'lg:ml-60'}`}>

        {/* Topbar */}
        <header className="sticky top-0 z-40 border-b border-slate-200/60 dark:border-slate-800/60 bg-white/96 dark:bg-slate-900/96 backdrop-blur-md shadow-[0_1px_12px_0_rgba(99,102,241,0.06)]">
          <div className="px-4 lg:px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {/* Hamburger — mobile only */}
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400 transition-colors mr-1"
                aria-label="Open sidebar"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="h-6 w-1 rounded-full" style={{ background: 'linear-gradient(180deg, #6366f1, #8b5cf6)' }} />
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                {NAV_LABELS[activeTab] ?? 'Timetable'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Dark mode toggle */}
              <button
                onClick={() => setDarkMode(d => !d)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Toggle dark mode"
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
              <Button
                variant="ghost" size="sm"
                onClick={() => setImportDialogOpen(true)}
                className="text-slate-600 hover:text-indigo-700 hover:bg-indigo-50/80 gap-1.5 rounded-lg"
              >
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="border-slate-200 gap-1.5 rounded-lg hover:border-indigo-200 hover:bg-indigo-50/50">
                    <FileText className="h-3.5 w-3.5 text-slate-500" />
                    Export all
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-xl shadow-xl shadow-slate-200/60 border-slate-200">
                  <DropdownMenuLabel className="text-xs text-slate-500">All classes (one sheet/page each)</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => handleExport('excel', 'class')} className="rounded-lg">
                    <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600" /> Excel workbook
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('pdf', 'class')} className="rounded-lg">
                    <FileText className="h-4 w-4 mr-2 text-red-500" /> PDF (multi-page)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-slate-500">All teachers</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => handleExport('excel', 'teacher')} className="rounded-lg">
                    <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600" /> Excel workbook
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('pdf', 'teacher')} className="rounded-lg">
                    <FileText className="h-4 w-4 mr-2 text-red-500" /> PDF (multi-page)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline" size="sm"
                onClick={() => handleExport('csv')}
                className="border-slate-200 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 gap-1.5 rounded-lg"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-blue-500" /> CSV
              </Button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <div className="bg-white rounded-2xl p-6 card-shadow mb-6">
              <div className="flex items-center gap-2 mb-4 border-b pb-4">
                <Settings className="h-5 w-5 text-indigo-500" />
                <h2 className="text-xl font-bold text-slate-800">Generation Settings</h2>
              </div>
              <div className="space-y-6 max-w-2xl">
                {/* 100% Fill Rate Settings */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-700">Filler Mechanism (100% Fill Rate)</h3>
                  <div className="flex flex-col gap-3 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="space-y-0.5 max-w-[85%]">
                        <span className="text-sm font-medium text-slate-800">Enable Filler Mechanism</span>
                        <p className="text-xs text-slate-500">Automatically try to fill empty slots using activity subjects or study periods to guarantee a 100% fill rate.</p>
                      </div>
                      <Switch
                        checked={fillEmptySlots}
                        onCheckedChange={setFillEmptySlots}
                      />
                    </label>
                    <div className="border-t border-slate-200"></div>
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="space-y-0.5 max-w-[85%]">
                        <span className="text-sm font-medium text-slate-800">Allow Duplicate Activities</span>
                        <p className="text-xs text-slate-500">Allow assigning activities (like Games, Library) even if the weekly target is met to fill empty gaps.</p>
                      </div>
                      <Switch
                        checked={allowDuplicateActivities}
                        onCheckedChange={setAllowDuplicateActivities}
                        disabled={!fillEmptySlots}
                      />
                    </label>
                  </div>
                  
                  <div className="space-y-2 mt-4">
                    <label className="text-sm font-medium text-slate-800">Study Period Teacher Pool</label>
                    <p className="text-xs text-slate-500 mb-2">Select teachers who can be assigned to "Study Period" as an absolute fallback filler.</p>
                    <div className="flex gap-2 mb-2">
                       <Select 
                          onValueChange={(val) => {
                             if(val && !studyPeriodTeacherPool.includes(val)) {
                               setStudyPeriodTeacherPool([...studyPeriodTeacherPool, val]);
                             }
                          }}
                        >
                        <SelectTrigger className="w-64 border-slate-200">
                          <SelectValue placeholder="Add teacher to pool..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {teachers.map(t => (
                            <SelectItem key={t.id} value={t.id}>{t.name} ({t.abbreviation})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" onClick={() => setStudyPeriodTeacherPool([])}>Clear All</Button>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {studyPeriodTeacherPool.length === 0 && <span className="text-xs text-slate-400 italic">No teachers assigned</span>}
                      {studyPeriodTeacherPool.map(id => {
                        const t = teachers.find(x => x.id === id);
                        return (
                          <div key={id} className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 shadow-sm rounded-lg text-xs font-medium text-slate-700">
                            {t?.name || id}
                            <button onClick={() => setStudyPeriodTeacherPool(studyPeriodTeacherPool.filter(x => x !== id))} className="text-slate-400 hover:text-red-500">✕</button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <Button onClick={handleSaveSettings} disabled={savingSettings} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md">
                    {savingSettings ? 'Saving...' : 'Save Settings'}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6 stagger-children">
              {/* Sections */}
              <div className="bg-white rounded-2xl p-5 card-shadow card-interactive animate-fade-in-up">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center stat-icon-blue shadow-md shadow-blue-100">
                    <CalendarDays className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-xs font-semibold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">Active</span>
                </div>
                <div className="text-3xl font-bold text-slate-900 mb-0.5">{sections.length}</div>
                <div className="text-sm font-medium text-slate-600">Total Sections</div>
                <div className="text-xs text-slate-400 mt-0.5">Grades VI – XII</div>
              </div>

              {/* Teachers */}
              <div className="bg-white rounded-2xl p-5 card-shadow card-interactive animate-fade-in-up">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center stat-icon-violet shadow-md shadow-violet-100">
                    <Users className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-xs font-semibold text-violet-500 bg-violet-50 px-2 py-0.5 rounded-full">{departments.length} Depts</span>
                </div>
                <div className="text-3xl font-bold text-slate-900 mb-0.5">{teachers.length}</div>
                <div className="text-sm font-medium text-slate-600">Total Teachers</div>
                <div className="text-xs text-slate-400 mt-0.5">All departments</div>
              </div>

              {/* Slots / Fill Rate */}
              <div className="bg-white rounded-2xl p-5 card-shadow card-interactive animate-fade-in-up">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center stat-icon-teal shadow-md shadow-teal-100">
                    <BookMarked className="h-5 w-5 text-white" />
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${fillRate >= 90 ? 'text-emerald-600 bg-emerald-50' : fillRate >= 60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50'}`}>
                    {fillRate}% fill
                  </span>
                </div>
                <div className="flex items-end gap-2 mb-0.5">
                   <div className="text-3xl font-bold text-slate-900">{slots.length}</div>
                   {fillerSlotsCount > 0 && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full mb-1">+{fillerSlotsCount} filler</span>}
                </div>
                <div className="text-sm font-medium text-slate-600">Timetable Slots</div>
                <div className="mt-2">
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${fillRate}%`,
                        background: fillRate >= 90 ? 'linear-gradient(90deg,#10b981,#059669)' : fillRate >= 60 ? 'linear-gradient(90deg,#f59e0b,#d97706)' : 'linear-gradient(90deg,#f43f5e,#e11d48)'
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Avg Workload */}
              <div className="bg-white rounded-2xl p-5 card-shadow card-interactive animate-fade-in-up">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center stat-icon-amber shadow-md shadow-amber-100">
                    <Activity className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex gap-1">
                    {(stats?.overloadedTeachers || 0) > 0 && (
                      <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                        <TrendingUp className="h-3 w-3" /> {stats?.overloadedTeachers}
                      </span>
                    )}
                    {(stats?.underloadedTeachers || 0) > 0 && (
                      <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                        <TrendingDown className="h-3 w-3" /> {stats?.underloadedTeachers}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-3xl font-bold text-slate-900 mb-0.5">{stats?.averageWorkload || 0}</div>
                <div className="text-sm font-medium text-slate-600">Avg Workload</div>
                <div className="text-xs text-slate-400 mt-0.5">periods / teacher / week</div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-2xl card-shadow mb-6 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-indigo-500" /> Quick Actions
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">Generate, preview, or modify the timetable</p>
                </div>
                {lastGenerationSummary && (
                  <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                    <span className="font-medium text-emerald-600">{lastGenerationSummary.generated}</span> generated ·{' '}
                    <span className="font-medium text-indigo-600">{lastGenerationSummary.preserved}</span> locked preserved
                  </div>
                )}
              </div>
              <div className="p-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 max-w-xl">
                  {/* Primary: Generate */}
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl text-white font-semibold text-sm transition-all duration-150 hover:opacity-90 hover:shadow-lg hover:shadow-indigo-200 disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    {generating
                      ? <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                      : <RefreshCw className="h-4 w-4 shrink-0" />}
                    <span>{generating ? 'Generating…' : 'Generate Timetable'}</span>
                  </button>

                  {/* Preview */}
                  <button
                    onClick={handlePreviewGenerate}
                    disabled={previewing}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 text-slate-700 font-semibold text-sm transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {previewing
                      ? <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                      : <Search className="h-4 w-4 shrink-0" />}
                    <span>{previewing ? 'Previewing…' : 'Preview Changes'}</span>
                  </button>

                  {/* Validate Workload */}
                  <button
                    onClick={handleValidateWorkload}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 hover:border-emerald-200 text-slate-700 font-semibold text-sm transition-all duration-150"
                  >
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    <span>Validate Workload</span>
                  </button>

                  {/* Unlock All */}
                  <button
                    onClick={handleUnlockAllSlots}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-slate-100 hover:bg-amber-50 hover:text-amber-700 border border-slate-200 hover:border-amber-200 text-slate-700 font-semibold text-sm transition-all duration-150"
                  >
                    <Unlock className="h-4 w-4 shrink-0" />
                    <span>Unlock All Slots</span>
                  </button>

                </div>

                {/* Preserve locked checkbox */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <label className="flex items-center gap-2.5 cursor-pointer group w-fit">
                    <div className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${preserveLockedOnGenerate ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'}`}
                      onClick={() => setPreserveLockedOnGenerate(v => !v)}>
                      {preserveLockedOnGenerate && <CheckCircle className="h-3 w-3 text-white" />}
                    </div>
                    <input
                      type="checkbox"
                      checked={preserveLockedOnGenerate}
                      onChange={(e) => setPreserveLockedOnGenerate(e.target.checked)}
                      className="sr-only"
                    />
                    <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors select-none">
                      Preserve manually locked slots during generation
                    </span>
                    <Shield className="h-3.5 w-3.5 text-indigo-400" />
                  </label>
                </div>
              </div>
            </div>

            {/* Departments Overview */}
            <div className="bg-white rounded-2xl card-shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Award className="h-4 w-4 text-indigo-500" /> Teachers by Department
                </h2>
                <span className="text-xs text-slate-500">{departments.length} departments</span>
              </div>
              <div className="p-6">
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {[
                    { name: 'English', color: 'bg-blue-500', light: 'bg-blue-50' },
                    { name: 'Physics', color: 'bg-violet-500', light: 'bg-violet-50' },
                    { name: 'Chemistry', color: 'bg-emerald-500', light: 'bg-emerald-50' },
                    { name: 'Biology', color: 'bg-green-500', light: 'bg-green-50' },
                    { name: 'Mathematics', color: 'bg-indigo-500', light: 'bg-indigo-50' },
                    { name: 'Hindi', color: 'bg-orange-500', light: 'bg-orange-50' },
                    { name: 'Nepali', color: 'bg-amber-500', light: 'bg-amber-50' },
                    { name: 'Commerce', color: 'bg-teal-500', light: 'bg-teal-50' },
                    { name: 'Economics', color: 'bg-cyan-500', light: 'bg-cyan-50' },
                    { name: 'Social Studies', color: 'bg-rose-500', light: 'bg-rose-50' },
                    { name: 'Computer Science', color: 'bg-fuchsia-500', light: 'bg-fuchsia-50' },
                    { name: 'Sports', color: 'bg-lime-500', light: 'bg-lime-50' },
                  ].map(({ name, color, light }) => {
                    const deptTeachers = teachers.filter(t => t.department === name);
                    if (deptTeachers.length === 0) return null;
                    return (
                      <div key={name} className={`${light} rounded-xl p-3.5 border border-white hover:shadow-md transition-shadow duration-200`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`h-2 w-2 rounded-full ${color}`} />
                          <h3 className="font-semibold text-sm text-slate-800 truncate">{name}</h3>
                        </div>
                        <p className="text-xs text-slate-500 mb-2">{deptTeachers.length} teacher{deptTeachers.length !== 1 ? 's' : ''}</p>
                        <div className="flex flex-wrap gap-1">
                          {deptTeachers.slice(0, 3).map(t => (
                            <span key={t.id} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-white/80 text-slate-700 border border-white shadow-sm">
                              {t.abbreviation}
                            </span>
                          ))}
                          {deptTeachers.length > 3 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-white/60 text-slate-500 border border-white">
                              +{deptTeachers.length - 3}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Class View Tab */}
          <TabsContent value="class">
            {/* Legend */}
            <div className="bg-white rounded-2xl card-shadow mb-4 px-5 py-3">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs font-semibold text-slate-500 mr-1">Legend:</span>
                {[
                  { label: 'Regular', cls: 'slot-regular' },
                  { label: 'Lab', cls: 'slot-lab' },
                  { label: 'Games', cls: 'slot-games' },
                  { label: 'Yoga', cls: 'slot-yoga' },
                  { label: 'Library', cls: 'slot-library' },
                  { label: 'Innovation', cls: 'slot-innovation' },
                  { label: 'W.E.', cls: 'slot-we' },
                ].map(({ label, cls }) => (
                  <span key={label} className={`${cls} text-[11px] font-semibold px-2.5 py-1 rounded-lg`}>{label}</span>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl card-shadow mb-4">
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Class Timetable</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Click any cell to edit · Lock icon to preserve during regeneration</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                      <SelectTrigger className="w-[200px] border-slate-200">
                        <SelectValue placeholder="Select class" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from(new Set(sections.map(s => s.grade?.name).filter(Boolean))).map(grade => (
                          <SelectGroup key={grade}>
                            <SelectLabel>Grade {grade}</SelectLabel>
                            {sections.filter(s => s.grade?.name === grade).map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedSection && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const name = sections.find(s => s.id === selectedSection)?.name ?? 'class';
                            const safe = name.replace(/[^A-Za-z0-9]/g, '_');
                            void downloadTimetableFile(
                              `/api/timetable/export/class/${selectedSection}?format=pdf`,
                              `timetable_${safe}.pdf`
                            );
                          }}
                          title="Download PDF"
                        >
                          <FileText className="h-4 w-4 mr-1" /> PDF
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const name = sections.find(s => s.id === selectedSection)?.name ?? 'class';
                            const safe = name.replace(/[^A-Za-z0-9]/g, '_');
                            void downloadTimetableFile(
                              `/api/timetable/export/class/${selectedSection}?format=xlsx`,
                              `timetable_${safe}.xlsx`
                            );
                          }}
                          title="Download Excel"
                        >
                          <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {selectedSection && (
              <div className="bg-white rounded-2xl card-shadow overflow-hidden">
                <ScrollArea className="w-full">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 border-b border-slate-100">
                        <TableHead className="w-28 sticky left-0 bg-slate-50 text-slate-600 font-semibold text-xs uppercase tracking-wider">Period</TableHead>
                        {days.map(day => (
                          <TableHead key={day.id} className="text-center min-w-[130px] text-slate-600 font-semibold text-xs uppercase tracking-wider">{day.name}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {timeSlots.map(slot => {
                        const sectionSlots = getSectionTimetable(selectedSection);
                        return (
                          <TableRow key={slot.id} className="border-b border-slate-50 hover:bg-slate-50/40 transition-colors">
                            <TableCell className="sticky left-0 bg-white border-r border-slate-100 z-10">
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="text-xs font-bold text-indigo-600 bg-indigo-50 rounded-md px-2 py-0.5">P{slot.periodNumber}</div>
                                <div className="text-[10px] text-slate-400 font-medium">{slot.startTime}</div>
                                <div className="text-[10px] text-slate-300">–</div>
                                <div className="text-[10px] text-slate-400 font-medium">{slot.endTime}</div>
                              </div>
                            </TableCell>
                            {days.map(day => {
                              const cellSlot = getSlot(sectionSlots, day.id, slot.id);
                              const typeLabel = cellSlot ? getSlotTypeLabel(cellSlot) : null;
                              const displayedSubject = cellSlot ? getDisplayedSubject(cellSlot) : null;
                              return (
                                <TableCell key={day.id} className="p-1.5">
                                  {cellSlot ? (
                                    <div
                                      className={`timetable-cell ${getSlotCellClass(cellSlot)} ${cellSlot.manuallyEdited ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                                      onClick={() => {
                                        setEditingSlot({
                                          sectionId: selectedSection,
                                          dayId: day.id,
                                          timeSlotId: slot.id,
                                          subjectId: cellSlot.subjectId,
                                          teacherId: cellSlot.teacherId,
                                          labTeacherId: cellSlot.labTeacherId ?? null,
                                          isLab: cellSlot.isLab,
                                          isGames: cellSlot.isGames,
                                          isYoga: cellSlot.isYoga,
                                          isLibrary: cellSlot.isLibrary,
                                          isInnovation: cellSlot.isInnovation,
                                          isWE: cellSlot.isWE,
                                          notes: cellSlot.notes ?? null,
                                        });
                                        setEditDialogOpen(true);
                                      }}
                                      title={[
                                        displayedSubject?.name,
                                        getSlotTeacherNames(cellSlot),
                                        cellSlot.room?.name,
                                      ].filter(Boolean).join(' — ')}
                                    >
                                      {/* Lock button */}
                                      <button
                                        type="button"
                                        className="absolute right-1 top-1 rounded p-0.5 hover:bg-black/5 transition-colors"
                                        onClick={(e) => { e.stopPropagation(); handleToggleSlotLock(cellSlot); }}
                                        title={cellSlot.manuallyEdited ? 'Unlock slot' : 'Lock slot'}
                                      >
                                        {cellSlot.manuallyEdited
                                          ? <Lock className="h-3 w-3 text-amber-500" />
                                          : <Unlock className="h-3 w-3 text-slate-300 hover:text-slate-500" />}
                                      </button>
                                      {/* Subject code */}
                                      <div className="font-bold text-sm text-slate-800 leading-tight">
                                        {displayedSubject?.code || '—'}
                                      </div>
                                      {/* Teacher abbr */}
                                      {getSlotTeacherAbbreviation(cellSlot) && (
                                        <div className="text-[11px] text-slate-500 font-medium mt-0.5">{getSlotTeacherAbbreviation(cellSlot)}</div>
                                      )}
                                      {/* Room */}
                                      {cellSlot.room?.name && (
                                        <div className="text-[10px] text-slate-400">{cellSlot.room.name}</div>
                                      )}
                                      {/* Type chip */}
                                      {typeLabel && (
                                        <div className={`text-[9px] font-bold uppercase tracking-wider mt-1 ${typeLabel.color}`}>
                                          {typeLabel.label}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div
                                      className="timetable-cell-empty flex flex-col items-center justify-center"
                                      style={{ minHeight: 56 }}
                                      onClick={() => {
                                        setEditingSlot({ sectionId: selectedSection, dayId: day.id, timeSlotId: slot.id });
                                        setEditDialogOpen(true);
                                      }}
                                    >
                                      <Plus className="h-4 w-4 text-slate-300" />
                                    </div>
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}
          </TabsContent>

          {/* Teacher View Tab */}
          <TabsContent value="teacher">
            <div className="bg-white rounded-2xl card-shadow mb-4">
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Teacher Timetable</h2>
                    <p className="text-xs text-slate-500 mt-0.5">View individual teacher schedules and manage unavailability</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={selectedTeacher} onValueChange={setSelectedTeacher}>
                      <SelectTrigger className="w-[250px] border-slate-200">
                        <SelectValue placeholder="Select teacher" />
                      </SelectTrigger>
                      <SelectContent>
                        {teachers.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name} ({t.abbreviation})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedTeacher && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const t = teachers.find(x => x.id === selectedTeacher);
                            const safe = (t?.abbreviation ?? 'teacher').replace(/[^A-Za-z0-9]/g, '_');
                            void downloadTimetableFile(
                              `/api/timetable/export/teacher/${selectedTeacher}?format=pdf`,
                              `timetable_${safe}.pdf`
                            );
                          }}
                          title="Download PDF"
                        >
                          <FileText className="h-4 w-4 mr-1" /> PDF
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const t = teachers.find(x => x.id === selectedTeacher);
                            const safe = (t?.abbreviation ?? 'teacher').replace(/[^A-Za-z0-9]/g, '_');
                            void downloadTimetableFile(
                              `/api/timetable/export/teacher/${selectedTeacher}?format=xlsx`,
                              `timetable_${safe}.xlsx`
                            );
                          }}
                          title="Download Excel"
                        >
                          <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {selectedTeacher && (
              <>
                {(() => {
                  const teacher = teachers.find(t => t.id === selectedTeacher);
                  const teacherSlots = getTeacherTimetable(selectedTeacher);
                  const workloadCount = getTeacherWorkloadCount(selectedTeacher);
                  const workloadPct = Math.round((workloadCount / (teacher?.targetWorkload || 30)) * 100);
                  const wStatus = getWorkloadStatus(workloadCount, teacher?.targetWorkload || 30);
                  return (
                    <div className="bg-white rounded-2xl card-shadow mb-4 p-5">
                      <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-xl flex items-center justify-center stat-icon-violet shadow-md shadow-violet-100 text-white font-bold text-lg">
                            {teacher?.name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-lg text-slate-900">{teacher?.name}</h3>
                              {teacher?.isHOD && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">HOD</span>
                              )}
                            </div>
                            <p className="text-sm text-slate-500">{teacher?.department}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-500">Workload</span>
                            <span className="text-lg font-bold text-slate-900">{workloadCount}</span>
                            <span className="text-sm text-slate-400">/ {teacher?.targetWorkload}</span>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${wStatus === 'OK' ? 'bg-emerald-50 text-emerald-600' : wStatus === 'Over' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                              {wStatus}
                            </span>
                          </div>
                          <div className="w-48 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(workloadPct, 100)}%`,
                                background: wStatus === 'OK' ? 'linear-gradient(90deg,#10b981,#059669)' : wStatus === 'Over' ? 'linear-gradient(90deg,#f43f5e,#e11d48)' : 'linear-gradient(90deg,#f59e0b,#d97706)'
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="bg-white rounded-2xl card-shadow overflow-hidden mb-4">
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50 border-b border-slate-100">
                          <TableHead className="w-28 sticky left-0 bg-slate-50 text-slate-600 font-semibold text-xs uppercase tracking-wider">Period</TableHead>
                          {days.map(day => (
                            <TableHead key={day.id} className="text-center min-w-[130px] text-slate-600 font-semibold text-xs uppercase tracking-wider">{day.name}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {timeSlots.map(slot => {
                          const teacherSlots = getTeacherTimetable(selectedTeacher);
                          return (
                            <TableRow key={slot.id} className="border-b border-slate-50 hover:bg-slate-50/40 transition-colors">
                              <TableCell className="sticky left-0 bg-white border-r border-slate-100 z-10">
                                <div className="flex flex-col items-center gap-0.5">
                                  <div className="text-xs font-bold text-indigo-600 bg-indigo-50 rounded-md px-2 py-0.5">P{slot.periodNumber}</div>
                                  <div className="text-[10px] text-slate-400 font-medium">{slot.startTime}</div>
                                  <div className="text-[10px] text-slate-300">–</div>
                                  <div className="text-[10px] text-slate-400 font-medium">{slot.endTime}</div>
                                </div>
                              </TableCell>
                              {days.map(day => {
                                const cellSlots = getTeacherCellSlots(teacherSlots, day.id, slot.id);
                                const cellSlot = cellSlots[0];
                                const displayedSubject = cellSlot ? getDisplayedSubject(cellSlot) : null;
                                const sectionLabel = Array.from(new Set(cellSlots.map((item) => item.section?.name).filter(Boolean))).join(' / ');
                                return (
                                  <TableCell key={day.id} className="p-1.5">
                                    {cellSlot ? (
                                      <div className={`timetable-cell ${getSlotCellClass(cellSlot)} ${cellSlot.manuallyEdited ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}>
                                        <button
                                          type="button"
                                          className="absolute right-1 top-1 rounded p-0.5 hover:bg-black/5 transition-colors"
                                          onClick={(e) => { e.stopPropagation(); handleToggleSlotLock(cellSlot); }}
                                          title={cellSlot.manuallyEdited ? 'Unlock slot' : 'Lock slot'}
                                        >
                                          {cellSlot.manuallyEdited
                                            ? <Lock className="h-3 w-3 text-amber-500" />
                                            : <Unlock className="h-3 w-3 text-slate-300 hover:text-slate-500" />}
                                        </button>
                                        <div className="font-bold text-sm text-indigo-700">{sectionLabel || cellSlot.section?.name}</div>
                                        <div className="text-[11px] text-slate-500 font-medium">{displayedSubject?.code}</div>
                                        {cellSlot.room?.name && (
                                          <div className="text-[10px] text-slate-400">{cellSlot.room.name}</div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-center text-slate-200 text-lg" style={{ minHeight: 56 }}>·</div>
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>

                <div className="bg-white rounded-2xl card-shadow overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h2 className="text-base font-semibold text-slate-900">Teacher Unavailability</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Mark blocked periods for part-time schedules, meetings, and fixed commitments</p>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <Select value={unavailabilityDayId} onValueChange={setUnavailabilityDayId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select day" />
                        </SelectTrigger>
                        <SelectContent>
                          {days.map(day => (
                            <SelectItem key={day.id} value={day.id}>{day.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={unavailabilityTimeSlotId} onValueChange={setUnavailabilityTimeSlotId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select period" />
                        </SelectTrigger>
                        <SelectContent>
                          {timeSlots.map(ts => (
                            <SelectItem key={ts.id} value={ts.id}>
                              P{ts.periodNumber} ({ts.startTime}-{ts.endTime})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Reason (optional)"
                        value={unavailabilityReason}
                        onChange={(e) => setUnavailabilityReason(e.target.value)}
                      />
                      <Button onClick={handleAddUnavailability}>
                        <Plus className="h-4 w-4 mr-2" /> Add Block
                      </Button>
                    </div>

                    <div className="border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Period</TableHead>
                            {days.map(day => (
                              <TableHead key={day.id} className="text-center">{day.name}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {timeSlots.map(ts => (
                            <TableRow key={ts.id}>
                              <TableCell className="font-medium">P{ts.periodNumber}</TableCell>
                              {days.map(day => {
                                const blocked = teacherUnavailability.find(
                                  u => u.dayId === day.id && u.timeSlotId === ts.id
                                );
                                return (
                                  <TableCell key={`${day.id}-${ts.id}`} className="text-center p-1">
                                    <Button
                                      type="button"
                                      variant={blocked ? 'destructive' : 'outline'}
                                      size="sm"
                                      className="w-full"
                                      onClick={() => handleToggleUnavailability(day.id, ts.id)}
                                      title={blocked?.reason || ''}
                                    >
                                      {blocked ? 'Blocked' : 'Available'}
                                    </Button>
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-2">Current Blocks</div>
                      {unavailabilityLoading ? (
                        <div className="text-xs text-muted-foreground">Loading...</div>
                      ) : teacherUnavailability.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No blocked periods set.</div>
                      ) : (
                        <div className="space-y-2">
                          {teacherUnavailability.map((u) => (
                            <div key={u.id} className="flex items-center justify-between border rounded p-2">
                              <div className="text-xs">
                                <span className="font-medium">{u.day?.name}</span> - P{u.timeSlot?.periodNumber}
                                {u.reason ? ` - ${u.reason}` : ''}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteUnavailability(u.id)}
                                className="text-red-500 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* Manage Teachers Tab */}
          <TabsContent value="manage-teachers">
            {/* Header row */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Teacher Management</h2>
                <p className="text-sm text-slate-500">Add, edit, and manage teacher records</p>
              </div>
              <Button
                onClick={openAddTeacherDialog}
                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 gap-1.5"
              >
                <Plus className="h-4 w-4" /> Add Teacher
              </Button>
            </div>

            {/* Search and Filter */}
            <div className="bg-white rounded-2xl card-shadow mb-4 p-4">
              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 relative min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search by name or abbreviation…"
                    value={teacherSearchQuery}
                    onChange={(e) => setTeacherSearchQuery(e.target.value)}
                    className="pl-9 border-slate-200 focus:border-indigo-300"
                  />
                </div>
                <Select value={teacherDeptFilter} onValueChange={setTeacherDeptFilter}>
                  <SelectTrigger className="w-[220px] border-slate-200">
                    <SelectValue placeholder="Filter by department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map(dept => (
                      <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Teachers Table */}
            <div className="bg-white rounded-2xl card-shadow overflow-hidden">
              <ScrollArea className="h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 border-b border-slate-100">
                      <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Name</TableHead>
                      <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Abbr.</TableHead>
                      <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Department</TableHead>
                      <TableHead className="text-center text-slate-600 font-semibold text-xs uppercase tracking-wider">HOD</TableHead>
                      <TableHead className="text-center text-slate-600 font-semibold text-xs uppercase tracking-wider">Target</TableHead>
                      <TableHead className="text-center text-slate-600 font-semibold text-xs uppercase tracking-wider">Current</TableHead>
                      <TableHead className="text-center text-slate-600 font-semibold text-xs uppercase tracking-wider">Grades</TableHead>
                      <TableHead className="text-center text-slate-600 font-semibold text-xs uppercase tracking-wider">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTeachers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-slate-400">
                          <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p className="font-medium">No teachers found</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTeachers.map(teacher => {
                        const currentWorkload = workloadData.find(w => w.id === teacher.id)?.currentWorkload ?? teacher.currentWorkload ?? 0;
                        const wStat = getWorkloadStatus(currentWorkload, teacher.targetWorkload);
                        return (
                          <TableRow key={teacher.id} className="border-b border-slate-50 hover:bg-indigo-50/30 transition-colors">
                            <TableCell>
                              <div className="font-semibold text-slate-900">{teacher.name}</div>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs font-bold px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                                {teacher.abbreviation}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">{teacher.department}</TableCell>
                            <TableCell className="text-center">
                              {teacher.isHOD && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">HOD</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center font-medium text-slate-700">{teacher.targetWorkload}</TableCell>
                            <TableCell className="text-center">
                              <span className={`font-bold ${wStat === 'OK' ? 'text-emerald-600' : wStat === 'Over' ? 'text-red-600' : 'text-amber-600'}`}>
                                {currentWorkload}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex flex-wrap justify-center gap-1">
                                {(teacher.teachableGrades ?? []).length > 0
                                  ? (teacher.teachableGrades ?? []).map(g => (
                                      <span key={g} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">{g}</span>
                                    ))
                                  : <span className="text-slate-300 text-xs">—</span>
                                }
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex justify-center gap-1">
                                <Button
                                  variant="ghost" size="sm"
                                  onClick={() => openEditTeacherDialog(teacher)}
                                  className="h-8 w-8 p-0 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost" size="sm"
                                  onClick={() => handleDeleteTeacher(teacher.id)}
                                  disabled={deletingTeacher === teacher.id}
                                  className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
                                >
                                  {deletingTeacher === teacher.id
                                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>

            {/* Summary row */}
            <div className="grid gap-3 sm:grid-cols-4 mt-4">
              {[
                { label: 'Total Teachers', value: teachers.length, color: 'stat-icon-blue', textColor: 'text-slate-900' },
                { label: 'Departments', value: departments.length, color: 'stat-icon-violet', textColor: 'text-slate-900' },
                { label: 'Underloaded', value: workloadData.filter(w => w.status === 'Under').length, color: 'stat-icon-amber', textColor: 'text-amber-600' },
                { label: 'Overloaded', value: workloadData.filter(w => w.status === 'Over').length, color: 'stat-icon-rose', textColor: 'text-red-600' },
              ].map(({ label, value, textColor }) => (
                <div key={label} className="bg-white rounded-xl card-shadow p-4 flex items-center gap-3">
                  <div>
                    <div className={`text-2xl font-bold ${textColor}`}>{value}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{label}</div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Workload Tab */}
          <TabsContent value="workload">
            <div className="bg-white rounded-2xl card-shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-indigo-500" /> Teacher Workload Validation
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">Monitor and balance teacher period assignments</p>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> OK: {workloadData.filter(w => w.status === 'OK').length}
                  </span>
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-100">
                    <TrendingDown className="h-3 w-3" /> Under: {workloadData.filter(w => w.status === 'Under').length}
                  </span>
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 font-semibold border border-red-100">
                    <TrendingUp className="h-3 w-3" /> Over: {workloadData.filter(w => w.status === 'Over').length}
                  </span>
                </div>
              </div>
              <ScrollArea className="h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 border-b border-slate-100">
                      <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Teacher</TableHead>
                      <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Department</TableHead>
                      <TableHead className="text-center text-slate-600 font-semibold text-xs uppercase tracking-wider">Target</TableHead>
                      <TableHead className="text-center text-slate-600 font-semibold text-xs uppercase tracking-wider">Current</TableHead>
                      <TableHead className="text-center text-slate-600 font-semibold text-xs uppercase tracking-wider">Δ</TableHead>
                      <TableHead className="text-center text-slate-600 font-semibold text-xs uppercase tracking-wider">Status</TableHead>
                      <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider min-w-[140px]">Progress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workloadData.map(teacher => {
                      const pct = Math.min((teacher.currentWorkload / Math.max(teacher.targetWorkload, 1)) * 100, 100);
                      return (
                        <TableRow key={teacher.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                          <TableCell>
                            <div className="font-semibold text-slate-900">{teacher.name}</div>
                            <div className="text-[11px] text-slate-400 font-medium">{teacher.abbreviation}</div>
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">{teacher.department}</TableCell>
                          <TableCell className="text-center font-medium text-slate-700">{teacher.targetWorkload}</TableCell>
                          <TableCell className="text-center">
                            <span className={`font-bold text-base ${teacher.status === 'OK' ? 'text-emerald-600' : teacher.status === 'Over' ? 'text-red-600' : 'text-amber-600'}`}>
                              {teacher.currentWorkload}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`text-sm font-bold ${teacher.difference > 0 ? 'text-red-500' : teacher.difference < 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                              {teacher.difference > 0 ? '+' : ''}{teacher.difference}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                              teacher.status === 'OK' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                              teacher.status === 'Over' ? 'bg-red-50 text-red-700 border border-red-200' :
                              'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}>
                              {teacher.status}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${pct}%`,
                                    background: teacher.status === 'OK' ? 'linear-gradient(90deg,#10b981,#059669)' :
                                      teacher.status === 'Over' ? 'linear-gradient(90deg,#f43f5e,#e11d48)' :
                                      'linear-gradient(90deg,#f59e0b,#d97706)'
                                  }}
                                />
                              </div>
                              <span className="text-[10px] text-slate-400 w-8 text-right">{Math.round(pct)}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </TabsContent>

          {/* Analysis Tab */}
          <TabsContent value="ai">
            <div className="grid gap-5 md:grid-cols-3">
              {/* Controls Panel */}
              <div className="bg-white rounded-2xl card-shadow overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-indigo-500" /> Schedule Analysis
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">Conflict detection and workload analysis</p>
                </div>
                <div className="p-5 space-y-2.5">
                  <button
                    onClick={() => handleAIAnalysis('analyze')}
                    disabled={aiLoading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-white font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed shadow-md shadow-indigo-200"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    {aiLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                    {aiLoading ? 'Analyzing…' : 'Analyze Timetable'}
                  </button>
                  <button
                    onClick={() => handleAIAnalysis('optimize')}
                    disabled={aiLoading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 text-slate-700 font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <CheckCircle className="h-4 w-4" /> Workload Report
                  </button>

                  <div className="h-px bg-slate-100 my-1" />

                  <button
                    onClick={fetchLabAudit}
                    disabled={labAuditLoading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-100 hover:bg-amber-50 hover:text-amber-700 border border-slate-200 hover:border-amber-200 text-slate-700 font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {labAuditLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                    Audit Lab Splits
                  </button>
                  <button
                    onClick={handleRepairLabSplits}
                    disabled={labRepairLoading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 hover:border-emerald-200 text-slate-700 font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {labRepairLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                    Fix Lab Splits
                  </button>

                  {stats && (
                    <>
                      <div className="h-px bg-slate-100 my-1" />
                      <div className="space-y-2 pt-1">
                        {[
                          { label: 'Fill Rate', value: `${fillRate}%`, color: fillRate >= 90 ? 'text-emerald-600' : fillRate >= 60 ? 'text-amber-600' : 'text-red-600' },
                          { label: 'Avg Workload', value: String(stats.averageWorkload), color: 'text-slate-900' },
                          { label: 'Overloaded', value: String(stats.overloadedTeachers), color: 'text-red-600' },
                          { label: 'Underloaded', value: String(stats.underloadedTeachers), color: 'text-amber-600' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0">
                            <span className="text-sm text-slate-500">{label}</span>
                            <span className={`text-sm font-bold ${color}`}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Report Panel */}
              <div className="md:col-span-2 bg-white rounded-2xl card-shadow overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="text-base font-semibold text-slate-900">Analysis Report</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Conflict detection, workload balance, lab audit, and recommendations</p>
                </div>
                <div className="p-5">
                  <ScrollArea className="h-[500px] pr-2">
                    {(generationWarnings.length > 0 || labSplitSessions.length > 0 || labRepairChanges.length > 0 || aiAnalysis) ? (
                      <div className="text-sm space-y-3">
                        {generationWarnings.length > 0 && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <div className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4" /> Generation Warnings ({generationWarnings.length})
                            </div>
                            <div className="space-y-1">
                              {generationWarnings.map((w, idx) => (
                                <div key={`${w}-${idx}`} className="text-xs text-amber-700 flex gap-1.5">
                                  <span className="text-amber-400 mt-0.5">›</span>{w}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                          <div className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                            <Brain className="h-4 w-4" /> Lab Audit
                          </div>
                          {labSplitSessions.length === 0 ? (
                            <div className="flex items-center gap-2 text-xs text-emerald-600">
                              <CheckCircle className="h-3.5 w-3.5" /> No split lab sessions detected
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {labSplitSessions.map((s) => (
                                <div
                                  key={`${s.sectionId}-${s.subjectId}-${s.dayId}`}
                                  className="text-xs border border-blue-200 rounded-lg px-3 py-2 bg-white"
                                >
                                  <span className="font-semibold text-blue-900">{s.sectionName}</span>
                                  <span className="text-blue-600"> · {s.subjectName} · {s.dayName}</span>
                                  <span className="text-slate-400"> | periods [{s.periodNumbers.join(', ')}]</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {labRepairChanges.length > 0 && (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                            <div className="font-semibold text-emerald-800 mb-2 flex items-center gap-2">
                              <Wrench className="h-4 w-4" /> Lab Repairs Applied ({labRepairChanges.length})
                            </div>
                            {labRepairChanges.map((c) => (
                              <div key={c.slotId} className="text-xs text-emerald-700 flex gap-1.5">
                                <span className="text-emerald-400 mt-0.5">✓</span>
                                {c.sectionName} · {c.subjectName} · {c.dayName}: P{c.fromPeriod} → P{c.toPeriod}
                              </div>
                            ))}
                          </div>
                        )}

                        {aiAnalysis && (
                          <div className="space-y-1">
                            {aiAnalysis.split('\n').map((line, i) => {
                              if (line.startsWith('# ')) return <h2 key={i} className="text-lg font-bold mt-4 mb-1 text-slate-900">{line.slice(2)}</h2>;
                              if (line.startsWith('## ')) return <h3 key={i} className="text-base font-semibold mt-3 mb-1 text-indigo-700">{line.slice(3)}</h3>;
                              if (line.startsWith('### ')) return <h4 key={i} className="text-sm font-semibold mt-2 mb-1 text-slate-700">{line.slice(4)}</h4>;
                              if (line.startsWith('---')) return <div key={i} className="h-px bg-slate-200 my-2" />;
                              if (line.startsWith('| ')) return <div key={i} className="font-mono text-xs bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">{line}</div>;
                              if (line.startsWith('- ') || line.startsWith('* ')) {
                                const text = line.slice(2).replace(/\*\*(.*?)\*\*/g, '$1');
                                return <div key={i} className="flex gap-1.5 ml-2 text-slate-700"><span className="text-indigo-400 mt-0.5">›</span><span>{text}</span></div>;
                              }
                              if (line.match(/^\d+\. /)) {
                                return <div key={i} className="ml-2 text-slate-700">{line.replace(/\*\*(.*?)\*\*/g, '$1')}</div>;
                              }
                              return <p key={i} className={line === '' ? 'h-2' : 'text-slate-700'}>{line.replace(/\*\*(.*?)\*\*/g, '$1')}</p>;
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="h-16 w-16 rounded-2xl flex items-center justify-center mb-4 bg-indigo-50">
                          <Brain className="h-8 w-8 text-indigo-300" />
                        </div>
                        <p className="font-semibold text-slate-700">No analysis yet</p>
                        <p className="text-sm text-slate-400 mt-1 max-w-xs">
                          Click &ldquo;Analyze Timetable&rdquo; to detect conflicts, check workload balance, and get recommendations
                        </p>
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </div>
            </div>
          </TabsContent>
          </Tabs>
        </main>
      </div>

      {/* Edit Slot Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Timetable Slot</DialogTitle>
            <DialogDescription>
              Choose an eligible teacher for the selected section and subject. Teacher changes sync across this section-subject.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Subject</Label>
              <Select 
                value={editingSlot.subjectId || ''} 
                onValueChange={(v) => setEditingSlot(prev => ({ ...prev, subjectId: v || undefined }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Teacher</Label>
              <Select 
                value={editingSlot.teacherId || ''} 
                onValueChange={(v) => setEditingSlot(prev => ({ ...prev, teacherId: v || undefined }))}
                disabled={!editingSlot.subjectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={editingSlot.subjectId ? 'Select eligible teacher' : 'Select subject first'} />
                </SelectTrigger>
                <SelectContent>
                  {eligibleTeachersForEditingSlot.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.abbreviation})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingSlot.subjectId && eligibleTeachersForEditingSlot.length === 0 && (
                <p className="text-xs text-amber-600">No eligible teachers found for this section and subject.</p>
              )}
              {sectionSubjectSlotCount > 1 && (
                <p className="text-xs text-slate-500">
                  Saving will update the teacher in all {sectionSubjectSlotCount} timetable slots for this section-subject.
                </p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  checked={editingSlot.isLab || false}
                  onChange={(e) => setEditingSlot(prev => ({ ...prev, isLab: e.target.checked }))}
                />
                Lab Period
              </label>
              <label className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  checked={editingSlot.isGames || false}
                  onChange={(e) => setEditingSlot(prev => ({ ...prev, isGames: e.target.checked }))}
                />
                Games
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateSlot}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Data</DialogTitle>
            <DialogDescription>Import teachers, subjects, or timetable from Excel/CSV</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Import Type</Label>
              <Select value={importType} onValueChange={setImportType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="timetable">Timetable Slots</SelectItem>
                  <SelectItem value="teachers">Teachers</SelectItem>
                  <SelectItem value="subjects">Subjects</SelectItem>
                  <SelectItem value="assignments">Teacher-Subject Assignments</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>File (CSV or JSON)</Label>
              <Input type="file" accept=".csv,.json" onChange={handleImport} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Teacher Add/Edit Dialog */}
      <Dialog open={teacherDialogOpen} onOpenChange={setTeacherDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTeacher.id ? 'Edit Teacher' : 'Add New Teacher'}</DialogTitle>
            <DialogDescription>
              {editingTeacher.id ? 'Update teacher information' : 'Enter details for the new teacher'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                placeholder="Enter teacher's full name"
                value={editingTeacher.name || ''}
                onChange={(e) => setEditingTeacher(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="abbreviation">Abbreviation *</Label>
              <Input
                id="abbreviation"
                placeholder="e.g., RKS, MPS, SJ"
                value={editingTeacher.abbreviation || ''}
                onChange={(e) => setEditingTeacher(prev => ({ ...prev, abbreviation: e.target.value.toUpperCase() }))}
                maxLength={5}
              />
              <p className="text-xs text-muted-foreground">Short code used in timetable display (max 5 characters)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Department *</Label>
              <Select
                value={editingTeacher.department || ''}
                onValueChange={(v) => setEditingTeacher(prev => ({ ...prev, department: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {teacherDepartmentOptions.map(dept => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetWorkload">Target Workload (periods/week)</Label>
              <Input
                id="targetWorkload"
                type="number"
                placeholder="30"
                value={editingTeacher.targetWorkload || ''}
                onChange={(e) => setEditingTeacher(prev => ({ ...prev, targetWorkload: parseInt(e.target.value) || 30 }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="isHOD" className="cursor-pointer">Head of Department (HOD)</Label>
              <Switch
                id="isHOD"
                checked={editingTeacher.isHOD || false}
                onCheckedChange={(checked) => setEditingTeacher(prev => ({ ...prev, isHOD: checked }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Classes Taught (Grades)</Label>
              <div className="flex flex-wrap gap-3">
                {['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'].map(grade => (
                  <label key={grade} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={(editingTeacher.teachableGrades ?? []).includes(grade)}
                      onChange={(e) => {
                        const current = editingTeacher.teachableGrades ?? [];
                        setEditingTeacher(prev => ({
                          ...prev,
                          teachableGrades: e.target.checked
                            ? [...current, grade]
                            : current.filter(g => g !== grade),
                        }));
                      }}
                    />
                    <span className="text-sm">{grade}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTeacherDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveTeacher}>
              {editingTeacher.id ? 'Update Teacher' : 'Add Teacher'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Simulator / Preview Dialog ── */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-6xl w-full p-0 gap-0 overflow-hidden rounded-2xl border-0 shadow-2xl" style={{ maxHeight: '92vh' }}>
          {/* ── Header ── */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between"
            style={{ background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)' }}>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <Search className="h-4 w-4 text-indigo-200" />
                <h2 className="text-base font-bold text-white">Simulator — Preview Changes</h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/20 text-white">
                  {previewDiffRows.length} slot{previewDiffRows.length !== 1 ? 's' : ''} differ
                </span>
              </div>
              <p className="text-xs text-indigo-200">
                Select which changes to apply. Unselected rows are ignored.
              </p>
            </div>
            <button
              onClick={() => setPreviewDialogOpen(false)}
              className="text-white/60 hover:text-white transition-colors text-xl leading-none mt-0.5"
            >✕</button>
          </div>

          {/* ── Stats bar ── */}
          {previewStats && (
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-3">
              {/* Diff counts */}
              {(
                [
                  { type: 'add', label: 'Added', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', count: previewDiffRows.filter(r => r.type === 'add').length },
                  { type: 'remove', label: 'Removed', color: 'text-red-700 bg-red-50 border-red-200', count: previewDiffRows.filter(r => r.type === 'remove').length },
                  { type: 'update', label: 'Changed', color: 'text-blue-700 bg-blue-50 border-blue-200', count: previewDiffRows.filter(r => r.type === 'update').length },
                ] as const
              ).map(({ type, label, color, count }) => (
                <button
                  key={type}
                  onClick={() => setPreviewFilterType(prev => prev === type ? 'all' : type)}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${color} ${previewFilterType === type ? 'ring-2 ring-offset-1 ring-indigo-400' : 'opacity-80 hover:opacity-100'}`}
                >
                  <span>{count}</span> {label}
                </button>
              ))}

              <div className="h-4 w-px bg-slate-200 mx-1" />

              {/* Fill rate */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Activity className="h-3.5 w-3.5 text-indigo-400" />
                <span className="font-semibold text-slate-900">{previewStats.stats?.fillRate ?? '—'}%</span>
                <span>fill rate</span>
              </div>
              {/* Conflicts */}
              <div className={`flex items-center gap-1.5 text-xs ${(previewStats.stats?.conflictsDetected ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {(previewStats.stats?.conflictsDetected ?? 0) > 0
                  ? <AlertTriangle className="h-3.5 w-3.5" />
                  : <CheckCircle className="h-3.5 w-3.5" />}
                <span className="font-semibold">{previewStats.stats?.conflictsDetected ?? 0}</span>
                <span>conflict{(previewStats.stats?.conflictsDetected ?? 0) !== 1 ? 's' : ''}</span>
              </div>
              {/* Unassigned */}
              {previewStats.unassigned.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="font-semibold">{previewStats.unassigned.length}</span>
                  <span>unassigned</span>
                </div>
              )}
              {/* Warnings */}
              {previewStats.warnings.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="font-semibold">{previewStats.warnings.length}</span>
                  <span>warning{previewStats.warnings.length !== 1 ? 's' : ''}</span>
                </div>
              )}

              {/* Workload pills */}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-slate-500">Workload:</span>
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                  {previewStats.stats?.teacherUtilization?.fullyUtilized ?? 0} OK
                </span>
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                  {previewStats.stats?.teacherUtilization?.underUtilized ?? 0} Under
                </span>
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700">
                  {previewStats.stats?.teacherUtilization?.overUtilized ?? 0} Over
                </span>
              </div>
            </div>
          )}

          {/* ── Warnings banner ── */}
          {previewStats && previewStats.warnings.length > 0 && (
            <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-100 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-800">
                <span className="font-semibold">Generation warnings: </span>
                {previewStats.warnings.slice(0, 3).join(' · ')}
                {previewStats.warnings.length > 3 && ` · +${previewStats.warnings.length - 3} more`}
              </div>
            </div>
          )}

          {/* ── Filters ── */}
          <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3 bg-white">
            {/* Type filter pills */}
            <div className="flex items-center gap-1">
              {(['all', 'add', 'remove', 'update'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setPreviewFilterType(t)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all capitalize ${
                    previewFilterType === t
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'
                  }`}
                >
                  {t === 'all' ? `All (${previewDiffRows.length})` : t === 'add' ? `Added (${previewDiffRows.filter(r => r.type === 'add').length})` : t === 'remove' ? `Removed (${previewDiffRows.filter(r => r.type === 'remove').length})` : `Changed (${previewDiffRows.filter(r => r.type === 'update').length})`}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-slate-200" />

            {/* Section filter */}
            <select
              value={previewFilterSection}
              onChange={e => setPreviewFilterSection(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:border-indigo-300"
            >
              <option value="all">All sections</option>
              {sections
                .filter(s => previewDiffRows.some(r => r.sectionId === s.id))
                .map(s => <option key={s.id} value={s.id}>{s.name}</option>)
              }
            </select>

            {/* Day filter */}
            <select
              value={previewFilterDay}
              onChange={e => setPreviewFilterDay(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:border-indigo-300"
            >
              <option value="all">All days</option>
              {days.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            {/* Search */}
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search subject or teacher…"
                value={previewSearch}
                onChange={e => setPreviewSearch(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-300 bg-white"
              />
            </div>

            {/* Bulk select */}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  const visibleKeys = previewDiffRows
                    .filter(r =>
                      (previewFilterType === 'all' || r.type === previewFilterType) &&
                      (previewFilterSection === 'all' || r.sectionId === previewFilterSection) &&
                      (previewFilterDay === 'all' || r.dayId === previewFilterDay)
                    )
                    .map(r => r.key);
                  setSelectedPreviewKeys(prev => {
                    const n = new Set(prev);
                    visibleKeys.forEach(k => n.add(k));
                    return n;
                  });
                }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold transition-colors"
              >Select visible</button>
              <span className="text-slate-300">|</span>
              <button
                onClick={() => setSelectedPreviewKeys(new Set(previewDiffRows.map(r => r.key)))}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold transition-colors"
              >All</button>
              <span className="text-slate-300">|</span>
              <button
                onClick={() => setSelectedPreviewKeys(new Set())}
                className="text-xs text-slate-500 hover:text-slate-700 font-semibold transition-colors"
              >None</button>
            </div>
          </div>

          {/* ── Diff Table ── */}
          <div className="overflow-auto flex-1" style={{ maxHeight: 'calc(92vh - 280px)' }}>
            {(() => {
              const filtered = previewDiffRows.filter(r => {
                if (previewFilterType !== 'all' && r.type !== previewFilterType) return false;
                if (previewFilterSection !== 'all' && r.sectionId !== previewFilterSection) return false;
                if (previewFilterDay !== 'all' && r.dayId !== previewFilterDay) return false;
                if (previewSearch) {
                  const q = previewSearch.toLowerCase();
                  const cs = (r.current ? getDisplayedSubject(r.current)?.name : '').toLowerCase();
                  const ct = getSlotTeacherNames(r.current ?? {}).toLowerCase();
                  const cta = getSlotTeacherAbbreviation(r.current ?? {}).toLowerCase();
                  const ps = (getPreviewDisplayedSubject(r.preview)?.name ?? '').toLowerCase();
                  const pt = getPreviewTeacherNames(r.preview).toLowerCase();
                  const pta = getPreviewTeacherAbbreviation(r.preview).toLowerCase();
                  if (!cs.includes(q) && !ct.includes(q) && !cta.includes(q) && !ps.includes(q) && !pt.includes(q) && !pta.includes(q)) return false;
                }
                return true;
              });

              if (filtered.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
                    <Search className="h-10 w-10 mb-3 opacity-30" />
                    <p className="font-semibold text-slate-600">No matching changes</p>
                    <p className="text-sm mt-1">Try adjusting the filters above</p>
                  </div>
                );
              }

              // Group by section for cleaner reading
              const grouped = new Map<string, PreviewDiffRow[]>();
              for (const row of filtered) {
                const key = row.sectionId;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key)!.push(row);
              }

              return (
                <div>
                  {Array.from(grouped.entries()).map(([sectionId, rows]) => {
                    const sectionName = sections.find(s => s.id === sectionId)?.name ?? sectionId;
                    const allSelected = rows.every(r => selectedPreviewKeys.has(r.key));
                    const someSelected = rows.some(r => selectedPreviewKeys.has(r.key));
                    return (
                      <div key={sectionId}>
                        {/* Section header */}
                        <div className="sticky top-0 z-10 px-6 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-3">
                          <button
                            onClick={() => {
                              setSelectedPreviewKeys(prev => {
                                const n = new Set(prev);
                                if (allSelected) rows.forEach(r => n.delete(r.key));
                                else rows.forEach(r => n.add(r.key));
                                return n;
                              });
                            }}
                            className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                              allSelected ? 'bg-indigo-600 border-indigo-600' : someSelected ? 'bg-indigo-200 border-indigo-400' : 'border-slate-300 bg-white'
                            }`}
                          >
                            {(allSelected || someSelected) && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                          </button>
                          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{sectionName}</span>
                          <span className="text-xs text-slate-400">{rows.length} change{rows.length !== 1 ? 's' : ''}</span>
                          <div className="flex gap-1 ml-2">
                            {['add','remove','update'].map(t => {
                              const cnt = rows.filter(r => r.type === t).length;
                              if (!cnt) return null;
                              return (
                                <span key={t} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  t === 'add' ? 'bg-emerald-100 text-emerald-700' :
                                  t === 'remove' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {cnt} {t === 'update' ? 'chg' : t}
                                </span>
                              );
                            })}
                          </div>
                        </div>

                        {/* Rows */}
                        {rows.map(row => {
                          const isSelected = selectedPreviewKeys.has(row.key);
                          const dayName = days.find(d => d.id === row.dayId)?.name ?? row.dayId;
                          const ts = timeSlots.find(t => t.id === row.timeSlotId);
                          const periodNo = ts?.periodNumber ?? '?';
                          const periodTime = ts ? `${ts.startTime}–${ts.endTime}` : '';

                          const currentSubj = row.current
                            ? getDisplayedSubject(row.current)?.name ?? row.current.subjectId ?? '—'
                            : '—';
                          const currentTeacherName = row.current ? getSlotTeacherNames(row.current) : '';
                          const currentTeacherAbbr = row.current
                            ? getSlotTeacherAbbreviation(row.current) || row.current.teacherId || '—'
                            : '—';

                          const previewSubj = getPreviewDisplayedSubject(row.preview)?.name ?? row.preview?.subjectId ?? '—';
                          const previewTeacherAbbr = getPreviewTeacherAbbreviation(row.preview) || row.preview?.teacherId || '—';
                          const previewTeacherName = getPreviewTeacherNames(row.preview);

                          const typeStyle = {
                            add: { bg: 'border-l-emerald-400 bg-emerald-50/40', badge: 'bg-emerald-100 text-emerald-700', label: '+ ADDED' },
                            remove: { bg: 'border-l-red-400 bg-red-50/40', badge: 'bg-red-100 text-red-700', label: '− REMOVED' },
                            update: { bg: 'border-l-blue-400 bg-blue-50/30', badge: 'bg-blue-100 text-blue-700', label: '↻ CHANGED' },
                          }[row.type];

                          return (
                            <div
                              key={row.key}
                              onClick={() => setSelectedPreviewKeys(prev => {
                                const n = new Set(prev);
                                if (n.has(row.key)) n.delete(row.key);
                                else n.add(row.key);
                                return n;
                              })}
                              className={`flex items-center gap-4 px-6 py-3 border-b border-slate-50 cursor-pointer transition-all border-l-4 ${typeStyle.bg} ${
                                isSelected ? 'opacity-100' : 'opacity-50 hover:opacity-75'
                              }`}
                            >
                              {/* Checkbox */}
                              <div className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'
                              }`}>
                                {isSelected && <CheckCircle className="h-3 w-3 text-white" />}
                              </div>

                              {/* Type badge */}
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${typeStyle.badge}`}>
                                {typeStyle.label}
                              </span>

                              {/* Day + Period */}
                              <div className="w-28 shrink-0">
                                <div className="text-xs font-semibold text-slate-700">{dayName}</div>
                                <div className="text-[10px] text-slate-400">P{periodNo} · {periodTime}</div>
                              </div>

                              {/* Current → Preview */}
                              <div className="flex-1 grid grid-cols-2 gap-3">
                                {/* Current */}
                                <div className={`rounded-lg px-3 py-2 ${row.type === 'remove' ? 'bg-red-50 border border-red-200' : 'bg-white border border-slate-200'}`}>
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Live</div>
                                  {row.current ? (
                                    <>
                                      <div className="text-sm font-bold text-slate-800 leading-tight">{currentSubj}</div>
                                      <div className="text-xs text-slate-500">{currentTeacherName || currentTeacherAbbr}</div>
                                    </>
                                  ) : (
                                    <div className="text-xs text-slate-400 italic">Empty slot</div>
                                  )}
                                </div>

                                {/* Preview */}
                                <div className={`rounded-lg px-3 py-2 ${row.type === 'add' ? 'bg-emerald-50 border border-emerald-200' : row.type === 'update' ? 'bg-blue-50 border border-blue-200' : 'bg-white border border-slate-200'}`}>
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Preview</div>
                                  {row.preview ? (
                                    <>
                                      <div className="text-sm font-bold text-slate-800 leading-tight">{previewSubj}</div>
                                      <div className="text-xs text-slate-500">{previewTeacherName || previewTeacherAbbr}</div>
                                    </>
                                  ) : (
                                    <div className="text-xs text-slate-400 italic">Will be removed</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center justify-between gap-4">
            <div className="text-sm text-slate-500">
              <span className="font-semibold text-slate-900">{selectedPreviewKeys.size}</span> of{' '}
              <span className="font-semibold text-slate-900">{previewDiffRows.length}</span> changes selected
              {selectedPreviewKeys.size > 0 && (
                <span className="ml-2 text-xs text-slate-400">
                  ({previewDiffRows.filter(r => r.type === 'add' && selectedPreviewKeys.has(r.key)).length} add ·{' '}
                  {previewDiffRows.filter(r => r.type === 'remove' && selectedPreviewKeys.has(r.key)).length} remove ·{' '}
                  {previewDiffRows.filter(r => r.type === 'update' && selectedPreviewKeys.has(r.key)).length} change)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setPreviewDialogOpen(false)} className="border-slate-200">
                Discard
              </Button>
              <button
                onClick={handleApplyPreviewSelected}
                disabled={applyingPreview || selectedPreviewKeys.size === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-white font-semibold text-sm transition-all hover:opacity-90 shadow-md shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
              >
                {applyingPreview
                  ? <><RefreshCw className="h-4 w-4 animate-spin" /> Applying…</>
                  : <><CheckCircle className="h-4 w-4" /> Apply {selectedPreviewKeys.size} Change{selectedPreviewKeys.size !== 1 ? 's' : ''}</>
                }
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
