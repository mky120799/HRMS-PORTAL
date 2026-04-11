import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { LogIn, Building2, Mail, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { setAuth } from '../lib/auth';
import { useToast } from '../lib/toast';

const schema = z.object({
  tenantId: z.string().min(1, 'Tenant ID or Slug is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const nav = useNavigate();
  const { showToast } = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormData) => {
    try {
      const res = await api.post('/auth/login', values);
      setAuth(res.data);
      showToast('Welcome back');
      nav('/');
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      if (msg === 'Invalid credentials') {
        showToast('Login failed. Please double-check your Tenant ID and Admin Email.', 'error');
      } else {
        showToast(msg, 'error');
      }
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', padding: 12, background: 'rgba(99, 102, 241, 0.2)', borderRadius: 12, marginBottom: 16 }}>
            <LogIn size={32} color="#818cf8" />
          </div>
          <h2 style={{ marginBottom: 8 }}>Welcome Back</h2>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Enter your credentials to access your portal</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div style={{ marginBottom: 20 }}>
            <label><Building2 size={14} style={{ marginRight: 6 }} /> Tenant ID / Slug</label>
            <input placeholder="e.g. acme-corp or UUID" {...register('tenantId')} />
            {errors.tenantId && <p>{errors.tenantId.message}</p>}
          </div>

          <div style={{ marginBottom: 20 }}>
            <label><Mail size={14} style={{ marginRight: 6 }} /> Email Address</label>
            <input type="email" placeholder="name@company.com" {...register('email')} />
            {errors.email && <p>{errors.email.message}</p>}
          </div>

          <div style={{ marginBottom: 24 }}>
            <label><Lock size={14} style={{ marginRight: 6 }} /> Password</label>
            <input type="password" placeholder="••••••••" {...register('password')} />
            {errors.password && <p>{errors.password.message}</p>}
          </div>

          <button style={{ width: '100%', padding: 12, fontSize: 16 }} disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14 }}>
            <span style={{ color: '#94a3b8' }}>Don't have a portal? </span>
            <Link to="/signup" style={{ fontWeight: 600 }}>Create one</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
