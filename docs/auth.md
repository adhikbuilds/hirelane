# Accounts and auth (Slice 2)

**Status:** built, uncommitted, 2026-10-29. Server side only: the database layer, the web auth library, two Google route handlers, and server actions. **The pages are not built.** There are no `page.tsx` files for `/signin`, `/signin/code`, `/welcome` or `/you`, so no one can reach the sign-in UI yet. The Google button and the email-code form have nothing to render in. Logout and delete redirect to `/signin` and `/`, and `/signin` does not exist yet.

**Not built:** the UI pages (above), phone OTP (Slice 2b, after the vendor decision), a real mail transport (file outbox only), and the Android Bearer path (designed, not used).

**Owner files:** `packages/db/src/auth/` (sessions, OTP, delete), `packages/db/migrations/0008_auth.sql` and `0009_auth_hardening.sql`, `packages/db/src/client.ts` (`withAuth`, `runAsRole`), `apps/web/lib/auth/`, `apps/web/app/auth/google/*/route.ts`, `apps/web/app/(auth)/**/actions.ts`, `apps/web/app/(app)/you/actions.ts`, `packages/agent/src/mail/`.

## 1. Feature flag

`accountsEnabled()` (`lib/auth/flags.ts`) decides whether auth is on:

1. `HIRELANE_ACCOUNTS=1` forces it on (dev and e2e).
2. `HIRELANE_ACCOUNTS=0` forces it off.
3. Otherwise the global `feature_flags` row with key `accounts` (`user_id IS NULL`) decides. An absent row means off.
4. Any error reading the flag counts as off.

When the flag is off, every auth action calls `notFound()` (a 404), and both Google routes answer 404 without contacting Google. Tests: `apps/web/tests/auth-flows.test.ts` ("flag off: both routes are 404 and Google is never contacted") and `auth-actions.test.ts` ("flag off: every action is a 404").

**Deferred:** `HIRELANE_ACCOUNTS` can override the flag in production with no warning or gate.

## 2. Who can reach the database, and how

Auth never runs as the table owner or the app role for its own tables.

- **`hirelane_auth`** is a `NOLOGIN` role that `0009_auth_hardening.sql` creates. It has no `BYPASSRLS`. It has explicit RLS policies, and it cannot create objects in the public schema. Its grants are:
  - `sessions`, `otp_challenges`, `auth_identities`: SELECT, INSERT, UPDATE, DELETE.
  - `rate_limits`: SELECT, INSERT, UPDATE, DELETE.
  - `feature_flags`: SELECT only.
  - `users`: SELECT and DELETE. INSERT only on `id`, `email`, `email_verified_at`. UPDATE only on `email_verified_at`. It cannot change `role` or `email`.
  - `consents`: SELECT, and INSERT only on `user_id`, `kind`, `granted`, `doc_version`.
- **`withAuth(fn)`** (`packages/db/src/client.ts`) checks out a pool connection, runs `SET ROLE hirelane_auth`, runs `fn`, then `RESET ROLE`. A connection that fails to reset is discarded, not returned to the pool. `runAsRole` is the underlying helper.
- **`withAdmin`** is no longer used in `lib/auth`. The `apps/web/lib/auth/**` entry was removed from the `withadmin-guard` allowlist, so the guard fails if `withAdmin` comes back there. `scripts/withadmin-guard.ts` enforces it.
- **App role consents.** Users record consents through `withUser` as `hirelane_app`. Migration 0009 adds a policy that refuses an `age_18_plus` consent from the app role, and limits INSERT on `consents` to four columns, so the app cannot set the timestamp. The 18+ attestation can only be written by the sign-up transaction (see §5).

The rows of `0008_auth.sql` are `users`, `auth_identities`, `sessions`, `otp_challenges`, `consents`, `product_events` and `idempotency_keys`. `product_events` carries a recursive, case-insensitive PII-key check, so no personal key can be written into event props.

## 3. Sessions (`packages/db/src/auth/sessions.ts`, `lib/auth/session.ts`)

| Item | Value |
|---|---|
| Token | `hl_s_` + 32 random bytes, base64url (web). `hl_at_` for Android (Bearer, not used yet) |
| Storage | Only the SHA-256 hex of the token is stored (`id_hash`). The raw token is shown once, to the client that asked |
| Cookie | `__Host-hl_session`, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 90 days |
| Idle expiry | 30 days, **sliding**: a use pushes it out, never past the absolute deadline |
| Absolute expiry | 90 days from creation |
| `last_seen_at` | Written at most once every 5 minutes, so reads are not writes |
| Client match | The stored client must match the token prefix. A web token in an `hl_at_` slot, or the reverse, fails |
| Login | `rotateSession` always mints a fresh token and revokes the one presented, so a planted cookie cannot be fixed |
| Logout | `revokeSession` marks the row revoked on the server, then the cookie is cleared. The row is dead even if a browser keeps sending the cookie |
| Cookie scope | A cookie carries only a `hl_s_` token. `tokenFromRequest` refuses an `hl_at_` token in a cookie |
| UA | HMAC of the first 300 characters of the user agent, keyed `auth/ua`. The raw string is not stored |

**Browser note.** Chromium accepted `__Host-` Secure cookies over `http://localhost` in Playwright (checked 2026-10-29). WebKit and Firefox were not checked. Set `HIRELANE_INSECURE_DEV_COOKIE=1` for unprefixed, non-Secure dev names if a browser drops the cookie. The override is ignored when `NODE_ENV` is `production`.

## 4. Sign-in paths

### 4a. Email code (`lib/auth/email-code.ts`, `app/(auth)/signin/actions.ts`, `…/signin/code/actions.ts`)

A 6-digit code, valid for 10 minutes, and at most 5 attempts per challenge. Only the newest code works: issuing a new one retires the open one for that address.

**Request** (`sendEmailCode`):

- Normalises the address. An invalid address returns `invalid_email`, which is the only response that differs by input.
- Per-IP send limit: 10 per 10 minutes. Over it returns `rate_limited` with `retryAfter`. In dev and test the shared local key gets a wider budget (`scaledLimit`), so e2e runs are not starved. Production is not widened.
- Per-address send limit: 5 per 10 minutes. Over it returns the same silent `ok`.
- Resend cooldown: one mail per address per 60 seconds, silent.
- Daily cap: 10 mails per address per day, silent.
- Mail is sent to every valid address, because a new address signs up through the same flow.
- Mail failures are swallowed. The log line carries the error name only, never the address or the code.

**Verify** (`verifyCode` → `verifyEmailCode`):

- Per-IP verify limit: 30 per 10 minutes.
- Per-address verify budget: 10 per hour across **all** challenges. Asking for a fresh code does not reset it. Past it, verify returns `rate_limited` **even for the right code**. This is a lockout: an attacker can lock a victim out of code sign-in for up to an hour. That is the trade-off the owner asked for. Tune the numbers if it hurts.
- Wrong, expired, consumed, locked-out and unknown codes all return one `invalid` answer. The DB side hashes a dummy value on a miss, so an unknown address costs the same as a wrong code.
- A code works once, even when two correct submissions race (`verifyChallenge` uses a guarded UPDATE).

**After a correct code.** The mailbox is proven. If an identity exists for this address (by `email_otp` subject or by a verified email match), the user is signed in and redirected to `/you`. Otherwise the 18+ gate starts (§5), and the user is sent to `/welcome`.

**Enumeration.** Known and unknown addresses get byte-identical responses (test "answers byte-identically for a known and an unknown address").

### 4b. Google OIDC (`lib/auth/google.ts`, `app/auth/google/{start,callback}/route.ts`)

Authorization code flow with PKCE (S256), state and nonce. No OIDC library: RS256 verification is written on `node:crypto`.

- **Start** (`GET /auth/google/start`): rate limited to 20 per 10 minutes per IP, keyed by an HMAC of the IP. It redirects to Google with a random state, nonce and PKCE verifier. The state cookie is `__Host-hl_oidc`, a signed payload with a 10-minute life.
- **Discovery** is cached for one hour per issuer. The JWKS is fetched on each callback and is not cached (deferred).
- **Callback** (`GET /auth/google/callback`): checks the state and its expiry (state compare is timing-safe), exchanges the code (timeout 5 s, body cap 64 KiB), then verifies the ID token.
- **ID token checks:** RS256 only. `iss` must match the configured issuer. For Google, `accounts.google.com` is also accepted. `aud` must be the client id, and `azp` must match when `aud` is an array. `exp` and `iat` are checked with 60 seconds of clock skew. `nonce` must match. `email_verified` must be `true`.
- Success for an existing identity starts a session and redirects to `/you`. A new identity gets the pending cookie and redirects to `/welcome`.

**Config** (`loadOidcConfig`): `HIRELANE_GOOGLE_CLIENT_ID` and `HIRELANE_GOOGLE_CLIENT_SECRET`. The secret is a secret. The redirect base is `HIRELANE_APP_ORIGIN`, which defaults to `http://localhost:3001` outside production. In production, `HIRELANE_APP_ORIGIN` must be a public https origin and the issuer must be a public https URL, or config returns null and Google sign-in is off. `HIRELANE_OIDC_ISSUER` overrides the issuer (default `https://accounts.google.com`).

**Deferred:** the OIDC state cookie is signed but not encrypted, and state is not single-use. Only the discovery document is cached.

### 4c. Linking

`resolveIdentity` finds the account for a verified identity. It first looks up `(provider, subject)`. If that fails and the identity's email is verified, it looks up an existing user by email and **links** the new identity to that account, setting `email_verified_at`. This means a Google sign-in with an address that already has an email-code account is attached to that account. Both paths require a verified email, so an unverified address never links.

## 5. The 18+ gate and sign-up (`lib/auth/pending-signup.ts`, `app/(auth)/welcome/actions.ts`)

No `users` or `auth_identities` row exists until the person attests.

1. A verified identity (Google or email code) with no account gets a **pending cookie**: `__Host-hl_pending`, a signed payload holding provider, subject, email, `iat` and `exp`. It lives 15 minutes. It has an integrity signature only, so do not put secrets in it.
2. `/welcome` shows the address being signed up (`getPendingSignup`).
3. `acceptSignup({ over18, terms, privacy })`:
   - No pending cookie, or an expired one: `expired`.
   - `over18` not true: `under_18`. **Nothing is stored.** The pending cookie is cleared.
   - `terms` or `privacy` not true: `consent_required`. The cookie is kept, so the person can tick the boxes.
   - Otherwise, inside one transaction under an advisory lock on the address: insert the user (`email`, `email_verified_at`), insert the identity, and insert three consents: `age_18_plus`, `terms` and `privacy`, all with `doc_version` `2026-10-29`. Then start a session and redirect to `/you`.
4. **Single use.** If the identity already has an account when the cookie is redeemed, the result is `expired` and no session is minted. Two simultaneous accepts give one success and one `expired`.
5. `declineSignup` clears the pending cookie. Nothing was ever stored.

No date of birth is asked. Under-18 is an attestation only (DPDP s.9).

**Invariant:** 0 users without an `age_18_plus` consent. Test: `auth-flows.test.ts` "0 users rows without an age_18_plus consent, across everything the suite created". Migration 0009 also stops the app role from inserting `age_18_plus`, so only the sign-up transaction can write it.

## 6. Consents after sign-up (`recordConsent`, `setConsent`)

`SELF_CONSENT_KINDS`: `terms`, `privacy`, `campus_share`, `offer_letter_tpo`, `llm_resume`, `llm_contacts`, `whatsapp`, `email_picks`, `analytics`. `age_18_plus` is not on the list and cannot be recorded here.

Consent rows are append-only. A withdrawal is a new row with `granted = false`. Writes run through `withUser` as `hirelane_app`, so RLS applies. The current `doc_version` is `LEGAL_DOC_VERSION` (`2026-10-29`).

## 7. Logout, delete, and what they revoke

- **Logout** (`logout`): `endSession` marks the session row revoked, the cookie is cleared, and the action redirects to `/signin`. The test "logout revokes the session server-side" checks that the same token stops working.
- **Delete** (`deleteMyAccount({ confirm: true })`): requires a live session and `confirm === true`. Then `deleteAccountFor` runs `deleteAccount` (`packages/db/src/auth/delete.ts`) through `withAuth`:
  1. `BEGIN`.
  2. `revokeAllSessions` for the user. No cookie can act on the account while the delete is in flight.
  3. `DELETE FROM users WHERE id = $1`. Foreign keys cascade to identities, sessions, consents, events and idempotency keys.
  4. `COMMIT`. On error, `ROLLBACK` and rethrow.
  
  The cookie is cleared and the action redirects to `/`. Tests: `packages/db/test/auth-delete.test.ts`, and "delete revokes every session, removes the account, and the address can start fresh".

  **Stale comment.** The header of `delete.ts` says to run it on `withAdmin`. That is out of date. The real path is `withAuth`, through `deleteAccountFor`. Fix the comment when the file is next edited.

**Deferred:** re-authentication before delete, "sign out everywhere", and a consent-withdrawal ledger that survives hard delete (a DPDP design decision).

## 8. Origin and CSRF (`lib/auth/origin.ts`)

Every mutating action calls `openAction`, which refuses a request whose `Origin` header does not match the app origin. A missing or `null` Origin fails. The expected origin is `HIRELANE_APP_ORIGIN` when set. Without it, outside production, the `Host` header is used as a fallback, never `X-Forwarded-Host`. **In production without `HIRELANE_APP_ORIGIN`, the check fails closed** (every mutation is refused). Read-only renders use `openRead`, which has no origin check, because a navigation GET sends no Origin.

## 9. Rate limits

`checkRateLimit` (`apps/web/lib/rate-limit.ts`) is a fixed window in `rate_limits`, counted in one atomic upsert. Its `prune` option deletes old windows. Its `pruneAfterSeconds` option (added for this slice) keeps daily buckets alive, and the default is still one hour. Buckets are keyed by an HMAC of the IP or of the target address, so neither the raw IP nor the raw address reaches `rate_limits`. `clientIp` reads `x-real-ip` only when `TRUST_X_REAL_IP=1`, and otherwise uses `TRUST_PROXY_HOPS`.

## 10. Keys and secrets

Signing, OTP hashing, the address subject and the UA hash all use `@hirelane/vault` subkeys, derived per purpose from the master key (`HIRELANE_MASTER_KEY`, set with `pnpm setup:keys`). Purposes in use: `auth/otp-code`, `auth/ip`, `auth/email-target`, `auth/ua`, `auth/sign/<purpose>` for the pending cookie and the OIDC state cookie, and `auth/ip` for rate buckets. The database never stores the plain code, the plain address or the raw IP.

## 11. Verification

| Check | Result (verify, 2026-10-29) |
|---|---|
| `pnpm db:verify-auth` | "Auth verification passed (26 checks)", exit 0 |
| `packages/db` tests | Sessions, OTP, delete, schema, hardening, helpers |
| `apps/web` tests | `auth-flows`, `auth-actions`, `auth-cookies-origin`, `auth-google-idtoken`, `auth-hardening`, `auth-pending-signup`. The whole flow (sign-up, sign-in, lookup, rotate, delete) runs as `hirelane_auth` in `auth-hardening.test.ts` |
| `withadmin-guard` | ok |
| Skips in the auth suites | None |

The Slice 2 acceptance boxes in `docs/design/campus-build-plan.md` are ticked on this evidence, with the named tests cited there.

## 12. Deploy caveat (read before shipping)

- **Migrate first.** Staging and prod must run `pnpm db:migrate` (migration 0009) **before** deploying this web code, because `lib/auth` needs the `hirelane_auth` role. Dev has 0009 applied.
- **The GRANT may need a role admin.** 0009 runs `GRANT hirelane_auth TO current_user`. A non-superuser migrator may not be allowed to do that. In that case the migration only emits a NOTICE ("a role administrator must run it before withAuth() can SET ROLE"). Check this before any deploy. Without the grant, sign-in fails at `SET ROLE`.
- **Mail in production is undelivered.** The file outbox writes `.mail/outbox/*.eml`. There is no real transport. Until one is chosen, code sign-in works only where someone can read the outbox. Deferred: a loud startup failure when accounts are on in production with no real transport.
- **Google in production** needs `HIRELANE_APP_ORIGIN` (public https) and the client id and secret. Missing any one turns Google sign-in off.

## 13. Known gaps (deferred lows)

- Gate or warn on the `HIRELANE_ACCOUNTS` override in production.
- Re-authentication for account delete, and "sign out everywhere".
- OIDC state cookie encryption and single-use state. JWKS caching.
- File-outbox startup failure in production with no transport.
- Consent-withdrawal ledger that survives hard delete (DPDP decision).
- Lockout trade-off on the 10-per-hour verify budget. Owner to decide whether to tune.

## Related

- `docs/resume.md` for the resume pipeline, which runs after sign-in in Slice 3.
- `docs/design/campus-build-plan.md` for the Slice 2 tasks and acceptance.
- `docs/architecture.md` §3 and §7 for the RLS posture and the owner-role grants that `0007` sets up.
