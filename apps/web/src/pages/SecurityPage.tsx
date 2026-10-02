import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldCheck, ShieldAlert, Download, KeyRound, MonitorSmartphone, RotateCcw, Copy } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { getAuth, setAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { passwordSchema } from '../lib/validation';
import { fmtDate } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';

type Session = {
  id: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  revokedReason?: string | null;
  current: boolean;
  active: boolean;
};

export function SecurityPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');
  const [qrUrl, setQrUrl] = useState('');
  const [code, setCode] = useState('');
  const [regenCode, setRegenCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pw, setPw] = useState({ current: '', next: '' });

  const me = useQuery({ queryKey: ['me'], queryFn: async () => (await api.get<{ isTwoFactorEnabled: boolean; recoveryCodeCount?: number }>('/auth/me')).data });
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: async () => (await api.get<Session[]>('/auth/sessions')).data });
  const enabled = me.data?.isTwoFactorEnabled;

  const begin = useMutation({
    mutationFn: async () => (await api.post<{ qrCodeUrl: string }>('/auth/2fa/generate')).data,
    onSuccess: (d) => setQrUrl(d.qrCodeUrl),
    onError,
  });
  const toggle = useMutation({
    mutationFn: async () => (await api.post<{ recoveryCodes?: string[] }>(enabled ? '/auth/2fa/turn-off' : '/auth/2fa/turn-on', { code })).data,
    onSuccess: (result) => {
      if (result.recoveryCodes?.length) setRecoveryCodes(result.recoveryCodes);
      showToast(enabled ? 'Two-factor authentication disabled' : 'Two-factor authentication enabled', 'success');
      setQrUrl('');
      setCode('');
      me.refetch();
    },
    onError,
  });
  const regenerateCodes = useMutation({
    mutationFn: async () => (await api.post<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes/regenerate', { code: regenCode })).data,
    onSuccess: (result) => {
      setRecoveryCodes(result.recoveryCodes);
      setRegenCode('');
      me.refetch();
      showToast('New recovery codes generated', 'success');
    },
    onError,
  });
  const revokeSession = useMutation({
    mutationFn: async (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      showToast('Session revoked', 'success');
    },
    onError,
  });
  const revokeOtherSessions = useMutation({
    mutationFn: async () => api.post('/auth/sessions/revoke-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      showToast('Other sessions revoked', 'success');
    },
    onError,
  });
  const changePassword = useMutation({
    mutationFn: async () => {
      const check = passwordSchema.safeParse(pw.next);
      if (!check.success) throw new Error(check.error.issues[0].message);
      return (await api.post('/auth/change-password', { currentPassword: pw.current, newPassword: pw.next })).data;
    },
    onSuccess: (session) => {
      const auth = getAuth();
      if (auth) setAuth({ ...auth, ...session }); // this device stays signed in; others are signed out
      setPw({ current: '', next: '' });
      showToast('Password changed. Other devices have been signed out.', 'success');
    },
    onError,
  });

  const copyRecoveryCodes = () =>
    navigator.clipboard.writeText(recoveryCodes.join('\n')).then(() => showToast('Recovery codes copied', 'success')).catch(onError);

  const downloadRecoveryCodes = () => {
    const blob = new Blob([recoveryCodes.join('\n')], { type: 'text/plain' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'hrms-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto py-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="text-indigo-600" /> Security & Privacy
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {enabled ? <ShieldCheck className="text-emerald-500" /> : <ShieldAlert className="text-amber-500" />} Two-factor authentication
          </CardTitle>
          <CardDescription>{enabled ? 'Enabled — sign-ins require a code from your authenticator app.' : 'Add a second step to sign-in with an authenticator app.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!enabled && !qrUrl && <Button onClick={() => begin.mutate()} disabled={begin.isPending}>Set up 2FA</Button>}
          {qrUrl && (
            <div className="space-y-2">
              <img src={qrUrl} alt="Scan with your authenticator app" className="w-48 h-48 border rounded" />
              <p className="text-sm text-muted-foreground">Scan with Google Authenticator, 1Password or Authy, then enter the 6-digit code.</p>
            </div>
          )}
          {(qrUrl || enabled) && (
            <div className="flex gap-2 max-w-sm">
              <Input placeholder="123456" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <Button variant={enabled ? 'outline' : 'default'} disabled={code.length !== 6 || toggle.isPending} onClick={() => toggle.mutate()}>
                {enabled ? 'Disable' : 'Verify & enable'}
              </Button>
            </div>
          )}
          {enabled && (
            <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
              <div>
                <div className="font-medium">Recovery codes</div>
                <p className="text-sm text-muted-foreground">
                  Keep these somewhere safe. Each code works once if you lose your authenticator app.
                  {me.data?.recoveryCodeCount != null ? ` ${me.data.recoveryCodeCount} unused code(s) remain.` : ''}
                </p>
              </div>
              {recoveryCodes.length > 0 && (
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {recoveryCodes.map((item) => (
                      <code key={item} className="rounded bg-white px-3 py-2 text-sm font-semibold tracking-wider border">{item}</code>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={copyRecoveryCodes}><Copy size={14} className="mr-1" /> Copy</Button>
                    <Button variant="outline" size="sm" onClick={downloadRecoveryCodes}><Download size={14} className="mr-1" /> Download</Button>
                  </div>
                </div>
              )}
              <div className="flex gap-2 max-w-sm">
                <Input placeholder="Authenticator code" maxLength={6} value={regenCode} onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, ''))} />
                <Button variant="outline" disabled={regenCode.length !== 6 || regenerateCodes.isPending} onClick={() => regenerateCodes.mutate()}>
                  <RotateCcw size={14} className="mr-1" /> Regenerate
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone size={18} /> Active sessions
          </CardTitle>
          <CardDescription>Review devices signed in to your account and revoke anything you do not recognize.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" disabled={revokeOtherSessions.isPending} onClick={() => revokeOtherSessions.mutate()}>
              Revoke other sessions
            </Button>
          </div>
          {sessions.data?.map((session) => (
            <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white/60 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium truncate max-w-xl">{session.userAgent ?? 'Unknown device'}</div>
                  {session.current && <Badge variant="outline">Current</Badge>}
                  {!session.active && <Badge variant="outline" className="text-red-600">Revoked</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {session.ipAddress ?? 'Unknown IP'} · Last used {fmtDate(session.lastUsedAt)} · Expires {fmtDate(session.expiresAt)}
                  {session.revokedReason ? ` · ${session.revokedReason}` : ''}
                </div>
              </div>
              {!session.current && session.active && (
                <Button variant="outline" size="sm" disabled={revokeSession.isPending} onClick={() => revokeSession.mutate(session.id)}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
          {!sessions.isLoading && !sessions.data?.length && <div className="text-sm text-muted-foreground">No active sessions found.</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound size={18} /> Change password
          </CardTitle>
          <CardDescription>At least 10 characters with a letter and a number. Other sessions are signed out.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 max-w-sm">
          <div className="space-y-1">
            <Label>Current password</Label>
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>New password</Label>
            <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
          </div>
          <Button disabled={!pw.current || !pw.next || changePassword.isPending} onClick={() => changePassword.mutate()}>
            Update password
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download size={18} /> Your data
          </CardTitle>
          <CardDescription>Download a copy of everything this workspace stores about you (JSON).</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => downloadFile('/gdpr/export', 'my-data.json').catch(onError)}>
            Export my data
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
