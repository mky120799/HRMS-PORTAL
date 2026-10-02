# Authentication hardening plan

This checklist is the implementation plan for moving HRMS authentication toward
an enterprise-grade system similar in spirit to Zoho, Workday and other serious
HR platforms.

The goal is not to copy one vendor. The goal is to support secure password
login, MFA, sessions, tenant policies, permissions and provider-neutral
enterprise SSO.

## Status (2026-10-02, after completion work)

Every item below was checked against the code and covered by tests where noted.

Legend: `[x]` done · `[~]` partly done · `[ ]` not started

| Phase | Done | Partial | Not started |
| --- | --- | --- | --- |
| 0 Foundation | 13 | 0 | 0 |
| 1 Sessions | 16 | 0 | 0 |
| 2 MFA | 14 | 0 | 0 |
| 3 Tenant policies | 16 | 0 | 0 |
| 4 Permissions | 13 | 0 | 1 (custom roles — deferred by design) |
| 5 Security events | 18 | 0 | 0 |
| 6 OIDC SSO | 24 | 0 | 0 |
| 7 SAML SSO | 18 | 0 | 0 |
| 8 SCIM | 13 | 0 | 0 |
| 9 Frontend | 17 | 0 | 0 |
| 10 Documentation | 10 | 0 | 0 |
| 11 Review fixes | 14 | 0 | 0 |
| 12 Tests | 9 | 0 | 0 |
| 13 Roadmap | 3 | 0 | 1 (Redis rate limiting — needs an infrastructure decision) |

Everything planned is implemented and tested (101 unit, 61 API e2e). Two items
remain open on purpose; see **What is left** at the end.

## Phase 0: Current foundation

- [x] Workspace + email + password login
- [x] Password hashing with bcrypt
- [x] Short-lived access tokens
- [x] Refresh tokens
- [x] Refresh token rotation and reuse detection
- [x] Purpose-bound tokens for access, refresh, invite, reset, 2FA and SSO
- [x] Account lockout after repeated failures (password, MFA and step-up share one
  atomic counter; a correct password no longer resets it before the second factor)
- [x] Password reset
- [x] Admin invite flow
- [x] Google OAuth login for existing users
- [x] TOTP two-factor authentication
- [x] Encrypted 2FA secrets
- [x] Audit events for core auth actions

## Phase 1: Sessions

Goal: move from one refresh token per user to multiple managed sessions.

- [x] Add `UserSession` table
- [x] Store hashed refresh token per session
- [x] Store device/browser metadata (raw user agent; not parsed into device/browser names)
- [x] Store IP address and user agent
- [x] Store last-used timestamp
- [x] Store absolute expiry timestamp
- [x] Add session idle timeout support
- [x] Rotate refresh token per session
- [x] Detect refresh-token reuse per session (atomic rotation; tabs serialize refresh)
- [x] Revoke only the affected session when possible
- [x] Add `GET /auth/sessions`
- [x] Add `DELETE /auth/sessions/:id`
- [x] Add `POST /auth/sessions/revoke-all`
- [x] Add admin force logout endpoint
- [x] Update frontend security page to list active sessions
- [x] Document session lifecycle in `auth.md`

## Phase 2: MFA production hardening

Goal: make MFA usable and recoverable in real companies.

- [x] Add `MfaRecoveryCode` table
- [x] Generate recovery codes when MFA is enabled
- [x] Hash recovery codes before storage
- [x] Allow one-time recovery-code login (conditional consume; safe under concurrency)
- [x] Mark used recovery codes as consumed
- [x] Allow user to regenerate recovery codes after MFA verification
- [x] Add tenant policy: require MFA for admins (late joiners enrol at first sign-in;
  MFA cannot be turned off while required)
- [x] Add tenant policy: require MFA for all users (same enrolment flow)
- [x] Add step-up MFA for sensitive actions — `@RequireStepUp()` on role changes,
  salary changes, payroll finalisation, auth-policy and identity-provider changes,
  SCIM token rotation, admin MFA reset and GDPR erasure; web app prompts and retries
- [x] Add admin MFA reset workflow
- [x] Audit MFA recovery-code use
- [x] Notify user when MFA is enabled, disabled or reset
- [x] Update security page UI for recovery codes
- [x] Document MFA setup and recovery flow

## Phase 3: Tenant auth policies

Goal: let each company control its own authentication rules.

- [x] Add `TenantAuthPolicy` table
- [x] Configure allowed login methods (password and Google toggles; OIDC/SAML via provider `isActive`)
- [x] Configure password minimum length
- [x] Configure password history count
- [x] Configure password expiry policy
- [x] Configure MFA requirements
- [x] Configure session idle timeout
- [x] Configure absolute session lifetime
- [x] Configure whether public signup is allowed (deployment-level
  `PUBLIC_SIGNUP_ENABLED`, by design — signup creates tenants)
- [x] Add admin API to read/update policy
- [x] Add settings UI for auth policy
- [x] Apply policy during login
- [x] Apply policy during password changes
- [x] Apply policy during SSO login
- [x] Audit policy changes
- [x] Document tenant auth policies

## Phase 4: Permissions and roles

Goal: move from simple role checks to a permission-based foundation.

- [x] Define permission constants
- [x] Map built-in roles to permissions
- [x] Add `PermissionGuard`
- [x] Keep existing `@Roles` support during migration
- [x] Add helper decorator like `@Permissions(...)`
- [x] Apply permissions to payroll APIs
- [x] Apply permissions to employee APIs
- [x] Apply permissions to hiring APIs
- [x] Apply permissions to documents APIs
- [x] Apply permissions to audit APIs
- [x] Apply permissions to leave, attendance, analytics, performance, tenant,
  billing, notification and compliance APIs
- [x] Update frontend route/action visibility to use permissions
- [ ] Add custom role data model later if needed
- [x] Update docs with role-to-permission matrix

Note: the role→permission map is duplicated in `apps/web/src/lib/auth.ts`, so it
must be kept in sync by hand until `/auth/me` returns permissions.

Current built-in role model:

- Platform: `SUPER_ADMIN`
- Full tenant administrator: `ADMIN`
- HR: `HR_ADMIN`, `HR_MANAGER`
- Payroll/finance: `PAYROLL_ADMIN`, `FINANCE`
- Hiring: `RECRUITER`, `HIRING_MANAGER`, `INTERVIEWER`
- People management/self-service: `MANAGER`, `EMPLOYEE`
- Oversight/security: `AUDITOR`, `IT_ADMIN`

Detailed mapping: `docs/modules/roles-and-permissions.md`.

## Phase 5: Security events and notifications

Goal: make authentication activity visible and auditable.

- [x] Add normalized `SecurityEvent` model or expand audit usage (audit log expanded)
- [x] Record login success
- [x] Record login failure
- [x] Record account lockout
- [x] Record password change
- [x] Record password reset request (`PASSWORD_RESET_REQUESTED`)
- [x] Record password reset completion
- [x] Record MFA challenge success/failure (`MFA_CHALLENGE_FAILED`, `STEP_UP_FAILED`)
- [x] Record MFA recovery-code use
- [x] Record session revoke (including `LOGOUT`)
- [x] Record refresh-token reuse
- [x] Record SSO login success/failure (`SSO_LOGIN_FAILED` with method and reason)
- [x] Notify user on password change
- [x] Notify user on MFA changes
- [x] Notify user on new device/session
- [x] Notify admins on suspicious auth activity (refresh-token reuse and lockouts,
  including lockouts caused by MFA failures)
- [x] Add admin security-events view (Audit Logs → Security events: category and
  event filters, paging, risky events highlighted)
- [x] Document security event taxonomy (`auth.md`)

## Phase 6: Generic OIDC SSO

Goal: support Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak and
other modern identity providers without hardcoding one vendor.

- [x] Add `TenantIdentityProvider` table
- [x] Support provider type `OIDC`
- [x] Store issuer URL
- [x] Store client ID
- [x] Store encrypted client secret
- [x] Store allowed email domains
- [x] Store active/inactive state
- [x] Add role mapping config (applied on JIT and at each SSO sign-in; never grants
  ADMIN; existing admins untouched)
- [x] Add just-in-time provisioning setting
- [x] Add OIDC discovery document loading (outbound-URL guard against SSRF)
- [x] Add OIDC authorization redirect endpoint
- [x] Add OIDC callback endpoint
- [x] Verify ID token signature (strict `kid`; one JWKS refetch on key rotation)
- [x] Verify issuer
- [x] Verify audience/client ID
- [x] Verify email verification status (missing claim accepted only for
  domain-pinned providers, e.g. Entra)
- [x] Match user by tenant + email
- [x] Optionally provision user if allowed
- [x] Apply tenant MFA/session policies after SSO
- [x] Audit SSO login events
- [x] Add admin UI for OIDC configuration
- [x] Add setup docs for Okta
- [x] Add setup docs for Microsoft Entra ID
- [x] Add setup docs for Google Workspace

## Phase 7: SAML SSO

Goal: support enterprise customers that require SAML.

- [x] Add provider type `SAML`
- [x] Store SAML entity ID
- [x] Store SSO URL
- [x] Store X.509 certificate
- [x] Store attribute mapping (`attributeMapping`: email, names, display name, groups)
- [x] Add SAML metadata endpoint
- [x] Add SAML ACS callback endpoint
- [x] Verify SAML response signature (signed assertions required)
- [x] Verify audience/entity ID
- [x] Verify recipient and destination (HRMS checks both; the library does not)
- [x] Verify assertion expiry
- [x] Prevent assertion replay (assertion IDs recorded in `AuthReplayGuard`)
- [x] Match or provision user
- [x] Apply tenant policies
- [x] Audit SAML login events
- [x] Add admin UI for SAML configuration
- [x] Add setup docs for Okta SAML
- [x] Add setup docs for Entra SAML

## Phase 8: SCIM provisioning

Goal: allow external identity providers to create, update and deactivate users
automatically.

- [x] Add SCIM bearer token model
- [x] Add hashed SCIM token storage on identity provider records
- [x] Add SCIM `/Users` endpoint
- [x] Add SCIM list users endpoint
- [x] Add SCIM create user endpoint
- [x] Add SCIM update user endpoint
- [x] Add SCIM deactivate user endpoint
- [x] Map SCIM user to HRMS user and employee
- [x] Respect tenant seat limits
- [x] Audit SCIM changes
- [x] Add admin token rotation UI
- [x] Add setup docs for Okta SCIM
- [x] Add setup docs for Entra SCIM

Not in scope yet: SCIM `/Groups`.

## Phase 9: Frontend work

Goal: make the auth system understandable and usable.

- [x] Security page: active sessions
- [x] Security page: revoke session
- [x] Security page: revoke all sessions
- [x] Security page: MFA recovery codes
- [x] Settings page: tenant auth policy
- [x] Settings page: SSO provider list
- [x] Settings page: OIDC configuration
- [x] Settings page: SAML configuration
- [x] Admin page: force logout user
- [x] Admin page: reset MFA
- [x] Admin page: security event log
- [x] Login page: required-MFA enrolment step (QR → code → recovery codes)
- [x] Global step-up prompt for sensitive actions
- [x] Settings page: role mapping and SAML attribute mapping
- [x] Login page: company SSO option
- [x] Login page: domain/workspace discovery
- [x] Login page: clear MFA step

## Phase 10: Documentation

Goal: keep implementation and product understanding together.

- [x] Keep `docs/modules/auth.md` updated
- [x] Keep `docs/modules/authentication-tutorial.md` updated
- [x] Keep this checklist updated
- [x] Add Okta OIDC setup guide
- [x] Add Microsoft Entra ID setup guide
- [x] Add Google Workspace setup guide
- [x] Add SAML setup guide
- [x] Add SCIM setup guide
- [x] Add admin runbook for MFA reset (`auth-runbooks.md`)
- [x] Add admin runbook for suspicious login review (`auth-runbooks.md`)

## Phase 11: Fixes from code review (done 2026-10-02)

- [x] 11.1 **2FA brute force.** The 2FA step honours `lockedUntil`; the password
  step no longer clears failures for MFA users; the counter increment is atomic.
- [x] 11.2 **MFA-required dead end.** Users a policy requires to use MFA get an
  `mfa_enroll` token and enrol at sign-in (password and SSO); `2fa/turn-off` is
  refused while the policy requires MFA.
- [x] 11.3 **Replayable SSO exchange code.** Codes carry a `jti` recorded in
  `AuthReplayGuard`; the second exchange fails.
- [x] 11.4 **Multi-tab refresh race.** Rotation is a compare-and-swap on the
  presented hash; the web app serializes refreshes across tabs (Web Locks) and
  reuses a token another tab obtained. No grace window, so reuse detection stays strict.
- [x] 11.5 **OIDC hardening.** Outbound-URL guard (public IPs only, no redirects,
  https in production) for discovery, token and JWKS; strict `kid` with one
  refetch; JIT requires allowed domains.
- [x] 11.6 **Recovery-code race.** Conditional consume (`usedAt IS NULL`).
- [x] 11.7 **SCIM.** Unique indexed token hash, zod-validated bodies, raw SCIM
  responses and RFC 7644 errors (the app envelope previously wrapped every SCIM
  response, which Okta/Entra cannot parse), `application/scim+json` accepted,
  Entra-style PATCH paths and string booleans.
- [x] 11.8 **Email enumeration.** Password-login-disabled is decided per workspace
  before the email lookup.
- [x] 11.9 **SAML.** Destination/Recipient checks and assertion replay guard.
- [x] 11.10 **Privilege escalation via IdP.** New `identity_providers.manage`
  permission (ADMIN only) plus step-up; IdP role mapping can never grant ADMIN.

Found and fixed while doing this:

- [x] **API could not boot.** A duplicate `x-www-form-urlencoded` parser in
  `bootstrap.ts` made `app.init()` throw (Nest already registers one); removed.
- [x] **Google sign-in crashed on start.** Passport redirects with
  `res.setHeader`, which Fastify replies do not have. Google now uses the OIDC
  verifier (with nonce and browser binding); `passport-google-oauth20` removed.
- [x] **OIDC client secret written to the audit log** on identity-provider
  updates (the whole DTO was logged). Secrets are now redacted.
- [x] RabbitMQ consumer threw on shutdown (`nack` on a closing channel), which
  failed whichever e2e suite ran next.

## Phase 12: Tests (done)

- [x] Fix stale `common/auth/token.service.spec.ts`
- [x] Sessions: cookie, instant logout, revoke another device, refresh rotation via cookie
- [x] MFA: lockout at the 2FA step, single-use recovery codes, required enrolment, blocked turn-off
- [x] Tenant policy: password login off (no enumeration), password history, MFA required
- [x] OIDC: signature, issuer, audience, nonce, expiry, `alg`, `kid` rotation,
  `email_verified`, SSRF (unit tests with real RSA keys + e2e)
- [x] SAML: Destination/Recipient and malformed documents (unit); attribute mapping (unit)
- [x] SCIM: auth, raw protocol shape, scim+json, Entra PATCH, ignored role attribute, tenant isolation
- [x] Step-up guard (unit) and step-up flow bound to session (e2e)
- [x] Regression test for each Phase 11 fix

Totals: 101 unit tests; API e2e 61 (auth 15, security 27, workflows 19) — all passing.

Not covered by automated tests: a full signed SAML round trip and live sign-in
against real Okta / Entra / Google tenants. Do one manual test per IdP before
onboarding a customer on it (`auth-setup-guides.md`).

## Phase 13: Remaining roadmap

- [x] Refresh token in an httpOnly `SameSite=Strict` cookie instead of `localStorage`
- [x] Bind SSO `state` to a browser nonce cookie (login CSRF)
- [ ] Redis-backed rate limiting so limits hold across API instances — needs a
  Redis service (ElastiCache in Terraform, `redis` in docker-compose) and the
  `ioredis` dependency; until then limits are per instance
- [x] Instant revocation: access tokens' `sid` checked against the session table
  (30 s per-instance cache, cleared immediately on the revoking instance)

## What is left

1. **Decide on Redis** for shared rate limiting (Phase 13). Needed before running
   more than one API instance in production.
2. **Manual IdP tests** — one real sign-in per IdP (Okta, Entra, Google) before a
   customer depends on it.
3. Optional later: custom roles data model (Phase 4), SCIM `/Groups`, TOTP code
   replay prevention (a valid 6-digit code can currently be reused within its
   30-second window), and parsing user agents into device names for the sessions list.
