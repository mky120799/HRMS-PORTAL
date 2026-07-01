import { useQuery } from '@tanstack/react-query';
import { FileText, Clock } from 'lucide-react';
import { api } from '../lib/api';

export function AttendancePayrollPage() {
  const attendance = useQuery({ queryKey: ['attendance'], queryFn: async () => (await api.get('/attendance/me')).data });
  const payslips = useQuery({ queryKey: ['payslips'], queryFn: async () => (await api.get('/payroll/my-payslips')).data }); // Optional: assuming this exists

  return (
    <div>
      <div className="topbar">
        <h2>Attendance & Payroll</h2>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 24 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Clock size={18} color="#6366f1" /> Last 30 Days Attendance</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '12px 0', color: 'var(--text-muted)' }}>Date</th>
                <th style={{ padding: '12px 0', color: 'var(--text-muted)' }}>Clock In</th>
                <th style={{ padding: '12px 0', color: 'var(--text-muted)' }}>Clock Out</th>
              </tr>
            </thead>
            <tbody>
              {attendance.data?.map((record: any) => (
                <tr key={record.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.02)' }}>
                  <td style={{ padding: '12px 0' }}>{new Date(record.date).toLocaleDateString()}</td>
                  <td style={{ padding: '12px 0', color: '#10b981' }}>{new Date(record.clockIn).toLocaleTimeString()}</td>
                  <td style={{ padding: '12px 0', color: record.clockOut ? '#f59e0b' : '#94a3b8' }}>
                    {record.clockOut ? new Date(record.clockOut).toLocaleTimeString() : 'Missing'}
                  </td>
                </tr>
              ))}
              {!attendance.data?.length && <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No records found.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 24 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={18} color="#10b981" /> My Payslips</h3>
          </div>
          <div style={{ display: 'grid', gap: 16 }}>
            {payslips.data?.map((slip: any) => (
              <div key={slip.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{slip.month} {slip.year}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Net Pay: ${slip.netPay}</div>
                </div>
                <a href={slip.pdfUrl} target="_blank" rel="noreferrer" style={{ background: '#10b981', color: '#fff', padding: '8px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 14 }}>
                  Download PDF
                </a>
              </div>
            ))}
            {!payslips.data?.length && <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>No payslips generated yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
