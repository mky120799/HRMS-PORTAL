import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { saveAuth } from '../lib/auth';

/**
 * Handles the redirect from /auth/google/callback
 * The backend redirects here with ?accessToken=xxx&refreshToken=xxx
 */
export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');

    if (accessToken && refreshToken) {
      // Decode JWT to extract user info
      try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        saveAuth({
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: '15m',
          user: {
            id: payload.sub,
            email: payload.email,
            tenantId: payload.tenantId,
            role: payload.role,
            name: payload.name ?? payload.email,
          },
        });
        navigate('/', { replace: true });
      } catch {
        navigate('/login?error=sso_failed', { replace: true });
      }
    } else {
      navigate('/login?error=sso_failed', { replace: true });
    }
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
