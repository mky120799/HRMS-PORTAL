# Auth module

`apps/server/src/modules/auth` · `apps/server/src/common/auth` · `common/strategies/jwt.strategy.ts`

## Purpose
Sign-up, sign-in, sessions, invitations, password reset, two-factor authentication and
Google SSO for a multi-tenant product where the same email can exist in several workspaces.

## Key concepts
* **Workspace identifier.** Users sign in with *workspace + email + password*. The workspace
  is the tenant's slug (e.g. `acme-corp-1a2b3c`) or id. The last one used is remembered by the
  browser.
* **Token purposes.** `TokenService.sign(purpose, payload)` — each purpose has its own derived
  signing key (`HMAC(JWT_SECRET, "hrms:jwt:<purpose>")`), lifetime and a `typ` claim.

  | Purpose | Lifetime | Used for | Stateful check |
  | --- | --- | --- | --- |
  | `access` | 15 min | `Authorization: Bearer` on every API call | none (stateless) |
  | `refresh` | 7 days | `POST /auth/refresh` | stored SHA-256 hash + `tokenVersion` |
  | `two_factor` | 5 min | second login step | `tokenVersion` |
  | `invite` | 7 days | accept-invite link | `tokenVersion` (single use) |
  | `reset` | 1 hour | reset-password link | `tokenVersion` (single use) |
  | `sso_state` | 10 min | OAuth `state` carrying the workspace | signature |
  | `sso_exchange` | 60 s | one-time code after Google sign-in | `tokenVersion` |

* **`tokenVersion`** on `User` is the revocation lever. Incremented on password set/reset/change,
  offboarding, role change and erasure.

## Endpoints

| Method & path | Access | Notes |
| --- | --- | --- |
| `POST /auth/signup` | public, 5/min/IP | Creates tenant (30-day trial) + default leave policies + admin user + employee **in one transaction** |
| `POST /auth/login` | public, 10/min/IP | Returns tokens or `{ twoFactorRequired, tempToken }` |
| `POST /auth/2fa/authenticate` | public, 10/min/IP | Completes a 2FA login |
| `POST /auth/refresh` | public, 30/min/IP | Rotates the refresh token |
| `POST /auth/logout` | user | Deletes the stored refresh token |
| `GET /auth/me` | user | Profile + employee + tenant |
| `POST /auth/change-password` | user | Signs out other devices, returns a fresh session |
| `POST /auth/invite` | ADMIN, seat limit | Creates the login; links to an employee with the same email or creates one |
| `POST /auth/accept-invite` | public | Sets password; link becomes invalid |
| `POST /auth/reset-password-request` | public, 5/min/IP | Same response whether or not the account exists |
| `POST /auth/reset-password` | public | Sets password; signs out all sessions |
| `POST /auth/2fa/generate` · `turn-on` · `turn-off` | user | TOTP enrolment (QR code) and disable (requires a valid code) |
| `GET /auth/google?tenant=<slug>` | public | Starts Google OAuth |
| `GET /auth/google/callback` | public | Redirects to `/auth/callback?code=…` (never tokens in URLs) |
| `POST /auth/sso/exchange` | public | Exchanges the one-time code for a session (or a 2FA step) |

## Rules & safeguards
* **Password policy:** ≥ 10 chars, a letter and a digit (NIST 800-63B favours length). bcrypt cost 12.
* **Account lockout:** 5 consecutive failures → locked 15 min (audited as `ACCOUNT_LOCKED`).
* **No user enumeration:** unknown users are compared against a dummy bcrypt hash so timing
  matches; reset requests always return the same message; "deactivated"/"suspended" is only
  revealed after a correct password.
* **Refresh rotation + reuse detection:** only `sha256(refreshToken)` is stored.
  *Why not bcrypt?* bcrypt silently truncates input at 72 bytes; every JWT from this issuer
  shares its first ~72 bytes (header + `sub`), so bcrypt would accept any old token — this was
  a real bug in the original code. High-entropy tokens only need a fast hash. Replaying a
  rotated token revokes the session and logs `REFRESH_TOKEN_REUSE`.
* **2FA secrets** are encrypted at rest (AES-256-GCM, `CryptoService`).
* **Google SSO** only signs in *existing, active* users of the workspace named in the signed
  `state`, using Google's *verified* email. It never auto-provisions (the original code put any
  Google user into the first tenant in the database). If 2FA is on, SSO still requires the code.
* **Invite** respects the plan's seat limit (`EmployeeLimitGuard`).

## Failure modes & edge cases
* Same email in two workspaces → allowed; the workspace field disambiguates.
* Invite for an email already linked to a user → 409.
* Changing role or offboarding someone revokes their refresh token immediately; their current
  access token expires within 15 minutes (documented trade-off of stateless access tokens).
* Clock skew: JWT expiry uses server time only.

## Tests
`test/security.e2e-spec.ts` — token confusion (4 purposes), missing-tenant token, removed
`/auth/register`, single-use invites, refresh rotation + reuse revocation, lockout, reset
non-enumeration. `common/auth/token.service.spec.ts` — purpose isolation and strategy
fail-closed cases.

## Interview talking points
* "Why separate keys *and* a `typ` claim?" — defence in depth; either alone prevents token
  confusion, together a single mistake can't reintroduce it.
* "How do you log someone out everywhere?" — `tokenVersion` bump; stateless access tokens
  bound the window to 15 minutes; could add a Redis deny-list if instant revocation is needed.
* "Why tokens in localStorage?" — simpler for a SPA calling an API on another origin in dev;
  mitigated by short access tokens, rotation, and a strict CSP with no third-party scripts.
  Next step is an httpOnly, SameSite=strict refresh cookie.
