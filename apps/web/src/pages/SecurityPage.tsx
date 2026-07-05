import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Shield, ShieldAlert, ShieldCheck, Download, AlertTriangle } from 'lucide-react';
import { getAuth } from '../lib/auth';

export function SecurityPage() {
  const { showToast } = useToast();
  const auth = getAuth();
  const [showQr, setShowQr] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [verificationCode, setVerificationCode] = useState('');

  // Fetch current user settings to see if 2FA is already enabled
  const { data: userProfile, refetch } = useQuery({
    queryKey: ['profile', 'me'],
    queryFn: async () => {
      const res = await api.get('/auth/me');
      return res.data;
    },
  });

  const generate2faMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/auth/2fa/generate');
      return res.data;
    },
    onSuccess: (data) => {
      setQrUrl(data.qrCodeUrl);
      setShowQr(true);
    },
    onError: () => showToast('Failed to generate 2FA setup.', 'error'),
  });

  const turnOn2faMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await api.post('/auth/2fa/turn-on', { code });
      return res.data;
    },
    onSuccess: () => {
      showToast('Two-Factor Authentication successfully enabled!', 'success');
      setShowQr(false);
      setVerificationCode('');
      refetch();
    },
    onError: () => showToast('Invalid verification code.', 'error'),
  });

  const exportGdprMutation = useMutation({
    mutationFn: async () => {
      // Must use window.location or fetch as Blob to trigger download
      const res = await api.get('/gdpr/export', { responseType: 'blob' });
      return res.data;
    },
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `gdpr-export-${auth?.user.sub}.json`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      showToast('Data export downloaded successfully.', 'success');
    },
    onError: () => showToast('Failed to export data.', 'error'),
  });

  const is2FAEnabled = userProfile?.isTwoFactorEnabled;

  return (
    <div className="space-y-8 max-w-4xl mx-auto py-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="text-indigo-600" />
          Security & Privacy
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your account security and data privacy settings.
        </p>
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Two-Factor Authentication (2FA)
            {is2FAEnabled ? (
              <ShieldCheck className="text-emerald-500 h-5 w-5" />
            ) : (
              <ShieldAlert className="text-amber-500 h-5 w-5" />
            )}
          </CardTitle>
          <CardDescription>
            Add an extra layer of security to your account. Once configured, you'll be required to enter both your password and an authentication code from your mobile phone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {is2FAEnabled ? (
            <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-lg flex items-start gap-3">
              <ShieldCheck className="text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-emerald-900">2FA is currently enabled</h4>
                <p className="text-sm text-emerald-700 mt-1">Your account is secured with multi-factor authentication.</p>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-lg flex items-start gap-3">
              <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-amber-900">2FA is not enabled</h4>
                <p className="text-sm text-amber-700 mt-1">We highly recommend enabling 2FA to protect your enterprise data.</p>
              </div>
            </div>
          )}

          {!is2FAEnabled && !showQr && (
            <Button 
              onClick={() => generate2faMutation.mutate()} 
              disabled={generate2faMutation.isPending}
            >
              {generate2faMutation.isPending ? 'Generating...' : 'Setup Two-Factor Authentication'}
            </Button>
          )}

          {showQr && !is2FAEnabled && (
            <div className="p-6 border rounded-lg bg-slate-50 space-y-4">
              <h4 className="font-semibold text-sm">Step 1: Scan this QR Code</h4>
              <p className="text-xs text-muted-foreground">Open your authenticator app (e.g. Google Authenticator, Authy) and scan this QR code.</p>
              <div className="bg-white p-2 inline-block rounded border">
                <img src={qrUrl} alt="2FA QR Code" className="w-40 h-40" />
              </div>
              
              <h4 className="font-semibold text-sm mt-6">Step 2: Enter Verification Code</h4>
              <p className="text-xs text-muted-foreground">Enter the 6-digit code generated by your app.</p>
              <div className="flex items-center gap-3 max-w-sm">
                <Input 
                  placeholder="000000" 
                  maxLength={6} 
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="font-mono text-lg tracking-widest text-center"
                />
                <Button 
                  onClick={() => turnOn2faMutation.mutate(verificationCode)}
                  disabled={verificationCode.length !== 6 || turnOn2faMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Verify & Enable
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="text-blue-500 h-5 w-5" />
            GDPR Data Export
          </CardTitle>
          <CardDescription>
            Download a complete JSON record of all data associated with your account, in compliance with GDPR Right to Access regulations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            This export includes your profile details, attendance records, leaves, payslips, and associated documents.
          </p>
          <Button 
            variant="outline" 
            onClick={() => exportGdprMutation.mutate()}
            disabled={exportGdprMutation.isPending}
            className="w-full sm:w-auto"
          >
            <Download size={16} className="mr-2" />
            {exportGdprMutation.isPending ? 'Preparing Export...' : 'Download My Data'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
