import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Mail, Building2, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { getErrorMessage } from '../lib/errors';

const requestSchema = z.object({
  tenantId: z.string().min(1, 'Tenant ID is required'),
  email: z.string().email(),
});

const resetSchema = z.object({
  password: z.string().min(8, 'Minimum 8 characters required'),
});

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const nav = useNavigate();
  const { showToast } = useToast();
  const [successMsg, setSuccessMsg] = useState('');

  const reqForm = useForm<z.infer<typeof requestSchema>>({ resolver: zodResolver(requestSchema) });
  const resetForm = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });

  const onRequest = async (values: z.infer<typeof requestSchema>) => {
    try {
      const res = await api.post('/auth/reset-password-request', values);
      setSuccessMsg(res.data.message);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  const onReset = async (values: z.infer<typeof resetSchema>) => {
    try {
      await api.post('/auth/reset-password', { token, password: values.password });
      showToast('Password updated! You can now log in.');
      nav('/login');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', padding: 12, background: 'rgba(99, 102, 241, 0.2)', borderRadius: 12, marginBottom: 16 }}>
            <KeyRound size={32} color="#818cf8" />
          </div>
          <h2 style={{ marginBottom: 8 }}>{token ? 'Set New Password' : 'Reset Password'}</h2>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>
            {token ? 'Type your new secure password below.' : 'Enter your details to receive a reset link.'}
          </p>
        </div>

        {successMsg && !token ? (
          <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: 16, borderRadius: 8, color: '#10b981', textAlign: 'center', marginBottom: 20 }}>
            {successMsg}
          </div>
        ) : !token ? (
          <form onSubmit={reqForm.handleSubmit(onRequest)}>
            <div style={{ marginBottom: 20 }}>
              <label><Building2 size={14} style={{ marginRight: 6 }} /> Tenant ID</label>
              <input placeholder="UUID" {...reqForm.register('tenantId')} />
              {reqForm.formState.errors.tenantId && <p>{reqForm.formState.errors.tenantId.message}</p>}
            </div>
            <div style={{ marginBottom: 24 }}>
              <label><Mail size={14} style={{ marginRight: 6 }} /> Email</label>
              <input type="email" placeholder="name@company.com" {...reqForm.register('email')} />
              {reqForm.formState.errors.email && <p>{reqForm.formState.errors.email.message}</p>}
            </div>
            <button style={{ width: '100%', padding: 12 }} disabled={reqForm.formState.isSubmitting}>
              {reqForm.formState.isSubmitting ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        ) : (
          <form onSubmit={resetForm.handleSubmit(onReset)}>
            <div style={{ marginBottom: 24 }}>
              <label><Lock size={14} style={{ marginRight: 6 }} /> New Password</label>
              <input type="password" placeholder="••••••••" {...resetForm.register('password')} />
              {resetForm.formState.errors.password && <p>{resetForm.formState.errors.password.message}</p>}
            </div>
            <button style={{ width: '100%', padding: 12 }} disabled={resetForm.formState.isSubmitting}>
              {resetForm.formState.isSubmitting ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14 }}>
          <Link to="/login" style={{ color: '#94a3b8', textDecoration: 'none' }}>Back to Login</Link>
        </div>
      </div>
    </div>
  );
}
