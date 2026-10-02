import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, MessageSquare, ShieldCheck, CalendarDays, Save, Trash2, Plus, Briefcase } from 'lucide-react';
import { api, API_BASE_URL } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { hasPermission } from '../lib/auth';
import { fmtDay } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { HiringSettingsPanel } from '../components/HiringSettingsPanel';
import { CustomRolesPanel } from '../components/CustomRolesPanel';

type Settings = { id: string; name: string; slug: string; timezone: string; whitelistedIps: string[]; slackWebhookUrl: string | null; slackHiringWebhookUrl: string | null };
type AuthPolicy = {
  allowPasswordLogin: boolean;
  allowGoogleLogin: boolean;
  requireMfaForAdmins: boolean;
  requireMfaForAll: boolean;
  passwordMinLength: number;
  passwordHistoryCount: number;
  passwordExpiresDays: number | null;
  sessionIdleMinutes: number | null;
  sessionAbsoluteHours: number;
};
type IdentityProvider = {
  id: string;
  providerType: 'OIDC' | 'SAML';
  name: string;
  issuerUrl?: string | null;
  clientId?: string | null;
  samlEntityId?: string | null;
  samlSsoUrl?: string | null;
  allowedDomains: string[];
  jitProvisioning: boolean;
  scimEnabled: boolean;
  isActive: boolean;
  clientSecretConfigured?: boolean;
  samlCertificateConfigured?: boolean;
  roleMapping?: Record<string, string> | null;
  attributeMapping?: Partial<Record<SamlAttributeField, string>> | null;
};
type SamlAttributeField = 'email' | 'firstName' | 'lastName' | 'displayName' | 'groups';
const SAML_ATTRIBUTE_FIELDS: { key: SamlAttributeField; label: string; placeholder: string }[] = [
  { key: 'email', label: 'Email attribute', placeholder: 'email (default: email, mail, NameID)' },
  { key: 'firstName', label: 'First name attribute', placeholder: 'givenName' },
  { key: 'lastName', label: 'Last name attribute', placeholder: 'surname' },
  { key: 'displayName', label: 'Display name attribute', placeholder: 'displayName' },
  { key: 'groups', label: 'Groups attribute (for role mapping)', placeholder: 'groups' },
];
/** Roles an IdP group may grant. ADMIN is assigned in HRMS only. */
const IDP_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'PAYROLL_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'MANAGER', 'EMPLOYEE', 'AUDITOR', 'FINANCE', 'IT_ADMIN'];

const CUSTOM_ROLE_REF = /^CUSTOM:([A-Z][A-Z0-9_]{1,39})$/;

/** "Group name = ROLE" (or "= custom:KEY") per line → { "Group name": "ROLE" }. Throws on unknown roles. */
function parseRoleMapping(text: string): Record<string, string> | undefined {
  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.lastIndexOf('=');
      if (index <= 0) throw new Error(`Role mapping line must look like "Group = ROLE": ${line}`);
      const group = line.slice(0, index).trim();
      const role = line.slice(index + 1).trim().toUpperCase();
      const custom = CUSTOM_ROLE_REF.exec(role);
      if (custom) return [group, `custom:${custom[1]}`] as const;
      if (!IDP_ROLES.includes(role)) {
        throw new Error(`Unknown or non-assignable role "${role}". Allowed: ${IDP_ROLES.join(', ')} or custom:<KEY>`);
      }
      return [group, role] as const;
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
}
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
  const canManageSecurity = hasPermission(['security.manage']);
  const canManageIdentityProviders = hasPermission(['identity_providers.manage']);
  const canManageRoles = hasPermission(['roles.manage']);

  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get<Settings>('/tenants/settings')).data });
  const authPolicy = useQuery({ queryKey: ['settings', 'auth-policy'], enabled: canManageSecurity, queryFn: async () => (await api.get<AuthPolicy>('/tenants/auth-policy')).data });
  const identityProviders = useQuery({ queryKey: ['settings', 'identity-providers'], enabled: canManageIdentityProviders, queryFn: async () => (await api.get<IdentityProvider[]>('/tenants/identity-providers')).data });
  const policies = useQuery({ queryKey: ['leave-policies'], queryFn: async () => (await api.get<Policy[]>('/leave-policies')).data });
  const holidays = useQuery({ queryKey: ['holidays', year], queryFn: async () => (await api.get<Holiday[]>('/holidays', { params: { year } })).data });

  const [general, setGeneral] = useState({ name: '', timezone: '', ips: '' });
  const [authDraft, setAuthDraft] = useState<AuthPolicy | null>(null);
  const [scimToken, setScimToken] = useState<{ providerName: string; token: string } | null>(null);
  const [idpDraft, setIdpDraft] = useState({
    providerType: 'OIDC' as 'OIDC' | 'SAML',
    name: '',
    issuerUrl: '',
    clientId: '',
    clientSecret: '',
    samlEntityId: '',
    samlSsoUrl: '',
    samlCertificate: '',
    allowedDomains: '',
    roleMapping: '',
    attributeMapping: {} as Partial<Record<SamlAttributeField, string>>,
    jitProvisioning: false,
    scimEnabled: false,
    isActive: true,
  });
  const [slack, setSlack] = useState({ general: '', hiring: '' });
  const [newPolicy, setNewPolicy] = useState<Policy>({ type: '', annualQuota: 0, isPaid: true });
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });

  useEffect(() => {
    if (settings.data) setGeneral({ name: settings.data.name, timezone: settings.data.timezone, ips: settings.data.whitelistedIps.join(', ') });
  }, [settings.data]);
  useEffect(() => {
    if (authPolicy.data) setAuthDraft(authPolicy.data);
  }, [authPolicy.data]);

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => api.patch('/tenants/settings', body),
    onSuccess: () => {
      setSlack({ general: '', hiring: '' });
      qc.invalidateQueries({ queryKey: ['settings'] });
      showToast('Settings saved', 'success');
    },
    onError,
  });
  const saveAuthPolicy = useMutation({
    mutationFn: async () => api.patch('/tenants/auth-policy', authDraft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'auth-policy'] });
      showToast('Authentication policy saved', 'success');
    },
    onError,
  });
  const saveIdentityProvider = useMutation({
    mutationFn: async () => api.post('/tenants/identity-providers', {
      providerType: idpDraft.providerType,
      name: idpDraft.name,
      issuerUrl: idpDraft.issuerUrl || undefined,
      clientId: idpDraft.clientId || undefined,
      clientSecret: idpDraft.clientSecret || undefined,
      samlEntityId: idpDraft.samlEntityId || undefined,
      samlSsoUrl: idpDraft.samlSsoUrl || undefined,
      samlCertificate: idpDraft.samlCertificate || undefined,
      allowedDomains: idpDraft.allowedDomains.split(',').map((value) => value.trim()).filter(Boolean),
      roleMapping: parseRoleMapping(idpDraft.roleMapping),
      attributeMapping:
        idpDraft.providerType === 'SAML' && Object.values(idpDraft.attributeMapping).some((value) => value?.trim())
          ? Object.fromEntries(Object.entries(idpDraft.attributeMapping).filter(([, value]) => value?.trim()))
          : undefined,
      jitProvisioning: idpDraft.jitProvisioning,
      scimEnabled: idpDraft.scimEnabled,
      isActive: idpDraft.isActive,
    }),
    onSuccess: () => {
      setIdpDraft({
        providerType: 'OIDC',
        name: '',
        issuerUrl: '',
        clientId: '',
        clientSecret: '',
        samlEntityId: '',
        samlSsoUrl: '',
        samlCertificate: '',
        allowedDomains: '',
        roleMapping: '',
        attributeMapping: {},
        jitProvisioning: false,
        scimEnabled: false,
        isActive: true,
      });
      qc.invalidateQueries({ queryKey: ['settings', 'identity-providers'] });
      showToast('Identity provider saved', 'success');
    },
    onError,
  });
  const toggleIdentityProvider = useMutation({
    mutationFn: async (provider: IdentityProvider) => api.patch(`/tenants/identity-providers/${provider.id}`, { isActive: !provider.isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'identity-providers'] });
      showToast('Identity provider updated', 'success');
    },
    onError,
  });
  const rotateScimToken = useMutation({
    mutationFn: async (provider: IdentityProvider) => ({
      provider,
      data: (await api.post<{ token: string; message: string }>(`/tenants/identity-providers/${provider.id}/scim-token`)).data,
    }),
    onSuccess: ({ provider, data }) => {
      setScimToken({ providerName: provider.name, token: data.token });
      qc.invalidateQueries({ queryKey: ['settings', 'identity-providers'] });
      showToast('SCIM token generated. Copy it now.', 'success');
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
  const optionalNumber = (value: string) => (value === '' ? null : Number(value));

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

      {canManageSecurity && authDraft && (
        <Section icon={<ShieldCheck size={18} />} title="Authentication policy" description="Control login methods, MFA enforcement and session lifetime.">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={authDraft.allowPasswordLogin} onChange={(e) => setAuthDraft((v) => v && { ...v, allowPasswordLogin: e.target.checked })} />
              Allow password login
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={authDraft.allowGoogleLogin} onChange={(e) => setAuthDraft((v) => v && { ...v, allowGoogleLogin: e.target.checked })} />
              Allow Google login
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={authDraft.requireMfaForAdmins} onChange={(e) => setAuthDraft((v) => v && { ...v, requireMfaForAdmins: e.target.checked })} />
              Require MFA for admins
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={authDraft.requireMfaForAll} onChange={(e) => setAuthDraft((v) => v && { ...v, requireMfaForAll: e.target.checked })} />
              Require MFA for every user
            </label>
            <div className="space-y-1">
              <Label>Password minimum length</Label>
              <Input type="number" min={10} max={128} value={authDraft.passwordMinLength} onChange={(e) => setAuthDraft((v) => v && { ...v, passwordMinLength: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label>Password history count</Label>
              <Input type="number" min={0} max={24} value={authDraft.passwordHistoryCount} onChange={(e) => setAuthDraft((v) => v && { ...v, passwordHistoryCount: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">0 disables reuse checks; recommended: 5–10 for admin-heavy tenants.</p>
            </div>
            <div className="space-y-1">
              <Label>Password expiry (days)</Label>
              <Input type="number" min={1} max={730} placeholder="Never" value={authDraft.passwordExpiresDays ?? ''} onChange={(e) => setAuthDraft((v) => v && { ...v, passwordExpiresDays: optionalNumber(e.target.value) })} />
              <p className="text-xs text-muted-foreground">Blank means passwords do not expire automatically.</p>
            </div>
            <div className="space-y-1">
              <Label>Idle timeout (minutes)</Label>
              <Input type="number" min={5} max={43200} placeholder="No idle timeout" value={authDraft.sessionIdleMinutes ?? ''} onChange={(e) => setAuthDraft((v) => v && { ...v, sessionIdleMinutes: optionalNumber(e.target.value) })} />
              <p className="text-xs text-muted-foreground">Blank keeps sessions alive until the absolute lifetime or logout.</p>
            </div>
            <div className="space-y-1">
              <Label>Session lifetime (hours)</Label>
              <Input type="number" min={1} max={168} value={authDraft.sessionAbsoluteHours} onChange={(e) => setAuthDraft((v) => v && { ...v, sessionAbsoluteHours: Number(e.target.value) })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">MFA enforcement can only be enabled after matching users have already set up two-factor authentication.</p>
          <Button onClick={() => saveAuthPolicy.mutate()} disabled={saveAuthPolicy.isPending}>
            <Save size={16} className="mr-2" /> Save authentication policy
          </Button>
        </Section>
      )}

      {canManageIdentityProviders && (
        <Section icon={<ShieldCheck size={18} />} title="Enterprise SSO providers" description="OIDC and SAML sign-in plus SCIM provisioning for Okta, Entra ID, Google Workspace or similar identity providers. Changes ask you to confirm your identity.">
          <div className="space-y-3">
            {identityProviders.data?.map((provider) => (
              <div key={provider.id} className="rounded-lg border bg-white/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{provider.name} · {provider.providerType}</div>
                    <div className="text-xs text-muted-foreground">
                      {provider.providerType === 'OIDC' ? provider.issuerUrl : provider.samlSsoUrl}
                      {provider.allowedDomains.length ? ` · domains: ${provider.allowedDomains.join(', ')}` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Secret: {provider.clientSecretConfigured || provider.samlCertificateConfigured ? 'configured' : 'not configured'} · SCIM: {provider.scimEnabled ? 'enabled' : 'disabled'} · JIT: {provider.jitProvisioning ? 'on' : 'off'}
                    </div>
                    {provider.roleMapping && Object.keys(provider.roleMapping).length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Role mapping: {Object.entries(provider.roleMapping).map(([group, role]) => `${group} → ${role}`).join(', ')}
                      </div>
                    )}
                    {provider.providerType === 'SAML' && (
                      <div className="text-xs text-muted-foreground">
                        Metadata: <code>{API_BASE_URL}/auth/saml/metadata/{provider.id}</code>
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => toggleIdentityProvider.mutate(provider)} disabled={toggleIdentityProvider.isPending}>
                    {provider.isActive ? 'Disable' : 'Enable'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rotateScimToken.mutate(provider)} disabled={rotateScimToken.isPending}>
                    Rotate SCIM token
                  </Button>
                </div>
              </div>
            ))}
            {!identityProviders.isLoading && !identityProviders.data?.length && <div className="text-sm text-muted-foreground">No enterprise identity providers configured yet.</div>}
          </div>
          {scimToken && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="text-sm font-medium text-amber-900">New SCIM token for {scimToken.providerName}</div>
              <p className="text-xs text-amber-800">Copy this token into Okta/Entra now. For security, HRMS will not show it again.</p>
              <div className="flex gap-2">
                <Input readOnly value={scimToken.token} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(scimToken.token);
                    showToast('SCIM token copied', 'success');
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-amber-800">SCIM base URL: <code>{API_BASE_URL}/scim/v2</code></p>
            </div>
          )}

          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Add provider configuration</div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Type</Label>
                <select className="h-10 w-full rounded-md border bg-white px-2 text-sm" value={idpDraft.providerType} onChange={(e) => setIdpDraft((v) => ({ ...v, providerType: e.target.value as 'OIDC' | 'SAML' }))}>
                  <option value="OIDC">OIDC</option>
                  <option value="SAML">SAML</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input placeholder="Okta / Entra ID / Google Workspace" value={idpDraft.name} onChange={(e) => setIdpDraft((v) => ({ ...v, name: e.target.value }))} />
              </div>
              {idpDraft.providerType === 'OIDC' ? (
                <>
                  <div className="space-y-1">
                    <Label>Issuer URL</Label>
                    <Input placeholder="https://example.okta.com/oauth2/default" value={idpDraft.issuerUrl} onChange={(e) => setIdpDraft((v) => ({ ...v, issuerUrl: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Client ID</Label>
                    <Input value={idpDraft.clientId} onChange={(e) => setIdpDraft((v) => ({ ...v, clientId: e.target.value }))} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Client secret</Label>
                    <Input type="password" value={idpDraft.clientSecret} onChange={(e) => setIdpDraft((v) => ({ ...v, clientSecret: e.target.value }))} />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label>SAML entity ID</Label>
                    <Input value={idpDraft.samlEntityId} onChange={(e) => setIdpDraft((v) => ({ ...v, samlEntityId: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>SAML SSO URL</Label>
                    <Input value={idpDraft.samlSsoUrl} onChange={(e) => setIdpDraft((v) => ({ ...v, samlSsoUrl: e.target.value }))} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>X.509 certificate</Label>
                    <textarea className="min-h-24 w-full rounded-md border bg-white p-2 text-sm" value={idpDraft.samlCertificate} onChange={(e) => setIdpDraft((v) => ({ ...v, samlCertificate: e.target.value }))} />
                  </div>
                </>
              )}
              <div className="space-y-1 md:col-span-2">
                <Label>Allowed email domains</Label>
                <Input placeholder="company.com, subsidiary.com" value={idpDraft.allowedDomains} onChange={(e) => setIdpDraft((v) => ({ ...v, allowedDomains: e.target.value }))} />
              </div>
              {idpDraft.providerType === 'SAML' &&
                SAML_ATTRIBUTE_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <Label>{field.label}</Label>
                    <Input
                      placeholder={field.placeholder}
                      value={idpDraft.attributeMapping[field.key] ?? ''}
                      onChange={(e) => setIdpDraft((v) => ({ ...v, attributeMapping: { ...v.attributeMapping, [field.key]: e.target.value } }))}
                    />
                  </div>
                ))}
              <div className="space-y-1 md:col-span-2">
                <Label>Role mapping (optional)</Label>
                <textarea
                  className="min-h-20 w-full rounded-md border bg-white p-2 font-mono text-sm"
                  placeholder={'HR Team = HR_ADMIN\nPeople Managers = MANAGER\nEveryone = EMPLOYEE'}
                  value={idpDraft.roleMapping}
                  onChange={(e) => setIdpDraft((v) => ({ ...v, roleMapping: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  One "IdP group = HRMS role" per line (use custom:KEY for a custom role); the first matching line wins. It is applied at every sign-in and, with SCIM, whenever group membership changes. ADMIN cannot be granted by an IdP, and existing admins are never changed.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={idpDraft.jitProvisioning} onChange={(e) => setIdpDraft((v) => ({ ...v, jitProvisioning: e.target.checked }))} />
                Just-in-time provisioning (requires allowed domains)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={idpDraft.scimEnabled} onChange={(e) => setIdpDraft((v) => ({ ...v, scimEnabled: e.target.checked }))} />
                SCIM enabled
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              OIDC and SAML sign-in and SCIM provisioning are active for enabled providers. For SAML, give your IdP the metadata URL shown after saving.
            </p>
            <Button
              disabled={saveIdentityProvider.isPending || !idpDraft.name || (idpDraft.jitProvisioning && !idpDraft.allowedDomains.trim())}
              onClick={() => saveIdentityProvider.mutate()}
            >
              <Save size={16} className="mr-2" /> Save provider
            </Button>
          </div>
        </Section>
      )}

      {canManageRoles && (
        <Section icon={<ShieldCheck size={18} />} title="Custom roles" description="Build roles from individual permissions, e.g. a regional HR role without payroll access. Changes ask you to confirm your identity.">
          <CustomRolesPanel />
        </Section>
      )}

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

      <div>
        <div className="flex items-center gap-2 text-lg font-semibold mb-4">
          <Briefcase size={18} className="text-indigo-500" /> Hiring
        </div>
        <HiringSettingsPanel />
      </div>
    </div>
  );
}
