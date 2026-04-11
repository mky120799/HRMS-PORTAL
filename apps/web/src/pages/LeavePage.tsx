import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Calendar, Clock, CheckCircle, XCircle, FileText, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';

type LeaveRequest = {
  _id?: string;
  id?: string;
  employeeId: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  reason?: string;
};

const schema = z.object({
  employeeId: z.string().min(1, 'Employee reference is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  type: z.string().optional(),
  reason: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function LeavePage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const list = useQuery({ queryKey: ['leave'], queryFn: async () => (await api.get('/leave-requests')).data as LeaveRequest[] });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) });

  const create = useMutation({
    mutationFn: async (body: FormData) => api.post('/leave-requests', body),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ['leave'] });
      showToast('Leave request submitted for approval');
    },
    onError: (error) => showToast(getErrorMessage(error), 'error'),
  });

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'APPROVED': return { bg: 'rgba(16, 185, 129, 0.1)', color: '#10b981', icon: <CheckCircle size={14} /> };
      case 'REJECTED': return { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', icon: <XCircle size={14} /> };
      default: return { bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', icon: <Clock size={14} /> };
    }
  };

  return (
    <div className="leave-page">
      <div className="topbar">
        <h2>Leave Management</h2>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: 'minmax(300px, 1fr) 2fr' }}>
        <div className="card">
          <h2>Request Leave</h2>
          <form onSubmit={handleSubmit((v) => create.mutate(v))}>
            <div style={{ marginBottom: 16 }}>
              <label>Employee ID</label>
              <input placeholder="Employee identifier" {...register('employeeId')} />
              {errors.employeeId && <p>{errors.employeeId.message}</p>}
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <label>Leave Type</label>
              <select {...register('type')}>
                <option value="ANNUAL">Annual Leave</option>
                <option value="SICK">Sick Leave</option>
                <option value="MATERNITY">Maternity Leave</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div className="row gap" style={{ marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label>Start Date</label>
                <input type="date" {...register('startDate')} />
              </div>
              <div style={{ flex: 1 }}>
                <label>End Date</label>
                <input type="date" {...register('endDate')} />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label>Reason (Optional)</label>
              <textarea placeholder="Tell us more..." {...register('reason')} style={{ minHeight: 80 }} />
            </div>

            <button style={{ width: '100%' }} disabled={create.isPending}>
              <Plus size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Submit Request
            </button>
          </form>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '24px 24px 0' }}>
            <h2>Request History</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.map((r) => {
                  const style = getStatusStyle(r.status);
                  return (
                    <tr key={r._id ?? r.id}>
                      <td style={{ fontWeight: 500 }}>{r.employeeId}</td>
                      <td>{r.type}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                        <div className="row gap" style={{ gap: 4 }}>
                          <Calendar size={12} />
                          {new Date(r.startDate).toLocaleDateString()} - {new Date(r.endDate).toLocaleDateString()}
                        </div>
                      </td>
                      <td>
                        <div style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          gap: 6, 
                          padding: '4px 10px', 
                          borderRadius: 20, 
                          fontSize: 12, 
                          fontWeight: 600,
                          background: style.bg,
                          color: style.color
                        }}>
                          {style.icon}
                          {r.status}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {list.isLoading && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 40 }}>Loading history...</td></tr>
                )}
                {!list.isLoading && (list.data?.length ?? 0) === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 40 }}>No requests found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
