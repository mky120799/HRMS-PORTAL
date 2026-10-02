# Auth module

`apps/server/src/modules/auth` · `apps/server/src/common/auth` · `common/strategies/jwt.strategy.ts` · `common/guards/step-up.guard.ts`

## Purpose
Sign-up, sign-in, multi-device sessions, invitations, password reset, MFA with
recovery codes, step-up re-authentication, tenant auth policies, Google/OIDC/SAML
SSO and SCIM provisioning for a multi-tenant product where the same email can
exist in several workspaces.

Related: [hardening plan & status](authentication-hardening-plan.md) ·
[tutorial](authentication-tutorial.md) · [IdP setup guides](auth-setup-guides.md) ·
[admin runbooks](auth-runbooks.md) · [roles & permissions](roles-and-permissions.md)

## Key concepts
* **Workspace identifier.** Users sign in with *workspace + email + password*. The workspace
  is the tenant's slug (e.g. `acme-corp-1a2b3c`) or id. The last one used is remembered by the
  browser.
* **Token purposes.** `TokenService.sign(purpose, payload)` — each purpose has its own derived
  signing key (`HMAC(JWT_SECRET, "hrms:jwt:<purpose>")`), lifetime and a `typ` claim.

  | Purpose | Lifetime | Used for | Stateful check |
  | --- | --- | --- | --- |
  | `access` | 15 min | `Authorization: Bearer` on every API call | session `sid` still active (30 s cache) |
  | `refresh` | 7 days | `hrms_refresh` httpOnly cookie → `POST /auth/refresh` | stored SHA-256 hash (compare-and-swap) + `tokenVersion` |
  | `two_factor` | 5 min | second login step | `tokenVersion` + lockout |
  | `mfa_enroll` | 15 min | first-login MFA enrolment when policy requires it | `tokenVersion`, user not yet enrolled |
  | `step_up` | 5 min | `x-step-up-token` header on sensitive routes | bound to user + tenant + session |
  | `invite` | 7 days | accept-invite link | `tokenVersion` (single use) |
  | `reset` | 1 hour | reset-password link | `tokenVersion` (single use) |
  | `sso_state` | 10 min | OAuth/OIDC `state`, SAML `RelayState` | signature + browser nonce cookie |
  | `sso_exchange` | 60 s | one-time code after SSO | `jti` recorded in `AuthReplayGuard` (single use) + `tokenVersion` |

* **`UserSession`** stores one hashed refresh token per browser/device with IP, user agent,
  expiry, last-used time and revocation state.
* **`tokenVersion`** on `User` is the account-wide revocation lever. Incremented on password
  set/reset/change, offboarding, role change (including IdP role sync), MFA reset and erasure.
* **`AuthReplayGuard`** records keys of single-use artifacts (SSO exchange `jti`, SAML assertion
  IDs). The primary key makes the second use fail, across all API instances.

## Endpoints

| Method & path | Access | Notes |
| --- | --- | --- |
| `POST /auth/signup` | public, 5/min/IP | Creates tenant (30-day trial) + default leave policies + admin user + employee **in one transaction**; disabled when `PUBLIC_SIGNUP_ENABLED=false` |
| `POST /auth/login` | public, 10/min/IP | Session, or `{ twoFactorRequired, tempToken }`, or `{ mfaEnrollmentRequired, enrollmentToken }` |
| `POST /auth/2fa/authenticate` | public, 10/min/IP | Completes a 2FA login with a TOTP or recovery code |
| `POST /auth/2fa/enroll/start` | public (enrolment token) | QR code for first-login enrolment |
| `POST /auth/2fa/enroll/complete` | public (enrolment token) | Enables MFA, returns session + recovery codes (shown once) |
| `POST /auth/refresh` | public, 30/min/IP | Reads the `hrms_refresh` cookie (body `refreshToken` still accepted for non-browser clients); rotates it |
| `POST /auth/logout` | user | Revokes the current session, clears the cookie |
| `POST /auth/step-up` | user, 10/min/IP | `{ code }` (MFA users) or `{ password }` → 5-minute `stepUpToken` |
| `GET /auth/sessions` | user | Lists active/revoked device sessions for the user |
| `DELETE /auth/sessions/:id` | user | Revokes another owned session |
| `POST /auth/sessions/revoke-all` | user | Revokes all other owned sessions |
| `POST /auth/users/:id/revoke-sessions` | `security.manage` | Force logout for a tenant user |
| `POST /auth/users/:id/reset-mfa` | `security.manage` + step-up | Clears MFA/recovery codes and revokes that user's sessions |
| `GET /auth/me` | user | Profile + employee + tenant + unused recovery-code count |
| `POST /auth/change-password` | user | Signs out other devices, returns a fresh session |
| `POST /auth/invite` | `employees.manage`, seat limit | Creates the login; links to an employee with the same email or creates one |
| `POST /auth/accept-invite` | public | Sets password; link becomes invalid |
| `POST /auth/reset-password-request` | public, 5/min/IP | Same response whether or not the account exists |
| `POST /auth/reset-password` | public | Sets password; signs out all sessions |
| `POST /auth/2fa/generate` · `turn-on` · `turn-off` | user | TOTP enrolment (QR code), recovery-code creation and disable (blocked while policy requires MFA) |
| `POST /auth/2fa/recovery-codes/regenerate` | user | Replaces unused recovery codes after a valid authenticator code |
| `GET /auth/google?tenant=<slug>` | public | Starts Google sign-in (OIDC against `accounts.google.com`) |
| `GET /auth/google/callback` | public | Redirects to `/auth/callback?code=…` (never tokens in URLs) |
| `GET /auth/sso/providers?tenant=<slug>` | public | Lists enabled Google/OIDC/SAML options for the workspace login screen |
| `GET /auth/sso/discovery?email=<email>` | public | Suggests workspaces only when an active OIDC/SAML provider explicitly allows that email domain |
| `GET /auth/oidc/start/:providerId?tenant=<slug>` | public | Starts OIDC SSO for a configured provider |
| `GET /auth/oidc/callback` | public | Validates OIDC callback and redirects to `/auth/callback?code=…` |
| `GET /auth/saml/metadata/:providerId` | public | SAML SP metadata for Okta/Entra setup |
| `GET /auth/saml/start/:providerId?tenant=<slug>` | public | Starts SAML SSO for a configured provider |
| `POST /auth/saml/callback/:providerId` | public | SAML ACS endpoint; validates response and redirects to `/auth/callback?code=…` |
| `POST /auth/sso/exchange` | public | Exchanges the one-time code for a session (or a 2FA / enrolment step) |
| `GET/PATCH /tenants/auth-policy` | `security.manage` (+ step-up to change) | Tenant authentication policy |
| `GET/POST/PATCH /tenants/identity-providers` · `POST …/:id/scim-token` | `identity_providers.manage` (ADMIN only) + step-up to change | OIDC/SAML/SCIM configuration |
| `GET /audit?category=security&action=…` | `audit.read` | Security-event view (paged) |
| `GET /scim/v2/ServiceProviderConfig` · `ResourceTypes` · `Schemas` | public | SCIM metadata |
| `GET/POST /scim/v2/Users` · `GET/PUT/PATCH/DELETE /scim/v2/Users/:id` | SCIM bearer token, 600/min/IP | Raw SCIM 2.0 JSON (`application/scim+json` accepted); DELETE/`active:false` deactivates and revokes sessions |

## Rules & safeguards
* **Password policy:** tenant-configurable minimum length (default 10) with
  bcrypt cost 12. Tenants can also set password history count and password
  expiry days. New passwords are checked against the current password and the
  configured number of previous password hashes (`UserPasswordHistory`).
* **Account lockout:** 5 consecutive failures → locked 15 min. One atomic counter
  covers wrong passwords, wrong MFA codes (`MFA_CHALLENGE_FAILED`) and failed step-up
  (`STEP_UP_FAILED`). For MFA users a correct password does **not** clear the counter —
  only a successful second factor does — otherwise a known password would reset the
  lock between TOTP guesses. A lock emails the user and alerts workspace admins.
* **No user enumeration:** unknown users are compared against a dummy bcrypt hash so timing
  matches; reset requests always return the same message; "deactivated"/"suspended" is only
  revealed after a correct password; "password login disabled" is decided per workspace
  before the email is looked up, so every address gets the same 403.
* **Refresh token storage (browser):** the refresh token is only ever sent as the
  `hrms_refresh` cookie — `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, `Secure` in
  production — and is stripped from JSON bodies, so injected script cannot read it. CORS
  uses `credentials: true` with an explicit origin allow-list (`*` is refused at boot).
  The web app keeps only the 15-minute access token.
* **Refresh rotation + reuse detection:** only `sha256(refreshToken)` is stored per session.
  *Why not bcrypt?* bcrypt silently truncates input at 72 bytes; every JWT from this issuer
  shares its first ~72 bytes (header + `sub`), so bcrypt would accept any old token — this was
  a real bug in the original code. Rotation is a compare-and-swap on the presented hash, so two
  concurrent refreshes with one token cannot both succeed. Replaying a rotated token revokes
  that session, logs `REFRESH_TOKEN_REUSE` and alerts the user and admins. The web app
  serializes refreshes across tabs with a Web Lock and reuses a token another tab just
  obtained, so normal multi-tab use never looks like reuse.
* **Instant revocation:** `JwtStrategy` checks that the access token's session (`sid`) is
  still active. Answers are cached for 30 s per instance and cleared immediately on the
  instance that revokes, so logout, revoke-device, force-logout, password change, role
  change, offboarding, erasure and SCIM deactivation apply within seconds, not 15 minutes.
* **Session lifetime:** refresh sessions are capped by the smaller of the platform refresh
  TTL and the tenant's absolute session lifetime. If configured, the idle timeout revokes
  sessions whose `lastUsedAt` is too old.
* **2FA secrets** are encrypted at rest (AES-256-GCM, `CryptoService`).
* **2FA recovery codes** are generated when MFA is enabled, shown once, stored as bcrypt
  hashes and consumed with a conditional update (`usedAt IS NULL`), so a code works exactly
  once even under concurrency. Regenerating codes invalidates unused old codes.
* **MFA required by policy:** cannot be enabled until affected active users have enrolled.
  Users who arrive later (invite, SCIM, JIT) receive an `mfa_enroll` token after their first
  factor and must enrol before getting a session. While required, users cannot turn MFA off.
* **Step-up:** `@RequireStepUp()` routes need an `x-step-up-token` from `POST /auth/step-up`
  (≤ 5 min old, same user, tenant and session). Applied to role changes, salary changes,
  payroll finalisation, auth-policy changes, identity-provider changes and SCIM token
  rotation, admin MFA reset and GDPR erasure. The web app prompts and retries automatically
  on `403 { code: "STEP_UP_REQUIRED" }`.
* **Admin MFA reset** requires `security.manage` and step-up, clears the user's TOTP secret
  and recovery codes, bumps `tokenVersion`, revokes sessions and writes an audit event.
* **Security notifications** go through the notification outbox for new sessions,
  password changes/resets, MFA changes, recovery-code use, lockouts and refresh-token reuse.
  Lockouts and token reuse also alert tenant admins.
* **Tenant auth policy** controls password login, Google login, MFA enforcement, minimum
  password length, password history count, password expiry, idle timeout and maximum
  refresh-session lifetime.
* **Public signup** is deployment-controlled with `PUBLIC_SIGNUP_ENABLED`. Production
  examples disable it so new workspaces are created intentionally.
* **Identity providers** can only be configured by `ADMIN` (`identity_providers.manage`): an
  IdP decides who can sign in as whom, so giving it to `IT_ADMIN` would let them sign in as
  an admin. Client secrets and SAML certificates are encrypted at rest and never written to
  the audit log.
* **Generic OIDC SSO** (Okta, Entra ID, Google Workspace, Auth0, Keycloak…): discovery,
  authorization-code flow, RS256 ID-token signature via JWKS (strict `kid` match, one JWKS
  refetch on an unknown `kid` for key rotation, no "any key" fallback), issuer, audience,
  expiry, nonce and `email_verified`. A missing `email_verified` (Entra) is accepted only
  when the provider is pinned to allowed domains. Discovery, token and JWKS requests go
  through the outbound-URL guard: public addresses only, no redirects, https in production
  (`ALLOW_PRIVATE_IDP_URLS=true` for a local Keycloak in development only).
* **Built-in Google sign-in** uses the same OIDC verifier against `accounts.google.com`
  (configured by `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`). It only signs in *existing,
  active* users of the workspace named in the signed state and never auto-provisions. The
  earlier passport-based flow was removed: passport redirects with `res.setHeader`, which
  Fastify replies do not have.
* **SSO browser binding:** every SSO start sets an `hrms_sso` httpOnly nonce cookie whose
  hash is inside the signed state; callbacks fail in any other browser (login CSRF).
* **JIT provisioning** creates a missing user (with linked employee, seat limit enforced)
  only when the provider has `jitProvisioning` **and** at least one allowed domain.
* **Role mapping:** `roleMapping` (`{ "<IdP group>": "<ROLE>" }`, first match wins,
  case-insensitive) sets the role on JIT creation and re-syncs it at each SSO sign-in
  (other sessions revoked on change, `ROLE_SYNCED_FROM_IDP` audited). `ADMIN` can never be
  granted and existing admins are never changed.
* **SAML SSO** uses `@node-saml/node-saml` for metadata, signature, issuer, audience and
  expiry. HRMS also verifies `Response/@Destination` and the bearer
  `SubjectConfirmationData/@Recipient` against the ACS URL (the library does not), records
  each assertion ID for single use, and maps email/name/groups via configurable attribute
  names with Okta/Entra defaults. `InResponseTo` is not validated; replay and CSRF are
  covered by the assertion-ID guard and browser binding.
* **Workspace discovery** is conservative: it only suggests a workspace when an active
  OIDC/SAML provider has explicitly allowed the email domain.
* **SCIM provisioning** uses a per-provider bearer token generated in Settings, shown once,
  stored as a uniquely indexed SHA-256 hash (one indexed lookup per request). Bodies are
  validated with zod; unknown attributes (e.g. a role) are ignored, so SCIM-created users are
  always `EMPLOYEE` with an empty `passwordHash`. Responses are raw SCIM JSON with RFC 7644
  error bodies. Create/update/deactivate update both `User` and `Employee`, respect the seat
  limit, write audit events and revoke sessions on deactivation.
* **Invite** respects the plan's seat limit (`EmployeeLimitGuard`).
* **Roles and permissions:** built-in roles map to explicit permissions. API routes use
  `@Permissions(...)`; `@Roles(...)` is reserved for role identity cases such as platform
  routes. See `docs/modules/roles-and-permissions.md`.

## Failure modes & edge cases
* Same email in two workspaces → allowed; the workspace field disambiguates.
* Invite for an email already linked to a user → 409.
* Several API instances: a revoked session stops working on other instances within 30 s.
* SSO started in one browser and finished in another → `sso_failed` (`SSO_LOGIN_FAILED`,
  reason "different browser"/"not found in this browser").
* SAML requires the API on HTTPS (the `hrms_sso` cookie is `SameSite=None; Secure`);
  browsers treat `http://localhost` as secure for development.
* Clock skew: JWT expiry uses server time; OIDC tolerates `iat` up to 5 min ahead; SAML
  accepts 2 min clock skew.
* Rate limits are per API instance (in-memory throttler storage); see the plan's Phase 13.

## Security event taxonomy

Authentication security events are recorded in the audit log and shown under Audit Logs →
**Security events** (`GET /audit?category=security`). Review procedure:
[auth-runbooks.md](auth-runbooks.md).

| Event | Meaning |
| --- | --- |
| `LOGIN`, `LOGOUT` | Successful sign-in (password, SSO, MFA, recovery code, enrolment) / sign-out |
| `LOGIN_FAILED`, `MFA_CHALLENGE_FAILED`, `STEP_UP_FAILED` | Wrong password / second factor / step-up credential |
| `ACCOUNT_LOCKED` | Lockout reached; `newValues.trigger` says which failure type |
| `SSO_LOGIN_FAILED` | Google/OIDC/SAML callback rejected; `newValues.method`, `reason` |
| `REFRESH_TOKEN_REUSE` | A rotated refresh token was replayed; affected session revoked |
| `SESSION_IDLE_TIMEOUT` | A refresh session exceeded the tenant idle-timeout policy |
| `SESSION_REVOKED`, `SESSIONS_REVOKED`, `ADMIN_FORCE_LOGOUT` | Session revocation |
| `STEP_UP` | Re-authenticated for a sensitive action; `newValues.method` |
| `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET`, `PASSWORD_CHANGED` | Credential reset/change |
| `2FA_ENABLED`, `2FA_DISABLED`, `MFA_ENROLLMENT_REQUIRED` | MFA lifecycle |
| `MFA_RECOVERY_CODE_USED`, `MFA_RECOVERY_CODES_REGENERATED`, `ADMIN_MFA_RESET` | Recovery/admin MFA operations |
| `AUTH_POLICY_UPDATED` | Tenant authentication policy changed |
| `IDENTITY_PROVIDER_CREATED`, `IDENTITY_PROVIDER_UPDATED`, `SCIM_TOKEN_ROTATED` | Enterprise SSO/SCIM configuration changed |
| `SSO_USER_PROVISIONED`, `ROLE_SYNCED_FROM_IDP`, `SCIM_USER_*` | Identity-provider driven account changes |

User-facing notifications (in-app + email): `AUTH_NEW_SESSION`, `AUTH_PASSWORD_CHANGED`,
`AUTH_PASSWORD_RESET`, `AUTH_MFA_ENABLED/DISABLED/ADMIN_RESET`,
`AUTH_MFA_RECOVERY_CODE_USED`, `AUTH_ACCOUNT_LOCKED`, `AUTH_REFRESH_REUSE`; admins receive
`AUTH_SUSPICIOUS_ACTIVITY` for lockouts and token reuse.

## Tests
* `test/auth.e2e-spec.ts` (15) — httpOnly refresh cookie, instant logout/device revocation,
  2FA lockout that a known password cannot reset, single-use recovery codes, policy-required
  MFA enrolment and blocked turn-off, single-use SSO exchange codes, no enumeration with
  password login disabled, password history, step-up bound to the session, ADMIN-only IdP
  configuration with step-up/JIT rules/no secrets in audit, OIDC SSRF refusal, IdP role
  mapping (never ADMIN, JIT needs domains), SCIM protocol shape/content type/Entra PATCH/tenant
  isolation, security-event filter.
* `test/security.e2e-spec.ts` — token confusion, missing-tenant token, removed `/auth/register`,
  single-use invites, refresh rotation + reuse revocation (via cookie), lockout, reset
  non-enumeration.
* Unit: `common/auth/token.service.spec.ts` (purpose isolation, strategy fail-closed and session
  checks), `common/guards/step-up.guard.spec.ts`, `common/net/outbound-url.spec.ts`,
  `modules/auth/oidc-auth.service.spec.ts` (real RSA keys: signature, issuer, audience, nonce,
  expiry, `alg`, `kid` rotation, `email_verified`, browser binding),
  `modules/auth/saml-checks.spec.ts`, `modules/auth/sso-mapping.spec.ts`,
  `modules/auth/two-factor.service.spec.ts`.

## Interview talking points
* "Why separate keys *and* a `typ` claim?" — defence in depth; either alone prevents token
  confusion, together a single mistake can't reintroduce it.
* "How do you log someone out everywhere?" — revoke `UserSession` rows and bump
  `tokenVersion`; access tokens carry `sid`, which the API checks against the session table
  with a 30-second per-instance cache, so revocation is near-instant without a per-request
  database hit.
* "Where do you keep tokens in the SPA?" — access token (15 min) in storage, refresh token
  only in an httpOnly SameSite=Strict cookie scoped to the auth routes, so XSS cannot steal a
  long-lived credential; refresh is serialized across tabs so rotation + reuse detection does
  not log users out.
* "What does step-up protect against?" — a stolen access token or an unattended laptop: the
  most damaging actions need a fresh second factor bound to that exact session.
* "What does the SAML library *not* check?" — Destination/Recipient and assertion replay;
  HRMS checks both, and the replay guard is in the database so it works on every instance.
* "Why can't IT_ADMIN configure SSO?" — whoever controls the IdP can assert any email,
  including an admin's, so IdP configuration is effectively admin-level power.
