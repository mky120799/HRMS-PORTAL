# Authentication tutorial for HRMS

This document explains authentication in plain language. It is written for
implementation planning, not for security experts only.

## 1. What authentication means

Authentication answers one question:

> Who is this person?

Authorization answers a different question:

> What is this person allowed to do?

Example:

- Authentication: "This is Asha from Acme."
- Authorization: "Asha is a payroll admin, so she can finalize payroll."

In an HRMS, authentication is extremely important because the system stores
salary, documents, employee records, leave, attendance and hiring data.

## 2. The simple login flow

The most basic login flow is:

```text
User enters email + password
        |
        v
Server checks password
        |
        v
Server creates a session
        |
        v
User can call protected APIs
```

In our product the user also enters/selects a workspace, because the same email
can exist in more than one company workspace.

```text
Workspace + email + password
```

That means `alex@example.com` in `acme` and `alex@example.com` in `globex` are
different accounts.

## 3. Passwords

The server must never store the real password.

Instead it stores a password hash.

```text
password:        MySecret123
stored in DB:    bcrypt hash
```

When the user logs in:

```text
User enters password
        |
        v
Server hashes/checks it
        |
        v
If it matches, login succeeds
```

If the database is leaked, attackers should not immediately see real passwords.

## 4. Tokens and sessions

After login, the server gives the frontend tokens.

Think of a token like a temporary ID card.

Our app currently uses:

- access token
- refresh token
- special-purpose tokens for invite, reset password, 2FA and SSO exchange

### Access token

Short-lived token used on normal API calls.

```text
GET /employees
Authorization: Bearer <access token>
```

Current lifetime: 15 minutes.

Why short? If stolen, it expires quickly.

### Refresh token

Longer-lived token used to get a new access token.

```text
POST /auth/refresh
```

Current lifetime: 7 days.

The refresh token is more sensitive than the access token because it can create
new sessions.

Where each token lives in the browser matters:

- the **access token** (15 minutes) is kept by the web app and sent as
  `Authorization: Bearer ...`;
- the **refresh token** is set by the API as an `httpOnly`, `SameSite=Strict`
  cookie limited to `/api/v1/auth`. JavaScript on the page cannot read it, so even
  an XSS bug cannot steal a long-lived credential.

Browser tabs share that cookie, so the web app takes a cross-tab lock before
refreshing. Otherwise two tabs could present the same refresh token at once and
the server would (correctly) treat the second one as theft.

Enterprise systems also add two session limits:

- **Absolute lifetime:** a session cannot live beyond a fixed maximum age.
- **Idle timeout:** a session ends if it has not been used for a configured
  number of minutes.

In this portal, each refresh checks both limits. Refreshing rotates the token,
but it does not extend a session beyond the absolute lifetime.

## 5. Refresh token rotation

Refresh rotation means:

```text
User refreshes token
        |
        v
Old refresh token becomes invalid
        |
        v
New refresh token is issued
```

Why this matters:

If an attacker steals an old refresh token and tries to use it later, the server
can detect reuse and revoke the session.

Current app behavior:

- only the current refresh token hash is stored;
- old refresh tokens are rejected;
- replaying an old refresh token logs a security event.

## 6. Why token purpose matters

A reset-password token should not work as an access token.

An invite token should not work as a refresh token.

So every token has a purpose.

Examples:

```text
access       -> call APIs
refresh      -> get new access token
reset        -> reset password
invite       -> accept invite
two_factor   -> temporary second-step login
sso_state    -> protect SSO redirect state
```

This prevents a dangerous bug where one token type is accepted in the wrong
place.

## 7. Multi-factor authentication

Multi-factor authentication means the user must prove more than one thing.

Usually:

```text
Something you know: password
Something you have: phone/authenticator app
```

Google Authenticator and Microsoft Authenticator are not login providers. They
are apps that generate 6-digit codes.

This type of MFA is called TOTP.

You can think of it like this:

```text
HRMS and the authenticator app share a secret
        |
        v
Both calculate the current 6-digit code
        |
        v
If the codes match, MFA succeeds
```

Important:

- Google Authenticator does not tell us who the user is.
- It only proves the user has the authenticator device.
- Our HRMS still handles the login.

## 8. Backup codes

Backup codes are one-time recovery codes for MFA.

They help when a user loses their phone.

Example:

```text
User enables MFA
        |
        v
Server shows 10 backup codes
        |
        v
User stores them safely
        |
        v
If phone is lost, one backup code can complete login
```

Each backup code should be usable only once.

## 9. SSO

SSO means single sign-on.

Instead of every app managing passwords, the company uses one central identity
provider.

Examples:

- Okta
- Microsoft Entra ID
- Google Workspace
- OneLogin
- Ping Identity
- Auth0
- Keycloak

SSO flow:

```text
User opens HRMS
        |
        v
HRMS redirects user to company identity provider
        |
        v
Identity provider authenticates user
        |
        v
Identity provider redirects user back to HRMS
        |
        v
HRMS creates its own local session
```

So Okta or Entra does not replace our HRMS user table. We still need local users,
roles, permissions, audit logs and sessions.

The identity provider only proves:

> This person successfully logged in with the company.

## 10. Okta, Entra and Google Workspace

Okta and Microsoft Entra ID are company identity providers.

Google Workspace can also be used as a company identity provider.

For our HRMS, they should all plug into the same generic SSO system.

Bad design:

```text
Build only "Okta login"
```

Better design:

```text
Build generic enterprise SSO
        |
        +-- Okta
        +-- Microsoft Entra ID
        +-- Google Workspace
        +-- OneLogin
        +-- Custom OIDC provider
```

## 11. OIDC

OIDC means OpenID Connect.

Plain English:

> OIDC is a modern standard way for one app to ask another trusted login system
> who the user is.

OIDC is commonly used by:

- Okta
- Microsoft Entra ID
- Google Workspace
- Auth0
- Keycloak

OIDC flow:

```text
User enters workspace
        |
        v
HRMS shows configured SSO providers
        |
        v
HRMS sends user to provider
        |
        v
Provider logs user in
        |
        v
Provider sends back a code
        |
        v
HRMS exchanges code for identity tokens
        |
        v
HRMS verifies token signature and user email
        |
        v
HRMS creates session
```

In this portal, generic OIDC is implemented for existing users. The tenant
stores an issuer URL, client ID, encrypted client secret and allowed email
domains. During callback, HRMS verifies the provider's ID token before it creates
its own short-lived SSO exchange code and normal HRMS session.

Just-in-time (JIT) provisioning can create a missing user on first SSO sign-in,
but only when the provider is limited to the company's own email domains —
otherwise any account at a shared issuer such as Google could join the workspace.

IdP groups can also set the HRMS role through the provider's role mapping
(`HR Team = HR_ADMIN`). The mapping is applied at every sign-in. It can never
grant `ADMIN`, and existing admins are never changed by it.

The built-in "Sign in with Google" button uses this same OIDC code path (Google
is a standard OIDC issuer), so Google sign-ins get the same signature, nonce and
email-verification checks.

Two extra protections apply to every SSO flow:

- **Browser binding.** Starting SSO sets a random `httpOnly` nonce cookie whose
  hash is inside the signed `state`. The callback only succeeds in the browser
  that started the flow, which blocks "login CSRF" (an attacker tricking you into
  signing in as them).
- **One-time exchange code.** After SSO the browser receives a 60-second code,
  never tokens in the URL. Each code's ID is recorded, so it works exactly once.

## 12. SAML

SAML is an older enterprise SSO standard.

Many large companies still require it.

Plain English:

> SAML is an XML-based way for a company identity provider to tell HRMS that a
> user has logged in.

SAML is common in enterprise HR software, but it is more complex than OIDC.

In this portal, SAML is implemented for tenant-configured identity providers.
HRMS exposes metadata, receives the ACS callback, validates the signed SAML
response/assertion, extracts the user's email, then creates the normal HRMS
session. Like OIDC, JIT provisioning only happens when the provider explicitly
allows it.

The SAML library checks the signature, issuer, audience and expiry. HRMS adds the
checks the library leaves to the application:

- the response's `Destination` and the assertion's `Recipient` must be this
  HRMS callback URL, so an assertion issued for another application cannot be
  replayed here;
- each assertion ID is recorded and accepted only once (replay protection that
  works across several API servers);
- which SAML attributes hold email, name and groups is configurable per
  provider (attribute mapping), with sensible defaults for Okta and Entra.

## 13. SCIM

SCIM is not login.

SCIM is user provisioning.

Plain English:

> SCIM lets the company identity provider automatically create, update and
> deactivate users in HRMS.

Example:

```text
Employee joins company
        |
        v
IT adds employee in Okta/Entra
        |
        v
SCIM creates user in HRMS
```

When employee leaves:

```text
IT disables employee in Okta/Entra
        |
        v
SCIM disables user in HRMS
```

SCIM is very useful, but it should come after the core auth system is stable.

In this portal, SCIM is now implemented for basic user provisioning:

- admin rotates a SCIM bearer token in identity-provider settings;
- Okta/Entra calls `/scim/v2/Users`;
- HRMS creates or updates both the `User` and `Employee` records;
- deactivation disables the login and revokes sessions;
- SCIM-created users do not receive a password by default.

## 14. Sessions

A session represents a logged-in device/browser.

Examples:

- Chrome on laptop
- Safari on phone
- Firefox on office desktop

Enterprise design supports multiple sessions:

```text
User
  - laptop session
  - phone session
  - tablet session
```

This portal now stores refresh tokens in a `UserSession` table. Each browser or
device gets its own row, and only a hash of the refresh token is stored.

Then users can revoke sessions:

```text
Revoke this device
Revoke another device
Revoke all other devices
```

If a rotated refresh token is reused, the system treats that as suspicious and
revokes that session.

Revoking a session works almost instantly, not after the access token's 15
minutes. Every access token carries its session id, and the API checks that the
session is still active (cached for 30 seconds per server, cleared immediately on
the server that did the revocation). Logout, "revoke device", admin force-logout,
password change, offboarding and SCIM deactivation all use this.

## 14.1 Recovery codes

Authenticator apps are strong, but people lose phones. Production MFA needs a
recovery path that is safer than asking support to disable MFA casually.

When MFA is enabled, this portal generates one-time recovery codes:

```text
AB12C-DE34F
...
```

The user must save them. The server stores only bcrypt hashes, not the original
codes. When a recovery code is used during login, it is marked consumed and
cannot be used again — the "mark consumed" step is a conditional update, so two
simultaneous requests cannot both use the same code.

Wrong MFA codes count towards the same account lockout as wrong passwords
(5 failures → 15 minutes), and typing the correct password again does not reset
the counter. Without that, someone who knows the password could keep guessing
6-digit codes.

## 14.2 Tenant auth policy

Each workspace can configure security policy:

- allow or disable password login
- allow or disable Google login
- require MFA for admins
- require MFA for everyone
- increase minimum password length
- prevent reuse of recent passwords
- expire passwords after a configured number of days
- end inactive sessions with an idle timeout
- shorten the maximum refresh-session lifetime

The system refuses to enable MFA-required policies until the affected users have
already enrolled, so admins do not accidentally lock out the company.

People who join later (invited, created by SCIM, or provisioned by SSO) are not
locked out either: after a correct password or SSO sign-in they receive a
short-lived *enrolment-only* token, scan a QR code, confirm a code, receive their
recovery codes and are then signed in. While a policy requires MFA, users cannot
turn it off themselves.

## 14.3 Step-up authentication

Some actions are too dangerous to allow on a stolen access token alone. For
these, HRMS asks the user to prove it is really them again ("step-up"):

- changing someone's role
- changing salaries and finalising payroll
- changing the authentication policy
- adding or changing SSO/SCIM identity providers or rotating the SCIM token
- resetting another user's MFA
- erasing an employee's personal data

The user enters an authenticator or recovery code (or their password if they do
not use MFA). The API returns a 5-minute step-up token bound to that user and
that session; the web app sends it as `x-step-up-token` and retries the action.
A step-up token from a different session is rejected.

## 15. RBAC and permissions

RBAC means role-based access control.

Example roles:

- SUPER_ADMIN
- ADMIN
- HR_ADMIN
- HR_MANAGER
- PAYROLL_ADMIN
- RECRUITER
- HIRING_MANAGER
- INTERVIEWER
- MANAGER
- EMPLOYEE
- AUDITOR
- FINANCE
- IT_ADMIN

Permissions are more specific.

Example:

```text
payroll.finalize
employees.read_full
employees.manage
hiring.pipeline.manage
documents.manage
audit.read
```

Simple apps check only roles:

```text
Only ADMIN can access payroll
```

Production HR systems should move toward permissions:

```text
User can finalize payroll if they have payroll.finalize
```

This gives more control and prepares us for custom roles later.

In this portal, the backend permission map lives in
`apps/server/src/common/auth/permissions.ts`, and the frontend uses a matching
map in `apps/web/src/lib/auth.ts` so menus and buttons follow the same model as
the API.

## 16. Tenant auth policies

Each company should be able to define security rules.

Examples:

- Require MFA for all users
- Require MFA for admins only
- Allow password login
- Allow Google login
- Allow enterprise SSO
- Session idle timeout
- Maximum session lifetime
- Password minimum length
- Password history count
- Password expiry days

This is how HRMS becomes enterprise-ready.

## 17. Security events

Authentication should create audit/security events.

Examples:

- Login success
- Login failed
- Account locked
- Password changed
- Password reset requested
- Password reset completed
- MFA enabled
- MFA disabled
- MFA challenge failed
- Session revoked
- Role changed
- SSO login completed
- Suspicious login detected

In this portal they are written to the audit log and shown under
**Audit Logs → Security events**, with the risky ones (lockouts, refresh-token
reuse, SSO failures, failed MFA/step-up) highlighted. Lockouts and token reuse
also notify the user and the workspace admins. The review procedure is in
`docs/modules/auth-runbooks.md`.

## 18. Recommended architecture for our HRMS

Our final auth model should look like this:

```text
Normal users
  -> password login
  -> optional/required MFA
  -> HRMS session

Small companies
  -> Google login
  -> optional/required MFA
  -> HRMS session

Enterprise companies
  -> Okta / Entra / Google Workspace via OIDC
  -> HRMS session
  -> local roles and permissions

Large enterprise later
  -> SAML SSO
  -> SCIM provisioning
```

## 19. What we should build first

Best practical order:

1. Strong session model with multiple sessions.
2. Refresh-token rotation per session.
3. MFA backup codes.
4. Tenant auth policies.
5. Permission-based access checks.
6. Auth security events and notifications.
7. Generic OIDC SSO.
8. SAML later.
9. SCIM later.

This order gives us real production security before adding complex enterprise
integrations.

## 20. Mental model

Keep this simple mental model:

```text
Password login = HRMS checks the password

Authenticator app = HRMS checks a 6-digit second-factor code

Okta / Entra / Google Workspace = another trusted system checks the login

OIDC / SAML = protocols used by that trusted system to talk to HRMS

SCIM = automatic user create/update/disable, not login

Session = one logged-in device/browser

Role = broad job in the system

Permission = specific action the user can perform
```

If we keep these concepts separate, the implementation becomes much less
confusing.
