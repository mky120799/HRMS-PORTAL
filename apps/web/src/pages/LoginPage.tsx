import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { LogIn, Building2, Mail, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { setAuth } from '../lib/auth';
import { useToast } from '../lib/toast';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';

const schema = z.object({
  tenantId: z.string().min(1, 'Tenant ID or Slug is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type FormData = z.infer<typeof schema>;

import { useState } from 'react';
export function LoginPage() {
  const nav = useNavigate();
  const { showToast } = useToast();
  
  const [isTwoFactorPending, setIsTwoFactorPending] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormData) => {
    try {
      const res = await api.post('/auth/login', values);
      
      if (res.data.twoFactorRequired) {
        setIsTwoFactorPending(true);
        setTempToken(res.data.tempToken);
        return;
      }
      
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

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/2fa/authenticate', {
        tempToken,
        code: totpCode,
      });
      setAuth(res.data);
      showToast('Welcome back');
      nav('/');
    } catch (error: unknown) {
      showToast('Invalid or expired 2FA code', 'error');
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-900 to-indigo-950 p-4">
      <Card className="w-full max-w-[440px] bg-white/5 border-white/10 text-white backdrop-blur-xl">
        <CardHeader className="text-center pb-8">
          <div className="mx-auto mb-4 inline-flex p-3 bg-indigo-500/20 rounded-xl">
            <LogIn size={32} className="text-indigo-400" />
          </div>
          <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
          <CardDescription className="text-slate-400">Enter your credentials to access your portal</CardDescription>
        </CardHeader>
        
        <CardContent>
          {isTwoFactorPending ? (
            <form onSubmit={handleTwoFactorSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Lock size={14} /> Authentication Code
                </Label>
                <Input 
                  placeholder="000000" 
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 font-mono text-center tracking-widest text-lg"
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-6 mt-2">
                Verify
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsTwoFactorPending(false)} className="w-full text-slate-400 mt-2">
                Back to Login
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Building2 size={14} /> Tenant ID / Slug
                </Label>
                <Input 
                  placeholder="e.g. acme-corp or UUID" 
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  {...register('tenantId')} 
                />
                {errors.tenantId && <p className="text-red-400 text-xs">{errors.tenantId.message}</p>}
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Mail size={14} /> Email Address
                </Label>
                <Input 
                  type="email" 
                  placeholder="name@company.com" 
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  {...register('email')} 
                />
                {errors.email && <p className="text-red-400 text-xs">{errors.email.message}</p>}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300 flex items-center gap-2">
                    <Lock size={14} /> Password
                  </Label>
                  <Link to="/reset-password" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                    Forgot password?
                  </Link>
                </div>
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  {...register('password')} 
                />
                {errors.password && <p className="text-red-400 text-xs">{errors.password.message}</p>}
              </div>

              <Button 
                type="submit" 
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-6 text-base mt-2" 
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </Button>

              {/* Google SSO Divider */}
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-transparent px-3 text-slate-500">or continue with</span>
                </div>
              </div>

              <a
                href={`${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/auth/google`}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#4285F4" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.1 29.3 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1 7.2 2.7l5.7-5.7C33.1 7.1 28.8 5 24 5 12.9 5 4 13.9 4 25s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.2-.1-2.3-.1-3.5l.1-.5z" />
                  <path fill="#34A853" d="M6.3 15.2l6.6 4.8C14.5 17 19 14 24 14c2.8 0 5.3 1 7.2 2.7l5.7-5.7C33.1 7.1 28.8 5 24 5c-7.5 0-14 4.1-17.7 10.2z" />
                  <path fill="#FBBC05" d="M24 45c5.2 0 9.9-1.8 13.5-4.7l-6.2-5.2C29.6 36.6 27 37.5 24 37.5c-5.2 0-9.7-3-11.4-7.3l-6.6 5.1C9.9 41 16.4 45 24 45z" />
                  <path fill="#EA4335" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.2 5.4l6.2 5.2C37 36.8 44 32 44 25c0-1.5-.2-2.9-.4-4.5z" />
                </svg>
                Sign in with Google
              </a>

              <div className="text-center mt-6 text-sm text-slate-400">
                Don't have a portal?{' '}
                <Link to="/signup" className="text-white font-semibold hover:text-indigo-300 transition-colors">
                  Create one
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
