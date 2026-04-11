import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { UserPlus, Building2, Mail, Lock, User } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { setAuth } from '../lib/auth';
import { useToast } from '../lib/toast';

const schema = z.object({
  tenantName: z.string().min(2, 'Company name is too short'),
  name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormData = z.infer<typeof schema>;

export function SignupPage() {
  const nav = useNavigate();
  const { showToast } = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormData) => {
    try {
      const res = await api.post('/auth/signup', values);
      setAuth(res.data);
      showToast('Account created successfully');
      nav('/');
    } catch (error: unknown) {
      showToast(getErrorMessage(error), 'error');
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', padding: 12, background: 'rgba(192, 132, 252, 0.2)', borderRadius: 12, marginBottom: 16 }}>
            <UserPlus size={32} color="#c084fc" />
          </div>
          <h2 style={{ marginBottom: 8 }}>Create Your Portal</h2>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Set up your company space in seconds</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div style={{ marginBottom: 20 }}>
            <label><Building2 size={14} style={{ marginRight: 6 }} /> Company Name</label>
            <input placeholder="Acme Inc." {...register('tenantName')} />
            {errors.tenantName && <p>{errors.tenantName.message}</p>}
          </div>

          <div style={{ marginBottom: 20 }}>
            <label><User size={14} style={{ marginRight: 6 }} /> Your Full Name</label>
            <input placeholder="John Doe" {...register('name')} />
            {errors.name && <p>{errors.name.message}</p>}
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

          <button style={{ width: '100%', padding: 12, fontSize: 16, background: 'linear-gradient(to right, #6366f1, #c084fc)' }} disabled={isSubmitting}>
            {isSubmitting ? 'Creating account...' : 'Get Started'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14 }}>
            <span style={{ color: '#94a3b8' }}>Already have a portal? </span>
            <Link to="/login" style={{ fontWeight: 600 }}>Sign in</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
