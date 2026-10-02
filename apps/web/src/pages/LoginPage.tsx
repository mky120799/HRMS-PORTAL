import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { LogIn, Building2, Mail, Lock, ShieldCheck, KeyRound, Copy } from 'lucide-react';
import { api, API_BASE_URL } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { lastWorkspace, rememberWorkspace, setAuth, type AuthState } from '../lib/auth';
import { useToast } from '../lib/toast';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';

const schema = z.object({
  tenantId: z.string().trim().min(1, 'Workspace is required'),
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormData = z.infer<typeof schema>;
type SsoProvider = { id: string; name: string; providerType: 'OIDC' | 'SAML'; allowedDomains: string[] };
type SsoProvidersResponse = {
  googleEnabled: boolean;
  oidc: SsoProvider[];
  saml: SsoProvider[];
};
type WorkspaceDiscoveryResponse = {
  workspaces: { id: string; name: string; slug: string; providers: { id: string; name: string; providerType: string }[] }[];
};

export function LoginPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { showToast } = useToast();

  const [isTwoFactorPending, setIsTwoFactorPending] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [enrollmentQr, setEnrollmentQr] = useState('');
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [pendingSession, setPendingSession] = useState<{ session: AuthState; recoveryCodes: string[] } | null>(null);
  const [ssoProviders, setSsoProviders] = useState<SsoProvidersResponse | null>(null);
  const [workspaceDiscovery, setWorkspaceDiscovery] = useState<WorkspaceDiscoveryResponse | null>(null);
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { tenantId: params.get('workspace') ?? lastWorkspace() },
  });
  const workspace = watch('tenantId');
  const email = watch('email');

  useEffect(() => {
    if (params.get('error') === 'sso_failed') {
      showToast('SSO sign-in failed. Your provider email must already have an account in that workspace.', 'error');
    }
    if (params.get('mfa_enroll') === '1') {
      const pending = sessionStorage.getItem('ssoEnrollmentToken');
      if (pending) {
        sessionStorage.removeItem('ssoEnrollmentToken');
        void startEnrollment(pending);
      }
    }
    if (params.get('sso_2fa') === '1') {
      const pending = sessionStorage.getItem('ssoTempToken');
      if (pending) {
        sessionStorage.removeItem('ssoTempToken');
        setTempToken(pending);
        setIsTwoFactorPending(true);
        showToast('Enter your MFA code or a recovery code to finish SSO sign-in.');
      }
    }
  }, [params, showToast]);

  useEffect(() => {
    const tenant = workspace?.trim();
    if (!tenant) {
      setSsoProviders(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .get<SsoProvidersResponse>('/auth/sso/providers', { params: { tenant } })
        .then((res) => {
          if (!cancelled) setSsoProviders(res.data);
        })
        .catch(() => {
          if (!cancelled) setSsoProviders(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workspace]);

  useEffect(() => {
    const value = email?.trim();
    if (!value || !value.includes('@') || workspace?.trim()) {
      setWorkspaceDiscovery(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .get<WorkspaceDiscoveryResponse>('/auth/sso/discovery', { params: { email: value } })
        .then((res) => {
          if (!cancelled) setWorkspaceDiscovery(res.data);
        })
        .catch(() => {
          if (!cancelled) setWorkspaceDiscovery(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [email, workspace]);

  /** The workspace requires MFA and this account has not set it up: enrol before signing in. */
  async function startEnrollment(token: string) {
    try {
      const res = await api.post<{ qrCodeUrl: string }>('/auth/2fa/enroll/start', { enrollmentToken: token });
      setEnrollmentToken(token);
      setEnrollmentQr(res.data.qrCodeUrl);
      setEnrollmentCode('');
    } catch (error: unknown) {
      showToast(getErrorMessage(error), 'error');
    }
  }

  const completeEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<AuthState & { recoveryCodes: string[] }>('/auth/2fa/enroll/complete', { enrollmentToken, code: enrollmentCode });
      const { recoveryCodes, ...session } = res.data;
      setEnrollmentToken('');
      setPendingSession({ session, recoveryCodes });
    } catch (error: unknown) {
      showToast(getErrorMessage(error), 'error');
    }
  };

  const finishEnrollment = () => {
    if (!pendingSession) return;
    setAuth(pendingSession.session);
    setPendingSession(null);
    showToast('Two-factor authentication is set up');
    nav('/');
  };

  const onSubmit = async (values: FormData) => {
    try {
      const res = await api.post('/auth/login', values);
      const data = res.data;
      rememberWorkspace(values.tenantId);

      if (data.twoFactorRequired) {
        setIsTwoFactorPending(true);
        setTempToken(data.tempToken);
        return;
      }
      if (data.mfaEnrollmentRequired) {
        await startEnrollment(data.enrollmentToken);
        return;
      }
      
      setAuth(data);
      showToast('Welcome back');
      nav('/');
    } catch (error: unknown) {
      showToast(getErrorMessage(error), 'error');
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/2fa/authenticate', {
        tempToken,
        code: totpCode,
      });
      setAuth(res.data);
      showToast('Welcome back');
      nav('/');
    } catch (error: unknown) {
      showToast(getErrorMessage(error), 'error');
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-900 to-indigo-950 p-4">
      <Card className="w-full max-w-[440px] bg-white/5 border-white/10 text-white backdrop-blur-xl">
        <CardHeader className="text-center pb-8">
          <div className="mx-auto mb-4 inline-flex p-3 bg-indigo-500/20 rounded-xl">
            <LogIn size={32} className="text-indigo-400" />
          </div>
          <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
          <CardDescription className="text-slate-400">Enter your credentials to access your portal</CardDescription>
        </CardHeader>
        
        <CardContent>
          {pendingSession ? (
            <div className="space-y-5">
              <div className="space-y-2 text-sm text-slate-300">
                <p className="flex items-center gap-2 font-medium text-white">
                  <KeyRound size={16} /> Save your recovery codes
                </p>
                <p>Each code works once if you lose your authenticator. They will not be shown again.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/5 p-3 font-mono text-sm">
                {pendingSession.recoveryCodes.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-slate-300"
                onClick={() =>
                  navigator.clipboard
                    .writeText(pendingSession.recoveryCodes.join('\n'))
                    .then(() => showToast('Recovery codes copied'))
                    .catch((error: unknown) => showToast(getErrorMessage(error), 'error'))
                }
              >
                <Copy size={14} className="mr-2" /> Copy codes
              </Button>
              <Button type="button" onClick={finishEnrollment} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-6">
                I saved them — continue
              </Button>
            </div>
          ) : enrollmentToken ? (
            <form onSubmit={completeEnrollment} className="space-y-5">
              <div className="space-y-2 text-sm text-slate-300">
                <p className="flex items-center gap-2 font-medium text-white">
                  <ShieldCheck size={16} /> Set up two-factor authentication
                </p>
                <p>Your workspace requires it. Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the 6-digit code.</p>
              </div>
              {enrollmentQr && <img src={enrollmentQr} alt="Authenticator QR code" className="mx-auto h-44 w-44 rounded-lg bg-white p-2" />}
              <Input
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={enrollmentCode}
                onChange={(e) => setEnrollmentCode(e.target.value.replace(/\D/g, ''))}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 font-mono text-center tracking-widest text-lg"
                autoFocus
              />
              <Button type="submit" disabled={enrollmentCode.length !== 6} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-6">
                Verify and sign in
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEnrollmentToken('')} className="w-full text-slate-400">
                Back to Login
              </Button>
            </form>
          ) : isTwoFactorPending ? (
            <form onSubmit={handleTwoFactorSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Lock size={14} /> Authentication or recovery code
                </Label>
                <Input 
                  placeholder="000000 or recovery code"
                  maxLength={32}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 font-mono text-center tracking-widest text-lg"
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-6 mt-2">
                Verify
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsTwoFactorPending(false)} className="w-full text-slate-400 mt-2">
                Back to Login
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Building2 size={14} /> Workspace
                </Label>
                <Input 
                  placeholder="e.g. acme-corp-1a2b3c" 
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  {...register('tenantId')} 
                />
                {errors.tenantId && <p className="text-red-400 text-xs">{errors.tenantId.message}</p>}
                {!workspace?.trim() && Boolean(workspaceDiscovery?.workspaces.length) && (
                  <div className="rounded-lg border border-indigo-400/20 bg-indigo-400/10 p-3 text-xs text-indigo-100">
                    <div className="mb-2 font-medium">Workspace found for this email domain:</div>
                    {workspaceDiscovery?.workspaces.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="block w-full rounded-md px-2 py-1 text-left hover:bg-white/10"
                        onClick={() => {
                          setValue('tenantId', item.slug, { shouldValidate: true });
                          rememberWorkspace(item.slug);
                        }}
                      >
                        {item.name} <span className="text-indigo-200/70">({item.slug})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Mail size={14} /> Email Address
                </Label>
                <Input 
                  type="email" 
                  placeholder="name@company.com" 
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  {...register('email')} 
                />
                {errors.email && <p className="text-red-400 text-xs">{errors.email.message}</p>}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300 flex items-center gap-2">
                    <Lock size={14} /> Password
                  </Label>
                  <Link to="/reset-password" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                    Forgot password?
                  </Link>
                </div>
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  {...register('password')} 
                />
                {errors.password && <p className="text-red-400 text-xs">{errors.password.message}</p>}
              </div>

              <Button 
                type="submit" 
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-6 text-base mt-2" 
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </Button>

              {(ssoProviders?.googleEnabled !== false || Boolean(ssoProviders?.oidc.length) || Boolean(ssoProviders?.saml.length)) && (
                <div className="relative my-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-transparent px-3 text-slate-500">or continue with</span>
                  </div>
                </div>
              )}

              {ssoProviders?.googleEnabled !== false && (
                <a
                  href={workspace ? `${API_BASE_URL}/auth/google?tenant=${encodeURIComponent(workspace.trim())}` : undefined}
                  onClick={(e) => {
                    if (!workspace) {
                      e.preventDefault();
                      showToast('Enter your workspace first', 'error');
                    }
                  }}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                >
                  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#4285F4" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.1 29.3 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1 7.2 2.7l5.7-5.7C33.1 7.1 28.8 5 24 5 12.9 5 4 13.9 4 25s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.2-.1-2.3-.1-3.5l.1-.5z" />
                    <path fill="#34A853" d="M6.3 15.2l6.6 4.8C14.5 17 19 14 24 14c2.8 0 5.3 1 7.2 2.7l5.7-5.7C33.1 7.1 28.8 5 24 5c-7.5 0-14 4.1-17.7 10.2z" />
                    <path fill="#FBBC05" d="M24 45c5.2 0 9.9-1.8 13.5-4.7l-6.2-5.2C29.6 36.6 27 37.5 24 37.5c-5.2 0-9.7-3-11.4-7.3l-6.6 5.1C9.9 41 16.4 45 24 45z" />
                    <path fill="#EA4335" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.2 5.4l6.2 5.2C37 36.8 44 32 44 25c0-1.5-.2-2.9-.4-4.5z" />
                  </svg>
                  Sign in with Google
                </a>
              )}

              {ssoProviders?.oidc.map((provider) => (
                <a
                  key={provider.id}
                  href={workspace ? `${API_BASE_URL}/auth/oidc/start/${provider.id}?tenant=${encodeURIComponent(workspace.trim())}` : undefined}
                  onClick={(e) => {
                    if (!workspace) {
                      e.preventDefault();
                      showToast('Enter your workspace first', 'error');
                    } else {
                      rememberWorkspace(workspace.trim());
                    }
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                >
                  <ShieldCheck size={18} className="text-indigo-300" />
                  Sign in with {provider.name}
                </a>
              ))}

              {ssoProviders?.saml.map((provider) => (
                <a
                  key={provider.id}
                  href={workspace ? `${API_BASE_URL}/auth/saml/start/${provider.id}?tenant=${encodeURIComponent(workspace.trim())}` : undefined}
                  onClick={(e) => {
                    if (!workspace) {
                      e.preventDefault();
                      showToast('Enter your workspace first', 'error');
                    } else {
                      rememberWorkspace(workspace.trim());
                    }
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                >
                  <ShieldCheck size={18} className="text-indigo-300" />
                  Sign in with {provider.name}
                </a>
              ))}

              <div className="text-center mt-6 text-sm text-slate-400">
                Don't have a portal?{' '}
                <Link to="/signup" className="text-white font-semibold hover:text-indigo-300 transition-colors">
                  Create one
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
