import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Briefcase, MapPin, CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

type Job = { id: string; title: string; department: string; location: string | null; description: string; createdAt: string };

/** Public, unauthenticated careers page for one company: /careers/:slug */
export function CareersPage() {
  const { slug = '' } = useParams();
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [form, setForm] = useState({ candidateName: '', candidateEmail: '', consent: false });
  const [file, setFile] = useState<File | null>(null);
  const [done, setDone] = useState(false);

  const careers = useQuery({
    queryKey: ['careers', slug],
    queryFn: async () => (await api.get<{ company: string; jobs: Job[] }>(`/careers/${encodeURIComponent(slug)}`)).data,
    retry: false,
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Attach your resume (PDF or DOCX)');
      if (file.size > 5 * 1024 * 1024) throw new Error('Resume must be 5 MB or smaller');
      const data = new FormData();
      data.append('candidateName', form.candidateName);
      data.append('candidateEmail', form.candidateEmail);
      data.append('consent', String(form.consent));
      data.append('resume', file); // file last: the server reads text fields first
      return api.post(`/careers/${encodeURIComponent(slug)}/jobs/${openJob!.id}/apply`, data);
    },
    onSuccess: () => setDone(true),
  });

  if (careers.isLoading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin" /></div>;
  }
  if (careers.isError) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">This careers page does not exist.</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-14 px-6 text-center">
        <h1 className="text-4xl font-bold">Careers at {careers.data?.company}</h1>
        <p className="mt-2 text-indigo-100">{careers.data?.jobs.length} open position(s)</p>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-4">
        {careers.data?.jobs.map((job) => (
          <Card key={job.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase size={18} /> {job.title}
              </CardTitle>
              <CardDescription className="flex items-center gap-3">
                <span>{job.department}</span>
                {job.location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={14} /> {job.location}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm text-slate-700">{job.description}</p>
              {openJob?.id === job.id ? (
                done ? (
                  <div className="mt-4 flex items-center gap-2 text-emerald-600">
                    <CheckCircle2 size={18} /> Application received — check your email for a confirmation.
                  </div>
                ) : (
                  <form
                    className="mt-4 space-y-3 border-t pt-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      apply.mutate();
                    }}
                  >
                    <div className="grid md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Full name</Label>
                        <Input required value={form.candidateName} onChange={(e) => setForm((f) => ({ ...f, candidateName: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label>Email</Label>
                        <Input required type="email" value={form.candidateEmail} onChange={(e) => setForm((f) => ({ ...f, candidateEmail: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Resume (PDF or DOCX, max 5 MB)</Label>
                      <Input
                        required
                        type="file"
                        accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                    <label className="flex items-start gap-2 text-xs text-slate-600">
                      <input type="checkbox" required checked={form.consent} onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))} />
                      I agree that {careers.data?.company} may store and process my application data, including automated screening assistance, for recruitment
                      purposes. I can ask for my data to be deleted at any time.
                    </label>
                    {apply.isError && <p className="text-red-600 text-sm">{getErrorMessage(apply.error)}</p>}
                    <Button type="submit" disabled={apply.isPending}>
                      {apply.isPending ? 'Submitting…' : 'Submit application'}
                    </Button>
                  </form>
                )
              ) : (
                <Button
                  className="mt-4"
                  onClick={() => {
                    setOpenJob(job);
                    setDone(false);
                  }}
                >
                  Apply
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
        {careers.data?.jobs.length === 0 && <div className="text-center text-muted-foreground py-12">No open positions right now.</div>}
      </main>
    </div>
  );
}
