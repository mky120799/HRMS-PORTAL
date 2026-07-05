import { useState } from 'react';
import { getAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Settings,
  Slack,
  CalendarDays,
  Key,
  Save,
  CheckCircle,
  Server,
  Globe,
  Bell,
  ShieldCheck,
} from 'lucide-react';

function SettingSection({ icon, title, description, children }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">{icon}</div>
          <div>
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
            <CardDescription className="text-sm">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { showToast } = useToast();
  const auth = getAuth();

  const [slackWebhook, setSlackWebhook] = useState('');
  const [slackHiringWebhook, setSlackHiringWebhook] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSaveIntegrations = () => {
    // In a real deployment, these would PATCH /api/v1/tenants/:id/settings
    setSaved(true);
    showToast('Settings saved. Restart the server to apply .env changes.', 'success');
    setTimeout(() => setSaved(false), 3000);
  };

  const envVars = [
    { key: 'GEMINI_API_KEY', desc: 'AI chat + resume parsing', required: true },
    { key: 'GOOGLE_CLIENT_ID', desc: 'Google SSO', required: false },
    { key: 'GOOGLE_CLIENT_SECRET', desc: 'Google SSO', required: false },
    { key: 'GOOGLE_CALLBACK_URL', desc: 'Google OAuth redirect URI', required: false },
    { key: 'GOOGLE_CALENDAR_REFRESH_TOKEN', desc: 'Interview scheduling + Meet links', required: false },
    { key: 'SLACK_WEBHOOK_URL', desc: 'Leave approval notifications', required: false },
    { key: 'SLACK_HIRING_WEBHOOK_URL', desc: 'New application alerts', required: false },
    { key: 'AWS_ACCESS_KEY_ID', desc: 'S3 resume storage', required: false },
    { key: 'AWS_SECRET_ACCESS_KEY', desc: 'S3 resume storage', required: false },
    { key: 'AWS_S3_BUCKET_NAME', desc: 'Resume storage bucket', required: false },
  ];

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage integrations and system configuration for your HRMS instance.
        </p>
      </div>

      {/* Tenant Info */}
      <SettingSection icon={<Server size={18} />} title="Workspace" description="Your organization's HRMS workspace details">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground mb-1">Tenant ID</p>
            <code className="bg-muted px-2 py-1 rounded text-xs font-mono">{auth?.user.tenantId}</code>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Your Role</p>
            <Badge variant="secondary">{auth?.user.role}</Badge>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Logged in as</p>
            <p className="font-medium">{auth?.user.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Email</p>
            <p className="font-medium">{auth?.user.email}</p>
          </div>
        </div>
      </SettingSection>

      {/* Slack */}
      <SettingSection icon={<Slack size={18} />} title="Slack Notifications" description="Send leave approvals and hiring alerts to Slack channels">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
          <Bell size={14} className="shrink-0 mt-0.5" />
          <div>
            Set <code className="font-mono bg-amber-100 px-1 rounded">SLACK_WEBHOOK_URL</code> and{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">SLACK_HIRING_WEBHOOK_URL</code> in your server{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">.env</code> file to activate Slack alerts.
            Create a webhook at <strong>api.slack.com/apps</strong>.
          </div>
        </div>
        <div className="space-y-2">
          <Label>Leave Approvals Webhook URL</Label>
          <Input placeholder="https://hooks.slack.com/services/..." value={slackWebhook} onChange={(e) => setSlackWebhook(e.target.value)} />
          <p className="text-xs text-muted-foreground">Fires when a leave request is approved or rejected.</p>
        </div>
        <div className="space-y-2">
          <Label>Hiring Channel Webhook URL</Label>
          <Input placeholder="https://hooks.slack.com/services/..." value={slackHiringWebhook} onChange={(e) => setSlackHiringWebhook(e.target.value)} />
          <p className="text-xs text-muted-foreground">Fires when a new candidate applies for a job.</p>
        </div>
      </SettingSection>

      {/* Google Integrations */}
      <SettingSection icon={<CalendarDays size={18} />} title="Google Workspace" description="SSO login and automatic Google Meet interview scheduling">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 flex gap-2">
          <Globe size={14} className="shrink-0 mt-0.5" />
          <div>
            Configure these in <a href="https://console.cloud.google.com" target="_blank" rel="noopener" className="underline font-semibold">Google Cloud Console</a>.
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            { label: 'Google SSO', desc: 'Sign in with Google on Login page', enabled: true },
            { label: 'Google Meet', desc: 'Auto-generate Meet links for interviews', enabled: true },
            { label: 'Calendar Events', desc: 'Create calendar invites for interviews', enabled: true },
            { label: 'AI Resume Parsing', desc: 'Gemini parses resumes on application', enabled: true },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-2 p-3 rounded-lg border bg-card">
              <CheckCircle size={16} className={item.enabled ? 'text-emerald-500 mt-0.5' : 'text-slate-300 mt-0.5'} />
              <div>
                <p className="font-medium text-sm">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SettingSection>

      {/* Environment Variables Reference */}
      <SettingSection icon={<Key size={18} />} title="Environment Variables Reference" description="All required .env variables for full feature activation">
        <div className="space-y-2">
          {envVars.map((v) => (
            <div key={v.key} className="flex items-center gap-3 py-1.5 border-b border-border/40 last:border-0">
              <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded min-w-[220px]">{v.key}</code>
              <span className="text-xs text-muted-foreground flex-1">{v.desc}</span>
              <Badge variant={v.required ? 'destructive' : 'secondary'} className="text-xs shrink-0">
                {v.required ? 'Required' : 'Optional'}
              </Badge>
            </div>
          ))}
        </div>
      </SettingSection>

      {/* Security */}
      <SettingSection icon={<ShieldCheck size={18} />} title="Security" description="Current security configuration">
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            { label: 'JWT Auth', active: true },
            { label: 'Rate Limiting (100 req/min)', active: true },
            { label: 'Role-Based Access Control', active: true },
            { label: 'Audit Logging', active: true },
            { label: 'Refresh Token Rotation', active: true },
            { label: '2FA / TOTP', active: false },
            { label: 'IP Whitelisting', active: false },
            { label: 'GDPR Data Export', active: false },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2 p-2.5 rounded-lg border bg-card">
              <div className={`w-2 h-2 rounded-full shrink-0 ${item.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className={`text-xs ${item.active ? 'font-medium' : 'text-muted-foreground'}`}>{item.label}</span>
            </div>
          ))}
        </div>
      </SettingSection>

      <div className="flex justify-end">
        <Button onClick={handleSaveIntegrations} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Save size={16} className="mr-2" />
          {saved ? 'Saved!' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}
