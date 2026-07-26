# Senior-friendly guest access

**Status:** Approved direction; implementation requires a separate reviewed plan.

## Outcome

A guest proves their identity once on a browser and then returns directly to Sangam without repeatedly
entering an email address or OTP. The browser remains trusted until seven days after the guest's latest
accessible wedding ends, unless the guest signs out or an organizer revokes access earlier.

The pilot offers three entry paths:

1. an existing email magic link or code;
2. **Continue with Telegram**, matched to a verified phone already stored on the invitation; and
3. a short-lived organizer-assisted activation code or QR for guests who cannot use either.

No SMS or WhatsApp delivery provider is required. Sangam does not fingerprint hardware. A rotating,
secure Supabase browser session is the trusted-device credential.

## Non-negotiable security rules

- A display name, Telegram username, typed phone number, URL parameter, or browser fingerprint never
  decides which guest is bound.
- Telegram binding uses only a server-validated OIDC identity with `phone_number_verified=true`, and the
  normalized phone must uniquely match an unshared, guest-specific contact already on file.
- A missing, declined, duplicated, or mismatched Telegram phone fails closed without binding anyone.
- Organizer-assisted activation is possession-based identity proof. It is therefore short-lived,
  single-use, auditable, POST-only, and issued by an authorized operator after an out-of-band human check.
- Authentication and guest authorization remain separate. A valid Supabase user is not a wedding guest
  until the database binding succeeds.
- Existing RLS remains authoritative. Service-role code is limited to named binding/revocation commands.
- No guest PII is disclosed before successful authentication and binding.

## Current defect to correct first

The application currently sends an email OTP correctly, establishes Supabase cookies, and calls
`getUser()` from middleware to refresh them. It nevertheless has two observable gaps:

1. `/login` never checks for an existing valid session and never redirects an already-signed-in visitor.
2. Production has not been certified for persistent cookie survival across callback, middleware refresh,
   browser restart, reverse proxy, and the deployed domain.

The first delivery is therefore a session-reliability slice, not a new identity provider. Supabase access
tokens remain short-lived and refresh silently. The refresh-token cookie is persistent; the Auth server,
not a browser cookie timestamp, controls session validity.

### Session-reliability behavior

- Visiting `/login` with a valid bound session redirects to the correct first destination.
- Visiting any wedding link with a valid session requires no email or OTP.
- Closing and reopening Safari, Chrome, or an in-app browser does not sign the guest out when the browser
  preserves site data.
- Incognito/private browsing, cleared site data, explicit sign-out, revoked membership, or an expired
  trusted period legitimately requires verification again.
- A diagnostic reason code distinguishes `no_cookie`, `refresh_failed`, `unbound_identity`,
  `membership_revoked`, and `wedding_access_expired`; the UI shows plain-language recovery copy and logs
  no token or contact value.

## Identity and account model

`app.account.auth_user_id` currently assumes one Supabase Auth user per Sangam account. Email and Telegram
can create different Auth users for the same person, so this assumption must not be stretched silently.

Add `app.account_identity`:

| Column | Meaning |
| --- | --- |
| `id` | UUID primary key |
| `account_id` | Sangam account |
| `auth_user_id` | Unique Supabase Auth user; belongs to exactly one Sangam account |
| `provider` | `email`, `telegram`, or `assisted` |
| `provider_subject_hash` | Hash of stable provider subject; never a display name |
| `verified_contact_hash` | Hash of normalized email/E.164 phone used for binding |
| `verified_at` | When provider assurance was accepted |
| `revoked_at` | Identity-level revocation |
| `created_by_account_id` | Set only for organizer-assisted activation |

Enforce `unique(auth_user_id)` and `unique(provider, provider_subject_hash)`. Provider subjects and
verified contacts are derived by service-only code; no value from `auth.users.raw_user_meta_data` or a
browser request is authoritative because user metadata can be edited by the user.

Migration compatibility:

- Backfill every non-null `app.account.auth_user_id` into `account_identity(provider='email')`.
- Change `app.current_account_id()` to resolve through one active `account_identity` row, with a temporary
  compatibility fallback to `account.auth_user_id` during rollout.
- Do not remove the old column in this slice. Reserve that cleanup for a later migration after production
  observation.
- Binding a second Auth identity to an existing account is permitted only after a unique authoritative
  guest-contact match or an authorized assisted activation. Conflicts raise and are audited.
- `link_signed_in_account` and every new binding function must refuse to reactivate a membership whose
  wedding access period has ended or which an organizer explicitly revoked. Reauthentication is not an
  authorization override.

## Trusted period and revocation

The trusted period for a guest account ends at 23:59:59 in the wedding's default timezone seven days
after `wedding.end_date`. If the account has access to multiple weddings, use the latest applicable end.
Wedding owners and active operators are not automatically expired by this guest rule.

For the pilot, Supabase continues its normal rotating session. A scheduled server command performs the
business cutoff and organizer revocation:

- revoke the affected guest membership when its access period has ended;
- sign out the account's Supabase identities only when the account has no other current wedding access
  and no active operator role;
- retain attendance and audit history;
- never revoke an account that still has a future/active wedding or an active operator role.

Organizer revocation is guest-membership-wide for the selected wedding, not per physical device. It
therefore removes that wedding from every device while preserving unrelated wedding or operator access.
Per-device management requires a session-management UI and is deferred.

## Telegram flow

Telegram supports OIDC Authorization Code Flow with PKCE. Sangam configures a Supabase custom OIDC
provider with issuer `https://oauth.telegram.org`, an `email_optional` account, and scopes
`openid profile phone`. Telegram returns the verified phone in the signed ID token after user consent.

Flow:

1. Guest taps **Continue with Telegram**.
2. Supabase initiates the custom OIDC flow with PKCE and an allow-listed callback.
3. Telegram authenticates the person and asks permission to share the verified phone.
4. Supabase validates issuer, audience, signature, expiry, nonce/state, and establishes a session.
5. The server callback derives `auth_user_id`, provider subject, `phone_number`, and
   `phone_number_verified` from the server-controlled `auth.identities.identity_data` row for the
   Telegram provider. It accepts no identity values from query/form data or editable user metadata.
6. Normalize the phone to E.164 and find a unique `household_contact` where `guest_id` is non-null,
   `is_shared=false`, and channel is `sms` or `whatsapp`.
7. Zero matches: show recovery choices without revealing guest data. More than one match: require organizer
   resolution. Exactly one unbound or same-account match: create/adopt the account identity, activate the
   membership, and bind idempotently.
8. Redirect to the guest's schedule and retain the session silently.

The login requests no `telegram:bot_access` scope in this slice; authentication must not silently become
permission to message the guest.

## Organizer-assisted activation

This path is for a guest who has neither usable email nor Telegram. It is not available anonymously from
a guest search screen.

### Operator flow

1. Wedding owner or an authorized host-group admin opens the guest record they are allowed to manage.
2. They select **Activate this guest's device** and confirm they have identified the person or trusted
   family representative.
3. Sangam creates 256 bits of randomness, stores only its SHA-256 hash, and displays the QR value once.
   A separately hashed ten-character human-enterable code is also shown once and is protected by a
   five-attempt limit per activation plus endpoint rate limiting.
4. The activation expires after 15 minutes.

### Guest device flow

1. The device opens the activation page. GET/preview reveals no guest name and consumes nothing.
2. The page asks for an explicit **Activate this device** POST.
3. The browser establishes a Supabase anonymous session, and the service command atomically redeems the
   activation against that server-verified `auth.uid()`.
4. The command creates the `assisted` account identity, binds only the preselected guest, activates the
   membership, records the issuing operator, and marks the token used in one transaction.
5. Concurrent or replay redemption yields one success at most. Scanner GETs cannot burn the token.

Assisted activation must never rebind a guest already owned by a different account. The operator must use
a separately audited revoke-and-reissue workflow to resolve an existing binding.

## Login interface

The login page presents choices in this order:

1. **Continue with Telegram** — primary when configured.
2. **Email me a sign-in link** — recovery and non-Telegram option.
3. **I need help signing in** — explains organizer-assisted activation without exposing a guest list.

If a valid session exists, none of these controls render; the visitor redirects automatically. Copy uses
large tap targets and plain language. It never asks guests to remember a password or understand the term
"OTP." Gujarati and Hindi strings are included before pilot rollout.

## Failure handling

| Condition | Result |
| --- | --- |
| Telegram phone permission declined | No binding; offer email or organizer help |
| Telegram phone absent/unverified | No binding; generic error, server audit |
| Phone matches shared or multiple guests | No binding; organizer resolution queue |
| Telegram identity already belongs to another account | Reject and alert operator; never merge automatically |
| Assisted token scanned by preview bot | Validity-only response; no mutation or PII |
| Assisted token expired/replayed | Generic failure; no session-to-guest binding |
| Session refresh fails | Clear unusable cookies once; return to recovery with reason code |
| Membership revoked | Deny immediately through RLS even if the JWT remains temporarily valid |
| Guest browser loses cookies | Reverify through Telegram/email or request assisted activation |

## Database and API surface

Add only the correctness-critical structures in the implementation slice:

- `app.account_identity` for multiple verified Auth identities;
- `app.assisted_activation` for hashed, scoped, expiring activation tokens;
- append-only structured auth audit actions: `identity_bound`, `identity_conflict`,
  `assisted_activation_issued`, `assisted_activation_redeemed`, `access_revoked`, and `session_recovery`;
- service-only functions for Telegram binding, assisted issuance/redemption, and wedding-access revocation;
- narrowly granted public wrappers only where an authenticated browser must call them.

Do not add browser fingerprints, passwords, permanent guest QR credentials, Telegram usernames as keys,
or a general-purpose device-management subsystem.

## Adversarial test gate

Database tests must execute under real `anon`, `authenticated`, and `service_role` roles and prove:

- an authenticated but unbound Telegram user sees no wedding data;
- a typed/form/query phone cannot influence binding;
- an unverified, mismatched, shared, or duplicate phone cannot bind;
- a unique verified phone binds only its intended guest and is idempotent;
- one Auth user cannot map to two Sangam accounts;
- one account can safely carry both an email and Telegram identity;
- an existing conflicting guest binding is never replaced;
- scanner GET cannot consume an assisted activation or reveal the guest name;
- wrong, expired, replayed, and concurrent activation attempts fail without side effects;
- unauthorized operators cannot issue or revoke activation;
- membership revocation immediately removes RLS access;
- guest cutoff excludes active operators and accounts with another active wedding.

Browser tests must prove:

- first email, Telegram, and assisted sign-ins establish cookies on `https://sangam.vitan.in`;
- a browser restart returns directly to the correct destination;
- `/login` redirects an already-signed-in visitor;
- middleware propagates rotated cookies to request and response;
- sign-out and organizer revocation force reauthentication;
- Telegram cancellation and popup/deep-link failures have usable fallbacks;
- Safari/iOS, Chrome/Android, desktop Chrome, and at least one email/Telegram in-app browser work;
- no auth token, raw contact, raw activation token, or guest PII appears in logs or analytics.

## Delivery order and gates

1. **Session reliability:** diagnose production cookie behavior, add signed-in redirect, and pass restart/
   refresh tests. Ship independently.
2. **Identity boundary:** add/backfill `account_identity`, update `current_account_id()`, and pass all
   existing RLS suites unchanged plus new multi-identity tests.
3. **Telegram:** configure BotFather and Supabase OIDC, add callback binding, keep behind
   `TELEGRAM_LOGIN_ENABLED=0` until a real-provider compatibility probe passes. The probe must confirm
   Supabase accepts Telegram's discovery document and ID-token claims despite Telegram not exposing a
   separate UserInfo endpoint, and that `auth.identities.identity_data` contains the verified-phone fields.
4. **Assisted activation:** add issuer UI and anonymous-session redemption behind
   `ASSISTED_ACTIVATION_ENABLED=0` until adversarial and browser tests pass.
5. **Cutoff/revocation:** schedule the guest-only wedding cutoff and expose organizer account revocation.

Email remains enabled as recovery. SMS/WhatsApp OTP and passkeys are deferred; passkeys may be reconsidered
when Supabase no longer marks the feature experimental.

## External prerequisites

- A Telegram bot configured in BotFather with `https://sangam.vitan.in` and the exact Supabase callback
  allow-listed; client secret stored only in Supabase/Coolify secrets.
- Supabase custom OIDC provider configured with `email_optional=true` and verified-phone scope.
- Every Telegram-eligible guest has a normalized personal E.164 phone contact; shared household numbers
  must be marked `is_shared=true` and cannot auto-bind.
- Production Auth redirect URLs and cookie behavior certified on the final domain before enabling either
  feature flag.

## References

- Telegram OIDC and verified phone claims: <https://core.telegram.org/bots/telegram-login>
- Supabase custom OAuth/OIDC providers: <https://supabase.com/docs/guides/auth/custom-oauth-providers>
- Supabase session behavior: <https://supabase.com/docs/guides/auth/sessions>
- Supabase passkeys (experimental, deferred): <https://supabase.com/docs/guides/auth/passkeys>
