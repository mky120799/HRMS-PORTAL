import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Activity, ShieldCheck, Database, Trash, Edit, PlusCircle, LogIn, ExternalLink } from 'lucide-react';
import { getAuth } from '../lib/auth';

type AuditLog = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  userId: string | null;
  ipAddress: string | null;
  createdAt: string;
};

export function AuditLogsPage() {
  const auth = getAuth();

  const { data: logs, isLoading } = useQuery<AuditLog[]>({
    queryKey: ['audit', 'logs'],
    queryFn: async () => {
      const res = await api.get('/audit?limit=50');
      return res.data;
    },
  });

  const getActionBadge = (action: string) => {
    switch (action.toUpperCase()) {
      case 'CREATE': return <Badge className="bg-emerald-500 hover:bg-emerald-600"><PlusCircle size={12} className="mr-1"/> Create</Badge>;
      case 'UPDATE': return <Badge className="bg-blue-500 hover:bg-blue-600"><Edit size={12} className="mr-1"/> Update</Badge>;
      case 'DELETE': return <Badge variant="destructive"><Trash size={12} className="mr-1"/> Delete</Badge>;
      case 'LOGIN': return <Badge variant="secondary" className="bg-indigo-100 text-indigo-800"><LogIn size={12} className="mr-1"/> Login</Badge>;
      case 'EXPORT': return <Badge variant="outline" className="text-purple-600 border-purple-200"><ExternalLink size={12} className="mr-1"/> Export</Badge>;
      default: return <Badge variant="outline">{action}</Badge>;
    }
  };

  const getResourceIcon = (resource: string) => {
    if (resource.includes('auth') || resource.includes('security')) return <ShieldCheck size={16} className="text-slate-400" />;
    return <Database size={16} className="text-slate-400" />;
  };

  return (
    <div className="space-y-8 py-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Activity className="text-indigo-600" />
          Audit Logs
        </h1>
        <p className="text-muted-foreground mt-1">
          Review system events, data mutations, and security actions across your organization.
        </p>
      </div>

      <Card className="border-border/50 bg-white/50 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>The last 50 events logged for tenant {auth?.user.tenantId}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>IP Address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-32 text-muted-foreground">Loading audit trails...</TableCell>
                </TableRow>
              ) : logs?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-32 text-muted-foreground">No audit logs found.</TableCell>
                </TableRow>
              ) : (
                logs?.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-slate-600 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {getResourceIcon(log.resource)}
                        <span className="capitalize">{log.resource}</span>
                      </div>
                      {log.resourceId && <div className="text-xs text-muted-foreground mt-1 font-mono">ID: {log.resourceId.substring(0, 8)}...</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {log.userId || 'System'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {log.ipAddress || 'Unknown'}
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
