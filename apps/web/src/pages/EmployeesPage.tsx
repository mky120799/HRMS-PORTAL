import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Plus, Search, Mail, UserMinus } from 'lucide-react';
import { api, type Paged } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { getAuth } from '../lib/auth';
import { fmtDay, todayIso } from '../lib/format';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

const schema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().optional(),
  email: z.string().trim().email('Invalid email address'),
  department: z.string().trim().optional(),
  designation: z.string().trim().optional(),
  employeeCode: z.string().trim().optional(),
  managerId: z.string().optional(),
  dateOfJoining: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

type Employee = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  department?: string | null;
  designation?: string | null;
  status: string;
  employeeCode?: string | null;
  dateOfJoining?: string | null;
  userId?: string | null;
  manager?: { firstName: string; lastName: string } | null;
  user?: { role: string; isActive: boolean } | null;
};

export function EmployeesPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const isAdmin = getAuth()?.user.role === 'ADMIN';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ['employees', search, page],
    queryFn: async () => (await api.get<Paged<Employee>>('/employees', { params: { search: search || undefined, page, pageSize: 20 } })).data,
  });
  const managers = useQuery({
    queryKey: ['employees', 'all-active'],
    enabled: isAdmin,
    queryFn: async () => (await api.get<Paged<Employee>>('/employees', { params: { status: 'ACTIVE', pageSize: 100 } })).data.items,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['employees'] });
  const onError = (error: unknown) => showToast(getErrorMessage(error), 'error');

  const create = useMutation({
    mutationFn: async (v: FormData) =>
      api.post('/employees', { ...v, managerId: v.managerId || undefined, dateOfJoining: v.dateOfJoining || undefined }),
    onSuccess: () => {
      reset();
      refresh();
      showToast('Employee added', 'success');
    },
    onError,
  });
  const invite = useMutation({
    mutationFn: async (e: Employee) => api.post('/auth/invite', { email: e.email, name: `${e.firstName} ${e.lastName}`.trim(), role: 'EMPLOYEE' }),
    onSuccess: () => {
      refresh();
      showToast('Invitation email sent', 'success');
    },
    onError,
  });
  const offboard = useMutation({
    mutationFn: async (e: Employee) => api.post(`/employees/${e.id}/offboard`, { exitDate: todayIso() }),
    onSuccess: () => {
      refresh();
      showToast('Employee offboarded and access revoked', 'success');
    },
    onError,
  });
  const changeRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => api.patch(`/employees/${id}/role`, { role }),
    onSuccess: () => {
      refresh();
      showToast('Role updated', 'success');
    },
    onError,
  });

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{isAdmin ? 'Employee Roster' : 'Company Directory'}</h2>
          <p className="text-muted-foreground mt-2">{list.data?.total ?? 0} people</p>
        </div>
        <div className="relative w-full md:w-[300px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email or code"
            className="pl-10 bg-white/50 backdrop-blur-sm"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <div className={`grid gap-6 ${isAdmin ? 'lg:grid-cols-3' : ''}`}>
        {isAdmin && (
          <Card className="lg:col-span-1 bg-white/50 backdrop-blur-xl h-fit">
            <CardHeader>
              <CardTitle>Add Employee</CardTitle>
              <CardDescription>Create the record, then send an invite so they can sign in.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>First name</Label>
                    <Input {...register('firstName')} />
                    {errors.firstName && <p className="text-red-500 text-xs">{errors.firstName.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label>Last name</Label>
                    <Input {...register('lastName')} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Work email</Label>
                  <Input type="email" {...register('email')} />
                  {errors.email && <p className="text-red-500 text-xs">{errors.email.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Department</Label>
                    <Input {...register('department')} />
                  </div>
                  <div className="space-y-1">
                    <Label>Designation</Label>
                    <Input {...register('designation')} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Employee code</Label>
                    <Input {...register('employeeCode')} />
                  </div>
                  <div className="space-y-1">
                    <Label>Date of joining</Label>
                    <Input type="date" {...register('dateOfJoining')} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Reports to</Label>
                  <select className="w-full h-10 rounded-md border bg-white/70 px-3 text-sm" {...register('managerId')}>
                    <option value="">— No manager —</option>
                    {managers.data?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.firstName} {m.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white" disabled={create.isPending}>
                  <Plus size={18} className="mr-2" />
                  {create.isPending ? 'Adding...' : 'Add Employee'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card className={`${isAdmin ? 'lg:col-span-2' : ''} bg-white/50 backdrop-blur-xl overflow-hidden`}>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="pl-6">Employee</TableHead>
                  <TableHead>Department</TableHead>
                  {isAdmin && <TableHead>Joined</TableHead>}
                  {isAdmin && <TableHead>Access</TableHead>}
                  {isAdmin && <TableHead className="text-right pr-6">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => (
                  <TableRow key={e.id} className="hover:bg-slate-50/50">
                    <TableCell className="pl-6 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-indigo-100 text-indigo-700 font-medium">
                            {e.firstName.charAt(0)}
                            {e.lastName?.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">
                            {e.firstName} {e.lastName} {e.status !== 'ACTIVE' && <Badge variant="outline" className="ml-1">{e.status}</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">{e.designation ? `${e.designation} · ` : ''}{e.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{e.department ?? <span className="text-muted-foreground italic text-sm">Unassigned</span>}</TableCell>
                    {isAdmin && <TableCell className="text-sm">{fmtDay(e.dateOfJoining)}</TableCell>}
                    {isAdmin && (
                      <TableCell>
                        {e.user ? (
                          <select
                            className="h-8 rounded-md border bg-white/70 px-2 text-xs"
                            value={e.user.role}
                            disabled={e.status === 'EXITED'}
                            onChange={(ev) => changeRole.mutate({ id: e.id, role: ev.target.value })}
                          >
                            <option value="EMPLOYEE">Employee</option>
                            <option value="MANAGER">Manager</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">No login</span>
                        )}
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell className="text-right pr-6 space-x-1">
                        {!e.userId && e.status !== 'EXITED' && (
                          <Button variant="ghost" size="sm" onClick={() => invite.mutate(e)} disabled={invite.isPending}>
                            <Mail size={14} className="mr-1" /> Invite
                          </Button>
                        )}
                        {e.status !== 'EXITED' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-600"
                            onClick={() => window.confirm(`Offboard ${e.firstName}? Their access is revoked immediately.`) && offboard.mutate(e)}
                          >
                            <UserMinus size={14} className="mr-1" /> Offboard
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!list.isLoading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                      No employees found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {(list.data?.totalPages ?? 1) > 1 && (
              <div className="flex items-center justify-end gap-2 p-4 text-sm">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span>
                  Page {page} of {list.data?.totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= (list.data?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
