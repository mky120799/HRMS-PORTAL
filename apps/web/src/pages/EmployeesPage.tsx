import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Plus, Search, Mail, User, Briefcase, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  department: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

type Employee = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  department?: string;
};

export function EmployeesPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const list = useQuery({ queryKey: ['employees'], queryFn: async () => (await api.get('/employees')).data as Employee[] });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) });

  const create = useMutation({
    mutationFn: async (body: FormData) => api.post('/employees', body),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ['employees'] });
      showToast('Employee added to the roster');
    },
    onError: (error) => showToast(getErrorMessage(error), 'error'),
  });

  return (
    <div className="employees-page">
      <div className="topbar">
        <h2>Employee Roster</h2>
        <div className="row gap">
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input placeholder="Search employees..." style={{ paddingLeft: 40, width: 300, background: 'white' }} />
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: '1fr 2fr' }}>
        <div className="card">
          <h2>Add New Employee</h2>
          <form onSubmit={handleSubmit((v) => create.mutate(v))}>
            <div style={{ marginBottom: 16 }}>
              <label>First Name</label>
              <input placeholder="John" {...register('firstName')} />
              {errors.firstName && <p>{errors.firstName.message}</p>}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Last Name</label>
              <input placeholder="Doe" {...register('lastName')} />
              {errors.lastName && <p>{errors.lastName.message}</p>}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Email Address</label>
              <input placeholder="john.doe@company.com" {...register('email')} />
              {errors.email && <p>{errors.email.message}</p>}
            </div>
            <div style={{ marginBottom: 20 }}>
              <label>Department</label>
              <input placeholder="Engineering" {...register('department')} />
            </div>
            <button style={{ width: '100%' }} disabled={create.isPending}>
              <Plus size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {create.isPending ? 'Adding...' : 'Add Employee'}
            </button>
          </form>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '24px 24px 0' }}>
            <h2>All Employees</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Email</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="row gap">
                        <div style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600 }}>
                          {e.firstName.charAt(0)}{e.lastName.charAt(0)}
                        </div>
                        <span style={{ fontWeight: 500 }}>{e.firstName} {e.lastName}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ background: 'rgba(0,0,0,0.05)', padding: '4px 8px', borderRadius: 4, fontSize: 13 }}>
                        {e.department ?? 'Unassigned'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 14 }}>{e.email}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button style={{ background: 'transparent', color: '#ef4444', padding: 4 }}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {list.isLoading && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 40 }}>Loading data...</td></tr>
                )}
                {!list.isLoading && (list.data?.length ?? 0) === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 40 }}>No employees found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
