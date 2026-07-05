import { useState } from 'react';
import { getAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { CreditCard, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';

export function BillingPage() {
  const { showToast } = useToast();
  const auth = getAuth();
  const [loading, setLoading] = useState(false);

  // In a real app, this would be fetched from /api/v1/tenants/me
  // We'll mock it for the UI demonstration
  const [tenantInfo] = useState({
    subscriptionStatus: 'TRIAL', // TRIAL, ACTIVE, PAST_DUE, CANCELED
    planName: 'Enterprise Beta',
  });

  const handleCheckout = async () => {
    setLoading(true);
    try {
      // Mock price ID from Stripe dashboard
      const priceId = 'price_1234567890'; 
      const res = await api.post('/stripe/checkout', {
        priceId,
        successUrl: window.location.origin + '/billing?success=true',
        cancelUrl: window.location.origin + '/billing?canceled=true',
      });
      window.location.href = res.data.url;
    } catch (err: any) {
      showToast('Failed to start checkout. Check Stripe configuration.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleManageBilling = async () => {
    setLoading(true);
    try {
      const res = await api.post('/stripe/portal', {
        returnUrl: window.location.origin + '/billing',
      });
      window.location.href = res.data.url;
    } catch (err: any) {
      showToast('No active Stripe customer found to manage.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto py-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing & Subscription</h1>
        <p className="text-muted-foreground mt-1">
          Manage your workspace subscription, view invoices, and update payment methods.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
              Current Plan
              {tenantInfo.subscriptionStatus === 'ACTIVE' && (
                <Badge className="bg-emerald-500 hover:bg-emerald-600">Active</Badge>
              )}
              {tenantInfo.subscriptionStatus === 'TRIAL' && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800">Trial</Badge>
              )}
              {tenantInfo.subscriptionStatus === 'PAST_DUE' && (
                <Badge variant="destructive">Past Due</Badge>
              )}
            </CardTitle>
            <CardDescription>Your organization is on the {tenantInfo.planName} plan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="text-sm">Unlimited Employees</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="text-sm">AI Resume Parsing (Gemini)</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="text-sm">Slack & Google Integrations</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="text-sm">Advanced Payroll Exports</span>
              </div>
            </div>
            
            {tenantInfo.subscriptionStatus === 'TRIAL' && (
              <div className="bg-amber-50 text-amber-800 text-sm p-3 rounded-md flex items-start gap-2 border border-amber-200">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <p>Your trial expires in 14 days. Upgrade now to avoid interruption.</p>
              </div>
            )}
            
            {tenantInfo.subscriptionStatus === 'PAST_DUE' && (
              <div className="bg-red-50 text-red-800 text-sm p-3 rounded-md flex items-start gap-2 border border-red-200">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <p>Your last payment failed. Please update your payment method.</p>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-slate-50/50 border-t pt-4">
            {tenantInfo.subscriptionStatus !== 'ACTIVE' ? (
              <Button onClick={handleCheckout} disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700">
                <CreditCard size={16} className="mr-2" />
                {loading ? 'Processing...' : 'Upgrade Now'}
              </Button>
            ) : (
              <Button onClick={handleManageBilling} disabled={loading} variant="outline" className="w-full">
                <ExternalLink size={16} className="mr-2" />
                {loading ? 'Processing...' : 'Manage Billing & Invoices'}
              </Button>
            )}
          </CardFooter>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
            <CardDescription>Securely managed by Stripe</CardDescription>
          </CardHeader>
          <CardContent>
            {tenantInfo.subscriptionStatus === 'ACTIVE' ? (
              <div className="flex items-center gap-3 p-3 border rounded-lg bg-slate-50">
                <div className="bg-white p-2 rounded shadow-sm">
                  <CreditCard className="text-slate-500" size={20} />
                </div>
                <div>
                  <p className="font-medium text-sm">Visa ending in 4242</p>
                  <p className="text-xs text-muted-foreground">Expires 12/2028</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground border-2 border-dashed rounded-lg">
                <CreditCard size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No payment method on file</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
