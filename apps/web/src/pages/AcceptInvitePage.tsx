import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, PartyPopper } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { getErrorMessage } from '../lib/errors';

const schema = z.object({
  password: z.string().min(8, 'Minimum 8 characters required'),
});

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const nav = useNavigate();
  const { showToast } = useToast();

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: z.infer<typeof schema>) => {
    try {
      await api.post('/auth/accept-invite', { token, password: values.password });
      showToast('Account activated! You can now log in.', 'success');
      nav('/login');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="card" style={{ textAlign: 'center' }}>
          <h2>Invalid Link</h2>
          <p style={{ color: '#94a3b8', marginBottom: 24 }}>This invitation link is missing a security token.</p>
          <Link to="/login" style={{ color: '#818cf8', fontWeight: 600, textDecoration: 'none' }}>Go to Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', padding: 12, background: 'rgba(16, 185, 129, 0.2)', borderRadius: 12, marginBottom: 16 }}>
            <PartyPopper size={32} color="#10b981" />
          </div>
          <h2 style={{ marginBottom: 8 }}>Welcome Aboard!</h2>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>
            Set a secure password to activate your HRMS account.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div style={{ marginBottom: 24 }}>
            <label><Lock size={14} style={{ marginRight: 6 }} /> Password</label>
            <input type="password" placeholder="••••••••" {...register('password')} />
            {errors.password && <p>{errors.password.message}</p>}
          </div>
          <button style={{ width: '100%', padding: 12, background: '#10b981', color: '#fff', border: 'none' }} disabled={isSubmitting}>
            {isSubmitting ? 'Activating...' : 'Activate Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
