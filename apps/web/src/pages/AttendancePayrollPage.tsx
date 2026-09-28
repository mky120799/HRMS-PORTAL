import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Clock, LogIn, LogOut, Download } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { fmtDay, fmtMoney, fmtTime, MONTHS } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

type AttendanceRecord = { id: string; date: string; clockIn: string; clockOut: string | null; workMinutes: number | null; status: string };
type Payslip = { id: string; month: number; year: number; grossPay: number; deductions: number; netPay: number; lopDays: number };

const hours = (m: number | null) => (m == null ? '—' : `${Math.floor(m / 60)}h ${m % 60}m`);

export function AttendancePayrollPage() {
  const { showToast } = useToast();
  const qc = useQueryClient();
  const attendance = useQuery({ queryKey: ['attendance'], queryFn: async () => (await api.get<{ today: AttendanceRecord | null; records: AttendanceRecord[] }>('/attendance/me')).data });
  const payslips = useQuery({ queryKey: ['payslips'], queryFn: async () => (await api.get<Payslip[]>('/payroll/my-payslips')).data, retry: false });

  const clock = useMutation({
    mutationFn: async (action: 'clock-in' | 'clock-out') => api.post(`/attendance/${action}`),
    onSuccess: (_r, action) => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      showToast(action === 'clock-in' ? 'Clocked in' : 'Clocked out', 'success');
    },
    onError: (e) => showToast(getErrorMessage(e), 'error'),
  });

  const today = attendance.data?.today;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Attendance & Payslips</h2>
          <p className="text-muted-foreground mt-2">"Today" follows your company's timezone.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => clock.mutate('clock-in')} disabled={!!today || clock.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <LogIn size={16} className="mr-2" /> Clock in
          </Button>
          <Button onClick={() => clock.mutate('clock-out')} disabled={!today || !!today.clockOut || clock.isPending} variant="outline">
            <LogOut size={16} className="mr-2" /> Clock out
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock size={18} className="text-indigo-500" /> Last 30 days
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="pl-6">Date</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead>Worked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.data?.records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-6 font-medium">
                      {fmtDay(r.date)} {r.status === 'HALF_DAY' && <Badge variant="outline" className="ml-1">Half day</Badge>}
                    </TableCell>
                    <TableCell>{fmtTime(r.clockIn)}</TableCell>
                    <TableCell>{r.clockOut ? fmtTime(r.clockOut) : <span className="text-slate-400 italic">—</span>}</TableCell>
                    <TableCell>{hours(r.workMinutes)}</TableCell>
                  </TableRow>
                ))}
                {!attendance.isLoading && !attendance.data?.records.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      No records yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText size={18} className="text-emerald-500" /> My payslips
            </CardTitle>
            <CardDescription>Payslips appear once payroll for the month is finalized.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {payslips.data?.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-4 rounded-xl border bg-white/40">
                <div>
                  <div className="font-semibold">
                    {MONTHS[p.month - 1]} {p.year}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Net {fmtMoney(p.netPay)} · Gross {fmtMoney(p.grossPay)}
                    {p.lopDays > 0 && ` · ${p.lopDays} LOP day(s)`}
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => downloadFile(`/payroll/payslips/${p.id}/pdf`, `payslip-${p.year}-${p.month}.pdf`).catch((e) => showToast(getErrorMessage(e), 'error'))}
                >
                  <Download size={16} className="mr-2" /> PDF
                </Button>
              </div>
            ))}
            {payslips.isError && <div className="py-6 text-center text-muted-foreground">{getErrorMessage(payslips.error)}</div>}
            {!payslips.isLoading && !payslips.isError && !payslips.data?.length && (
              <div className="py-8 text-center text-muted-foreground border-2 border-dashed rounded-xl">No payslips yet.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
