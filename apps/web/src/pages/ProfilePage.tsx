import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Mail, Shield, Building2, Calendar, Briefcase, ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '../lib/api';
import { hasPermission } from '../lib/auth';
import { fmtDay } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { QueryErrorState } from '../components/QueryErrorState';

type Me = {
  name: string;
  email: string;
  role: string;
  isTwoFactorEnabled: boolean;
  employee: { department: string | null; designation: string | null; dateOfJoining: string | null } | null;
  tenant: { name: string; slug: string } | null;
};

export function ProfilePage() {
  const hasScopedAdminAccess = hasPermission(['tenant.settings.manage', 'employees.manage', 'payroll.run.manage', 'hiring.jobs.manage']);
  const { data: user, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['me'],
    meta: { inlineError: true },
    queryFn: async () => (await api.get<Me>('/auth/me')).data,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto" role="status" aria-label="Loading profile">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-72" />
          <Skeleton className="h-72 md:col-span-2" />
        </div>
      </div>
    );
  }

  if (isError || !user) {
    return <QueryErrorState title="Your profile could not be loaded" error={error} onRetry={() => refetch()} className="max-w-5xl mx-auto" />;
  }

  const job = [user.employee?.designation, user.employee?.department].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">My Profile</h2>
        <p className="text-muted-foreground mt-2">Your account and employment details.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Left Column (Identity) */}
        <Card className="md:col-span-1 bg-white/50 backdrop-blur-xl h-fit">
          <CardContent className="pt-8 flex flex-col items-center text-center">
            <Avatar className="h-24 w-24 mb-4 border-4 border-background shadow-sm">
              <AvatarFallback className="bg-indigo-100 text-indigo-700 text-3xl font-semibold">
                {user.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <h3 className="text-xl font-bold break-words">{user.name}</h3>
            <div className="text-indigo-600 font-medium text-sm mb-6">{user.role}</div>

            <div className="w-full space-y-4 pt-6 border-t border-border/50 text-left">
              <div className="flex items-center gap-3 text-sm min-w-0">
                <Mail size={16} className="text-muted-foreground shrink-0" aria-hidden />
                <span className="font-medium text-slate-700 truncate">{user.email}</span>
              </div>
              <div className="flex items-center gap-3 text-sm min-w-0">
                <Building2 size={16} className="text-muted-foreground shrink-0" aria-hidden />
                <span className="font-medium text-slate-700 truncate">{user.tenant?.name ?? '—'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right Column (Details) */}
        <Card className="md:col-span-2 bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex gap-4 items-start">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
                <Shield size={20} aria-hidden />
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-1">Security Role</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  You are signed in as <strong className="text-slate-700">{user.role}</strong>. This gives you
                  access to {hasScopedAdminAccess ? 'the administrative features assigned to your role.' : 'your own attendance, leave, payslips and documents.'}
                </div>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0">
                <Briefcase size={20} aria-hidden />
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-1">Position</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  {job || (user.employee ? 'Not set yet — ask HR to update your record.' : 'This account is not linked to an employee record.')}
                </div>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="p-2 bg-amber-50 text-amber-600 rounded-lg shrink-0">
                <Calendar size={20} aria-hidden />
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-1">Date of Joining</div>
                <div className="text-sm text-muted-foreground leading-relaxed">{fmtDay(user.employee?.dateOfJoining)}</div>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className={user.isTwoFactorEnabled ? 'p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0' : 'p-2 bg-red-50 text-red-600 rounded-lg shrink-0'}>
                {user.isTwoFactorEnabled ? <ShieldCheck size={20} aria-hidden /> : <ShieldOff size={20} aria-hidden />}
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-1">Two-factor authentication</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  {user.isTwoFactorEnabled ? 'Enabled.' : 'Not enabled — turn it on to protect your payslips and personal data.'}
                </div>
              </div>
            </div>

            <Separator className="my-4" />

            <div className="flex flex-wrap items-center gap-3">
              <Button asChild className="bg-indigo-500 hover:bg-indigo-600 text-white px-8">
                <Link to="/security">Password & security</Link>
              </Button>
              <span className="text-xs text-muted-foreground">Name, department and joining date are maintained by HR.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
