import { z } from 'zod';

/**
 * SCIM 2.0 request bodies (RFC 7643/7644), limited to the User attributes HRMS
 * stores. Unknown attributes are ignored (`passthrough` is not used), so an IdP
 * cannot set anything else, such as a role.
 */
const name = z
  .object({
    givenName: z.string().max(200).optional(),
    familyName: z.string().max(200).optional(),
    formatted: z.string().max(400).optional(),
  })
  .partial();

const emailEntry = z.object({
  value: z.string().max(320).optional(),
  primary: z.boolean().optional(),
  type: z.string().max(50).optional(),
});

/** Entra sends booleans as strings ("True"/"False") in some PATCH operations. */
const scimBoolean = z.union([z.boolean(), z.enum(['true', 'false', 'True', 'False']).transform((v) => v.toLowerCase() === 'true')]);

export const scimUserSchema = z.object({
  userName: z.string().max(320).optional(),
  externalId: z.string().max(200).optional(),
  active: scimBoolean.optional(),
  name: name.optional(),
  emails: z.array(emailEntry).max(10).optional(),
  title: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': z
    .object({ department: z.string().max(200).optional() })
    .optional(),
});
export type ScimUserInput = z.infer<typeof scimUserSchema>;

export const scimPatchSchema = z.object({
  Operations: z
    .array(
      z.object({
        op: z.string().max(20),
        path: z.string().max(200).optional(),
        value: z.unknown().optional(),
      }),
    )
    .max(100),
});
export type ScimPatch = z.infer<typeof scimPatchSchema>;

export const scimListQuerySchema = z.object({
  startIndex: z.coerce.number().int().min(1).max(1_000_000).optional(),
  count: z.coerce.number().int().min(0).max(1000).optional(),
  filter: z.string().max(500).optional(),
  /** Entra lists groups with `excludedAttributes=members`. */
  excludedAttributes: z.string().max(200).optional(),
  attributes: z.string().max(200).optional(),
});
export type ScimListQuery = z.infer<typeof scimListQuerySchema>;

/** A group member reference: `value` is the HRMS user id returned by /Users. */
export const scimMemberSchema = z.object({
  value: z.string().max(100),
  display: z.string().max(320).optional(),
});

/**
 * SCIM Group (RFC 7643 §4.2). Groups carry no permissions themselves: their
 * names are matched against the provider's role mapping to set members' roles.
 */
export const scimGroupSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  externalId: z.string().max(200).optional(),
  members: z.array(scimMemberSchema).max(10_000).optional(),
});
export type ScimGroupInput = z.infer<typeof scimGroupSchema>;
