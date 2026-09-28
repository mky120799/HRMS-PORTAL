import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Building2, Users, Search } from 'lucide-react';
import { api, type Paged } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { fmtDate } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type Tenant = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  _count: { users: number; employees: number };
};

/** Platform operator console. Shows tenant metadata only — never customers' employee data. */
export function SuperAdminPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const tenants = useQuery({
    queryKey: ['platform', 'tenants', search, page],
    queryFn: async () => (await api.get<Paged<Tenant>>('/platform/tenants', { params: { search: search || undefined, page, pageSize: 25 } })).data,
  });
  const setActive = useMutation({
    mutationFn: async (t: Tenant) => api.patch(`/platform/tenants/${t.id}`, { isActive: !t.isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform'] });
      showToast('Tenant updated', 'success');
    },
    onError: (e) => showToast(getErrorMessage(e), 'error'),
  });

  const items = tenants.data?.items ?? [];
  const paying = items.filter((t) => t.subscriptionStatus === 'ACTIVE').length;

  return (
    <div className="space-y-6 py-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="text-indigo-600" /> Platform
        </h1>
        <p className="text-muted-foreground mt-1">All workspaces. Revenue metrics live in the Stripe dashboard.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2"><Building2 size={14} /> Workspaces</CardDescription>
            <CardTitle className="text-3xl">{tenants.data?.total ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Paying (this page)</CardDescription>
            <CardTitle className="text-3xl">{paying}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2"><Users size={14} /> Employees (this page)</CardDescription>
            <CardTitle className="text-3xl">{items.reduce((n, t) => n + t._count.employees, 0)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Workspaces</CardTitle>
          <div className="relative w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name or slug" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Workspace</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Users / Employees</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="pr-6 text-right">Access</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="pl-6">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.slug}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t.subscriptionPlan}</Badge> <span className="text-xs text-muted-foreground">{t.subscriptionStatus}</span>
                  </TableCell>
                  <TableCell>
                    {t._count.users} / {t._count.employees}
                  </TableCell>
                  <TableCell>{fmtDate(t.createdAt)}</TableCell>
                  <TableCell className="pr-6 text-right">
                    <Button
                      size="sm"
                      variant={t.isActive ? 'outline' : 'default'}
                      className={t.isActive ? 'text-red-600' : ''}
                      onClick={() => window.confirm(`${t.isActive ? 'Suspend' : 'Reactivate'} ${t.name}?`) && setActive.mutate(t)}
                    >
                      {t.isActive ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(tenants.data?.totalPages ?? 1) > 1 && (
            <div className="flex justify-end gap-2 p-4">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page >= (tenants.data?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
