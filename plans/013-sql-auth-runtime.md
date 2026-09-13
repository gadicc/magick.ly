# SQL authentication integration

`src/auth/sqlAuth.ts` defines the Better Auth configuration that runtime routes
will consume, and a fresh session-to-canonical-user adapter for domain services.
The existing Auth.js/Gongo login route remains active until the coordinated
runtime switch. This factory does not load environment files, open a database
singleton or install a second login route.

The configuration accepts an explicit origin, secret, Google credentials and a
transaction-capable Drizzle database. Use Loom's secret helper and normal Next
environment loading in the eventual wrapper. Use `neonFull` for the database;
the adapter deliberately enables transactions so new user/account pairs commit
together. All local auth IDs use UUIDv7. Provider subjects retain their external
text identities and imported account links remain authoritative.

The origin must be canonical HTTPS, or HTTP on a literal supported loopback host
for local development. Host wildcards, credentials, paths, queries and fragments
are rejected. Better Auth's standard environment behavior still applies:
`BETTER_AUTH_SECRETS` can configure versioned secrets, and
`BETTER_AUTH_TRUSTED_ORIGINS` adds trusted origins. Those effective values must be
reviewed for each deployment; explicit factory arguments alone do not prove
Preview isolation. No credentials are added or changed in this unit.

Origin and CSRF protections are enabled explicitly, including in tests. The
installed Better Auth version otherwise defaults to skipping origin checks under
`NODE_ENV=test`; handler acceptance must exercise the runtime policy instead.

Google remains the only login provider. Existing subject matches preserve the
imported UUID even if the provider email changes. An unlinked subject cannot
acquire an existing account through matching email. Explicit authenticated
linking keeps Better Auth's same-email and last-account protections. Email/password
login and self-service account deletion stay disabled. New access/refresh tokens
use Better Auth's encryption; historical tokens remain excluded by the importer.
Application grants and display profiles stay in their separate tables and cannot
be granted through provider profile fields.

The factory's library logger emits only `SQL_AUTH_ERROR` or `SQL_AUTH_WARNING`.
Forced account-insert failure demonstrated that Better Auth's default logger
prints Drizzle query parameters, including the raw fresh ID token. Encrypting
access/refresh tokens does not sanitize those diagnostics. Library message and
argument payloads are therefore never forwarded by this logger; the eventual
HTTP boundary can add a safe request identifier separately.

The `magickli-sql` cookie prefix separates new sessions from Auth.js and default
Better Auth cookies. Loom's ten-second cookie cache is available for ordinary UI
reads. Private data, mutations and renewed offline grants must use
`getFreshSqlSession` or `getFreshSqlUserId`. These helpers copy request headers,
disable cookie-cache reads and session renewal, and verify matching canonical
session/user IDs and an unexpired timestamp. They do not memoize with React.cache:
checks repeated after provider I/O must reread the database. Better Auth may still
clean up an expired session row, so these are not strictly read-only operations.
Domain services continue loading current grants themselves.

Before activation, wire the shared factory into the actual Node handler and
server readers, confirm Google callbacks for the exact deployment origin, and
switch clients and repositories together so canonical UUID sessions never enter
the legacy ObjectId adapter. Preserve old-client draft/study recovery and the
agreed one-time reauthentication. Verify sign-out/offline cleanup and effective
Preview service isolation before enabling private traffic.

## Verification on 13 September 2026

Seventy independently authored/updated cases pass: 21 actual Better Auth
handler/Drizzle/PGlite cases and 49 configuration/fresh-reader cases. The database
tests consume this factory, preserve imported identities, and stub only Google's
external token verification/exchange/user-info boundary. They forbid all fetch
calls. Actual authorization-code/state callback processing verifies token
encryption and rejects replayed state; no Google server or real JWT was used.

The checks cover secure host-only cookies, old/forged credential refusal,
cached-cookie revocation, actual private ritual source/metadata denial, session
expiry and sign-out, cross-origin request refusal, new-user UUIDv7 allocation,
profile/grant separation, concurrent first sign-ins and same-subject retry. A
temporary account CHECK failure proves a newly inserted user rolls back with its
failed account; the response and logger retain no synthetic token/email/query.
The default logger leak was reproduced before the fixed logger was added.

The full suite passes 3,922 tests with 14 opt-in Mongo cases skipped, including
62 additional cases in this unit. All 86-module coverage gates pass: 98.23%
statements, 97.13% branches, 99.83% functions and 99.28% lines. This new module has
100% statement/function/line coverage and 97.22% branch coverage. Types, Biome and
ordinary Loom check pass; existing repository lint and release-workflow advisories
remain. Independent review found no remaining actionable issue in this unit.

Evidence: `/tmp/magickli-sql-auth-{coverage,types,biome}.log` and final integration
logs `/tmp/magickli-sql-auth-{full-coverage,final-types,final-biome,loom}.log`.
Factory SHA-256:
`d763639563eddc51ca1ebf809de5d9063968f35bbd9b26313ea3fae510111c5e`.
No route/build entrypoint changed, so this is handler/PGlite evidence rather than
a new deployed build, browser, real PostgreSQL or live OAuth acceptance claim.

Magickli now pins Loom 1.25.0, whose nonlocal `neonFull` connection requires
native certificate-chain and hostname verification. The installed `neonFull.js`
and `databaseTls.js` hashes match the independently reviewed release, and
postgres.js remains 3.4.9. Frozen install, the 3,922-test coverage suite, types,
Biome, ordinary Loom check and an isolated production build pass. Production
Loom check remains blocked by the pre-existing master release workflow without
`db:migrate`; the cached Loom 1.24.0 CLI reports the same issue. No runtime route,
provider, database or deployment was activated by this adoption.

## Runtime entrypoints prepared

The app now composes the reviewed factory with Loom's transaction connection
and an explicit `BETTER_AUTH_URL`; it never borrows a Production origin from
legacy environment variables or an incoming Host header. Fresh server session
helpers support the SQL domain services. `/api/session` returns only the current
user's ID, name, image and separately read global-admin flag with `no-store`,
rechecking the session after the grant lookup. Its failure response contains no
provider diagnostics or session tokens.

The new `/signin` page starts Google authentication through Better Auth and
accepts only local application callback paths. CI uses synthetic authentication
values and closed loopback SQL endpoints. The existing login handler and global
browser provider are still unchanged in this commit; their coordinated switch
follows the reader, editor and study integration.

Root adversarial review checked callback redirects, session/account changes,
private response caching, explicit deployment origin and server/client imports.
The isolated tree at `/tmp/magickli-auth-runtime-validation` passes 72 focused
tests, typechecking, targeted Biome, ordinary Loom check and a production build.
Logs: `/tmp/magickli-auth-runtime-{tests,types,biome,loom,build}.log`. These are
local checks with synthetic credentials, not a live OAuth or deployment claim.
