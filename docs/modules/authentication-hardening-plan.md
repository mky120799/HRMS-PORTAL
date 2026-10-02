# Authentication hardening plan

This checklist is the implementation plan for moving HRMS authentication toward
an enterprise-grade system similar in spirit to Zoho, Workday and other serious
HR platforms.

The goal is not to copy one vendor. The goal is to support secure password
login, MFA, sessions, tenant policies, permissions and provider-neutral
enterprise SSO.

## Phase 0: Current foundation

Already present:

- [x] Workspace + email + password login
- [x] Password hashing with bcrypt
- [x] Short-lived access tokens
- [x] Refresh tokens
- [x] Refresh token rotation and reuse detection
- [x] Purpose-bound tokens for access, refresh, invite, reset, 2FA and SSO
- [x] Account lockout after repeated failures
- [x] Password reset
- [x] Admin invite flow
- [x] Google OAuth login for existing users
- [x] TOTP two-factor authentication
- [x] Encrypted 2FA secrets
- [x] Audit events for core auth actions

## Phase 1: Sessions

Goal: move from one refresh token per user to multiple managed sessions.

- [ ] Add `UserSession` table
- [ ] Store hashed refresh token per session
- [ ] Store device/browser metadata
- [ ] Store IP address and user agent
- [ ] Store last-used timestamp
- [ ] Store absolute expiry timestamp
- [ ] Add session idle timeout support
- [ ] Rotate refresh token per session
- [ ] Detect refresh-token reuse per session
- [ ] Revoke only the affected session when possible
- [ ] Add `GET /auth/sessions`
- [ ] Add `DELETE /auth/sessions/:id`
- [ ] Add `POST /auth/sessions/revoke-all`
- [ ] Add admin force logout endpoint
- [ ] Update frontend security page to list active sessions
- [ ] Document session lifecycle in `auth.md`

## Phase 2: MFA production hardening

Goal: make MFA usable and recoverable in real companies.

- [ ] Add `MfaRecoveryCode` table
- [ ] Generate recovery codes when MFA is enabled
- [ ] Hash recovery codes before storage
- [ ] Allow one-time recovery-code login
- [ ] Mark used recovery codes as consumed
- [ ] Allow user to regenerate recovery codes after MFA verification
- [ ] Add tenant policy: require MFA for admins
- [ ] Add tenant policy: require MFA for all users
- [ ] Add step-up MFA for sensitive actions
- [ ] Add admin MFA reset workflow
- [ ] Audit MFA recovery-code use
- [ ] Notify user when MFA is enabled, disabled or reset
- [ ] Update security page UI for recovery codes
- [ ] Document MFA setup and recovery flow

## Phase 3: Tenant auth policies

Goal: let each company control its own authentication rules.

- [ ] Add `TenantAuthPolicy` table
- [ ] Configure allowed login methods
- [ ] Configure password minimum length
- [ ] Configure password history count
- [ ] Configure password expiry policy
- [ ] Configure MFA requirements
- [ ] Configure session idle timeout
- [ ] Configure absolute session lifetime
- [ ] Configure whether public signup is allowed
- [ ] Add admin API to read/update policy
- [ ] Add settings UI for auth policy
- [ ] Apply policy during login
- [ ] Apply policy during password changes
- [ ] Apply policy during SSO login
- [ ] Audit policy changes
- [ ] Document tenant auth policies

## Phase 4: Permissions and roles

Goal: move from simple role checks to a permission-based foundation.

- [ ] Define permission constants
- [ ] Map built-in roles to permissions
- [ ] Add `PermissionGuard`
- [ ] Keep existing `@Roles` support during migration
- [ ] Add helper decorator like `@Permissions(...)`
- [ ] Apply permissions to payroll APIs
- [ ] Apply permissions to employee APIs
- [ ] Apply permissions to hiring APIs
- [ ] Apply permissions to documents APIs
- [ ] Apply permissions to audit APIs
- [ ] Add custom role data model later if needed
- [ ] Update docs with role-to-permission matrix

## Phase 5: Security events and notifications

Goal: make authentication activity visible and auditable.

- [ ] Add normalized `SecurityEvent` model or expand audit usage
- [ ] Record login success
- [ ] Record login failure
- [ ] Record account lockout
- [ ] Record password change
- [ ] Record password reset request
- [ ] Record password reset completion
- [ ] Record MFA challenge success/failure
- [ ] Record MFA recovery-code use
- [ ] Record session revoke
- [ ] Record refresh-token reuse
- [ ] Record SSO login success/failure
- [ ] Notify user on password change
- [ ] Notify user on MFA changes
- [ ] Notify user on new device/session
- [ ] Notify admins on suspicious auth activity
- [ ] Add admin security-events view
- [ ] Document security event taxonomy

## Phase 6: Generic OIDC SSO

Goal: support Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak and
other modern identity providers without hardcoding one vendor.

- [ ] Add `TenantIdentityProvider` table
- [ ] Support provider type `OIDC`
- [ ] Store issuer URL
- [ ] Store client ID
- [ ] Store encrypted client secret
- [ ] Store allowed email domains
- [ ] Store active/inactive state
- [ ] Add role mapping config
- [ ] Add just-in-time provisioning setting
- [ ] Add OIDC discovery document loading
- [ ] Add OIDC authorization redirect endpoint
- [ ] Add OIDC callback endpoint
- [ ] Verify ID token signature
- [ ] Verify issuer
- [ ] Verify audience/client ID
- [ ] Verify email verification status
- [ ] Match user by tenant + email
- [ ] Optionally provision user if allowed
- [ ] Apply tenant MFA/session policies after SSO
- [ ] Audit SSO login events
- [ ] Add admin UI for OIDC configuration
- [ ] Add setup docs for Okta
- [ ] Add setup docs for Microsoft Entra ID
- [ ] Add setup docs for Google Workspace

## Phase 7: SAML SSO

Goal: support enterprise customers that require SAML.

- [ ] Add provider type `SAML`
- [ ] Store SAML entity ID
- [ ] Store SSO URL
- [ ] Store X.509 certificate
- [ ] Store attribute mapping
- [ ] Add SAML metadata endpoint
- [ ] Add SAML ACS callback endpoint
- [ ] Verify SAML response signature
- [ ] Verify audience/entity ID
- [ ] Verify recipient and destination
- [ ] Verify assertion expiry
- [ ] Match or provision user
- [ ] Apply tenant policies
- [ ] Audit SAML login events
- [ ] Add admin UI for SAML configuration
- [ ] Add setup docs for Okta SAML
- [ ] Add setup docs for Entra SAML

## Phase 8: SCIM provisioning

Goal: allow external identity providers to create, update and deactivate users
automatically.

- [ ] Add SCIM bearer token model
- [ ] Add encrypted SCIM token storage
- [ ] Add SCIM `/Users` endpoint
- [ ] Add SCIM list users endpoint
- [ ] Add SCIM create user endpoint
- [ ] Add SCIM update user endpoint
- [ ] Add SCIM deactivate user endpoint
- [ ] Map SCIM user to HRMS user and employee
- [ ] Respect tenant seat limits
- [ ] Audit SCIM changes
- [ ] Add admin token rotation UI
- [ ] Add setup docs for Okta SCIM
- [ ] Add setup docs for Entra SCIM

## Phase 9: Frontend work

Goal: make the auth system understandable and usable.

- [ ] Security page: active sessions
- [ ] Security page: revoke session
- [ ] Security page: revoke all sessions
- [ ] Security page: MFA recovery codes
- [ ] Settings page: tenant auth policy
- [ ] Settings page: SSO provider list
- [ ] Settings page: OIDC configuration
- [ ] Settings page: SAML configuration
- [ ] Admin page: force logout user
- [ ] Admin page: reset MFA
- [ ] Admin page: security event log
- [ ] Login page: company SSO option
- [ ] Login page: domain/workspace discovery
- [ ] Login page: clear MFA step

## Phase 10: Documentation

Goal: keep implementation and product understanding together.

- [ ] Keep `docs/modules/auth.md` updated
- [ ] Keep `docs/modules/authentication-tutorial.md` updated
- [ ] Keep this checklist updated
- [ ] Add Okta OIDC setup guide
- [ ] Add Microsoft Entra ID setup guide
- [ ] Add Google Workspace setup guide
- [ ] Add SAML setup guide
- [ ] Add SCIM setup guide
- [ ] Add admin runbook for MFA reset
- [ ] Add admin runbook for suspicious login review

## Recommended build order

Start with:

1. Sessions
2. MFA recovery codes and MFA policy
3. Tenant auth policy
4. Security events and notifications
5. Permissions
6. Generic OIDC SSO
7. SAML
8. SCIM

This order gives us real security improvements before the more complex
enterprise integrations.
