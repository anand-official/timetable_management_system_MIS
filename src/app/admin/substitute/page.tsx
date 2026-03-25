'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

type Teacher = { id: string; name: string; abbreviation: string };
type SuggestionTeacher = { id: string; name: string; abbreviation: string };
type SuggestedSlot = {
  slotId: string;
  periodNumber: number;
  dayName: string;
  sectionName: string;
  subjectName: string;
  currentTeacher: SuggestionTeacher | null;
  suggestions: SuggestionTeacher[];
};

export default function SubstitutePage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SuggestedSlot[]>([]);
  const [choiceBySlot, setChoiceBySlot] = useState<Record<string, string>>({});
  const [submittingSlot, setSubmittingSlot] = useState<string | null>(null);

  const selectedTeacher = useMemo(
    () => teachers.find(t => t.id === selectedTeacherId) ?? null,
    [teachers, selectedTeacherId]
  );

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/timetable');
        const data = await r.json();
        setTeachers(data.teachers || []);
        if ((data.teachers || []).length > 0) setSelectedTeacherId((data.teachers || [])[0].id);
      } catch (error) {
        console.error(error);
        toast.error('Failed to load teachers');
      }
    })();
  }, []);

  const loadSuggestions = async () => {
    if (!selectedTeacherId || !selectedDate) {
      toast.error('Select teacher and date');
      return;
    }
    try {
      setLoading(true);
      const url = `/api/substitute/suggest?teacherId=${selectedTeacherId}&date=${selectedDate}`;
      const r = await fetch(url);
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);
      setRows(data.slots || []);
      setChoiceBySlot({});
      await fetch('/api/teacher-absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: selectedTeacherId, date: selectedDate }),
      });
    } catch (error) {
      console.error(error);
      toast.error('Failed to load substitute suggestions');
    } finally {
      setLoading(false);
    }
  };

  const reassign = async (slotId: string) => {
    const substituteTeacherId = choiceBySlot[slotId];
    if (!substituteTeacherId) {
      toast.error('Select a substitute teacher first');
      return;
    }
    try {
      setSubmittingSlot(slotId);
      const r = await fetch('/api/substitute/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId,
          substituteTeacherId,
          markAbsentTeacherId: selectedTeacherId,
          date: selectedDate,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);
      toast.success('Slot reassigned and locked');
      setRows(prev => prev.filter(row => row.slotId !== slotId));
    } catch (error) {
      console.error(error);
      toast.error('Failed to reassign slot');
    } finally {
      setSubmittingSlot(null);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Substitute Teacher Workflow</CardTitle>
          <CardDescription>Mark absence, review impacted slots, and assign substitutes.</CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>Teacher</Label>
            <Select value={selectedTeacherId} onValueChange={setSelectedTeacherId}>
              <SelectTrigger><SelectValue placeholder="Select teacher" /></SelectTrigger>
              <SelectContent>
                {teachers.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name} ({t.abbreviation})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Date</Label>
            <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={loadSuggestions} disabled={loading}>
              {loading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              Load Slots
            </Button>
          </div>
          <div className="flex items-end text-sm text-muted-foreground">
            {selectedTeacher ? `Selected: ${selectedTeacher.name}` : ''}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Absent Teacher Slots</CardTitle>
          <CardDescription>Only slots on the selected day are shown.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No slots found for this teacher/date.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Current Teacher</TableHead>
                  <TableHead>Suggested Substitute</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.slotId}>
                    <TableCell>P{row.periodNumber}</TableCell>
                    <TableCell>{row.sectionName}</TableCell>
                    <TableCell>{row.subjectName}</TableCell>
                    <TableCell>{row.currentTeacher?.abbreviation ?? '-'}</TableCell>
                    <TableCell className="w-[300px]">
                      <Select
                        value={choiceBySlot[row.slotId] || ''}
                        onValueChange={(v) => setChoiceBySlot(prev => ({ ...prev, [row.slotId]: v }))}
                      >
                        <SelectTrigger><SelectValue placeholder="Select substitute" /></SelectTrigger>
                        <SelectContent>
                          {row.suggestions.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name} ({s.abbreviation})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => reassign(row.slotId)}
                        disabled={submittingSlot === row.slotId || row.suggestions.length === 0}
                      >
                        {submittingSlot === row.slotId ? 'Replacing...' : 'Replace'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
