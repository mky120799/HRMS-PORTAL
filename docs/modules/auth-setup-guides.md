# Enterprise authentication setup guides

These guides are for tenant admins configuring external identity providers.
Only workspace `ADMIN`s can change identity providers (`identity_providers.manage`),
and every change asks them to confirm their identity (step-up).

## Shared HRMS values

Use these values in the provider admin console:

- OIDC redirect URI: `https://<api-host>/api/v1/auth/oidc/callback`
- Login start in HRMS: Settings → Enterprise SSO providers
- SCIM base URL: `https://<api-host>/api/v1/scim/v2`
- SCIM auth: Bearer token generated from the provider card in HRMS Settings

In local development:

- OIDC redirect URI: `http://localhost:3000/api/v1/auth/oidc/callback`
- SCIM base URL: `http://localhost:3000/api/v1/scim/v2`

## Okta OIDC

1. In Okta, create an **OIDC Web Application**.
2. Add the HRMS OIDC redirect URI.
3. Copy Okta's issuer URL. It usually looks like:
   `https://your-domain.okta.com/oauth2/default`.
4. Copy the client ID and client secret.
5. In HRMS Settings → Enterprise SSO providers:
   - Type: `OIDC`
   - Name: `Okta`
   - Issuer URL: Okta issuer URL
   - Client ID: Okta client ID
   - Client secret: Okta client secret
   - Allowed email domains: your company domains
   - Enable JIT only if you want first SSO login to create HRMS users
     (JIT requires at least one allowed domain)
   - Optional role mapping, e.g. `HR Team = HR_ADMIN` (see below); add a
     `groups` claim to the Okta ID token if you use it
6. Save, then test from the HRMS login page.

## Microsoft Entra ID OIDC

1. In Microsoft Entra admin center, create an **App registration**.
2. Add a Web redirect URI using the HRMS OIDC callback URL.
3. Create a client secret.
4. Use the issuer URL:
   `https://login.microsoftonline.com/<tenant-id>/v2.0`.
5. In HRMS Settings → Enterprise SSO providers:
   - Type: `OIDC`
   - Name: `Microsoft Entra ID`
   - Issuer URL: Entra issuer URL
   - Client ID: application/client ID
   - Client secret: generated secret value
   - Allowed email domains: your company domains
6. Save, then test from the HRMS login page.

## Google Workspace OIDC

1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. Add the HRMS OIDC callback URL as an authorized redirect URI.
3. Use Google's issuer URL: `https://accounts.google.com`.
4. In HRMS Settings → Enterprise SSO providers:
   - Type: `OIDC`
   - Name: `Google Workspace`
   - Issuer URL: `https://accounts.google.com`
   - Client ID: Google OAuth client ID
   - Client secret: Google OAuth client secret
   - Allowed email domains: your Workspace domains
5. Save, then test from the HRMS login page.

## Built-in "Sign in with Google" (platform level)

This is the Google button on the login page for workspaces that do not run their
own IdP. It is configured once for the whole deployment by the operator, not per
tenant, and only signs in people who already have an account in the workspace
(no auto-provisioning). Tenants can switch it off in Settings → Authentication policy.

1. In Google Cloud Console create an OAuth client of type **Web application**.
2. Authorized redirect URI: `https://<api-host>/api/v1/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL` in the
   API environment. The button is hidden while these are not set.

HRMS runs Google sign-in through its standard OIDC verifier (signature, issuer,
audience, nonce, `email_verified`).

## Role mapping (OIDC and SAML)

Each provider can map IdP groups to HRMS roles, one per line in Settings:

```text
HR Team = HR_ADMIN
Payroll = PAYROLL_ADMIN
People Managers = MANAGER
Everyone = EMPLOYEE
```

- Lines are checked top to bottom; the first group the user belongs to wins.
  Group names are matched without regard to case.
- Applied when a user is created by JIT and at every later SSO sign-in; when the
  role changes, the user's other sessions are signed out.
- `ADMIN` cannot be granted by an IdP, and users who are `ADMIN` in HRMS are never
  changed by the mapping. Administrators are managed inside HRMS only.
- Group sources: OIDC `groups` or `roles` claims; SAML `groups`, `memberOf`,
  `roles` or the Entra groups/role claim (or the attribute named in the mapping).
- Users who match no line keep their current role (new JIT users get `EMPLOYEE`).

## Okta SCIM

1. Create or open the Okta app used for HRMS.
2. Enable **SCIM provisioning**.
3. Set the SCIM base URL to the HRMS SCIM base URL.
4. In HRMS Settings, click **Rotate SCIM token** for the provider.
5. Copy the token immediately and paste it into Okta as the bearer token.
6. Enable create, update and deactivate users.
7. Test with one user before assigning a large group.

HRMS behavior:

- Create user → creates both `User` and `Employee` (role `EMPLOYEE`; SCIM never
  sets roles).
- Update user → updates email/name/department/title.
- Deactivate user (PATCH `active: false` or DELETE) → disables login and revokes
  sessions immediately.
- Accepts `application/scim+json`, returns raw SCIM JSON and RFC 7644 error bodies.

## Microsoft Entra ID SCIM

1. In Enterprise applications, open the HRMS application.
2. Go to Provisioning.
3. Set provisioning mode to **Automatic**.
4. Tenant URL: HRMS SCIM base URL.
5. Secret Token: token generated from HRMS Settings.
6. Test connection.
7. Map fields:
   - `userName` → work email
   - `name.givenName` → first name
   - `name.familyName` → last name
   - `title` → designation
   - `department` → department
   - `active` → account enabled/disabled
8. Start with a small assigned group before broad rollout.

## Okta SAML

1. In HRMS Settings, create a provider:
   - Type: `SAML`
   - Name: `Okta SAML`
   - SAML entity ID: Okta issuer/entity ID
   - SAML SSO URL: Okta SSO URL
   - X.509 certificate: Okta signing certificate
   - Allowed email domains: your company domains
2. Save the provider.
3. Copy the HRMS metadata URL from the provider card.
4. In Okta, create a SAML 2.0 app and import or paste the HRMS metadata.
5. Configure the name ID / email claim to send the user's work email.
6. Assign one test user first.
7. Test from the HRMS login page.

## Microsoft Entra ID SAML

1. In HRMS Settings, create a provider:
   - Type: `SAML`
   - Name: `Entra SAML`
   - SAML entity ID: Microsoft Entra Identifier
   - SAML SSO URL: Login URL
   - X.509 certificate: Base64 signing certificate
   - Allowed email domains: your company domains
2. Save the provider.
3. Copy the HRMS metadata URL from the provider card.
4. In Entra Enterprise applications, create or open the HRMS SAML app.
5. Set:
   - Identifier / Entity ID: HRMS metadata entity ID
   - Reply URL / ACS URL: HRMS SAML callback URL from metadata
6. Send email as NameID or as an email attribute.
7. Optional: add a group claim and configure role mapping.
8. Assign one test user first.
9. Test from the HRMS login page.

## SAML attribute mapping

By default HRMS reads:

| Field | Attributes tried |
| --- | --- |
| Email | `email`, `mail`, `urn:oid:0.9.2342.19200300.100.1.3`, the Entra/ADFS email claim, then NameID |
| First / last name | `firstName`/`givenName`, `lastName`/`surname`/`sn` (and their OID/claim forms) |
| Display name | `displayName`, `cn`, `name` |
| Groups | `groups`, `memberOf`, `roles`, Entra groups/role claims |

If your IdP uses other names, enter them in the provider's attribute mapping.
A configured attribute is used exclusively for that field (no fallback), so a
mapping mistake fails the sign-in instead of matching the wrong account.

## SAML production note

`@node-saml/node-saml` validates the signed assertion, issuer, audience and
expiry. HRMS additionally checks that `Response/@Destination` (when present) and
the bearer `SubjectConfirmationData/@Recipient` equal this provider's ACS URL,
and records every assertion ID in the database so each assertion is accepted
exactly once — this works across multiple API instances. The RelayState is bound
to the browser that started the sign-in (`hrms_sso` cookie). `InResponseTo`
checking is not enabled; replay and CSRF are covered by the two mechanisms above.

The ACS callback is a cross-site POST, so the `hrms_sso` cookie is
`SameSite=None; Secure`: the API must be served over HTTPS (browsers treat
`http://localhost` as secure for local testing).
