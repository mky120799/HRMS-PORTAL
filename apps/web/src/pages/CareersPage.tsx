import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Briefcase, Send, CheckCircle, Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '../lib/toast';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';

type PublicJob = {
  id: string;
  title: string;
  department: string;
  description: string | null;
  tenant: { name: string };
};

const applySchema = z.object({
  candidateName: z.string().min(2, 'Name is too short'),
  candidateEmail: z.string().email('Invalid email address'),
  resume: z.any().refine((files) => files?.length === 1, 'Resume is required'),
});

type ApplyForm = z.infer<typeof applySchema>;

export function CareersPage() {
  const { showToast } = useToast();
  const [selectedJob, setSelectedJob] = useState<PublicJob | null>(null);
  const [applied, setApplied] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsedData, setParsedData] = useState<{ skills: string[]; experienceYears: number; summary: string } | null>(null);

  const jobsQuery = useQuery({
    queryKey: ['public_jobs'],
    queryFn: async () => (await api.get('/hiring/public/jobs')).data as PublicJob[],
  });

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, setValue, watch } = useForm<ApplyForm>({
    resolver: zodResolver(applySchema),
  });

  const applyMutation = useMutation({
    mutationFn: async (data: ApplyForm) => {
      if (!selectedJob) throw new Error('No job selected');
      const formData = new FormData();
      formData.append('jobId', selectedJob.id);
      formData.append('candidateName', data.candidateName);
      formData.append('candidateEmail', data.candidateEmail);
      formData.append('resume', data.resume[0]);
      return api.post('/hiring/applications', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      setApplied(true);
      reset();
      setParsedData(null);
      showToast('Application submitted successfully! 🚀', 'success');
    },
    onError: (e) => showToast(getErrorMessage(e), 'error'),
  });

  /**
   * When a file is chosen, upload it to /ai/parse-resume and auto-fill the form.
   */
  const handleResumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);
    setParsedData(null);

    try {
      const formData = new FormData();
      formData.append('resume', file);
      const res = await api.post('/ai/parse-resume', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const data = res.data?.data ?? res.data;

      // Auto-fill form fields
      if (data.name) setValue('candidateName', data.name, { shouldValidate: true });
      if (data.email) setValue('candidateEmail', data.email, { shouldValidate: true });

      // Store extra context to display
      if (data.skills?.length || data.experienceYears || data.summary) {
        setParsedData({ skills: data.skills ?? [], experienceYears: data.experienceYears ?? 0, summary: data.summary ?? '' });
        showToast('✨ Resume parsed! Fields auto-filled.', 'success');
      }
    } catch {
      // Non-fatal — just silently skip auto-fill
    } finally {
      setParsing(false);
    }
  };

  const jobs = jobsQuery.data ?? [];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-border/40 py-5 px-8 flex items-center gap-3 shadow-sm sticky top-0 z-10">
        <div className="bg-indigo-500/10 p-2 rounded-lg">
          <Briefcase size={24} className="text-indigo-600" />
        </div>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
          Career Portal
        </h1>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto p-8 lg:p-12">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-extrabold tracking-tight mb-4 text-slate-900">Join Our Team</h2>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Browse our open positions and discover your next great opportunity to build the future with us.
          </p>
        </div>

        {jobsQuery.isLoading ? (
          <div className="text-center p-12 text-muted-foreground animate-pulse">Loading opportunities...</div>
        ) : jobs.length === 0 ? (
          <Card className="text-center p-16 bg-white/50 border-dashed border-2">
            <Briefcase size={48} className="mx-auto mb-4 text-slate-300" />
            <h3 className="text-xl font-semibold mb-2">No open positions right now</h3>
            <p className="text-muted-foreground">Check back later for new opportunities.</p>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {jobs.map(job => (
              <Card key={job.id} className="flex flex-col hover:shadow-lg transition-all duration-300 hover:-translate-y-1 bg-white border-slate-200">
                <CardHeader>
                  <div className="text-indigo-600 font-semibold text-sm mb-2">{job.tenant?.name || 'Company'}</div>
                  <CardTitle className="text-xl">{job.title}</CardTitle>
                  <div className="mt-2">
                    <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200">{job.department}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <p className="text-slate-500 text-sm leading-relaxed mb-6 flex-1">
                    {job.description || 'No description provided.'}
                  </p>
                  <Button
                    onClick={() => { setSelectedJob(job); setApplied(false); setParsedData(null); reset(); }}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    Apply Now
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <DialogContent className="sm:max-w-[460px]">
          {applied ? (
            <div className="text-center py-10 px-4">
              <CheckCircle size={56} className="text-emerald-500 mx-auto mb-4" />
              <DialogTitle className="text-2xl mb-2">Application Received!</DialogTitle>
              <DialogDescription className="text-base mb-8">
                We've received your application and our AI has already started reviewing it. We'll be in touch soon.
              </DialogDescription>
              <Button onClick={() => setSelectedJob(null)} variant="outline" className="w-full">
                Close
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Apply for {selectedJob?.title}</DialogTitle>
                <DialogDescription>
                  {selectedJob?.tenant?.name || 'Company'} • {selectedJob?.department}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit((v) => applyMutation.mutate(v))} className="space-y-4 pt-2">
                {/* Resume First — triggers auto-fill */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Resume (PDF/DOC)
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      <Sparkles size={11} /> AI Auto-Fill
                    </span>
                  </Label>
                  <Input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    {...register('resume')}
                    onChange={(e) => {
                      register('resume').onChange(e); // keep react-hook-form in sync
                      handleResumeChange(e);
                    }}
                    className="cursor-pointer file:text-indigo-600 file:bg-indigo-50 file:border-0 file:mr-4 file:py-1 file:px-3 file:rounded-full file:text-xs file:font-semibold"
                  />
                  {errors.resume && <p className="text-red-500 text-xs">{errors.resume.message as string}</p>}
                  {parsing && (
                    <div className="flex items-center gap-2 text-xs text-indigo-600 animate-pulse">
                      <Loader2 size={12} className="animate-spin" /> Parsing resume with Gemini AI...
                    </div>
                  )}
                </div>

                {/* AI-parsed skills preview */}
                {parsedData && (
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-xs space-y-2">
                    <div className="flex items-center gap-1.5 font-semibold text-indigo-700">
                      <Sparkles size={12} /> AI Resume Insights
                    </div>
                    {parsedData.summary && (
                      <p className="text-slate-600 italic">"{parsedData.summary}"</p>
                    )}
                    {parsedData.experienceYears > 0 && (
                      <p className="text-slate-600"><strong>{parsedData.experienceYears}</strong> years of experience detected</p>
                    )}
                    {parsedData.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {parsedData.skills.slice(0, 8).map((skill) => (
                          <span key={skill} className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">{skill}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input placeholder="John Doe" {...register('candidateName')} />
                  {errors.candidateName && <p className="text-red-500 text-xs">{errors.candidateName.message}</p>}
                </div>

                <div className="space-y-2 pb-2">
                  <Label>Email Address</Label>
                  <Input type="email" placeholder="john@example.com" {...register('candidateEmail')} />
                  {errors.candidateEmail && <p className="text-red-500 text-xs">{errors.candidateEmail.message}</p>}
                </div>

                <Button type="submit" disabled={applyMutation.isPending || isSubmitting || parsing} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                  <Send size={16} className="mr-2" />
                  {applyMutation.isPending ? 'Submitting...' : 'Submit Application'}
                </Button>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
