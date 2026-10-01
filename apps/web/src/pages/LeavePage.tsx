import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CheckCircle, XCircle, Clock, Plus, Ban } from 'lucide-react';
import { api, type Paged } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { getAuth } from '../lib/auth';
import { fmtDay } from '../lib/format';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';

type Leave = {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string | null;
  reviewNote?: string | null;
  employee?: { firstName: string; lastName: string; department?: string | null };
};
type Balance = { type: string; isPaid: boolean; quota: number | null; used: number; pending: number; remaining: number | null };
type Policy = { type: string; isPaid: boolean; annualQuota: number; accrualMode: string; carryForwardLimit?: number | null; allowNegative: boolean };
type LedgerEntry = { id: string; type: string; event: string; days: number | string; createdAt: string; metadata?: { reason?: string } | null };
type ApprovalRule = { step: number; approverKind: 'DIRECT_MANAGER' | 'ROLE' | 'SPECIFIC_USER'; approverRole?: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'; approverUserId?: string };

const schema = z
  .object({
    type: z.string().min(1, 'Choose a leave type'),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be after start date', path: ['endDate'] });
type FormData = z.infer<typeof schema>;

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    APPROVED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    REJECTED: 'bg-red-500/10 text-red-600 border-red-500/20',
    CANCELLED: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
    PENDING: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  };
  const Icon = status === 'APPROVED' ? CheckCircle : status === 'REJECTED' ? XCircle : status === 'CANCELLED' ? Ban : Clock;
  return (
    <Badge variant="outline" className={styles[status]}>
      <Icon size={12} className="mr-1" /> {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

export function LeavePage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const role = getAuth()?.user.role;
  const isAdmin = role === 'ADMIN';
  const canReview = role === 'ADMIN' || role === 'MANAGER';
  const [reviewScope, setReviewScope] = useState<'team' | 'all'>(role === 'ADMIN' ? 'all' : 'team');
  const [adminType, setAdminType] = useState('ANNUAL');
  const [adjustment, setAdjustment] = useState({ employeeId: '', type: 'ANNUAL', days: '', reason: '' });
  const [rulesDraft, setRulesDraft] = useState<ApprovalRule[]>([{ step: 1, approverKind: 'DIRECT_MANAGER' }]);

  const policies = useQuery({ queryKey: ['leave-policies'], queryFn: async () => (await api.get<Policy[]>('/leave-policies')).data });
  const balance = useQuery({ queryKey: ['leave', 'balance'], queryFn: async () => (await api.get<Balance[]>('/leave-requests/balance')).data });
  const ledger = useQuery({ queryKey: ['leave', 'ledger'], queryFn: async () => (await api.get<LedgerEntry[]>('/leave-balance-ledger')).data });
  const policyVersions = useQuery({ queryKey: ['leave-policy-versions', adminType], enabled: isAdmin, queryFn: async () => (await api.get<Policy[]>(`/leave-policies/${adminType}/versions`)).data });
  const approvalRules = useQuery({ queryKey: ['leave-approval-rules'], enabled: isAdmin, queryFn: async () => (await api.get<Array<ApprovalRule & { type: string }>>('/leave-approval-rules')).data });
  const mine = useQuery({ queryKey: ['leave', 'mine'], queryFn: async () => (await api.get<Paged<Leave>>('/leave-requests', { params: { scope: 'mine', pageSize: 50 } })).data });
  const pending = useQuery({
    queryKey: ['leave', 'review', reviewScope],
    enabled: canReview,
    queryFn: async () => (await api.get<Paged<Leave>>('/leave-requests', { params: { scope: reviewScope, status: 'PENDING', pageSize: 50 } })).data,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leave'] });
    qc.invalidateQueries({ queryKey: ['leave-policies'] });
    qc.invalidateQueries({ queryKey: ['leave-approval-rules'] });
  };
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');

  const create = useMutation({
    mutationFn: async (body: FormData) => api.post('/leave-requests', body),
    onSuccess: () => {
      reset();
      refresh();
      showToast('Leave request submitted', 'success');
    },
    onError,
  });
  const review = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) => {
      const note = status === 'REJECTED' ? window.prompt('Reason for rejection (optional)') ?? undefined : undefined;
      return api.patch(`/leave-requests/${id}/status`, { status, note: note || undefined });
    },
    onSuccess: (_r, v) => {
      refresh();
      showToast(`Leave ${v.status.toLowerCase()}`, 'success');
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => api.post(`/leave-requests/${id}/cancel`),
    onSuccess: () => {
      refresh();
      showToast('Request cancelled', 'success');
    },
    onError,
  });
  const adjustBalance = useMutation({
    mutationFn: async () => api.post('/leave-balance-adjustments', { ...adjustment, type: adminType, days: Number(adjustment.days) }),
    onSuccess: () => {
      setAdjustment((v) => ({ ...v, days: '', reason: '' }));
      refresh();
      showToast('Balance adjustment recorded', 'success');
    },
    onError,
  });
  const saveRules = useMutation({
    mutationFn: async () => api.put('/leave-approval-rules', { type: adminType, rules: rulesDraft }),
    onSuccess: () => {
      refresh();
      showToast('Approval workflow saved', 'success');
    },
    onError,
  });

  const loadRules = (type: string) => {
    setAdminType(type);
    const current = approvalRules.data?.filter((rule) => rule.type === type).map(({ type: _type, ...rule }) => rule);
    setRulesDraft(current?.length ? current : [{ step: 1, approverKind: 'DIRECT_MANAGER' }]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Leave</h2>
        <p className="text-muted-foreground mt-2">Balances are for the current calendar year and count pending requests.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {balance.data?.map((b) => (
          <Card key={b.type} className="bg-white/50 backdrop-blur-xl">
            <CardHeader className="pb-2">
              <CardDescription>{b.type}</CardDescription>
              <CardTitle className="text-3xl">{b.isPaid ? b.remaining : '—'}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {b.isPaid ? `${b.used} used · ${b.pending} pending · ${b.quota} per year` : `Unpaid · ${b.used} day(s) taken`}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="bg-white/50 backdrop-blur-xl h-fit">
          <CardHeader>
            <CardTitle>Request leave</CardTitle>
            <CardDescription>Working days exclude weekends and company holidays.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-3">
              <div className="space-y-1">
                <Label>Type</Label>
                <select className="w-full h-10 rounded-md border bg-white/70 px-3 text-sm" {...register('type')}>
                  <option value="">Select…</option>
                  {policies.data?.map((p) => (
                    <option key={p.type} value={p.type}>
                      {p.type}
                      {p.isPaid ? '' : ' (unpaid)'}
                    </option>
                  ))}
                </select>
                {errors.type && <p className="text-red-500 text-xs">{errors.type.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>From</Label>
                  <Input type="date" {...register('startDate')} />
                </div>
                <div className="space-y-1">
                  <Label>To</Label>
                  <Input type="date" {...register('endDate')} />
                </div>
              </div>
              {(errors.startDate || errors.endDate) && <p className="text-red-500 text-xs">{errors.startDate?.message ?? errors.endDate?.message}</p>}
              <div className="space-y-1">
                <Label>Reason</Label>
                <Input placeholder="Optional" {...register('reason')} />
              </div>
              <Button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white" disabled={create.isPending}>
                <Plus size={16} className="mr-2" /> {create.isPending ? 'Submitting…' : 'Submit request'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-white/50 backdrop-blur-xl overflow-hidden">
          <CardHeader>
            <CardTitle>My requests</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="pl-6">Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine.data?.items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-6 font-medium">{l.type}</TableCell>
                    <TableCell className="text-sm">
                      {fmtDay(l.startDate)} → {fmtDay(l.endDate)}
                      {l.reviewNote && <div className="text-xs text-muted-foreground">Note: {l.reviewNote}</div>}
                    </TableCell>
                    <TableCell>{l.days}</TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {l.status === 'PENDING' && (
                        <Button variant="ghost" size="sm" onClick={() => cancel.mutate(l.id)}>
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!mine.isLoading && !mine.data?.items.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No leave requests yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {canReview && (
        <Card className="bg-white/50 backdrop-blur-xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Awaiting your approval</CardTitle>
              <CardDescription>{reviewScope === 'team' ? 'Your direct reports' : 'Everyone in the workspace'}</CardDescription>
            </div>
            {role === 'ADMIN' && (
              <select className="h-9 rounded-md border bg-white/70 px-2 text-sm" value={reviewScope} onChange={(e) => setReviewScope(e.target.value as 'team' | 'all')}>
                <option value="all">All employees</option>
                <option value="team">My team</option>
              </select>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="pl-6">Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right pr-6">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.data?.items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-6 font-medium">
                      {l.employee?.firstName} {l.employee?.lastName}
                    </TableCell>
                    <TableCell>{l.type}</TableCell>
                    <TableCell className="text-sm">
                      {fmtDay(l.startDate)} → {fmtDay(l.endDate)}
                    </TableCell>
                    <TableCell>{l.days}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{l.reason ?? '—'}</TableCell>
                    <TableCell className="text-right pr-6 space-x-2">
                      <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white" disabled={review.isPending} onClick={() => review.mutate({ id: l.id, status: 'APPROVED' })}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600" disabled={review.isPending} onClick={() => review.mutate({ id: l.id, status: 'REJECTED' })}>
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!pending.isLoading && !pending.data?.items.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                      Nothing to review.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="bg-white/50 backdrop-blur-xl overflow-hidden">
        <CardHeader>
          <CardTitle>Balance statement</CardTitle>
          <CardDescription>Every credit, reservation, release, consumption, and correction for the current year.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50"><TableRow><TableHead className="pl-6">When</TableHead><TableHead>Type</TableHead><TableHead>Event</TableHead><TableHead>Days</TableHead><TableHead className="pr-6">Reason</TableHead></TableRow></TableHeader>
            <TableBody>
              {ledger.data?.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="pl-6 text-sm">{fmtDay(entry.createdAt)}</TableCell>
                  <TableCell>{entry.type}</TableCell><TableCell>{entry.event.replaceAll('_', ' ')}</TableCell>
                  <TableCell className={Number(entry.days) < 0 ? 'text-red-600' : 'text-emerald-600'}>{Number(entry.days) > 0 ? '+' : ''}{entry.days}</TableCell>
                  <TableCell className="pr-6 text-sm text-muted-foreground">{entry.metadata?.reason ?? '—'}</TableCell>
                </TableRow>
              ))}
              {!ledger.isLoading && !ledger.data?.length && <TableRow><TableCell colSpan={5} className="h-20 text-center text-muted-foreground">No balance events yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isAdmin && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="bg-white/50 backdrop-blur-xl">
            <CardHeader><CardTitle>Approval workflow</CardTitle><CardDescription>Rules are snapshotted when an employee submits a request.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <select className="w-full h-10 rounded-md border bg-white/70 px-3 text-sm" value={adminType} onChange={(e) => loadRules(e.target.value)}>
                {policies.data?.map((policy) => <option key={policy.type} value={policy.type}>{policy.type}</option>)}
              </select>
              {rulesDraft.map((rule, index) => (
                <div key={rule.step} className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
                  <span className="text-sm font-medium">{rule.step}</span>
                  <select className="h-10 rounded-md border bg-white/70 px-3 text-sm" value={rule.approverKind} onChange={(e) => setRulesDraft((rules) => rules.map((item, i) => i === index ? { ...item, approverKind: e.target.value as ApprovalRule['approverKind'], approverRole: e.target.value === 'ROLE' ? 'MANAGER' : undefined, approverUserId: undefined } : item))}>
                    <option value="DIRECT_MANAGER">Direct manager</option><option value="ROLE">Role</option><option value="SPECIFIC_USER">Named user</option>
                  </select>
                  {rulesDraft.length > 1 && <Button variant="ghost" size="sm" onClick={() => setRulesDraft((rules) => rules.filter((_, i) => i !== index).map((item, i) => ({ ...item, step: i + 1 })))}>Remove</Button>}
                  {rule.approverKind === 'ROLE' && <select className="col-start-2 h-10 rounded-md border bg-white/70 px-3 text-sm" value={rule.approverRole ?? 'MANAGER'} onChange={(e) => setRulesDraft((rules) => rules.map((item, i) => i === index ? { ...item, approverRole: e.target.value as ApprovalRule['approverRole'] } : item))}><option value="MANAGER">Manager</option><option value="ADMIN">Administrator</option><option value="EMPLOYEE">Employee</option></select>}
                  {rule.approverKind === 'SPECIFIC_USER' && <Input className="col-start-2" placeholder="Approver user UUID" value={rule.approverUserId ?? ''} onChange={(e) => setRulesDraft((rules) => rules.map((item, i) => i === index ? { ...item, approverUserId: e.target.value } : item))} />}
                </div>
              ))}
              <div className="flex gap-2"><Button variant="outline" onClick={() => setRulesDraft((rules) => [...rules, { step: rules.length + 1, approverKind: 'DIRECT_MANAGER' }])}>Add step</Button><Button className="bg-indigo-500 hover:bg-indigo-600 text-white" disabled={saveRules.isPending} onClick={() => saveRules.mutate()}>Save workflow</Button></div>
            </CardContent>
          </Card>

          <Card className="bg-white/50 backdrop-blur-xl">
            <CardHeader><CardTitle>Policy history & adjustment</CardTitle><CardDescription>Policy terms are future-dated; individual corrections are append-only.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <select className="w-full h-10 rounded-md border bg-white/70 px-3 text-sm" value={adminType} onChange={(e) => setAdminType(e.target.value)}>{policies.data?.map((policy) => <option key={policy.type} value={policy.type}>{policy.type}</option>)}</select>
              <div className="rounded-md border bg-white/60 p-3 text-sm space-y-1 max-h-32 overflow-auto">
                {policyVersions.data?.map((version: any) => <div key={version.id}>v{version.version}: {version.annualQuota} days · {version.accrualMode} · {fmtDay(version.effectiveFrom)}{version.effectiveTo ? ` to ${fmtDay(version.effectiveTo)}` : ' onward'}</div>)}
                {!policyVersions.data?.length && <span className="text-muted-foreground">No history available yet.</span>}
              </div>
              <div className="grid grid-cols-2 gap-2"><Input placeholder="Employee UUID" value={adjustment.employeeId} onChange={(e) => setAdjustment((v) => ({ ...v, employeeId: e.target.value }))} /><Input placeholder="Days, e.g. -1 or 2" value={adjustment.days} onChange={(e) => setAdjustment((v) => ({ ...v, days: e.target.value }))} /></div>
              <Input placeholder="Required correction reason" value={adjustment.reason} onChange={(e) => setAdjustment((v) => ({ ...v, type: adminType, reason: e.target.value }))} />
              <Button className="bg-indigo-500 hover:bg-indigo-600 text-white" disabled={adjustBalance.isPending || !adjustment.employeeId || !adjustment.days || adjustment.reason.length < 3} onClick={() => adjustBalance.mutate()}>Record adjustment</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
