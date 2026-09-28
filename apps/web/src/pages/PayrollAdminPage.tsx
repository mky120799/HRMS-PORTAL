import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Lock, Pencil, Download, AlertTriangle } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { fmtMoney, MONTHS } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';

type Salary = { baseSalary: number; allowances: number; deductions: number; monthlyTds: number; pfEnabled: boolean };
type SalaryRow = { employee: { id: string; firstName: string; lastName: string; department: string | null; employeeCode: string | null }; salary: Salary | null };
type Run = {
  status: 'NOT_STARTED' | 'DRAFT' | 'FINALIZED';
  totals: { gross: number; deductions: number; net: number };
  payslips: { id: string; employee: { firstName: string; lastName: string }; grossPay: number; pfDeduction: number; tdsDeduction: number; deductions: number; netPay: number; lopDays: number; status: string }[];
};

const EMPTY: Salary = { baseSalary: 0, allowances: 0, deductions: 0, monthlyTds: 0, pfEnabled: true };

export function PayrollAdminPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const last = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const [period, setPeriod] = useState({ month: last.getMonth() + 1, year: last.getFullYear() });
  const [editing, setEditing] = useState<{ id: string; values: Salary } | null>(null);
  const [warnings, setWarnings] = useState<{ name: string; message: string }[]>([]);

  const salaries = useQuery({ queryKey: ['payroll', 'salaries'], queryFn: async () => (await api.get<SalaryRow[]>('/payroll/salaries')).data });
  const run = useQuery({ queryKey: ['payroll', 'run', period], queryFn: async () => (await api.get<Run>('/payroll/runs', { params: period })).data });
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');

  const save = useMutation({
    mutationFn: async (e: { id: string; values: Salary }) => api.put(`/payroll/salaries/${e.id}`, e.values),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['payroll', 'salaries'] });
      showToast('Salary saved', 'success');
    },
    onError,
  });
  const generate = useMutation({
    mutationFn: async () => (await api.post('/payroll/runs/generate', period)).data,
    onSuccess: (data: any) => {
      setWarnings(data.warnings ?? []);
      qc.invalidateQueries({ queryKey: ['payroll', 'run'] });
      showToast(`${data.count} draft payslip(s) generated${data.employeesWithoutSalary ? ` — ${data.employeesWithoutSalary} employee(s) have no salary set` : ''}`, 'success');
    },
    onError,
  });
  const finalize = useMutation({
    mutationFn: async () => api.post('/payroll/runs/finalize', period),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll', 'run'] });
      showToast('Payroll finalized — employees can now see their payslips', 'success');
    },
    onError,
  });

  const num = (k: keyof Salary) => ({
    type: 'number',
    step: '0.01',
    min: 0,
    value: String(editing?.values[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditing((s) => s && { ...s, values: { ...s.values, [k]: Number(e.target.value) } }),
    className: 'h-8 w-28',
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Payroll</h2>
          <p className="text-muted-foreground mt-2">Generate drafts, review, then finalize. Finalized months are locked.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-10 rounded-md border bg-white/70 px-2 text-sm" value={period.month} onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <Input type="number" className="w-24" value={period.year} onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))} />
          <Button onClick={() => generate.mutate()} disabled={generate.isPending || run.data?.status === 'FINALIZED'} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Play size={16} className="mr-2" /> {run.data?.status === 'DRAFT' ? 'Regenerate' : 'Generate'}
          </Button>
          <Button
            variant="outline"
            disabled={run.data?.status !== 'DRAFT' || finalize.isPending}
            onClick={() => window.confirm('Finalize payroll? Payslips become visible to employees and can no longer be changed.') && finalize.mutate()}
          >
            <Lock size={16} className="mr-2" /> Finalize
          </Button>
        </div>
      </div>

      {warnings.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-4 space-y-1 text-sm text-amber-800">
            {warnings.map((w, i) => (
              <div key={i} className="flex gap-2">
                <AlertTriangle size={16} /> {w.name}: {w.message}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="bg-white/50 backdrop-blur-xl overflow-hidden">
        <CardHeader className="flex flex-row justify-between items-start">
          <div>
            <CardTitle>
              {MONTHS[period.month - 1]} {period.year}{' '}
              <Badge variant="outline" className="ml-2">
                {run.data?.status?.replace('_', ' ') ?? '…'}
              </Badge>
            </CardTitle>
            <CardDescription>
              Gross {fmtMoney(run.data?.totals.gross)} · Deductions {fmtMoney(run.data?.totals.deductions)} · Net {fmtMoney(run.data?.totals.net)}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow>
                <TableHead className="pl-6">Employee</TableHead>
                <TableHead>LOP</TableHead>
                <TableHead>Gross</TableHead>
                <TableHead>PF</TableHead>
                <TableHead>TDS</TableHead>
                <TableHead>Deductions</TableHead>
                <TableHead>Net</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.data?.payslips.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-6 font-medium">
                    {p.employee.firstName} {p.employee.lastName}
                  </TableCell>
                  <TableCell>{p.lopDays}</TableCell>
                  <TableCell>{fmtMoney(p.grossPay)}</TableCell>
                  <TableCell>{fmtMoney(p.pfDeduction)}</TableCell>
                  <TableCell>{fmtMoney(p.tdsDeduction)}</TableCell>
                  <TableCell>{fmtMoney(p.deductions)}</TableCell>
                  <TableCell className="font-semibold">{fmtMoney(p.netPay)}</TableCell>
                  <TableCell className="pr-6 text-right">
                    <Button variant="ghost" size="sm" onClick={() => downloadFile(`/payroll/payslips/${p.id}/pdf`, 'payslip.pdf').catch(onError)}>
                      <Download size={14} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {run.data?.status === 'NOT_STARTED' && (
                <TableRow>
                  <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                    No payroll run for this month yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="bg-white/50 backdrop-blur-xl overflow-hidden">
        <CardHeader>
          <CardTitle>Salary structures</CardTitle>
          <CardDescription>
            Monthly amounts. PF is 12% of basic up to the 15,000 wage ceiling. Enter TDS from each employee's tax computation.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow>
                <TableHead className="pl-6">Employee</TableHead>
                <TableHead>Basic</TableHead>
                <TableHead>Allowances</TableHead>
                <TableHead>Other deductions</TableHead>
                <TableHead>TDS</TableHead>
                <TableHead>PF</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {salaries.data?.map(({ employee: e, salary: s }) => {
                const isEditing = editing?.id === e.id;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="pl-6 font-medium">
                      {e.firstName} {e.lastName}
                      <div className="text-xs text-muted-foreground">{e.department ?? ''}</div>
                    </TableCell>
                    {isEditing ? (
                      <>
                        <TableCell><Input {...num('baseSalary')} /></TableCell>
                        <TableCell><Input {...num('allowances')} /></TableCell>
                        <TableCell><Input {...num('deductions')} /></TableCell>
                        <TableCell><Input {...num('monthlyTds')} /></TableCell>
                        <TableCell>
                          <input type="checkbox" checked={editing.values.pfEnabled} onChange={(ev) => setEditing((st) => st && { ...st, values: { ...st.values, pfEnabled: ev.target.checked } })} />
                        </TableCell>
                        <TableCell className="pr-6 text-right space-x-1">
                          <Button size="sm" onClick={() => save.mutate(editing)} disabled={save.isPending}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>{s ? fmtMoney(s.baseSalary) : <span className="text-amber-600 text-sm">Not set</span>}</TableCell>
                        <TableCell>{s ? fmtMoney(s.allowances) : '—'}</TableCell>
                        <TableCell>{s ? fmtMoney(s.deductions) : '—'}</TableCell>
                        <TableCell>{s ? fmtMoney(s.monthlyTds) : '—'}</TableCell>
                        <TableCell>{s ? (s.pfEnabled ? 'Yes' : 'No') : '—'}</TableCell>
                        <TableCell className="pr-6 text-right">
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ id: e.id, values: s ?? EMPTY })}>
                            <Pencil size={14} className="mr-1" /> Edit
                          </Button>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
