import { TENANT_ROLES, type TenantRole } from '../../common/constants/domain';

/**
 * Maps IdP groups to an HRMS role using the provider's `roleMapping`
 * (`{ "<group>": "<ROLE>" | "custom:<KEY>" }`). Entries are checked in the order
 * they were saved; the first group the user belongs to wins. Matching ignores case.
 *
 * ADMIN (and SUPER_ADMIN) can never be granted by an IdP: full workspace
 * administration is assigned inside HRMS only. Custom roles cannot contain
 * administrator powers either (see NON_DELEGABLE_PERMISSIONS).
 */
export const IDP_ASSIGNABLE_ROLES = TENANT_ROLES.filter((role) => role !== 'ADMIN');
export const CUSTOM_ROLE_REF = /^custom:([A-Z][A-Z0-9_]{1,39})$/;

export type MappedRole = { role: TenantRole } | { customRoleKey: string };

export function parseRoleRef(value: unknown): MappedRole | null {
  if (typeof value !== 'string') return null;
  if ((IDP_ASSIGNABLE_ROLES as readonly string[]).includes(value)) return { role: value as TenantRole };
  const custom = CUSTOM_ROLE_REF.exec(value);
  return custom ? { customRoleKey: custom[1] } : null;
}

export function mappedRole(roleMapping: unknown, groups: readonly string[]): MappedRole | null {
  if (!roleMapping || typeof roleMapping !== 'object' || Array.isArray(roleMapping) || !groups.length) return null;
  const memberOf = new Set(groups.map((group) => group.trim().toLowerCase()));
  for (const [group, role] of Object.entries(roleMapping as Record<string, unknown>)) {
    if (!memberOf.has(group.trim().toLowerCase())) continue;
    const parsed = parseRoleRef(role);
    if (parsed) return parsed;
  }
  return null;
}

/** Normalizes a claim/attribute that may be a string, a string array or absent. */
export function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return [];
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string' && item.trim() !== '')?.trim();
  return undefined;
}

export interface SamlAttributeMapping {
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  groups?: string;
}

/** Attribute names tried when the provider has no explicit mapping (Okta, Entra, ADFS conventions). */
const DEFAULT_SAML_ATTRIBUTES: Required<Record<keyof SamlAttributeMapping, string[]>> = {
  email: [
    'email',
    'mail',
    'urn:oid:0.9.2342.19200300.100.1.3',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  ],
  firstName: ['firstName', 'givenName', 'urn:oid:2.5.4.42', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'],
  lastName: ['lastName', 'surname', 'sn', 'urn:oid:2.5.4.4', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'],
  displayName: ['displayName', 'cn', 'name', 'http://schemas.microsoft.com/identity/claims/displayname'],
  groups: ['groups', 'memberOf', 'roles', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'],
};

export function parseSamlAttributeMapping(value: unknown): SamlAttributeMapping {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: SamlAttributeMapping = {};
  for (const key of Object.keys(DEFAULT_SAML_ATTRIBUTES) as (keyof SamlAttributeMapping)[]) {
    const name = (value as Record<string, unknown>)[key];
    if (typeof name === 'string' && name.trim()) result[key] = name.trim();
  }
  return result;
}

/**
 * Extracts identity fields from a validated SAML profile. A configured
 * attribute name is used exclusively for that field (no silent fallback), so a
 * mapping mistake fails loudly instead of matching the wrong account.
 */
export function samlIdentity(profile: Record<string, unknown>, mappingValue: unknown) {
  const mapping = parseSamlAttributeMapping(mappingValue);
  const pick = (field: keyof SamlAttributeMapping) =>
    mapping[field] ? [mapping[field] as string] : DEFAULT_SAML_ATTRIBUTES[field];

  const emailCandidates = [...pick('email').map((name) => firstString(profile[name])), ...(mapping.email ? [] : [firstString(profile.nameID)])];
  const email = emailCandidates.find((value) => !!value && value.includes('@'))?.toLowerCase();

  const value = (field: keyof SamlAttributeMapping) =>
    pick(field).map((name) => firstString(profile[name])).find((item) => !!item);
  const displayName = value('displayName');
  const name = displayName ?? ([value('firstName'), value('lastName')].filter(Boolean).join(' ') || undefined);
  const groups = pick('groups').flatMap((nameKey) => stringList(profile[nameKey]));

  return { email, name, groups };
}
