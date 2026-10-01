import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Puzzle, Plus, RefreshCw, Trash2, ChevronUp, ChevronDown,
  GripVertical, ToggleLeft, ToggleRight, Check, Copy,
} from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';

type Integration = {
  id: string;
  provider: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
};
type Stage = {
  id: string;
  key: string;
  name: string;
  category: string;
  position: number;
  isActive: boolean;
};

const CATEGORY_COLORS: Record<string, string> = {
  APPLIED: 'bg-slate-100 text-slate-600',
  SCREENING: 'bg-blue-100 text-blue-700',
  INTERVIEW: 'bg-indigo-100 text-indigo-700',
  OFFERED: 'bg-purple-100 text-purple-700',
  HIRED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const APPLICATION_STATUSES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED'] as const;

export function HiringSettingsPanel() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');

  // ─── Integrations state ─────────────────────────────────────────────────────
  const [showIntegDialog, setShowIntegDialog] = useState(false);
  const [newInteg, setNewInteg] = useState({ provider: '', displayName: '' });
  const [revealedSecret, setRevealedSecret] = useState<{ id: string; secret: string } | null>(null);

  // ─── Stages state ────────────────────────────────────────────────────────────
  const [showStageDialog, setShowStageDialog] = useState(false);
  const [newStage, setNewStage] = useState({ key: '', name: '', category: 'SCREENING' as string, position: 100 });

  const integrations = useQuery({
    queryKey: ['assessment-integrations'],
    queryFn: async () => (await api.get<Integration[]>('/hiring/assessment-integrations')).data,
  });
  const stages = useQuery({
    queryKey: ['hiring-stages'],
    queryFn: async () => (await api.get<Stage[]>('/hiring/stages')).data,
  });

  const createInteg = useMutation({
    mutationFn: async (body: { provider: string; displayName: string }) =>
      (await api.post<Integration & { webhookSecret: string }>('/hiring/assessment-integrations', body)).data,
    onSuccess: (data) => {
      setNewInteg({ provider: '', displayName: '' });
      setShowIntegDialog(false);
      setRevealedSecret({ id: data.id, secret: data.webhookSecret });
      qc.invalidateQueries({ queryKey: ['assessment-integrations'] });
    },
    onError,
  });

  const rotateSecret = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ webhookSecret: string }>(`/hiring/assessment-integrations/${id}/rotate-webhook-secret`)).data,
    onSuccess: (data, id) => setRevealedSecret({ id, secret: data.webhookSecret }),
    onError,
  });

  const createStage = useMutation({
    mutationFn: async (body: typeof newStage) => api.post('/hiring/stages', body),
    onSuccess: () => {
      setNewStage({ key: '', name: '', category: 'SCREENING', position: 100 });
      setShowStageDialog(false);
      qc.invalidateQueries({ queryKey: ['hiring-stages'] });
      showToast('Pipeline stage created', 'success');
    },
    onError,
  });

  const updateStage = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name?: string; position?: number; isActive?: boolean }) =>
      api.patch(`/hiring/stages/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hiring-stages'] }),
    onError,
  });

  const sortedStages = [...(stages.data ?? [])].sort((a, b) => a.position - b.position);

  function moveStage(stage: Stage, dir: 'up' | 'down') {
    const sorted = sortedStages;
    const idx = sorted.findIndex((s) => s.id === stage.id);
    const target = dir === 'up' ? sorted[idx - 1] : sorted[idx + 1];
    if (!target) return;
    // Swap positions
    updateStage.mutate({ id: stage.id, position: target.position });
    updateStage.mutate({ id: target.id, position: stage.position });
  }

  return (
    <div className="space-y-6">
      {/* ── Assessment Integrations ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Puzzle size={18} /> Assessment Integrations
            </CardTitle>
            <CardDescription>
              Connect third-party test providers (HackerRank, TestGorilla, etc.). Each integration
              generates a unique webhook secret for verifying inbound callbacks.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowIntegDialog(true)}>
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </CardHeader>
        <CardContent>
          {integrations.data?.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              No integrations configured yet.
            </div>
          )}
          <div className="space-y-3">
            {integrations.data?.map((integ) => (
              <div
                key={integ.id}
                className="flex items-center justify-between rounded-xl border bg-slate-50 px-4 py-3"
              >
                <div>
                  <div className="font-medium text-sm">{integ.displayName}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{integ.provider}</div>
                  {revealedSecret?.id === integ.id && (
                    <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs">
                      <span className="font-semibold text-amber-700">Webhook secret (save now — not shown again):</span>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="font-mono break-all text-slate-800">{revealedSecret.secret}</code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(revealedSecret.secret); showToast('Copied', 'success'); }}
                          className="shrink-0 text-indigo-600"
                          title="Copy to clipboard"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={integ.isActive ? 'text-emerald-600' : 'text-slate-400'}>
                    {integ.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm('Rotate the webhook secret? The old secret will stop working immediately.')) {
                        rotateSecret.mutate(integ.id);
                      }
                    }}
                    disabled={rotateSecret.isPending}
                    title="Rotate webhook secret"
                  >
                    <RefreshCw size={13} className="mr-1" /> Rotate secret
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Pipeline Stage Management ────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <GripVertical size={18} /> Pipeline Stages
            </CardTitle>
            <CardDescription>
              Customise your recruiting pipeline. Stages are ordered by position — use the arrows to
              reorder. Inactive stages are hidden from the pipeline but kept for historical records.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowStageDialog(true)}>
            <Plus size={14} className="mr-1" /> Add stage
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {sortedStages.map((stage, idx) => (
              <div
                key={stage.id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-opacity ${stage.isActive ? 'bg-white/60' : 'bg-slate-50 opacity-60'}`}
              >
                <GripVertical size={16} className="text-slate-300 shrink-0" />

                {/* Up/Down reorder */}
                <div className="flex flex-col">
                  <button
                    onClick={() => moveStage(stage, 'up')}
                    disabled={idx === 0 || updateStage.isPending}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20"
                    title="Move up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveStage(stage, 'down')}
                    disabled={idx === sortedStages.length - 1 || updateStage.isPending}
                    className="text-slate-400 hover:text-slate-600 disabled:opacity-20"
                    title="Move down"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                {/* Stage info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{stage.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{stage.key}</div>
                </div>

                <Badge className={`text-xs ${CATEGORY_COLORS[stage.category] ?? 'bg-slate-100 text-slate-600'}`}>
                  {stage.category}
                </Badge>

                {/* Toggle active */}
                <button
                  onClick={() => updateStage.mutate({ id: stage.id, isActive: !stage.isActive })}
                  disabled={updateStage.isPending}
                  title={stage.isActive ? 'Deactivate stage' : 'Activate stage'}
                  className={`transition-colors ${stage.isActive ? 'text-emerald-500 hover:text-emerald-700' : 'text-slate-300 hover:text-slate-500'}`}
                >
                  {stage.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Add Integration dialog ───────────────────────────────────────── */}
      <Dialog open={showIntegDialog} onOpenChange={setShowIntegDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add assessment integration</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Provider key (uppercase, e.g. HACKERRANK)</Label>
              <Input
                placeholder="HACKERRANK"
                value={newInteg.provider}
                onChange={(e) => setNewInteg((v) => ({ ...v, provider: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Display name</Label>
              <Input
                placeholder="HackerRank"
                value={newInteg.displayName}
                onChange={(e) => setNewInteg((v) => ({ ...v, displayName: e.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A webhook secret will be generated. <strong>Save it immediately</strong> — it is only shown once.
              Configure it in your provider's dashboard to authenticate callbacks.
            </p>
            <Button
              className="w-full"
              disabled={!newInteg.provider || !newInteg.displayName || createInteg.isPending}
              onClick={() => createInteg.mutate(newInteg)}
            >
              <Check size={14} className="mr-2" /> Create integration
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add Stage dialog ─────────────────────────────────────────────── */}
      <Dialog open={showStageDialog} onOpenChange={setShowStageDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add pipeline stage</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Stage key (uppercase, unique)</Label>
              <Input
                placeholder="TECHNICAL_INTERVIEW"
                value={newStage.key}
                onChange={(e) => setNewStage((v) => ({ ...v, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
              />
              <p className="text-xs text-muted-foreground">Used internally — cannot be changed after creation.</p>
            </div>
            <div className="space-y-1">
              <Label>Display name</Label>
              <Input
                placeholder="Technical Interview"
                value={newStage.name}
                onChange={(e) => setNewStage((v) => ({ ...v, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Category (pipeline phase this stage belongs to)</Label>
              <select
                className="h-9 w-full rounded-md border bg-white px-2 text-sm"
                value={newStage.category}
                onChange={(e) => setNewStage((v) => ({ ...v, category: e.target.value }))}
              >
                {APPLICATION_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Position (lower = earlier in pipeline)</Label>
              <Input
                type="number"
                min={1}
                max={9999}
                value={newStage.position}
                onChange={(e) => setNewStage((v) => ({ ...v, position: Number(e.target.value) }))}
              />
            </div>
            <Button
              className="w-full"
              disabled={!newStage.key || !newStage.name || createStage.isPending}
              onClick={() => createStage.mutate(newStage)}
            >
              <Plus size={14} className="mr-2" /> Create stage
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
