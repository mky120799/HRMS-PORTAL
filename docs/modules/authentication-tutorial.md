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

We should build OIDC before SAML because it is easier and cleaner for modern
apps.

## 12. SAML

SAML is an older enterprise SSO standard.

Many large companies still require it.

Plain English:

> SAML is an XML-based way for a company identity provider to tell HRMS that a
> user has logged in.

SAML is common in enterprise HR software, but it is more complex than OIDC.

Recommended order:

1. Build OIDC first.
2. Add SAML later when needed by enterprise customers.

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

## 14. Sessions

A session represents a logged-in device/browser.

Examples:

- Chrome on laptop
- Safari on phone
- Firefox on office desktop

Current app design has one active refresh token per user.

Enterprise design should support multiple sessions:

```text
User
  - laptop session
  - phone session
  - tablet session
```

Then users and admins can revoke sessions:

```text
Revoke this device
Revoke all devices
Admin force logout
```

## 15. RBAC and permissions

RBAC means role-based access control.

Example roles:

- ADMIN
- HR_MANAGER
- PAYROLL_ADMIN
- RECRUITER
- MANAGER
- EMPLOYEE

Permissions are more specific.

Example:

```text
payroll.finalize
employees.read
employees.update
hiring.manage
documents.read_private
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

These events are useful for admins and for future alerts.

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
