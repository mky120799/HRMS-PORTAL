# Authentication runbooks

Step-by-step procedures for workspace administrators. Both use **Audit Logs →
Security events** (`GET /audit?category=security`), which needs `audit.read`.

## Runbook 1: Resetting a user's MFA

Use this when someone has lost their authenticator **and** their recovery codes.
Resetting MFA lets the person sign in with their password alone until they enrol
again, so the main risk is resetting it for an impostor.

**Who can do it:** users with `security.manage` (`ADMIN`, `IT_ADMIN`). You cannot
reset your own MFA this way. HRMS asks you to confirm your identity first
(step-up).

1. **Verify the person out of band.** Do not act on an email or chat message
   alone; those are exactly what an attacker would send. Call them back on a
   number from the HR record, or confirm in person or on a video call with their
   manager.
2. **Check whether a recovery code is still an option.** If they have their codes,
   they can sign in with one and set up a new authenticator themselves; no reset
   needed.
3. **Look at recent security events** for the user. Filter by
   `MFA_CHALLENGE_FAILED`, `ACCOUNT_LOCKED` and `LOGIN_FAILED`. Many failures from
   an unfamiliar IP just before the request are a warning sign: treat it as
   suspicious (Runbook 2) before resetting anything.
4. **Reset:** Employees → the person → **Reset MFA**
   (`POST /auth/users/:id/reset-mfa`). This:
   - clears their authenticator secret and every recovery code,
   - signs out all their sessions immediately,
   - emails them a security notice, and
   - writes `ADMIN_MFA_RESET` to the audit log under your name.
5. **Have them enrol again right away.** If the workspace requires MFA, they are
   taken through enrolment on their next sign-in automatically. Otherwise ask
   them to open **Security → Two-factor authentication** and to save the new
   recovery codes.
6. **Record** the verification method you used (ticket or HR note). The audit log
   proves *what* happened; your note proves *why* it was legitimate.

## Runbook 2: Reviewing suspicious sign-in activity

**Triggers:** an "Account locked" or "Suspicious authentication activity" email or
in-app alert, a user reporting a sign-in they did not make, or red events in
Security events.

### What the events mean

| Event | What it usually means | Severity |
| --- | --- | --- |
| `LOGIN_FAILED` (a few) | Typos | Low |
| `LOGIN_FAILED` (many, several accounts, same IP) | Password spraying | High |
| `MFA_CHALLENGE_FAILED` | Someone has the password but not the second factor | **High** — the password is compromised |
| `ACCOUNT_LOCKED` | 5 failures in a row (password, MFA or step-up); 15-minute lock | Medium; High if `trigger` is an MFA failure |
| `REFRESH_TOKEN_REUSE` | An old session token was replayed; the session was revoked automatically | **High** — possible token theft from a device |
| `SSO_LOGIN_FAILED` | IdP rejected or misconfigured (look at `reason`) | Low for configuration errors; High for "different browser" or "already used" |
| `STEP_UP_FAILED` | Someone with a signed-in session failed to confirm their identity for a sensitive action | **High** if the user did not do it |
| `AUTH_POLICY_UPDATED`, `IDENTITY_PROVIDER_*`, `SCIM_TOKEN_ROTATED` | Security configuration changed | Check it was planned |
| `ROLE_SYNCED_FROM_IDP`, `SSO_USER_PROVISIONED` | IdP changed a role or created a user | Check against IdP group changes |

### Procedure

1. **Scope it.** In Security events, filter by the alerting event, then look at
   the same user and IP over the previous 24 hours. Note the IP addresses and
   user agents (hover the IP to see the user agent).
2. **Ask the user** (out of band) whether the activity was theirs. A new laptop
   or travel explains a lot of "new session" notices.
3. **If it was not them, contain it:**
   1. Employees → the person → **Force logout**
      (`POST /auth/users/:id/revoke-sessions`). This takes effect within seconds.
   2. Have the user reset their password (this also signs out every session and
      invalidates outstanding reset and invite links).
   3. If `MFA_CHALLENGE_FAILED` or `STEP_UP_FAILED` appeared, assume the password
      was known to the attacker. Make sure MFA is on, and consider requiring it
      for everyone (Settings → Authentication policy).
   4. For `REFRESH_TOKEN_REUSE`, ask the user to check that device for malware or
      browser extensions.
   5. If the IP is clearly hostile and your workspace only works from known
      networks, add an IP allow-list (Settings → General). Be careful: it applies
      to everyone.
4. **Check for changes the attacker may have made.** Switch Audit Logs to
   **All activity**, filter by the user, and look for role changes, salary or bank
   changes, document downloads, data exports and invitations in the same window.
5. **For SSO users,** do the same in your identity provider (Okta/Entra sign-in
   logs). Disabling the user there and letting SCIM deactivate them in HRMS
   revokes their HRMS sessions as well.
6. **Write it up:** what happened, accounts affected, data touched, and actions
   taken. If personal data may have been accessed, involve whoever owns your
   data-protection obligations. Breach notification deadlines can be short
   (72 hours under GDPR).

### Things that are *not* incidents

- One `REFRESH_TOKEN_REUSE` right after a laptop wakes from sleep with many tabs
  open was possible in older web-app versions. Current versions serialize refresh
  across tabs, so treat new occurrences as real.
- `SSO_LOGIN_FAILED` with reason "SSO session not found in this browser" usually
  means the user opened the sign-in link in a different browser or profile.
