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

            <div className="text-center mt-6 text-sm text-slate-400">
              Don't have a portal?{' '}
              <Link to="/signup" className="text-white font-semibold hover:text-indigo-300 transition-colors">
                Create one
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
