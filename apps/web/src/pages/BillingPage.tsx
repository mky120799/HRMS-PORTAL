import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { fmtDate } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

type Subscription = {
  plan: string;
  status: string;
  effectivePlan: string;
  trialEndsAt: string | null;
  isTrialActive: boolean;
  trialDaysRemaining: number;
  employeeLimit: number | null;
  activeEmployees: number;
  hasBillingAccount: boolean;
};

const PLANS: { plan: 'BASIC' | 'BUSINESS' | 'ENTERPRISE'; seats: string; features: string[] }[] = [
  { plan: 'BASIC', seats: 'Up to 50 employees', features: ['Leave & attendance', 'Payroll & payslips', 'Documents', 'Hiring pipeline'] },
  { plan: 'BUSINESS', seats: 'Up to 250 employees', features: ['Everything in Basic', 'Performance reviews', 'Analytics dashboard'] },
  { plan: 'ENTERPRISE', seats: 'Unlimited employees', features: ['Everything in Business', 'AI resume screening', 'AI HR assistant'] },
];

export function BillingPage() {
  const { showToast } = useToast();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);

  const sub = useQuery({ queryKey: ['subscription'], queryFn: async () => (await api.get<Subscription>('/tenants/subscription')).data });
  const available = useQuery({ queryKey: ['billing-plans'], queryFn: async () => (await api.get<{ plan: string; available: boolean }[]>('/billing/plans')).data });

  useEffect(() => {
    if (params.get('status') === 'success') showToast('Payment received — your plan updates within a few seconds.', 'success');
  }, [params, showToast]);

  const go = async (key: string, request: () => Promise<{ data: { url: string } }>) => {
    setBusy(key);
    try {
      window.location.href = (await request()).data.url;
    } catch (e) {
      showToast(getErrorMessage(e), 'error');
      setBusy(null);
    }
  };

  const s = sub.data;
  const isPaid = s && (s.status === 'ACTIVE' || s.status === 'PAST_DUE');

  return (
    <div className="space-y-8 max-w-5xl mx-auto py-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing & Subscription</h1>
        <p className="text-muted-foreground mt-2">Payments are handled securely by Stripe.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard size={18} /> Current plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sub.isLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-2xl font-bold">{s?.isTrialActive ? 'Free trial' : s?.plan}</div>
              <Badge variant="outline">{s?.status}</Badge>
              {s?.isTrialActive && <span className="text-sm text-muted-foreground">{s.trialDaysRemaining} day(s) left · ends {fmtDate(s.trialEndsAt)} · all features unlocked</span>}
              {s?.status === 'PAST_DUE' && <span className="text-sm text-red-600">Payment failed — update your card to avoid losing access.</span>}
              <span className="text-sm text-muted-foreground">
                Seats: {s?.activeEmployees} / {s?.employeeLimit ?? 'unlimited'}
              </span>
            </div>
          )}
        </CardContent>
        {s?.hasBillingAccount && (
          <CardFooter>
            <Button variant="outline" disabled={!!busy} onClick={() => go('portal', () => api.post('/billing/portal'))}>
              <ExternalLink size={16} className="mr-2" /> Manage billing, invoices & payment method
            </Button>
          </CardFooter>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((p) => {
          const current = isPaid && s?.plan === p.plan;
          const purchasable = available.data?.find((a) => a.plan === p.plan)?.available;
          return (
            <Card key={p.plan} className={current ? 'ring-2 ring-indigo-500' : ''}>
              <CardHeader>
                <CardTitle>{p.plan.charAt(0) + p.plan.slice(1).toLowerCase()}</CardTitle>
                <CardDescription>{p.seats}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {p.features.map((f) => (
                  <div key={f} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 size={14} className="text-emerald-500" /> {f}
                  </div>
                ))}
              </CardContent>
              <CardFooter>
                {current ? (
                  <Badge>Current plan</Badge>
                ) : isPaid ? (
                  <Button variant="outline" className="w-full" disabled={!!busy} onClick={() => go('portal', () => api.post('/billing/portal'))}>
                    Change plan
                  </Button>
                ) : (
                  <Button className="w-full" disabled={!purchasable || !!busy} onClick={() => go(p.plan, () => api.post('/billing/checkout', { plan: p.plan }))}>
                    {busy === p.plan ? <Loader2 className="animate-spin" size={16} /> : purchasable ? 'Subscribe' : 'Unavailable'}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
