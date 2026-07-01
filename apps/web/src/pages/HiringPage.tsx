import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState, useRef } from 'react';
import { z } from 'zod';
import { Plus, Briefcase, Users, FileText, Upload, Download, ChevronRight, X } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { getAuth } from '../lib/auth';

const jobSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  department: z.string().min(1, 'Department is required'),
  description: z.string().min(1, 'Description is required'),
});

type JobFormData = z.infer<typeof jobSchema>;

type Job = {
  id: string;
  title: string;
  department: string;
  description: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  _count?: { applications: number };
};

type Application = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  aiScore: number | null;
  resumeUrl: string | null;
  resumeFilename: string | null;
  createdAt: string;
  job: { id: string; title: string; department: string };
};

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'rgba(245,158,11,0.15)',
  INTERVIEW: 'rgba(99,102,241,0.15)',
  HIRED:     'rgba(16,185,129,0.15)',
  REJECTED:  'rgba(239,68,68,0.15)',
};

const STATUS_TEXT: Record<string, string> = {
  PENDING:   '#f59e0b',
  INTERVIEW: '#6366f1',
  HIRED:     '#10b981',
  REJECTED:  '#ef4444',
};

export function HiringPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const auth = getAuth();
  const isAdmin = auth?.user.role === 'ADMIN';

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyJobId, setApplyJobId] = useState<string | null>(null);
  const resumeRef = useRef<HTMLInputElement>(null);

  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => (await api.get('/hiring/jobs')).data as Job[],
  });

  const applications = useQuery({
    queryKey: ['applications', selectedJobId],
    queryFn: async () => {
      const qs = selectedJobId ? `?jobId=${selectedJobId}` : '';
      return (await api.get(`/hiring/applications${qs}`)).data as Application[];
    },
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<JobFormData>({
    resolver: zodResolver(jobSchema),
  });

  const createJob = useMutation({
    mutationFn: async (body: JobFormData) => api.post('/hiring/jobs', body),
    onSuccess: () => { reset(); qc.invalidateQueries({ queryKey: ['jobs'] }); showToast('Job posting created!'); },
    onError: (e) => showToast(getErrorMessage(e), 'error'),
  });

  const updateAppStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      api.patch(`/hiring/applications/${id}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['applications'] }); showToast('Status updated'); },
    onError: (e) => showToast(getErrorMessage(e), 'error'),
  });

  const toggleJob = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      api.patch(`/hiring/jobs/${id}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jobs'] }); showToast('Job status updated'); },
    onError: (e) => showToast(getErrorMessage(e), 'error'),
  });

  // File upload for application with resume
  const submitApplication = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (!applyJobId) return;
    fd.set('jobId', applyJobId);

    try {
      await fetch('/api/v1/hiring/applications', {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth?.accessToken}` },
        body: fd,
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
      });
      showToast('Application submitted successfully!');
      setShowApplyModal(false);
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    } catch (err: any) {
      showToast(err.message ?? 'Failed to submit application', 'error');
    }
  };

  const selectedJob = jobs.data?.find((j) => j.id === selectedJobId);

  return (
    <div>
      <div className="topbar">
        <h2>Recruitment & Hiring</h2>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: isAdmin ? '1fr 2fr' : '1fr' }}>
        {/* ── Left: Job Postings ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Create Job Form (Admin only) */}
          {isAdmin && (
            <div className="card">
              <div className="row gap" style={{ marginBottom: 16 }}>
                <Briefcase size={20} color="var(--primary)" />
                <h3 style={{ margin: 0 }}>Post New Job</h3>
              </div>
              <form onSubmit={handleSubmit((v) => createJob.mutate(v))}>
                <div style={{ marginBottom: 12 }}>
                  <label>Job Title</label>
                  <input placeholder="e.g. Senior Engineer" {...register('title')} />
                  {errors.title && <p className="error-text">{errors.title.message}</p>}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label>Department</label>
                  <input placeholder="e.g. Engineering" {...register('department')} />
                  {errors.department && <p className="error-text">{errors.department.message}</p>}
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label>Description</label>
                  <textarea rows={3} placeholder="Role details and requirements..." {...register('description')}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, resize: 'vertical' }} />
                  {errors.description && <p className="error-text">{errors.description.message}</p>}
                </div>
                <button style={{ width: '100%' }} disabled={createJob.isPending}>
                  <Plus size={16} style={{ marginRight: 6 }} />
                  {createJob.isPending ? 'Posting...' : 'Post Job'}
                </button>
              </form>
            </div>
          )}

          {/* Job List */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>Open Positions</h3>
                <span className="muted" style={{ fontSize: 13 }}>{jobs.data?.filter(j => j.status === 'OPEN').length ?? 0} active</span>
              </div>
            </div>
            {jobs.isLoading && <p className="muted p-4">Loading...</p>}
            {jobs.data?.map((j) => (
              <div key={j.id}
                onClick={() => setSelectedJobId(j.id === selectedJobId ? null : j.id)}
                style={{
                  padding: '16px 20px',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(0,0,0,0.04)',
                  background: selectedJobId === j.id ? 'rgba(99,102,241,0.05)' : 'transparent',
                  transition: 'background 0.2s',
                }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{j.title}</span>
                  <div className="row gap" style={{ gap: 8 }}>
                    <span style={{
                      background: j.status === 'OPEN' ? 'rgba(16,185,129,0.1)' : 'rgba(0,0,0,0.05)',
                      color: j.status === 'OPEN' ? '#10b981' : 'var(--text-muted)',
                      fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                    }}>{j.status}</span>
                    <ChevronRight size={16} color="var(--text-muted)" />
                  </div>
                </div>
                <div className="row gap" style={{ gap: 12 }}>
                  <span className="muted" style={{ fontSize: 12 }}>{j.department}</span>
                  <span className="muted" style={{ fontSize: 12 }}>· {j._count?.applications ?? 0} applicants</span>
                </div>

                {/* Inline actions for selected job */}
                {selectedJobId === j.id && isAdmin && (
                  <div className="row gap" style={{ marginTop: 10, gap: 8 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      style={{ fontSize: 12, padding: '4px 12px', background: j.status === 'OPEN' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: j.status === 'OPEN' ? '#ef4444' : '#10b981' }}
                      onClick={() => toggleJob.mutate({ id: j.id, status: j.status === 'OPEN' ? 'CLOSED' : 'OPEN' })}>
                      {j.status === 'OPEN' ? 'Close Job' : 'Reopen Job'}
                    </button>
                    <button
                      style={{ fontSize: 12, padding: '4px 12px', background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}
                      onClick={() => { setApplyJobId(j.id); setShowApplyModal(true); }}>
                      Add Application
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!jobs.isLoading && (jobs.data?.length ?? 0) === 0 && (
              <p className="muted" style={{ textAlign: 'center', padding: 24 }}>No jobs posted yet.</p>
            )}
          </div>
        </div>

        {/* ── Right: Applications Panel ── */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{selectedJob ? `Applications — ${selectedJob.title}` : 'All Applications'}</h3>
              <div className="row gap" style={{ gap: 8 }}>
                {selectedJobId && <button style={{ fontSize: 12, padding: '4px 12px', background: 'rgba(0,0,0,0.05)', color: 'var(--text-muted)' }} onClick={() => setSelectedJobId(null)}>Show All</button>}
                <button style={{ fontSize: 12, padding: '4px 12px', background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}
                  onClick={() => { setApplyJobId(selectedJobId ?? null); setShowApplyModal(true); }}>
                  <Plus size={14} style={{ marginRight: 4 }} /> New Application
                </button>
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Position</th>
                  <th>Status</th>
                  <th>AI Match</th>
                  <th>Resume</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {applications.data?.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{a.candidateName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.candidateEmail}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>{a.job.title}</td>
                    <td>
                      <span style={{ background: STATUS_COLORS[a.status] ?? 'rgba(0,0,0,0.05)', color: STATUS_TEXT[a.status] ?? 'var(--text-muted)', padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                        {a.status}
                      </span>
                    </td>
                    <td>
                      {a.aiScore != null ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: a.aiScore >= 80 ? 'rgba(16,185,129,0.1)' : a.aiScore >= 50 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: a.aiScore >= 80 ? '#10b981' : a.aiScore >= 50 ? '#f59e0b' : '#ef4444' }}>
                           {a.aiScore >= 80 ? '⭐ ' : ''}{a.aiScore}%
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>Pending...</span>
                      )}
                    </td>
                    <td>
                      {a.resumeUrl ? (
                        <a href={`/api/v1/hiring/uploads${a.resumeUrl.replace('/uploads', '')}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--primary)', fontSize: 13, textDecoration: 'none' }}>
                          <Download size={14} /> {a.resumeFilename ?? 'Resume'}
                        </a>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>No file</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td>
                        <select
                          value={a.status}
                          onChange={(e) => updateAppStatus.mutate({ id: a.id, status: e.target.value })}
                          style={{ fontSize: 12, padding: '4px 8px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6, cursor: 'pointer', background: 'white' }}>
                          <option value="PENDING">PENDING</option>
                          <option value="INTERVIEW">INTERVIEW</option>
                          <option value="HIRED">HIRED</option>
                          <option value="REJECTED">REJECTED</option>
                        </select>
                      </td>
                    )}
                  </tr>
                ))}
                {applications.isLoading && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>Loading...</td></tr>}
                {!applications.isLoading && (applications.data?.length ?? 0) === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>No applications yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Apply / New Application Modal ── */}
      {showApplyModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '100%', maxWidth: 480, position: 'relative' }}>
            <button onClick={() => setShowApplyModal(false)} style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', padding: 4 }}>
              <X size={20} />
            </button>
            <div className="row gap" style={{ marginBottom: 20 }}>
              <FileText size={20} color="var(--primary)" />
              <h3 style={{ margin: 0 }}>Submit Application</h3>
            </div>
            <form onSubmit={submitApplication}>
              {!applyJobId && (
                <div style={{ marginBottom: 14 }}>
                  <label>Select Job</label>
                  <select name="jobId" required style={{ width: '100%', padding: '8px 12px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8 }}>
                    <option value="">-- Choose a position --</option>
                    {jobs.data?.filter(j => j.status === 'OPEN').map(j => (
                      <option key={j.id} value={j.id}>{j.title} ({j.department})</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ marginBottom: 14 }}>
                <label>Candidate Name</label>
                <input name="candidateName" placeholder="Full name" required />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label>Candidate Email</label>
                <input name="candidateEmail" type="email" placeholder="name@example.com" required />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label>Resume / Documents</label>
                <div style={{ border: '2px dashed rgba(99,102,241,0.3)', borderRadius: 10, padding: 20, textAlign: 'center', cursor: 'pointer', marginTop: 4 }}
                  onClick={() => resumeRef.current?.click()}>
                  <Upload size={24} color="var(--primary)" style={{ margin: '0 auto 8px' }} />
                  <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Click to upload resume/documents</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>PDF, DOC, DOCX, JPG, PNG · Max 10MB</div>
                  <input ref={resumeRef} name="resume" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }}
                    onChange={(e) => { const name = e.target.files?.[0]?.name; if (name) (e.target.parentElement!.querySelector('div:first-of-type + div') as any).textContent = `📎 ${name}`; }} />
                </div>
              </div>
              <button type="submit" style={{ width: '100%' }}>Submit Application</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
