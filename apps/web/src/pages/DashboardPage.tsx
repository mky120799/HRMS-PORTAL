import { useQuery } from '@tanstack/react-query';
import { 
  Users, 
  Calendar, 
  Bell, 
  TrendingUp,
  UserPlus,
  CheckCircle,
  Clock
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
    <div className="dashboard">
      <div className="topbar">
        <h2>Executive Dashboard</h2>
      </div>

      <div className="grid-3">
        <div className="card">
          <div className="row gap" style={{ marginBottom: 16 }}>
            <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: 8, borderRadius: 8 }}>
              <Users size={20} color="#6366f1" />
            </div>
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Total Employees</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{employees.data?.length ?? 0}</div>
          <div style={{ color: '#10b981', fontSize: 13, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            <TrendingUp size={14} /> +12% from last month
          </div>
        </div>

        <div className="card">
          <div className="row gap" style={{ marginBottom: 16 }}>
            <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: 8, borderRadius: 8 }}>
              <Calendar size={20} color="#f59e0b" />
            </div>
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Active Leaves</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{leaves.data?.filter((l: any) => l.status === 'APPROVED').length ?? 0}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
            Across all departments
          </div>
        </div>

        <div className="card">
          <div className="row gap" style={{ marginBottom: 16 }}>
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: 8, borderRadius: 8 }}>
              <Clock size={20} color="#ef4444" />
            </div>
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Pending Requests</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{leaves.data?.filter((l: any) => l.status === 'PENDING').length ?? 0}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
            Requires admin action
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="card">
          <h2>Hiring Trends</h2>
          <div style={{ height: 300, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorCount)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2>Quick Actions</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            <button className="row gap" style={{ background: 'rgba(99, 102, 241, 0.05)', color: 'var(--text-main)', textAlign: 'left', justifyContent: 'flex-start' }}>
              <UserPlus size={18} color="#6366f1" /> Add New Employee
            </button>
            <button className="row gap" style={{ background: 'rgba(16, 185, 129, 0.05)', color: 'var(--text-main)', textAlign: 'left', justifyContent: 'flex-start' }}>
              <CheckCircle size={18} color="#10b981" /> Approve Leaves
            </button>
            
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>My Attendance Today</h3>
              {todayRecord?.clockIn ? (
                todayRecord.clockOut ? (
                  <div style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: 12, borderRadius: 8, textAlign: 'center', fontSize: 14, fontWeight: 500 }}>
                    Shift Completed! 🎉
                  </div>
                ) : (
                  <button onClick={handleClockOut} style={{ width: '100%', background: '#ef4444', color: '#fff', padding: 12 }}>
                    Clock Out
                  </button>
                )
              ) : (
                <button onClick={handleClockIn} style={{ width: '100%', background: '#10b981', color: '#fff', padding: 12 }}>
                  Clock In
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
