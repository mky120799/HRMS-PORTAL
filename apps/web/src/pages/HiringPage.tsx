import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Plus, Briefcase, Download, CalendarPlus, Link as LinkIcon, Sparkles } from 'lucide-react';
import { api, downloadFile, type Paged } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { getAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';

const jobSchema = z.object({
  title: z.string().trim().min(2, 'Title is required'),
  department: z.string().trim().min(1, 'Department is required'),
  location: z.string().trim().optional(),
  description: z.string().trim().min(20, 'Describe the role in at least 20 characters'),
});
type JobForm = z.infer<typeof jobSchema>;

type Job = { id: string; title: string; department: string; location?: string | null; status: 'OPEN' | 'CLOSED'; createdAt: string; _count?: { applications: number } };
type Application = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  aiScore: number | null;
  aiReason: string | null;
  resumeFilename: string | null;
  interviewAt: string | null;
  createdAt: string;
  job: { id: string; title: string };
};

const STATUSES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED'];
const statusColor: Record<string, string> = {
  APPLIED: 'bg-slate-100 text-slate-700',
  SCREENING: 'bg-blue-100 text-blue-700',
  INTERVIEW: 'bg-indigo-100 text-indigo-700',
  OFFERED: 'bg-purple-100 text-purple-700',
  HIRED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export function HiringPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const auth = getAuth();
  const isAdmin = auth?.user.role === 'ADMIN';
  const [jobId, setJobId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [scheduling, setScheduling] = useState<Application | null>(null);
  const [interview, setInterview] = useState({ startsAt: '', durationMinutes: 45, location: '' });
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');

  const jobs = useQuery({ queryKey: ['jobs'], queryFn: async () => (await api.get<Job[]>('/hiring/jobs')).data, retry: false });
  const applications = useQuery({
    queryKey: ['applications', jobId, status],
    queryFn: async () => (await api.get<Paged<Application>>('/hiring/applications', { params: { jobId: jobId || undefined, status: status || undefined, pageSize: 100 } })).data,
    retry: false,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<JobForm>({ resolver: zodResolver(jobSchema) });

  const createJob = useMutation({
    mutationFn: async (body: JobForm) => api.post('/hiring/jobs', body),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ['jobs'] });
      showToast('Job published on your careers page', 'success');
    },
    onError,
  });
  const toggleJob = useMutation({
    mutationFn: async (job: Job) => api.patch(`/hiring/jobs/${job.id}`, { status: job.status === 'OPEN' ? 'CLOSED' : 'OPEN' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
    onError,
  });
  const setAppStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => api.patch(`/hiring/applications/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      showToast('Status updated — the candidate has been notified', 'success');
    },
    onError,
  });
  const schedule = useMutation({
    mutationFn: async () =>
      api.post(`/hiring/applications/${scheduling!.id}/schedule-interview`, {
        startsAt: new Date(interview.startsAt).toISOString(),
        durationMinutes: interview.durationMinutes,
        location: interview.location || undefined,
      }),
    onSuccess: () => {
      setScheduling(null);
      qc.invalidateQueries({ queryKey: ['applications'] });
      showToast('Interview scheduled — invitations emailed with a calendar link', 'success');
    },
    onError,
  });

  const careersUrl = auth?.tenant?.slug ? `${window.location.origin}/careers/${auth.tenant.slug}` : null;

  if (jobs.isError) {
    return <Card><CardContent className="py-8 text-muted-foreground">{getErrorMessage(jobs.error)}</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Hiring</h2>
          <p className="text-muted-foreground mt-2">Candidates apply on your public careers page.</p>
        </div>
        {careersUrl && (
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(careersUrl).then(() => showToast('Careers page link copied', 'success'))}>
            <LinkIcon size={16} className="mr-2" /> Copy careers link
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {isAdmin && (
          <Card className="bg-white/50 backdrop-blur-xl h-fit">
            <CardHeader>
              <CardTitle>Post a job</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit((v) => createJob.mutate(v))} className="space-y-3">
                <div className="space-y-1">
                  <Label>Title</Label>
                  <Input {...register('title')} />
                  {errors.title && <p className="text-red-500 text-xs">{errors.title.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Department</Label>
                    <Input {...register('department')} />
                  </div>
                  <div className="space-y-1">
                    <Label>Location</Label>
                    <Input placeholder="Remote" {...register('location')} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Textarea rows={5} {...register('description')} />
                  {errors.description && <p className="text-red-500 text-xs">{errors.description.message}</p>}
                </div>
                <Button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white" disabled={createJob.isPending}>
                  <Plus size={16} className="mr-2" /> Publish
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card className={`${isAdmin ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white/50 backdrop-blur-xl`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase size={18} /> Jobs
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {jobs.data?.map((j) => (
              <div key={j.id} className={`rounded-xl border p-4 bg-white/40 ${jobId === j.id ? 'ring-2 ring-indigo-400' : ''}`}>
                <button className="text-left w-full" onClick={() => setJobId(jobId === j.id ? '' : j.id)}>
                  <div className="font-semibold">{j.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {j.department}
                    {j.location ? ` · ${j.location}` : ''} · {j._count?.applications ?? 0} applicant(s)
                  </div>
                </button>
                <div className="flex justify-between items-center mt-2">
                  <Badge variant="outline" className={j.status === 'OPEN' ? 'text-emerald-600' : 'text-slate-500'}>
                    {j.status}
                  </Badge>
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => toggleJob.mutate(j)}>
                      {j.status === 'OPEN' ? 'Close' : 'Reopen'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!jobs.isLoading && !jobs.data?.length && <div className="text-muted-foreground text-sm">No jobs yet.</div>}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white/50 backdrop-blur-xl overflow-hidden">
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Candidates</CardTitle>
            <CardDescription>AI scores are advisory — they never reject anyone automatically.</CardDescription>
          </div>
          <select className="h-9 rounded-md border bg-white/70 px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All stages</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow>
                <TableHead className="pl-6">Candidate</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>AI match</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.data?.items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="pl-6">
                    <div className="font-medium">{a.candidateName}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.candidateEmail} · applied {fmtDate(a.createdAt)}
                    </div>
                    {a.interviewAt && <div className="text-xs text-indigo-600">Interview {new Date(a.interviewAt).toLocaleString()}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{a.job.title}</TableCell>
                  <TableCell className="max-w-[260px]">
                    {a.aiScore != null ? (
                      <div title={a.aiReason ?? ''}>
                        <Badge variant="outline" className={a.aiScore >= 75 ? 'text-emerald-600' : a.aiScore >= 50 ? 'text-amber-600' : 'text-red-600'}>
                          <Sparkles size={12} className="mr-1" /> {a.aiScore}
                        </Badge>
                        <div className="text-xs text-muted-foreground line-clamp-2">{a.aiReason}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{a.aiReason ?? 'Not screened'}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <select
                        className={`h-8 rounded-md border px-2 text-xs ${statusColor[a.status] ?? ''}`}
                        value={a.status}
                        onChange={(e) => window.confirm(`Move ${a.candidateName} to ${e.target.value}? The candidate will be emailed.`) && setAppStatus.mutate({ id: a.id, status: e.target.value })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <Badge className={statusColor[a.status]}>{a.status}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-6 text-right space-x-1">
                    {a.resumeFilename && (
                      <Button variant="ghost" size="sm" onClick={() => downloadFile(`/hiring/applications/${a.id}/resume`, a.resumeFilename!).catch(onError)}>
                        <Download size={14} />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setScheduling(a)} disabled={['HIRED', 'REJECTED'].includes(a.status)}>
                      <CalendarPlus size={14} className="mr-1" /> Interview
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!applications.isLoading && !applications.data?.items.length && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No candidates yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!scheduling} onOpenChange={(open) => !open && setScheduling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule interview — {scheduling?.candidateName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Date & time (your local time)</Label>
              <Input type="datetime-local" value={interview.startsAt} onChange={(e) => setInterview((s) => ({ ...s, startsAt: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Duration (minutes)</Label>
              <Input type="number" min={15} max={480} value={interview.durationMinutes} onChange={(e) => setInterview((s) => ({ ...s, durationMinutes: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1">
              <Label>Location or video link</Label>
              <Input placeholder="https://meet.google.com/…" value={interview.location} onChange={(e) => setInterview((s) => ({ ...s, location: e.target.value }))} />
            </div>
            <p className="text-xs text-muted-foreground">You are the interviewer. The candidate and you receive an email with an “Add to calendar” link.</p>
            <Button className="w-full" disabled={!interview.startsAt || schedule.isPending} onClick={() => schedule.mutate()}>
              Send invitations
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
