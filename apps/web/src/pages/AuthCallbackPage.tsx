import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { setAuth } from '../lib/auth';

/**
 * Google SSO lands here with a short-lived one-time `code` (never raw tokens in
 * the URL). We exchange it for a session via POST /auth/sso/exchange.
 */
export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in development
    started.current = true;
    const code = params.get('code');
    if (!code) {
      navigate('/login?error=sso_failed', { replace: true });
      return;
    }
    window.history.replaceState(null, '', '/auth/callback'); // drop the code from history
    api
      .post('/auth/sso/exchange', { code })
      .then((res) => {
        if (res.data.twoFactorRequired) {
          navigate('/login?error=sso_2fa', { replace: true });
          return;
        }
        setAuth(res.data);
        navigate('/', { replace: true });
      })
      .catch(() => navigate('/login?error=sso_failed', { replace: true }));
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4">
        <Loader2 size={40} className="animate-spin text-indigo-600 mx-auto" />
        <p className="text-slate-600 font-medium">Completing Google sign-in...</p>
      </div>
    </div>
  );
}
