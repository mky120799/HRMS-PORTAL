import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Activity, ShieldCheck, ShieldAlert, Database, Trash, Edit, PlusCircle, LogIn, ExternalLink } from 'lucide-react';

type AuditLog = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
};

type Category = 'all' | 'security';

/** Security event taxonomy (docs/modules/auth.md). Empty value = every security event. */
const SECURITY_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'MFA_CHALLENGE_FAILED',
  'ACCOUNT_LOCKED',
  'SSO_LOGIN_FAILED',
  'REFRESH_TOKEN_REUSE',
  'STEP_UP',
  'STEP_UP_FAILED',
  'LOGOUT',
  'SESSION_REVOKED',
  'SESSIONS_REVOKED',
  'ADMIN_FORCE_LOGOUT',
  'SESSION_IDLE_TIMEOUT',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET',
  'PASSWORD_CHANGED',
  '2FA_ENABLED',
  '2FA_DISABLED',
  'MFA_ENROLLMENT_REQUIRED',
  'MFA_RECOVERY_CODE_USED',
  'MFA_RECOVERY_CODES_REGENERATED',
  'ADMIN_MFA_RESET',
  'AUTH_POLICY_UPDATED',
  'IDENTITY_PROVIDER_CREATED',
  'IDENTITY_PROVIDER_UPDATED',
  'SCIM_TOKEN_ROTATED',
  'SSO_USER_PROVISIONED',
  'ROLE_SYNCED_FROM_IDP',
];

/** Events an administrator should look at; see docs/modules/auth-runbooks.md. */
const ALERT_ACTIONS = new Set(['ACCOUNT_LOCKED', 'REFRESH_TOKEN_REUSE', 'SSO_LOGIN_FAILED', 'MFA_CHALLENGE_FAILED', 'STEP_UP_FAILED', 'ADMIN_MFA_RESET']);

const PAGE_SIZE = 50;

export function AuditLogsPage() {
  const [category, setCategory] = useState<Category>('security');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', 'logs', category, action, page],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (
        await api.get<Paged<AuditLog>>('/audit', {
          params: {
            page,
            pageSize: PAGE_SIZE,
            category: category === 'security' ? 'security' : undefined,
            action: action || undefined,
          },
        })
      ).data,
  });
  const logs = data?.items;

  const choose = (next: Category) => {
    setCategory(next);
    setAction('');
    setPage(1);
  };

  const getActionBadge = (value: string) => {
    if (ALERT_ACTIONS.has(value)) {
      return (
        <Badge variant="destructive">
          <ShieldAlert size={12} className="mr-1" /> {value}
        </Badge>
      );
    }
    switch (value.toUpperCase()) {
      case 'CREATE': return <Badge className="bg-emerald-500 hover:bg-emerald-600"><PlusCircle size={12} className="mr-1"/> Create</Badge>;
      case 'UPDATE': return <Badge className="bg-blue-500 hover:bg-blue-600"><Edit size={12} className="mr-1"/> Update</Badge>;
      case 'DELETE': return <Badge variant="destructive"><Trash size={12} className="mr-1"/> Delete</Badge>;
      case 'LOGIN': return <Badge variant="secondary" className="bg-indigo-100 text-indigo-800"><LogIn size={12} className="mr-1"/> Login</Badge>;
      case 'EXPORT': return <Badge variant="outline" className="text-purple-600 border-purple-200"><ExternalLink size={12} className="mr-1"/> Export</Badge>;
      default: return <Badge variant="outline">{value}</Badge>;
    }
  };

  const getResourceIcon = (resource: string) => {
    if (resource.includes('auth') || resource.includes('identity') || resource.includes('security')) return <ShieldCheck size={16} className="text-slate-400" />;
    return <Database size={16} className="text-slate-400" />;
  };

  /** Small, non-sensitive details worth showing inline (method, reason, provider…). */
  const details = (log: AuditLog) => {
    const values = log.newValues ?? {};
    return ['method', 'reason', 'trigger', 'providerName', 'role', 'count']
      .filter((key) => values[key] !== undefined && values[key] !== null)
      .map((key) => `${key}: ${String(values[key])}`)
      .join(' · ');
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
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{category === 'security' ? 'Security events' : 'All activity'}</CardTitle>
              <CardDescription>
                {category === 'security'
                  ? 'Sign-ins, failures, lockouts, MFA, sessions, SSO and security settings. Red events need review.'
                  : 'Every recorded event, newest first.'}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={category === 'security' ? 'default' : 'outline'} onClick={() => choose('security')}>
                Security events
              </Button>
              <Button size="sm" variant={category === 'all' ? 'default' : 'outline'} onClick={() => choose('all')}>
                All activity
              </Button>
            </div>
          </div>
          {category === 'security' && (
            <select
              className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by event"
            >
              <option value="">All security events</option>
              {SECURITY_ACTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          )}
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
                    <TableCell>
                      {getActionBadge(log.action)}
                      {details(log) && <div className="text-xs text-muted-foreground mt-1">{details(log)}</div>}
                    </TableCell>
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
                    <TableCell className="text-xs text-slate-500" title={log.userAgent ?? undefined}>
                      {log.ipAddress || 'Unknown'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {data && data.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {data.page} of {data.totalPages} · {data.total} events
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
