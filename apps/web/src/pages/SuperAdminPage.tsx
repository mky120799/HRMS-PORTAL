import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { getAuth } from '../lib/auth';
import { Building2, Users, DollarSign, Activity, Ban, CheckCircle } from 'lucide-react';
import { Navigate } from 'react-router-dom';

type Tenant = {
  id: string;
  name: string;
  createdAt: string;
  subscriptionStatus: string;
  _count: {
    users: number;
    employees: number;
  };
};

export function SuperAdminPage() {
  const auth = getAuth();
  
  // Protect route
  if (auth?.user.role !== 'SUPER_ADMIN') {
    return <Navigate to="/dashboard" replace />;
  }

  // Use react-query to fetch global data. In reality, we'd need a super-admin specific controller.
  const { data: tenants, isLoading } = useQuery({
    queryKey: ['superadmin', 'tenants'],
    queryFn: async () => {
      // MOCK DATA for demonstration, since we haven't built the super-admin API endpoint yet
      return [
        { id: '1', name: 'Acme Corp', createdAt: '2026-01-15', subscriptionStatus: 'ACTIVE', _count: { users: 2, employees: 45 } },
        { id: '2', name: 'Globex Inc', createdAt: '2026-03-22', subscriptionStatus: 'TRIAL', _count: { users: 1, employees: 12 } },
        { id: '3', name: 'Initech', createdAt: '2026-06-10', subscriptionStatus: 'PAST_DUE', _count: { users: 3, employees: 150 } },
        { id: '4', name: 'Umbrella Corp', createdAt: '2025-11-05', subscriptionStatus: 'CANCELED', _count: { users: 1, employees: 8 } },
      ] as Tenant[];
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE': return <Badge className="bg-emerald-500 hover:bg-emerald-600">Active</Badge>;
      case 'TRIAL': return <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-200">Trial</Badge>;
      case 'PAST_DUE': return <Badge variant="destructive">Past Due</Badge>;
      default: return <Badge variant="outline" className="text-slate-500">Canceled</Badge>;
    }
  };

  const activeTenants = tenants?.filter(t => t.subscriptionStatus === 'ACTIVE').length || 0;
  const trialTenants = tenants?.filter(t => t.subscriptionStatus === 'TRIAL').length || 0;
  const mrr = activeTenants * 299; // Assuming $299/mo standard plan

  return (
    <div className="space-y-8 py-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Activity className="text-indigo-600" />
          Global Command Center
        </h1>
        <p className="text-muted-foreground mt-1">
          Super Admin dashboard for monitoring all tenants, revenue, and system health.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50 bg-white/50 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue (MRR)</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${mrr.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">+12% from last month</p>
          </CardContent>
        </Card>
        
        <Card className="border-border/50 bg-white/50 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Tenants</CardTitle>
            <Building2 className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeTenants}</div>
            <p className="text-xs text-muted-foreground">{trialTenants} currently in trial</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-white/50 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {tenants?.reduce((acc, t) => acc + t._count.users, 0) || 0}
            </div>
            <p className="text-xs text-muted-foreground">Admins & Managers</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-white/50 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">Operational</div>
            <p className="text-xs text-muted-foreground">All systems go</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 bg-white/50 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Registered Tenants</CardTitle>
          <CardDescription>Manage all organizations currently using the HRMS platform.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">Loading tenants...</TableCell>
                </TableRow>
              ) : (
                tenants?.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell className="font-medium">{tenant.name}</TableCell>
                    <TableCell>{getStatusBadge(tenant.subscriptionStatus)}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(tenant.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">{tenant._count.employees}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                        <Ban size={14} className="mr-1" /> Suspend
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
