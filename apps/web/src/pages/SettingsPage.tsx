import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, MessageSquare, ShieldCheck, CalendarDays, Save, Trash2, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { fmtDay } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

type Settings = { id: string; name: string; slug: string; timezone: string; whitelistedIps: string[]; slackWebhookUrl: string | null; slackHiringWebhookUrl: string | null };
type Policy = { type: string; annualQuota: number; isPaid: boolean };
type Holiday = { id: string; date: string; name: string };

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {icon} {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');
  const year = new Date().getFullYear();

  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get<Settings>('/tenants/settings')).data });
  const policies = useQuery({ queryKey: ['leave-policies'], queryFn: async () => (await api.get<Policy[]>('/leave-policies')).data });
  const holidays = useQuery({ queryKey: ['holidays', year], queryFn: async () => (await api.get<Holiday[]>('/holidays', { params: { year } })).data });

  const [general, setGeneral] = useState({ name: '', timezone: '', ips: '' });
  const [slack, setSlack] = useState({ general: '', hiring: '' });
  const [newPolicy, setNewPolicy] = useState<Policy>({ type: '', annualQuota: 0, isPaid: true });
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });

  useEffect(() => {
    if (settings.data) setGeneral({ name: settings.data.name, timezone: settings.data.timezone, ips: settings.data.whitelistedIps.join(', ') });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => api.patch('/tenants/settings', body),
    onSuccess: () => {
      setSlack({ general: '', hiring: '' });
      qc.invalidateQueries({ queryKey: ['settings'] });
      showToast('Settings saved', 'success');
    },
    onError,
  });
  const upsertPolicy = useMutation({
    mutationFn: async (p: Policy) => api.put('/leave-policies', p),
    onSuccess: () => {
      setNewPolicy({ type: '', annualQuota: 0, isPaid: true });
      qc.invalidateQueries({ queryKey: ['leave-policies'] });
      showToast('Leave policy saved', 'success');
    },
    onError,
  });
  const addHoliday = useMutation({
    mutationFn: async () => api.post('/holidays', newHoliday),
    onSuccess: () => {
      setNewHoliday({ date: '', name: '' });
      qc.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError,
  });
  const removeHoliday = useMutation({
    mutationFn: async (id: string) => api.delete(`/holidays/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }),
    onError,
  });

  const s = settings.data;
  const careersUrl = s ? `${window.location.origin}/careers/${s.slug}` : '';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Workspace configuration. Every change is recorded in the audit log.</p>
      </div>

      <Section icon={<Building2 size={18} />} title="Workspace" description="Your people sign in with the workspace ID below.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Company name</Label>
            <Input value={general.name} onChange={(e) => setGeneral((g) => ({ ...g, name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Timezone (IANA)</Label>
            <Input placeholder="Asia/Kolkata" value={general.timezone} onChange={(e) => setGeneral((g) => ({ ...g, timezone: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Workspace ID (for sign-in)</Label>
            <code className="block bg-muted px-2 py-2 rounded text-sm">{s?.slug}</code>
          </div>
          <div className="space-y-1">
            <Label>Public careers page</Label>
            <a className="block text-sm text-indigo-600 underline truncate py-2" href={careersUrl} target="_blank" rel="noreferrer">
              {careersUrl}
            </a>
          </div>
        </div>
        <Button onClick={() => save.mutate({ name: general.name, timezone: general.timezone })} disabled={save.isPending}>
          <Save size={16} className="mr-2" /> Save workspace
        </Button>
      </Section>

      <Section icon={<ShieldCheck size={18} />} title="Network access" description="Restrict access to office or VPN IP addresses. Leave empty to allow any network.">
        <div className="space-y-1">
          <Label>Allowed IPs or CIDR ranges (comma separated)</Label>
          <Input placeholder="203.0.113.10, 198.51.100.0/24" value={general.ips} onChange={(e) => setGeneral((g) => ({ ...g, ips: e.target.value }))} />
          <p className="text-xs text-muted-foreground">Your current address must be included, so you cannot lock yourself out.</p>
        </div>
        <Button
          onClick={() => save.mutate({ whitelistedIps: general.ips.split(',').map((v) => v.trim()).filter(Boolean) })}
          disabled={save.isPending}
        >
          <Save size={16} className="mr-2" /> Save allow-list
        </Button>
      </Section>

      <Section icon={<MessageSquare size={18} />} title="Slack" description="Post leave decisions and new-application alerts to your own Slack channels.">
        {(['general', 'hiring'] as const).map((k) => {
          const current = k === 'general' ? s?.slackWebhookUrl : s?.slackHiringWebhookUrl;
          const field = k === 'general' ? 'slackWebhookUrl' : 'slackHiringWebhookUrl';
          return (
            <div key={k} className="space-y-1">
              <Label>{k === 'general' ? 'Leave approvals webhook' : 'Hiring webhook (defaults to the one above)'}</Label>
              <div className="text-xs text-muted-foreground">{current ? `Configured: ${current}` : 'Not configured'}</div>
              <div className="flex gap-2">
                <Input placeholder="https://hooks.slack.com/services/…" value={slack[k]} onChange={(e) => setSlack((v) => ({ ...v, [k]: e.target.value }))} />
                <Button variant="outline" disabled={!slack[k] || save.isPending} onClick={() => save.mutate({ [field]: slack[k] })}>
                  Save
                </Button>
                {current && (
                  <Button variant="ghost" className="text-red-600" onClick={() => save.mutate({ [field]: null })}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </Section>

      <Section icon={<CalendarDays size={18} />} title="Leave policies & holidays" description="Annual quotas in working days. Holidays are excluded from leave-day counts.">
        <div className="space-y-2">
          {policies.data?.map((p) => (
            <div key={p.type} className="flex items-center gap-3">
              <span className="w-28 font-medium text-sm">{p.type}</span>
              <Input
                type="number"
                min={0}
                max={365}
                className="w-24"
                defaultValue={p.annualQuota}
                disabled={!p.isPaid}
                onBlur={(e) => Number(e.target.value) !== p.annualQuota && upsertPolicy.mutate({ ...p, annualQuota: Number(e.target.value) })}
              />
              <span className="text-xs text-muted-foreground">{p.isPaid ? 'days / year' : 'unpaid (deducted from salary)'}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2">
            <Input placeholder="NEW_TYPE" className="w-32" value={newPolicy.type} onChange={(e) => setNewPolicy((p) => ({ ...p, type: e.target.value.toUpperCase() }))} />
            <Input type="number" className="w-24" value={newPolicy.annualQuota} onChange={(e) => setNewPolicy((p) => ({ ...p, annualQuota: Number(e.target.value) }))} />
            <label className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={newPolicy.isPaid} onChange={(e) => setNewPolicy((p) => ({ ...p, isPaid: e.target.checked }))} /> Paid
            </label>
            <Button size="sm" variant="outline" disabled={!newPolicy.type} onClick={() => upsertPolicy.mutate(newPolicy)}>
              <Plus size={14} className="mr-1" /> Add type
            </Button>
          </div>
        </div>

        <div className="border-t pt-4 space-y-2">
          <div className="font-medium text-sm">Holidays {year}</div>
          {holidays.data?.map((h) => (
            <div key={h.id} className="flex items-center justify-between text-sm">
              <span>
                {fmtDay(h.date)} — {h.name}
              </span>
              <Button variant="ghost" size="icon" onClick={() => removeHoliday.mutate(h.id)}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input type="date" className="w-44" value={newHoliday.date} onChange={(e) => setNewHoliday((h) => ({ ...h, date: e.target.value }))} />
            <Input placeholder="Holiday name" value={newHoliday.name} onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))} />
            <Button size="sm" variant="outline" disabled={!newHoliday.date || !newHoliday.name} onClick={() => addHoliday.mutate()}>
              <Plus size={14} />
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
