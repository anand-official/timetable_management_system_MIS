'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

type Weights = {
  subjectPreferenceWeight: number;
  teacherDailyLoadWeight: number;
  sectionDailyLoadWeight: number;
  subjectSpreadWeight: number;
  teacherAdjacencyPenaltyWeight: number;
  labLastPeriodPenaltyWeight: number;
  classTeacherBonusWeight: number;
  roomAvailabilityWeight: number;
  labPlacementWeight: number;
};

const FIELDS: Array<{ key: keyof Weights; label: string }> = [
  { key: 'subjectPreferenceWeight', label: 'Subject Preference Weight' },
  { key: 'teacherDailyLoadWeight', label: 'Teacher Daily Load Weight' },
  { key: 'sectionDailyLoadWeight', label: 'Section Daily Load Weight' },
  { key: 'subjectSpreadWeight', label: 'Subject Spread Weight' },
  { key: 'teacherAdjacencyPenaltyWeight', label: 'Teacher Adjacency Penalty Weight' },
  { key: 'labLastPeriodPenaltyWeight', label: 'Lab Last Period Penalty Weight' },
  { key: 'classTeacherBonusWeight', label: 'Class Teacher Bonus Weight' },
  { key: 'roomAvailabilityWeight', label: 'Room Availability Weight' },
  { key: 'labPlacementWeight', label: 'Lab Placement Weight' },
];

export default function ScoringWeightsPage() {
  const [weights, setWeights] = useState<Weights | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/scoring-weights');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      setWeights(data.weights);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load scoring weights');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!weights) return;
    try {
      setSaving(true);
      const response = await fetch('/api/scoring-weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(weights),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      setWeights(data.weights);
      toast.success('Scoring weights updated');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save scoring weights');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !weights) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-violet-50/10 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-indigo-500 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading scoring weights…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-violet-50/10">
      <header className="sticky top-0 z-50 border-b border-indigo-100/60 bg-white/92 backdrop-blur-sm shadow-sm">
        <div className="container mx-auto px-6 py-3.5 flex items-center gap-3">
          <a href="/" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">← Dashboard</a>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-semibold text-slate-700">Scoring Weights</span>
        </div>
      </header>
      <div className="container mx-auto px-6 py-8 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Scoring Weights</h1>
          <p className="text-sm text-slate-500 mt-1">Adjust soft-constraint priorities used by the greedy timetable algorithm.</p>
        </div>
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 0 0 1px rgba(99,102,241,0.06), 0 4px 16px rgba(99,102,241,0.06)' }}>
          <div className="p-6 space-y-4">
            {FIELDS.map((field) => (
              <div key={field.key} className="flex items-center gap-4">
                <Label className="w-64 text-sm font-medium text-slate-700 shrink-0">{field.label}</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={weights[field.key]}
                  className="border-slate-200 focus:border-indigo-300 max-w-[140px]"
                  onChange={(e) =>
                    setWeights((prev) =>
                      prev
                        ? { ...prev, [field.key]: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0 }
                        : prev
                    )
                  }
                />
              </div>
            ))}
          </div>
          <div className="px-6 pb-6 flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-sm transition-all hover:opacity-90 shadow-md shadow-indigo-200 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              Save Weights
            </button>
            <button
              onClick={load}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all border border-slate-200"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
