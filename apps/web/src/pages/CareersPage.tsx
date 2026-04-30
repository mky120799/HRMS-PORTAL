import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Briefcase, Send, CheckCircle } from 'lucide-react';
import { useToast } from '../lib/toast';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';

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

  const jobsQuery = useQuery({
    queryKey: ['public_jobs'],
    queryFn: async () => (await api.get('/hiring/public/jobs')).data as PublicJob[],
  });

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<ApplyForm>({
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
      showToast('Application submitted successfully! 🚀');
    },
    onError: (e) => showToast(getErrorMessage(e), 'error'),
  });

  const jobs = jobsQuery.data ?? [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-offset)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'white', padding: '20px 40px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Briefcase size={24} color="var(--primary)" />
        <h1 style={{ margin: 0, fontSize: 20 }}>Career Portal</h1>
      </header>

      <main style={{ flex: 1, padding: 40, maxWidth: 1000, margin: '0 auto', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontSize: 32, marginBottom: 10 }}>Join Our Team</h2>
          <p className="muted">Browse our open positions and discover your next great opportunity.</p>
        </div>

        {jobsQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }} className="muted">Loading opportunities...</div>
        ) : jobs.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 60 }}>
            <Briefcase size={32} color="var(--text-muted)" style={{ marginBottom: 12 }} />
            <h3>No open positions right now</h3>
            <p className="muted">Check back later for new opportunities.</p>
          </div>
        ) : (
          <div className="grid-2">
            {jobs.map(job => (
              <div key={job.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, marginBottom: 4 }}>{job.tenant?.name || 'Company'}</div>
                  <h3 style={{ margin: '0 0 8px 0' }}>{job.title}</h3>
                  <div style={{ fontSize: 12, background: 'rgba(0,0,0,0.05)', display: 'inline-block', padding: '2px 8px', borderRadius: 4, marginBottom: 12 }}>
                    {job.department}
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 20 }}>
                    {job.description || 'No description provided.'}
                  </p>
                </div>
                <button 
                  onClick={() => { setSelectedJob(job); setApplied(false); }}
                  style={{ width: '100%', background: 'var(--primary)', color: 'white' }}
                >
                  Apply Now
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Application Modal */}
      {selectedJob && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 20, zIndex: 100
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 500, position: 'relative', overflow: 'hidden' }}>
            <button 
              onClick={() => setSelectedJob(null)}
              style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', padding: 4 }}
            >
              Close
            </button>
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>Apply for {selectedJob.title}</h2>
            <p className="muted" style={{ marginBottom: 24, fontSize: 14 }}>{selectedJob.tenant?.name || 'Company'} • {selectedJob.department}</p>

            {applied ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px' }} />
                <h3>Application Received!</h3>
                <p className="muted">We've received your application and will be in touch soon.</p>
                <button onClick={() => setSelectedJob(null)} style={{ marginTop: 24 }}>Close</button>
              </div>
            ) : (
              <form onSubmit={handleSubmit((v) => applyMutation.mutate(v))} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label>Full Name</label>
                  <input placeholder="John Doe" {...register('candidateName')} />
                  {errors.candidateName && <p className="error-text">{errors.candidateName.message}</p>}
                </div>
                <div>
                  <label>Email Address</label>
                  <input type="email" placeholder="john@example.com" {...register('candidateEmail')} />
                  {errors.candidateEmail && <p className="error-text">{errors.candidateEmail.message}</p>}
                </div>
                <div>
                  <label>Resume (PDF/DOC)</label>
                  <input type="file" accept=".pdf,.doc,.docx,.png,.jpg" {...register('resume')} style={{ padding: '8px 0' }} />
                  {errors.resume && <p className="error-text">{errors.resume.message as string}</p>}
                </div>
                <button type="submit" disabled={applyMutation.isPending || isSubmitting} style={{ marginTop: 8 }}>
                  <Send size={16} />
                  {applyMutation.isPending ? 'Submitting...' : 'Submit Application'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
