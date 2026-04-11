import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Plus, Search, Briefcase, Users, FileText, ClipboardList } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';

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
};

type Application = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  job: Job;
};

export function HiringPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  
  const jobs = useQuery({ 
    queryKey: ['jobs'], 
    queryFn: async () => (await api.get('/hiring/jobs')).data as Job[] 
  });

  const applications = useQuery({ 
    queryKey: ['applications'], 
    queryFn: async () => (await api.get('/hiring/applications')).data as Application[] 
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<JobFormData>({ 
    resolver: zodResolver(jobSchema) 
  });

  const createJob = useMutation({
    mutationFn: async (body: JobFormData) => api.post('/hiring/jobs', body),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ['jobs'] });
      showToast('Job posting created successfully');
    },
    onError: (error) => showToast(getErrorMessage(error), 'error'),
  });

  return (
    <div className="hiring-page">
      <div className="topbar">
        <h2>Recruitment & Hiring</h2>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: '1fr 2fr' }}>
        <div className="card">
          <div className="row gap" style={{ marginBottom: 16 }}>
             <Briefcase size={20} color="var(--primary)" />
             <h3 style={{ margin: 0 }}>Create Job Posting</h3>
          </div>
          <form onSubmit={handleSubmit((v) => createJob.mutate(v))}>
            <div style={{ marginBottom: 16 }}>
              <label>Job Title</label>
              <input placeholder="Senior Software Engineer" {...register('title')} />
              {errors.title && <p className="error-text">{errors.title.message}</p>}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Department</label>
              <input placeholder="Engineering" {...register('department')} />
              {errors.department && <p className="error-text">{errors.department.message}</p>}
            </div>
            <div style={{ marginBottom: 20 }}>
              <label>Description</label>
              <textarea 
                placeholder="Describe the role and requirements..." 
                rows={4} 
                {...register('description')} 
                style={{ width: '100%', padding: '8px 12px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8 }}
              />
              {errors.description && <p className="error-text">{errors.description.message}</p>}
            </div>
            <button style={{ width: '100%' }} disabled={createJob.isPending}>
              {createJob.isPending ? 'Creating...' : 'Post Job'}
            </button>
          </form>
        </div>

        <div style={{ display: 'grid', gap: 24 }}>
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: 24, paddingBottom: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>Active Job Postings</h3>
                <span className="muted" style={{ fontSize: 13 }}>{jobs.data?.length ?? 0} total</span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.data?.map((j) => (
                    <tr key={j.id}>
                      <td style={{ fontWeight: 600 }}>{j.title}</td>
                      <td>{j.department}</td>
                      <td>
                        <span style={{ 
                          background: j.status === 'OPEN' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(0,0,0,0.05)', 
                          color: j.status === 'OPEN' ? '#10b981' : 'var(--text-muted)',
                          padding: '2px 8px', 
                          borderRadius: 4, 
                          fontSize: 12,
                          fontWeight: 600
                        }}>
                          {j.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {new Date(j.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                  {jobs.isLoading && <tr><td colSpan={4} className="text-center p-4 muted">Loading jobs...</td></tr>}
                  {!jobs.isLoading && (jobs.data?.length ?? 0) === 0 && <tr><td colSpan={4} className="text-center p-4 muted">No jobs posted yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
             <div style={{ padding: 24, paddingBottom: 0 }}>
               <h3 style={{ margin: 0 }}>Recent Applications</h3>
             </div>
             <div style={{ overflowX: 'auto' }}>
               <table>
                 <thead>
                   <tr>
                     <th>Candidate</th>
                     <th>Job Position</th>
                     <th>Status</th>
                   </tr>
                 </thead>
                 <tbody>
                   {applications.data?.map((a) => (
                     <tr key={a.id}>
                       <td>
                         <div style={{ fontWeight: 600 }}>{a.candidateName}</div>
                         <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.candidateEmail}</div>
                       </td>
                       <td>{a.job.title}</td>
                       <td>
                         <span style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 13 }}>
                           {a.status}
                         </span>
                       </td>
                     </tr>
                   ))}
                    {applications.isLoading && <tr><td colSpan={3} className="text-center p-4 muted">Loading applications...</td></tr>}
                    {!applications.isLoading && (applications.data?.length ?? 0) === 0 && <tr><td colSpan={3} className="text-center p-4 muted">No applications received yet.</td></tr>}
                 </tbody>
               </table>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
