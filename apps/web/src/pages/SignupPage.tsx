import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { UserPlus, Building2, Mail, Lock, User } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { setAuth } from '../lib/auth';
import { useToast } from '../lib/toast';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';

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
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-900 to-indigo-950 p-4">
      <Card className="w-full max-w-[440px] bg-white/5 border-white/10 text-white backdrop-blur-xl">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto mb-4 inline-flex p-3 bg-purple-500/20 rounded-xl">
            <UserPlus size={32} className="text-purple-400" />
          </div>
          <CardTitle className="text-2xl font-bold">Create Your Portal</CardTitle>
          <CardDescription className="text-slate-400">Set up your company space in seconds</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label className="text-slate-300 flex items-center gap-2">
                <Building2 size={14} /> Company Name
              </Label>
              <Input 
                placeholder="Acme Inc." 
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-purple-500"
                {...register('tenantName')} 
              />
              {errors.tenantName && <p className="text-red-400 text-xs">{errors.tenantName.message}</p>}
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 flex items-center gap-2">
                <User size={14} /> Your Full Name
              </Label>
              <Input 
                placeholder="John Doe" 
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-purple-500"
                {...register('name')} 
              />
              {errors.name && <p className="text-red-400 text-xs">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 flex items-center gap-2">
                <Mail size={14} /> Email Address
              </Label>
              <Input 
                type="email" 
                placeholder="name@company.com" 
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-purple-500"
                {...register('email')} 
              />
              {errors.email && <p className="text-red-400 text-xs">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 flex items-center gap-2">
                <Lock size={14} /> Password
              </Label>
              <Input 
                type="password" 
                placeholder="••••••••" 
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-purple-500"
                {...register('password')} 
              />
              {errors.password && <p className="text-red-400 text-xs">{errors.password.message}</p>}
            </div>

            <Button 
              type="submit" 
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white py-6 text-base border-0 mt-2" 
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating account...' : 'Get Started'}
            </Button>

            <div className="text-center mt-6 text-sm text-slate-400">
              Already have a portal?{' '}
              <Link to="/login" className="text-white font-semibold hover:text-purple-300 transition-colors">
                Sign in
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
