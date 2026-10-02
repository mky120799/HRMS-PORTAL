import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, registerStepUpPrompt, rememberStepUp } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

/**
 * Global "confirm it's you" prompt. Sensitive API calls (role changes, payroll
 * finalisation, SSO and security policy changes, MFA resets, erasure) answer
 * STEP_UP_REQUIRED; lib/api.ts calls the registered prompt, then retries the
 * original request with the step-up token. Valid for 5 minutes on this session.
 */
export function StepUpDialog() {
  const [open, setOpen] = useState(false);
  const [usesMfa, setUsesMfa] = useState(true);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((token: string | null) => void) | null>(null);

  useEffect(() => {
    registerStepUpPrompt(
      () =>
        new Promise<string | null>((resolve) => {
          resolver.current?.(null);
          resolver.current = resolve;
          setValue('');
          setError('');
          setOpen(true);
          api
            .get<{ isTwoFactorEnabled: boolean }>('/auth/me')
            .then((res) => setUsesMfa(res.data.isTwoFactorEnabled))
            .catch(() => setUsesMfa(true));
        }),
    );
    return () => registerStepUpPrompt(null);
  }, []);

  const finish = (token: string | null) => {
    resolver.current?.(token);
    resolver.current = null;
    setOpen(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ stepUpToken: string; expiresIn: number }>(
        '/auth/step-up',
        usesMfa ? { code: value.trim() } : { password: value },
      );
      rememberStepUp(res.data.stepUpToken, res.data.expiresIn);
      finish(res.data.stepUpToken);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish(null)}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck size={18} /> Confirm it&apos;s you
            </DialogTitle>
            <DialogDescription>
              This is a sensitive action. {usesMfa ? 'Enter a code from your authenticator app, or a recovery code.' : 'Enter your password.'} You
              won&apos;t be asked again for 5 minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="step-up-value">{usesMfa ? 'Authentication code' : 'Password'}</Label>
            <Input
              id="step-up-value"
              type={usesMfa ? 'text' : 'password'}
              inputMode={usesMfa ? 'numeric' : undefined}
              autoComplete={usesMfa ? 'one-time-code' : 'current-password'}
              maxLength={usesMfa ? 32 : 128}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !value}>
              {busy ? 'Checking…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
