import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Users, CalendarCheck, Briefcase, TrendingUp, PieChart
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RPieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { api } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];

const StatCard = ({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) => (
  <Card className="bg-white/50 backdrop-blur-xl">
    <CardContent className="pt-6 flex items-center gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
    </CardContent>
  </Card>
);

export function AnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics'],
    queryFn: async () => (await api.get('/analytics/overview')).data,
  });

  const analytics = data?.data ?? data;

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-slate-200 rounded w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-slate-100 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const summary = analytics?.summary ?? {};
  const departmentBreakdown = analytics?.departmentBreakdown ?? [];
  const monthlyLeave = analytics?.monthlyLeave ?? [];
  const hiringFunnel = analytics?.hiringFunnel ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Workforce Analytics</h2>
        <p className="text-muted-foreground mt-2">Data-driven HR insights across your entire organisation.</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users}         label="Total Employees"   value={summary.totalEmployees ?? 0}   color="bg-indigo-500" />
        <StatCard icon={CalendarCheck} label="Total Leave Requests" value={summary.totalLeaveRequests ?? 0} color="bg-emerald-500" />
        <StatCard icon={Briefcase}     label="Open Positions"    value={summary.openJobs ?? 0}          color="bg-purple-500" />
        <StatCard icon={TrendingUp}    label="Candidates Hired"  value={summary.hiredCount ?? 0}        color="bg-amber-500" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-6 md:grid-cols-5">
        {/* Department Breakdown (Pie) */}
        <Card className="md:col-span-2 bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart size={18} className="text-indigo-500" /> Department Distribution
            </CardTitle>
            <CardDescription>Headcount by department</CardDescription>
          </CardHeader>
          <CardContent>
            {departmentBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <RPieChart>
                  <Pie data={departmentBreakdown} dataKey="count" nameKey="department" cx="50%" cy="50%" outerRadius={85} paddingAngle={3}>
                    {departmentBreakdown.map((_: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`${v} employees`]} />
                  <Legend iconType="circle" iconSize={10} />
                </RPieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[240px] flex items-center justify-center text-muted-foreground text-sm">
                No department data available yet.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hiring Funnel (Bar) */}
        <Card className="md:col-span-3 bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase size={18} className="text-purple-500" /> Hiring Funnel
            </CardTitle>
            <CardDescription>Application pipeline progression</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hiringFunnel} barSize={40}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="stage" axisLine={false} tickLine={false} style={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} style={{ fontSize: 12 }} />
                <Tooltip cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="count" name="Candidates" radius={[6, 6, 0, 0]}>
                  {hiringFunnel.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Leave Trend */}
      <Card className="bg-white/50 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 size={18} className="text-emerald-500" /> Leave Utilisation Trend
          </CardTitle>
          <CardDescription>Monthly leave requests over the last 6 months, broken down by status</CardDescription>
        </CardHeader>
        <CardContent>
          {monthlyLeave.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyLeave} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} style={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} style={{ fontSize: 12 }} />
                <Tooltip cursor={{ fill: '#f8fafc' }} />
                <Legend iconType="circle" iconSize={10} />
                <Bar dataKey="approved" name="Approved" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pending"  name="Pending"  fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="rejected" name="Rejected" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">
              No leave data available for the last 6 months.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
