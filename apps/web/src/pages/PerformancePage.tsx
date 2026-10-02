import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Target, Star, Users, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { hasPermission } from '../lib/auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';

type Person = { firstName: string; lastName: string; designation?: string | null };
type Review = {
  id: string;
  cycleName: string;
  status: 'DRAFT' | 'SELF_SUBMITTED' | 'COMPLETED';
  selfRating: number | null;
  managerRating: number | null;
  selfComments: string | null;
  managerComments: string | null;
  employee?: Person;
  reviewer?: Person | null;
};
type Cycle = { cycleName: string; draft: number; selfSubmitted: number; completed: number; total: number };

function Rating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star`}>
          <Star size={22} className={n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
        </button>
      ))}
    </div>
  );
}

function ReviewForm({ submitLabel, onSubmit, busy }: { submitLabel: string; onSubmit: (rating: number, comments: string) => void; busy: boolean }) {
  const [rating, setRating] = useState(3);
  const [comments, setComments] = useState('');
  return (
    <div className="space-y-3 pt-3 border-t mt-3">
      <Rating value={rating} onChange={setRating} />
      <Textarea placeholder="Comments" value={comments} onChange={(e) => setComments(e.target.value)} maxLength={4000} />
      <Button size="sm" disabled={busy || !comments.trim()} onClick={() => onSubmit(rating, comments)}>
        {submitLabel}
      </Button>
    </div>
  );
}

const statusLabel = { DRAFT: 'Awaiting self-review', SELF_SUBMITTED: 'Awaiting manager', COMPLETED: 'Completed' };

export function PerformancePage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const canViewTeamReviews = hasPermission(['performance.team.read']);
  const canManagePerformance = hasPermission(['performance.manage']);
  const [cycleName, setCycleName] = useState('');
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');
  const refresh = () => qc.invalidateQueries({ queryKey: ['performance'] });

  const mine = useQuery({ queryKey: ['performance', 'me'], queryFn: async () => (await api.get<Review[]>('/performance/me')).data, retry: false });
  const team = useQuery({ queryKey: ['performance', 'team'], enabled: canViewTeamReviews, queryFn: async () => (await api.get<Review[]>('/performance/team')).data });
  const cycles = useQuery({ queryKey: ['performance', 'cycles'], enabled: canManagePerformance, queryFn: async () => (await api.get<Cycle[]>('/performance/cycles')).data });

  const self = useMutation({
    mutationFn: async (v: { id: string; rating: number; comments: string }) => api.patch(`/performance/${v.id}/self`, { selfRating: v.rating, comments: v.comments }),
    onSuccess: () => {
      refresh();
      showToast('Self-review submitted', 'success');
    },
    onError,
  });
  const manager = useMutation({
    mutationFn: async (v: { id: string; rating: number; comments: string }) => api.patch(`/performance/${v.id}/manager`, { managerRating: v.rating, comments: v.comments }),
    onSuccess: () => {
      refresh();
      showToast('Review completed', 'success');
    },
    onError,
  });
  const openCycle = useMutation({
    mutationFn: async () => (await api.post('/performance/cycle', { cycleName })).data,
    onSuccess: (d: any) => {
      setCycleName('');
      refresh();
      showToast(`Cycle opened for ${d.created} employee(s)${d.employeesWithoutManager ? ` — ${d.employeesWithoutManager} have no manager assigned` : ''}`, 'success');
    },
    onError,
  });

  if (mine.isError) {
    return <Card><CardContent className="py-8 text-muted-foreground">{getErrorMessage(mine.error)}</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Performance</h2>
        <p className="text-muted-foreground mt-2">Self-review first, then your manager completes the review.</p>
      </div>

      {canManagePerformance && (
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Review cycles</CardTitle>
            <CardDescription>Opening a cycle creates a review for every active employee, assigned to their manager.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 max-w-md">
              <Input placeholder="e.g. H2 2026" value={cycleName} onChange={(e) => setCycleName(e.target.value)} />
              <Button onClick={() => openCycle.mutate()} disabled={cycleName.trim().length < 2 || openCycle.isPending}>
                <Plus size={16} className="mr-1" /> Open cycle
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {cycles.data?.map((c) => (
                <div key={c.cycleName} className="rounded-xl border p-4 bg-white/40">
                  <div className="font-semibold">{c.cycleName}</div>
                  <div className="text-sm text-muted-foreground">
                    {c.completed}/{c.total} completed · {c.selfSubmitted} awaiting manager · {c.draft} awaiting self-review
                  </div>
                  <div className="h-2 mt-2 rounded bg-slate-200 overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${c.total ? (c.completed / c.total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target size={18} className="text-indigo-500" /> My reviews
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {mine.data?.map((r) => (
              <div key={r.id} className="rounded-xl border p-4 bg-white/40">
                <div className="flex justify-between">
                  <div className="font-semibold">{r.cycleName}</div>
                  <Badge variant="outline">{statusLabel[r.status]}</Badge>
                </div>
                <div className="text-sm text-muted-foreground">Reviewer: {r.reviewer ? `${r.reviewer.firstName} ${r.reviewer.lastName}` : 'Not assigned'}</div>
                {r.selfRating && <div className="text-sm mt-2">Self: {r.selfRating}/5 — {r.selfComments}</div>}
                {r.status === 'COMPLETED' && <div className="text-sm mt-1">Manager: {r.managerRating}/5 — {r.managerComments}</div>}
                {r.status === 'DRAFT' && <ReviewForm submitLabel="Submit self-review" busy={self.isPending} onSubmit={(rating, comments) => self.mutate({ id: r.id, rating, comments })} />}
              </div>
            ))}
            {!mine.isLoading && !mine.data?.length && <div className="text-muted-foreground text-sm">No reviews yet.</div>}
          </CardContent>
        </Card>

        {canViewTeamReviews && (
          <Card className="bg-white/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users size={18} className="text-emerald-500" /> My team
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {team.data?.map((r) => (
                <div key={r.id} className="rounded-xl border p-4 bg-white/40">
                  <div className="flex justify-between">
                    <div className="font-semibold">
                      {r.employee?.firstName} {r.employee?.lastName} · {r.cycleName}
                    </div>
                    <Badge variant="outline">{statusLabel[r.status]}</Badge>
                  </div>
                  {r.selfRating && <div className="text-sm mt-2">Self: {r.selfRating}/5 — {r.selfComments}</div>}
                  {r.status === 'COMPLETED' && <div className="text-sm mt-1">You: {r.managerRating}/5 — {r.managerComments}</div>}
                  {r.status === 'SELF_SUBMITTED' && <ReviewForm submitLabel="Complete review" busy={manager.isPending} onSubmit={(rating, comments) => manager.mutate({ id: r.id, rating, comments })} />}
                </div>
              ))}
              {!team.isLoading && !team.data?.length && <div className="text-muted-foreground text-sm">No team reviews assigned to you.</div>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
