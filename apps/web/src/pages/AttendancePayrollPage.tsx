import { useQuery } from '@tanstack/react-query';
import { FileText, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

export function AttendancePayrollPage() {
  const attendance = useQuery({ queryKey: ['attendance'], queryFn: async () => (await api.get('/attendance/me')).data });
  const payslips = useQuery({ queryKey: ['payslips'], queryFn: async () => (await api.get('/payroll/my-payslips')).data }); // Optional: assuming this exists

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Attendance & Payroll</h2>
        <p className="text-muted-foreground mt-2">View your recent attendance records and payslips.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock size={18} className="text-indigo-500" /> 
              Last 30 Days Attendance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="pl-6">Date</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.data?.map((record: any) => (
                  <TableRow key={record.id} className="hover:bg-slate-50/50">
                    <TableCell className="pl-6 py-4 font-medium text-slate-700">
                      {new Date(record.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200">
                        {new Date(record.clockIn).toLocaleTimeString()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {record.clockOut ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200">
                          {new Date(record.clockOut).toLocaleTimeString()}
                        </Badge>
                      ) : (
                        <span className="text-sm text-slate-400 italic">Missing</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                
                {!attendance.data?.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                      No records found.
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
              <FileText size={18} className="text-emerald-500" /> 
              My Payslips
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {payslips.data?.map((slip: any) => (
                <div key={slip.id} className="flex items-center justify-between p-4 rounded-xl border bg-white/40">
                  <div>
                    <div className="font-semibold text-slate-800">{slip.month} {slip.year}</div>
                    <div className="text-sm text-muted-foreground mt-1">Net Pay: ${slip.netPay}</div>
                  </div>
                  <Button asChild variant="default" className="bg-emerald-500 hover:bg-emerald-600 text-white">
                    <a href={slip.pdfUrl} target="_blank" rel="noreferrer">
                      Download PDF
                    </a>
                  </Button>
                </div>
              ))}
              
              {!payslips.data?.length && (
                <div className="py-8 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                  No payslips generated yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
