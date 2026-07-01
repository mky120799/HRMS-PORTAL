import { useQuery } from '@tanstack/react-query';
import { 
  Users, 
  Calendar, 
  Clock,
  TrendingUp,
  UserPlus,
  CheckCircle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { getAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { getErrorMessage } from '../lib/errors';

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';

const data = [
  { name: 'Mon', count: 4 },
  { name: 'Tue', count: 7 },
  { name: 'Wed', count: 5 },
  { name: 'Thu', count: 12 },
  { name: 'Fri', count: 9 },
];

export function DashboardPage() {
  const { showToast } = useToast();
  const auth = getAuth();
  
  const employees = useQuery({ queryKey: ['employees'], queryFn: async () => (await api.get('/employees')).data });
  const leaves = useQuery({ queryKey: ['leave'], queryFn: async () => (await api.get('/leave-requests')).data });
  const attendance = useQuery({ queryKey: ['attendance'], queryFn: async () => (await api.get('/attendance/me')).data });
  
  const todayRecord = attendance.data?.find((r: any) => new Date(r.date).toDateString() === new Date().toDateString());

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

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Employees</CardTitle>
            <div className="h-10 w-10 bg-indigo-500/10 rounded-xl flex items-center justify-center">
              <Users size={20} className="text-indigo-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{employees.data?.length ?? 0}</div>
            <p className="text-xs text-emerald-500 mt-2 flex items-center gap-1 font-medium">
              <TrendingUp size={14} /> +12% from last month
            </p>
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
            <div className="text-4xl font-bold">{leaves.data?.filter((l: any) => l.status === 'APPROVED').length ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-2">Across all departments</p>
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
            <div className="text-4xl font-bold">{leaves.data?.filter((l: any) => l.status === 'PENDING').length ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-2">Requires admin action</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Hiring Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
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
          </CardContent>
        </Card>

        <Card className="bg-white/50 backdrop-blur-xl flex flex-col">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 flex-1">
            <Button variant="outline" className="w-full justify-start h-12 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 border-indigo-100">
              <UserPlus size={18} className="mr-2" /> Add New Employee
            </Button>
            <Button variant="outline" className="w-full justify-start h-12 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-700 border-emerald-100">
              <CheckCircle size={18} className="mr-2" /> Approve Leaves
            </Button>
            
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
