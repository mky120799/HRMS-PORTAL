import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Plus, Search, Mail, UserMinus, ShieldOff, LogOut } from 'lucide-react';
import { api, type Paged } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { hasPermission } from '../lib/auth';
import { useRoleCatalog } from '../components/CustomRolesPanel';
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
  user?: { role: string; isActive: boolean; customRoleId?: string | null; roleManagedBy?: string | null } | null;
};

const ROLE_OPTIONS = [
  ['EMPLOYEE', 'Employee'],
  ['MANAGER', 'Manager'],
  ['HR_MANAGER', 'HR manager'],
  ['HR_ADMIN', 'HR admin'],
  ['PAYROLL_ADMIN', 'Payroll admin'],
  ['RECRUITER', 'Recruiter'],
  ['HIRING_MANAGER', 'Hiring manager'],
  ['INTERVIEWER', 'Interviewer'],
  ['FINANCE', 'Finance'],
  ['AUDITOR', 'Auditor'],
  ['IT_ADMIN', 'IT admin'],
  ['ADMIN', 'Admin'],
] as const;

export function EmployeesPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const canManageEmployees = hasPermission(['employees.manage']);
  const canManageRoles = hasPermission(['employees.roles.manage']);
  const canManageSecurity = hasPermission(['security.manage']);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const roleCatalog = useRoleCatalog(canManageRoles);
  const customRoles = roleCatalog.data?.custom ?? [];

  const list = useQuery({
    queryKey: ['employees', search, page],
    queryFn: async () => (await api.get<Paged<Employee>>('/employees', { params: { search: search || undefined, page, pageSize: 20 } })).data,
  });
  const managers = useQuery({
    queryKey: ['employees', 'all-active'],
    enabled: canManageEmployees,
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
    // Option values are a built-in role or "custom:<id>".
    mutationFn: async ({ id, role }: { id: string; role: string }) =>
      api.patch(`/employees/${id}/role`, role.startsWith('custom:') ? { customRoleId: role.slice(7) } : { role }),
    onSuccess: () => {
      refresh();
      showToast('Role updated', 'success');
    },
    onError,
  });
  const forceLogout = useMutation({
    mutationFn: async (e: Employee) => api.post(`/auth/users/${e.userId}/revoke-sessions`),
    onSuccess: () => showToast('User sessions revoked', 'success'),
    onError,
  });
  const resetMfa = useMutation({
    mutationFn: async (e: Employee) => api.post(`/auth/users/${e.userId}/reset-mfa`),
    onSuccess: () => {
      refresh();
      showToast('MFA reset and sessions revoked', 'success');
    },
    onError,
  });

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{canManageEmployees ? 'Employee Roster' : 'Company Directory'}</h2>
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

      <div className={`grid gap-6 ${canManageEmployees ? 'lg:grid-cols-3' : ''}`}>
        {canManageEmployees && (
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

        <Card className={`${canManageEmployees ? 'lg:col-span-2' : ''} bg-white/50 backdrop-blur-xl overflow-hidden`}>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="pl-6">Employee</TableHead>
                  <TableHead>Department</TableHead>
                  {canManageEmployees && <TableHead>Joined</TableHead>}
                  {canManageEmployees && <TableHead>Access</TableHead>}
                  {canManageEmployees && <TableHead className="text-right pr-6">Actions</TableHead>}
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
                    {canManageEmployees && <TableCell className="text-sm">{fmtDay(e.dateOfJoining)}</TableCell>}
                    {canManageEmployees && (
                      <TableCell>
                        {e.user ? (
                          <div className="flex items-center gap-1">
                            <select
                              className="h-8 rounded-md border bg-white/70 px-2 text-xs"
                              value={e.user.customRoleId ? `custom:${e.user.customRoleId}` : e.user.role}
                              disabled={e.status === 'EXITED' || !canManageRoles}
                              onChange={(ev) => changeRole.mutate({ id: e.id, role: ev.target.value })}
                            >
                              {ROLE_OPTIONS.map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                              {customRoles
                                .filter((role) => role.isActive || role.id === e.user?.customRoleId)
                                .map((role) => (
                                  <option key={role.id} value={`custom:${role.id}`} disabled={!role.isActive}>
                                    {role.name} (custom)
                                  </option>
                                ))}
                              {e.user.customRoleId && !customRoles.some((role) => role.id === e.user?.customRoleId) && (
                                <option value={`custom:${e.user.customRoleId}`}>Custom role</option>
                              )}
                            </select>
                            {e.user.roleManagedBy?.startsWith('idp:') && (
                              <Badge variant="outline" className="text-[10px]" title="Set by your identity provider's group mapping">IdP</Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No login</span>
                        )}
                      </TableCell>
                    )}
                    {canManageEmployees && (
                      <TableCell className="text-right pr-6 space-x-1">
                        {!e.userId && e.status !== 'EXITED' && (
                          <Button variant="ghost" size="sm" onClick={() => invite.mutate(e)} disabled={invite.isPending}>
                            <Mail size={14} className="mr-1" /> Invite
                          </Button>
                        )}
                        {canManageSecurity && e.userId && e.status !== 'EXITED' && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => forceLogout.mutate(e)} disabled={forceLogout.isPending}>
                              <LogOut size={14} className="mr-1" /> Force logout
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => window.confirm(`Reset MFA for ${e.firstName}? They will need to enroll again.`) && resetMfa.mutate(e)} disabled={resetMfa.isPending}>
                              <ShieldOff size={14} className="mr-1" /> Reset MFA
                            </Button>
                          </>
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
