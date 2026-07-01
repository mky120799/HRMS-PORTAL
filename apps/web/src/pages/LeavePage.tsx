import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Calendar, Clock, CheckCircle, XCircle, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';

type LeaveRequest = {
  _id?: string;
  id?: string;
  employeeId: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  reason?: string;
};

const schema = z.object({
  employeeId: z.string().min(1, 'Employee reference is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  type: z.string().optional(),
  reason: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function LeavePage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const list = useQuery({ queryKey: ['leave'], queryFn: async () => (await api.get('/leave-requests')).data as LeaveRequest[] });
  
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({ 
    resolver: zodResolver(schema) 
  });

  const create = useMutation({
    mutationFn: async (body: FormData) => api.post('/leave-requests', body),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ['leave'] });
      showToast('Leave request submitted for approval', 'success');
    },
    onError: (error) => showToast(getErrorMessage(error), 'error'),
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED': return <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20"><CheckCircle size={12} className="mr-1" /> Approved</Badge>;
      case 'REJECTED': return <Badge className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20"><XCircle size={12} className="mr-1" /> Rejected</Badge>;
      default: return <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20"><Clock size={12} className="mr-1" /> Pending</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Leave Management</h2>
        <p className="text-muted-foreground mt-2">Request time off and track your leave history.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1 bg-white/50 backdrop-blur-xl h-fit">
          <CardHeader>
            <CardTitle>Request Leave</CardTitle>
            <CardDescription>Submit a new time-off request.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4">
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input placeholder="Employee identifier" {...register('employeeId')} className="bg-white/50" />
                {errors.employeeId && <p className="text-red-500 text-xs">{errors.employeeId.message}</p>}
              </div>
              
              <div className="space-y-2">
                <Label>Leave Type</Label>
                <select 
                  {...register('type')} 
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="ANNUAL">Annual Leave</option>
                  <option value="SICK">Sick Leave</option>
                  <option value="MATERNITY">Maternity Leave</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" {...register('startDate')} className="bg-white/50" />
                  {errors.startDate && <p className="text-red-500 text-xs">{errors.startDate.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" {...register('endDate')} className="bg-white/50" />
                  {errors.endDate && <p className="text-red-500 text-xs">{errors.endDate.message}</p>}
                </div>
              </div>

              <div className="space-y-2 pb-2">
                <Label>Reason (Optional)</Label>
                <textarea 
                  placeholder="Tell us more..." 
                  {...register('reason')} 
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-white/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" 
                />
              </div>

              <Button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white" disabled={create.isPending || isSubmitting}>
                <Plus size={18} className="mr-2" />
                Submit Request
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-white/50 backdrop-blur-xl overflow-hidden">
          <CardHeader>
            <CardTitle>Request History</CardTitle>
            <CardDescription>Track the status of all leave requests.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="pl-6">Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right pr-6">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data?.map((r) => (
                  <TableRow key={r._id ?? r.id} className="hover:bg-slate-50/50">
                    <TableCell className="pl-6 py-4 font-medium">{r.employeeId}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">{r.type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar size={14} className="text-indigo-400" />
                        {new Date(r.startDate).toLocaleDateString()} - {new Date(r.endDate).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      {getStatusBadge(r.status)}
                    </TableCell>
                  </TableRow>
                ))}
                
                {list.isLoading && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                      Loading history...
                    </TableCell>
                  </TableRow>
                )}
                
                {!list.isLoading && (list.data?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                      No requests found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
