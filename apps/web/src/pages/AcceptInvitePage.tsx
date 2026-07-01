import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, PartyPopper } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { getErrorMessage } from '../lib/errors';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';

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
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-900 to-indigo-950 p-4">
        <Card className="w-full max-w-[440px] bg-white/5 border-white/10 text-white backdrop-blur-xl text-center pb-6">
          <CardHeader>
            <CardTitle className="text-2xl font-bold">Invalid Link</CardTitle>
            <CardDescription className="text-slate-400">This invitation link is missing a security token.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full bg-white/10 hover:bg-white/20 border-0 text-white">
              <Link to="/login">Go to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-900 to-indigo-950 p-4">
      <Card className="w-full max-w-[440px] bg-white/5 border-white/10 text-white backdrop-blur-xl">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto mb-4 inline-flex p-3 bg-emerald-500/20 rounded-xl">
            <PartyPopper size={32} className="text-emerald-400" />
          </div>
          <CardTitle className="text-2xl font-bold">Welcome Aboard!</CardTitle>
          <CardDescription className="text-slate-400">Set a secure password to activate your HRMS account.</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label className="text-slate-300 flex items-center gap-2">
                <Lock size={14} /> Password
              </Label>
              <Input 
                type="password" 
                placeholder="••••••••" 
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500"
                {...register('password')} 
              />
              {errors.password && <p className="text-red-400 text-xs">{errors.password.message}</p>}
            </div>
            <Button 
              type="submit" 
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-6 text-base mt-2" 
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Activating...' : 'Activate Account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
