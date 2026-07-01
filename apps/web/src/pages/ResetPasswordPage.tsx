import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Mail, Building2, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { getErrorMessage } from '../lib/errors';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';

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
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-900 to-indigo-950 p-4">
      <Card className="w-full max-w-[440px] bg-white/5 border-white/10 text-white backdrop-blur-xl">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto mb-4 inline-flex p-3 bg-indigo-500/20 rounded-xl">
            <KeyRound size={32} className="text-indigo-400" />
          </div>
          <CardTitle className="text-2xl font-bold">{token ? 'Set New Password' : 'Reset Password'}</CardTitle>
          <CardDescription className="text-slate-400">
            {token ? 'Type your new secure password below.' : 'Enter your details to receive a reset link.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {successMsg && !token ? (
            <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg text-emerald-400 text-center mb-5 text-sm">
              {successMsg}
            </div>
          ) : !token ? (
            <form onSubmit={reqForm.handleSubmit(onRequest)} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Building2 size={14} /> Tenant ID
                </Label>
                <Input 
                  placeholder="UUID" 
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  {...reqForm.register('tenantId')} 
                />
                {reqForm.formState.errors.tenantId && <p className="text-red-400 text-xs">{reqForm.formState.errors.tenantId.message}</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Mail size={14} /> Email
                </Label>
                <Input 
                  type="email" 
                  placeholder="name@company.com" 
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  {...reqForm.register('email')} 
                />
                {reqForm.formState.errors.email && <p className="text-red-400 text-xs">{reqForm.formState.errors.email.message}</p>}
              </div>
              <Button 
                type="submit" 
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-6 text-base mt-2" 
                disabled={reqForm.formState.isSubmitting}
              >
                {reqForm.formState.isSubmitting ? 'Sending...' : 'Send Reset Link'}
              </Button>
            </form>
          ) : (
            <form onSubmit={resetForm.handleSubmit(onReset)} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Lock size={14} /> New Password
                </Label>
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  {...resetForm.register('password')} 
                />
                {resetForm.formState.errors.password && <p className="text-red-400 text-xs">{resetForm.formState.errors.password.message}</p>}
              </div>
              <Button 
                type="submit" 
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-6 text-base mt-2" 
                disabled={resetForm.formState.isSubmitting}
              >
                {resetForm.formState.isSubmitting ? 'Updating...' : 'Update Password'}
              </Button>
            </form>
          )}

          <div className="text-center mt-6 text-sm text-slate-400">
            <Link to="/login" className="hover:text-white transition-colors">
              Back to Login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
