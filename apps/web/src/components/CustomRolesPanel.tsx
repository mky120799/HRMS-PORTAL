import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../lib/toast';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';

export type CustomRole = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  baseRole: string;
  permissions: string[];
  isActive: boolean;
  userCount: number;
};
export type RoleCatalog = {
  permissions: string[];
  nonDelegable: string[];
  builtIn: { key: string; permissions: string[] }[];
  custom: CustomRole[];
};

/** Base roles a custom role can build on (ADMIN stays built-in only). */
const BASE_ROLES = ['EMPLOYEE', 'MANAGER', 'HR_MANAGER', 'HR_ADMIN', 'PAYROLL_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'FINANCE', 'AUDITOR', 'IT_ADMIN'];

type Draft = { id?: string; key: string; name: string; description: string; baseRole: string; permissions: string[] };
const EMPTY: Draft = { key: '', name: '', description: '', baseRole: 'EMPLOYEE', permissions: [] };

export function useRoleCatalog(enabled = true) {
  return useQuery({ queryKey: ['roles'], enabled, queryFn: async () => (await api.get<RoleCatalog>('/roles')).data });
}

export function CustomRolesPanel() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const onError = (e: unknown) => showToast(getErrorMessage(e), 'error');
  const catalog = useRoleCatalog();
  const [draft, setDraft] = useState<Draft | null>(null);

  // Group permissions by area ("payroll.read" → "payroll") for the checkbox grid.
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const permission of catalog.data?.permissions ?? []) {
      const area = permission.split('.')[0];
      map.set(area, [...(map.get(area) ?? []), permission]);
    }
    return [...map.entries()];
  }, [catalog.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['roles'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
  };
  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = { name: d.name, description: d.description || undefined, baseRole: d.baseRole, permissions: d.permissions };
      return d.id ? api.patch(`/roles/${d.id}`, body) : api.post('/roles', { ...body, key: d.key });
    },
    onSuccess: (_res, d) => {
      setDraft(null);
      refresh();
      showToast(d.id ? 'Custom role updated' : 'Custom role created', 'success');
    },
    onError,
  });
  const toggle = useMutation({
    mutationFn: async (role: CustomRole) => api.patch(`/roles/${role.id}`, { isActive: !role.isActive }),
    onSuccess: () => {
      refresh();
      showToast('Custom role updated', 'success');
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: async (role: CustomRole) => api.delete(`/roles/${role.id}`),
    onSuccess: () => {
      refresh();
      showToast('Custom role deleted', 'success');
    },
    onError,
  });

  const delegable = new Set(catalog.data?.permissions ?? []);
  const copyBasePermissions = () => {
    if (!draft) return;
    const base = catalog.data?.builtIn.find((role) => role.key === draft.baseRole)?.permissions ?? [];
    setDraft({ ...draft, permissions: base.filter((permission) => delegable.has(permission)) });
  };
  const togglePermission = (permission: string) =>
    draft &&
    setDraft({
      ...draft,
      permissions: draft.permissions.includes(permission)
        ? draft.permissions.filter((item) => item !== permission)
        : [...draft.permissions, permission],
    });

  const roles = catalog.data?.custom ?? [];

  return (
    <div className="space-y-4">
      {roles.length === 0 && !catalog.isLoading && <p className="text-sm text-muted-foreground">No custom roles yet.</p>}
      {roles.map((role) => (
        <div key={role.id} className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              {role.name}
              <code className="text-xs text-muted-foreground">custom:{role.key}</code>
              {!role.isActive && <Badge variant="outline">Inactive</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              Base role {role.baseRole} · {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'} · {role.userCount} user
              {role.userCount === 1 ? '' : 's'}
            </div>
            {role.description && <div className="text-xs text-muted-foreground">{role.description}</div>}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDraft({ id: role.id, key: role.key, name: role.name, description: role.description ?? '', baseRole: role.baseRole, permissions: role.permissions })
              }
            >
              <Pencil size={14} className="mr-1" /> Edit
            </Button>
            <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(role)}>
              {role.isActive ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={remove.isPending || role.userCount > 0}
              title={role.userCount > 0 ? 'Reassign its users first, or deactivate it' : undefined}
              onClick={() => window.confirm(`Delete the role "${role.name}"?`) && remove.mutate(role)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      ))}

      {!draft ? (
        <Button variant="outline" onClick={() => setDraft({ ...EMPTY })}>
          <Plus size={16} className="mr-2" /> New custom role
        </Button>
      ) : (
        <div className="space-y-4 rounded-md border p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input placeholder="Regional HR" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Key (used in IdP mappings as custom:KEY)</Label>
              <Input
                placeholder="REGIONAL_HR"
                value={draft.key}
                disabled={!!draft.id}
                onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
              />
            </div>
            <div className="space-y-1">
              <Label>Base role</Label>
              <select
                className="h-9 w-full rounded-md border bg-white px-2 text-sm"
                value={draft.baseRole}
                onChange={(e) => setDraft({ ...draft, baseRole: e.target.value })}
              >
                {BASE_ROLES.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Controls which pages and record scopes apply (for example, managers see their team).</p>
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Permissions</Label>
              <Button variant="ghost" size="sm" onClick={copyBasePermissions}>
                Copy from base role
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {groups.map(([area, permissions]) => (
                <div key={area} className="space-y-1">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">{area.replace(/_/g, ' ')}</div>
                  {permissions.map((permission) => (
                    <label key={permission} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={draft.permissions.includes(permission)} onChange={() => togglePermission(permission)} />
                      <code className="text-xs">{permission}</code>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Not available in custom roles: {(catalog.data?.nonDelegable ?? []).join(', ')}. You can only assign a role whose permissions you hold yourself.
            </p>
          </div>

          <div className="flex gap-2">
            <Button disabled={save.isPending || draft.name.trim().length < 2 || (!draft.id && draft.key.length < 2)} onClick={() => save.mutate(draft)}>
              <Save size={16} className="mr-2" /> {draft.id ? 'Save role' : 'Create role'}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              <X size={16} className="mr-2" /> Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
