import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Shield, ShieldCheck, ShieldAlert, Download, KeyRound } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { getAuth, setAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { passwordSchema } from '../lib/validation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export function SecurityPage() {
  const { showToast } = useToast();
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');
  const [qrUrl, setQrUrl] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });

  const me = useQuery({ queryKey: ['me'], queryFn: async () => (await api.get<{ isTwoFactorEnabled: boolean }>('/auth/me')).data });
  const enabled = me.data?.isTwoFactorEnabled;

  const begin = useMutation({
    mutationFn: async () => (await api.post<{ qrCodeUrl: string }>('/auth/2fa/generate')).data,
    onSuccess: (d) => setQrUrl(d.qrCodeUrl),
    onError,
  });
  const toggle = useMutation({
    mutationFn: async () => api.post(enabled ? '/auth/2fa/turn-off' : '/auth/2fa/turn-on', { code }),
    onSuccess: () => {
      showToast(enabled ? 'Two-factor authentication disabled' : 'Two-factor authentication enabled', 'success');
      setQrUrl('');
      setCode('');
      me.refetch();
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
