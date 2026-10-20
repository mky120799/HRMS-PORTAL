import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users,
  Calendar,
  Clock,
  UserPlus,
  CheckCircle,
  CalendarPlus,
  Wallet,
} from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { hasPermission } from '../lib/auth';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { getErrorMessage } from '../lib/errors';

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { QueryErrorState } from '../components/QueryErrorState';

/** A stat that distinguishes "loading" and "failed" from a real zero. */
function Stat({ loading, failed, value }: { loading: boolean; failed: boolean; value: number }) {
  if (loading) return <Skeleton className="h-10 w-16" />;
  if (failed) return <div className="text-4xl font-bold text-muted-foreground" title="Could not load">—</div>;
  return <div className="text-4xl font-bold">{value}</div>;
}

export function DashboardPage() {
  const { showToast } = useToast();

  const canSeeAnalytics = hasPermission(['analytics.read']);
  const canManageEmployees = hasPermission(['employees.manage']);
  const canReviewLeave = hasPermission(['leave.review', 'leave.admin']);
  const employees = useQuery({ queryKey: ['employees', 'count'], meta: { inlineError: true }, queryFn: async () => (await api.get('/employees', { params: { pageSize: 1 } })).data });
  const leaves = useQuery({ queryKey: ['leave', 'mine', 'dashboard'], meta: { inlineError: true }, queryFn: async () => (await api.get('/leave-requests', { params: { scope: 'mine', pageSize: 100 } })).data });
  const attendance = useQuery({ queryKey: ['attendance'], queryFn: async () => (await api.get('/attendance/me')).data, retry: false });
  const analytics = useQuery({ queryKey: ['analytics'], enabled: canSeeAnalytics, meta: { inlineError: true }, queryFn: async () => (await api.get('/analytics/overview')).data });
  const failed = [employees, leaves, analytics].find((q) => q.isError);

  const hiringData = analytics.data?.hiringFunnel ?? [];
  const todayRecord = attendance.data?.today ?? null;

  const handleClockIn = async () => {
    try {
      await api.post('/attendance/clock-in');
      showToast('Clocked in successfully', 'success');
      attendance.refetch();
    } catch (e) {
      showToast(getErrorMessage(e), 'error');
    }
  };

  const handleClockOut = async () => {
    try {
      await api.post('/attendance/clock-out');
      showToast('Clocked out successfully', 'success');
      attendance.refetch();
    } catch (e) {
      showToast(getErrorMessage(e), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Executive Dashboard</h2>
        <p className="text-muted-foreground mt-2">Welcome back to the portal. Here's an overview of your organization.</p>
      </div>

      {failed && (
        <QueryErrorState
          title="Some dashboard figures could not be loaded"
          error={failed.error}
          onRetry={() => [employees, leaves, analytics].forEach((q) => q.isError && q.refetch())}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:gap-6">
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Employees</CardTitle>
            <div className="h-10 w-10 bg-indigo-500/10 rounded-xl flex items-center justify-center">
              <Users size={20} className="text-indigo-500" />
            </div>
          </CardHeader>
          <CardContent>
            <Stat loading={employees.isLoading} failed={employees.isError} value={employees.data?.total ?? 0} />
            <p className="text-xs text-muted-foreground mt-2">People you can see in the directory</p>
          </CardContent>
        </Card>

        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Leaves</CardTitle>
            <div className="h-10 w-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
              <Calendar size={20} className="text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            <Stat loading={leaves.isLoading} failed={leaves.isError} value={leaves.data?.items?.filter((l: any) => l.status === 'APPROVED').length ?? 0} />
            <p className="text-xs text-muted-foreground mt-2">Your approved requests</p>
          </CardContent>
        </Card>

        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Requests</CardTitle>
            <div className="h-10 w-10 bg-red-500/10 rounded-xl flex items-center justify-center">
              <Clock size={20} className="text-red-500" />
            </div>
          </CardHeader>
          <CardContent>
            {canSeeAnalytics ? (
              <Stat loading={analytics.isLoading} failed={analytics.isError} value={analytics.data?.summary?.pendingLeaves ?? 0} />
            ) : (
              <Stat loading={leaves.isLoading} failed={leaves.isError} value={leaves.data?.items?.filter((l: any) => l.status === 'PENDING').length ?? 0} />
            )}
            <p className="text-xs text-muted-foreground mt-2">{canSeeAnalytics ? 'Awaiting approval across the workspace' : 'Your requests awaiting approval'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:gap-6">
        <Card className="md:col-span-2 bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Hiring Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            {!canSeeAnalytics || (!analytics.isLoading && hiringData.length === 0) ? (
              <div className="h-[300px] flex items-center justify-center text-center text-sm text-muted-foreground px-6">
                {canSeeAnalytics ? 'No candidates in the pipeline yet.' : 'Hiring figures are visible to people with analytics access.'}
              </div>
            ) : (
            <div className="h-[300px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hiringData.map((d: any) => ({ name: d.stage, count: d.count }))}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dx={-10} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white/50 backdrop-blur-xl flex flex-col">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 flex-1">
            {canManageEmployees ? (
              <Button asChild variant="outline" className="w-full justify-start h-12 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 border-indigo-100">
                <Link to="/employees"><UserPlus size={18} className="mr-2" aria-hidden /> Add New Employee</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className="w-full justify-start h-12 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 border-indigo-100">
                <Link to="/attendance"><Wallet size={18} className="mr-2" aria-hidden /> My Payslips</Link>
              </Button>
            )}
            {canReviewLeave ? (
              <Button asChild variant="outline" className="w-full justify-start h-12 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-700 border-emerald-100">
                <Link to="/leave"><CheckCircle size={18} className="mr-2" aria-hidden /> Approve Leaves</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className="w-full justify-start h-12 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-700 border-emerald-100">
                <Link to="/leave"><CalendarPlus size={18} className="mr-2" aria-hidden /> Request Leave</Link>
              </Button>
            )}
            
            <div className="mt-auto pt-6">
              <Separator className="mb-6" />
              <h3 className="text-sm font-semibold text-muted-foreground mb-4">My Attendance Today</h3>
              {todayRecord?.clockIn ? (
                todayRecord.clockOut ? (
                  <div className="bg-emerald-500/10 text-emerald-600 p-4 rounded-xl text-center text-sm font-medium border border-emerald-500/20">
                    Shift Completed! 🎉
                  </div>
                ) : (
                  <Button onClick={handleClockOut} variant="destructive" className="w-full h-12 font-medium text-base">
                    Clock Out
                  </Button>
                )
              ) : (
                <Button onClick={handleClockIn} className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 font-medium text-base">
                  Clock In
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
