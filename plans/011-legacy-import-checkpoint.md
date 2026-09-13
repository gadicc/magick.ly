The importer now verifies backup files/BSON, prepares exact protected checkpoints
and applies their saved rows in one fenced SQL transaction. It allocates every
canonical, alias-row and email-provenance UUID before serialization. Schema
catalog and complete migration-history checks protect the prepared destination.
The trusted maintenance command and live runtime/cutover integration remain
pending. No runtime route uses this code.

## Preparation and source accounting

`prepareLegacyImport` accepts ten explicit decoded BSON collections, optional
`ritualWriteReceipts`, a fixed `importedAt`, reviewed configuration and an optional
UUIDv7 allocator. Configuration records the forum origin, file location,
fingerprinted study duplicate and unresolved-creator declarations. Unknown or
missing collections, unknown auth fields, conflicting IDs, unclassified domain
state and unused allocations stop preparation.

The grouped plan preserves identity/access, membership, rituals, study, files,
Discourse and protected evidence. Sessions are discarded count-only. Known OAuth
tokens, obsolete strategy configuration and opaque provider profile subtrees
never enter the checkpoint. Historical locale/gender values and photo provider
labels remain protected evidence by typed user identity and exact field position,
with no new runtime meaning. Unknown login/password fields are refused.

The saved plan itself is the allocation manifest; resume never recomposes it.
All canonical IDs, email-evidence IDs, alias-row IDs and alias creation dates are
explicit. Approved aliases share canonical IDs only through existing planners;
the archived study duplicate receives no independent ID. Configuration, BSON IDs,
dates and application projections are copied before the allocator can run.

Receipt policy is explicit. `require-empty-collection` refuses absence;
`allow-reviewed-pre-bridge-absence` permits the specifically reviewed snapshot
predating the undeployed Mongo write bridge. Both refuse nonempty receipts until
exact v1 archive/recovery handling exists. No receipt is translated into SQL v2.

## Checkpoint representation and authority

`legacyImportValue` preserves JSON scalars/containers and genuine Dates through
tagged containers. Literal tags and arbitrary own keys remain data; date-looking
strings stay strings. There is no custom class revival, path interpretation or
global registry. Installed SuperJSON rejects legitimate keys such as
`constructor`; the import-specific codec preserves them without changing object
prototypes. Shared references are copied by value. Cycles, sparse arrays,
accessors, hidden properties, unsupported classes and lossy values are refused.

Accepted output is bounded to 64 MiB, one million logical values and depth 256.
JSON framing and escaped bytes are charged before stringification. Wire depth and
token bounds are checked before parsing, followed by canonical reserialization.
These are representation bounds, not a total process-memory claim.

`createLegacyImportCheckpoint` binds exact payload bytes to a UUIDv7 run ID and
source-manifest, source-descriptor, schema and destination hashes. It hashes the
actual copied configuration. Resume verifies every binding plus payload and
configuration digests and returns fresh owned values without ID allocation.
This provides integrity for trusted maintenance data, not target authentication,
arbitrary row validation or browser import authority. The future SQL service
must bind the actual connection and reconcile known table rows.

## Verification on 13 September 2026

Independent source/allocation/SQL design reviews and 123 independently authored
codec cases informed the implementation. Review found and fixed escaped-string
budget expansion. Local adversarial review found and fixed application mutation
through the allocator callback. Review workers then hit the account usage limit;
final composition/envelope review and remaining tests were completed locally.
The whole final unit did not receive a completed second-agent review.

All 272 new tests pass: combined domain planning, typed aliases, reviewed
exceptions, secret exclusion, mutation isolation, receipt policies, historical
profile evidence, damaged checkpoints and serialization boundaries. The full
suite passes 3,288 tests with 14 opt-in Mongo cases skipped. All 77-module coverage
gates pass at 98.30% statements, 97.15% branches, 99.90% functions and 99.34% lines.
Types, Biome, ordinary Loom check and production build pass.

The protected corpus pass accounts for 190 documents: 12 users, 12 provider
accounts, 13 email evidence rows, 175 aliases, five rituals, 59 exact sources,
five archives, 48 study baselines, 656 active cards, 49 snapshots, ten files and
seven forum links. It classifies 36 discarded sessions, one strategy row, ten
embedded token fields, 17 opaque profile subtrees and 41 modern OAuth fields.
Protected evidence also retains four locale values, one gender value and six
photo provider labels. Repeat preparation and checkpoint round trips match with
a 3,425,036-byte payload; all 21 backup files/767,839 bytes and 11 module
fingerprints remain unchanged.

That pass uses disposable IDs and explicitly synthetic file/schema/target
configuration. The payload is never saved or usable as a production checkpoint.
It reuses the earlier native-scalar BSON projection; exact wire-type verification
belongs to the future owned loader. There were no database/provider calls or
writes. Evidence: `/tmp/magickli-prepared-import-preflight/report.json`, SHA-256
`a1a341e21fca0843aacf16f066028ab776a725456f384937ec2dae3ba8cd433e`,
`/tmp/magickli-import-preparation-{coverage,types,biome,loom,build}.log`, and
`/tmp/magickli-import-{plan,source,sql}-design.md`.

## BSON source verification

The first source-loader boundary, `decodeLegacyBson`, is now implemented. It
captures an owned inflated collection using intrinsic typed-array bounds,
rejects shared memory, validates complete BSON frames, and decodes original
numeric wrappers before native-scalar projection. Exact typed reserialization
must reproduce every frame byte, refusing duplicate fields and normalized array
indices. Frame and type-profile hashes bind the original numeric representation;
source names and values are absent from those evidence records. Unsupported BSON
types and int64 values outside the JavaScript safe range stop decoding. Native
Double values retain their exact meaning for subsequent domain validation.

Bounds are 256 MiB per inflated collection, 16 MiB per frame, 100,000 rows, one
million values and depth 256. These are capture/representation bounds, not a
total process-memory claim. Temporary byte copies are wiped; immutable decoded
strings are released normally. File provenance, gzip limits and source-wide
budgets belong to the file loader below.

All 190 production BSON frames pass exact typed round trips and then the actual
decoder, combined builder and checkpoint round trip. Backup files and 12 module
fingerprints remain unchanged. Evidence:
`/tmp/magickli-bson-decoder-preflight/report.json`, SHA-256
`f00b63bd5d06d873ea67a0ce37dcafc0b02a92a8b04da93643cdb08ab74b8a0a`.
Thirty new tests cover wire/type preservation, ownership, malformed/duplicate
fields, unsafe/unsupported values, depth/row limits and full-domain integration.
The review was local and adversarial; independent workers remained unavailable.

## Verified file capture

`prepareLegacyBackup` takes an explicit directory, database name, pinned manifest
digest and copied import configuration. It accepts the reviewed logical-dump
layout only: ten BSON/metadata pairs and one prelude, optionally an additional
receipt pair. Unknown/missing files, duplicate/traversing paths, symlinks,
nonregular files and malformed metadata are refused. Manifest prose and restore
claims do not establish integrity; this execution checks actual file bytes.

The loader reads bounded regular files with no-follow handles, compares sizes
and file metadata across each read, checks compressed hashes before decompression,
and runs the verified BSON decoder before the pure builder. It rechecks directory
inventories, the manifest and every compressed file after preparation. An
allocator that changes the backup cannot cause a stale plan to be returned.
Configuration and dates are copied before filesystem awaits.

Source-wide limits are 1 MiB manifest, 64 MiB compressed data, 256 MiB inflated
data, 1 MiB per metadata/prelude file, 100,000 rows and a 30-second deadline.
Callers can tighten but cannot increase those limits. The deadline is checked
between filesystem/CPU operations; it does not promise interruption of an
in-flight filesystem call. Gzip pipelines are cancelled and settled before owned
buffers are wiped. No original auth/session rows, manifest prose or private
filesystem diagnostics enter the returned source descriptor. Per-collection
evidence hashes bind frame/type records without retaining session identifiers.

All 49 new tests pass, covering capture, source mutation, cancellation, tightened
bounds, malformed manifests/gzip/BSON/UTF-8, symlinks, unknown files and receipt
policy. The real pinned backup passes the complete loader, builder and checkpoint
round trip: 21 files, ten collections, 190 records, identical prepared output,
unchanged backup bytes and 13 module fingerprints. This still uses synthetic file
destination/schema/target bindings and writes no database or provider state.
Evidence: `/tmp/magickli-backup-loader-preflight/report.json`, SHA-256
`49688313a0852c2cb8a1d806ec23f0b5ef34e2c05a44f2248c5d3129c09c81c6`.
Final verification is recorded in the implementation ledger.

The subsequent independent review of preparation through file capture found one
maintenance failure: a FIFO could block the file open before the regular-file
check. Opens now include `O_NONBLOCK` as well as `O_NOFOLLOW`, then verify the
opened descriptor. Two real FIFO regressions cover the manifest and a listed
gzip file; their cleanup also releases the old blocking implementation on failure.
This closes the reproduced hang, without claiming all filesystem operations are
interruptible. No other concrete finding remained in that independent review.

## Complete SQL row reconciliation

`legacyImportRows` projects the verified plan into every column of all 33
application tables. Nullable omissions become explicit null; missing required
values are refused even if SQL offers a default. Seven credential/expiry fields
remain null, no sessions are imported, and final ritual pointers must reference
their own planned revisions. Projection copies the protected input and does not
allocate IDs, generate timestamps or execute defaults.

The `magickli-import-complete-rows-v1` fingerprint includes table names, complete
rows and ten explicitly empty runtime tables. Row order and JSONB object-key
order are immaterial; arrays, multiplicity, exact text and historical nulls are
preserved. This projection consumes verified planner output; it does not replace
domain planning, source classification or schema validation.

Reconciliation snapshots the expected rows and computes their fingerprint before
any await. PostgreSQL compares both directions with `EXCEPT ALL`, using explicit
column projections and typed `jsonb_populate_recordset` input. This verifies
actual complete rows rather than hashing whatever happens to exist. Comparison
stays in SQL to preserve sub-millisecond timestamps, arbitrary JSONB decimal
precision, SQL NULL versus JSON null and leading BOMs that a driver may drop.
Text uses C collation. The helper returns only the expected fingerprint and
aggregate counts after every table matches; it performs no writes.

One hundred new tests cover pure projection and PGlite integration; 79 were
written independently. The independent review found no remaining defect. Actual
PostgreSQL 15.17 through Loom 1.24.0 applies all 13 migrations and validates the
33-table baseline, non-UTC timestamps, one-microsecond changes, exact text,
high-precision JSONB changes, null distinctions, missing/extra rows and rollback.
An unchanged migration rerun preserves the baseline, all 55 source fingerprints
remain unchanged, and the disposable database is removed. Evidence:
`/tmp/magickli-import-rows-postgres/result.json`, SHA-256
`6ad7f4432964c05cdc4f22d738aad88fce917775b4479738f84797cf8c5e65cd`.

The pinned production backup also passes complete-row projection and checkpoint
round-trip equality in memory. This uses synthetic file locations and disposable
IDs, with no private SQL import or provider calls. Evidence:
`/tmp/magickli-import-rows-preflight/report.json`, SHA-256
`115c5e707f904422a08c971d466dd77d418f4a1fe6e3910c62de10874ce168db`.
The future importer must supply
target/schema checks, a transaction, locks and deadlines; this helper does not
make an unlocked sequence of table reads an atomic snapshot.

## Durable checkpoint schema and migration history

Migration 0013 adds `legacy_import_runs`, separate from the 33 application tables.
One required unique slot permits one bootstrap run per database. All IDs, source/
configuration/schema/target hashes, expected-row hash and imported/prepared dates
are explicit. The exact protected payload must fit 1 byte–64 MiB and match its UTF-8
SHA-256. Timestamps must be finite. Completion is either wholly absent or has a
date no earlier than preparation and the same expected-row fingerprint.

The table has no defaults or domain foreign keys. Application deletion cannot
cascade away completion evidence, and a retry cannot generate fresh IDs through
SQL defaults. The future service owns immutable-header behavior and allowed
state transitions; SQL constraints alone do not implement a resumable importer.
Generated Valibot output and the app schema barrel include the new table, while
complete application-row reconciliation deliberately excludes this ledger.

`legacyImportMigrations` binds the installed Drizzle reader's complete ordered
SQL identities, including exact decoded SQL hashes, breakpoint flags and positive
safe timestamps. It reconstructs the reader's statement split without trimming
or changing line endings and validates the declared SQL hash. Migration-history
verification compares every applied `(created_at, hash)` in both directions with
multiplicity, detecting changed or duplicated old entries even if the latest
timestamp still matches. Input is copied before awaits and errors contain only
fixed categories. A matching journal does not prove an unchanged schema catalog;
the caller must still provide that check, target identity and transaction locks.

Forty-nine independently written schema tests and 35 migration-history tests
pass. Root review added rejection of PostgreSQL infinity timestamps; subsequent
independent review found no migration-helper defect. Actual PostgreSQL 15.17 via
Loom 1.24.0 applies all 14 migrations to 34 tables, round-trips the synthetic
protected checkpoint, rejects singleton/hash/completion/history drift, reconciles
complete rows and repeats migrations without altering the saved baseline or
completion. All 58 source fingerprints remain unchanged; the disposable database
is removed. Evidence: `/tmp/magickli-import-runs-postgres/result.json`, SHA-256
`db007410e15a2d3b076ee6e602b7f2534c9d695958059f24823ec24cbbbec2ad`.
This migration has not been applied to Neon.

## Fenced preparation and atomic application

`legacyImportCatalog` captures a versioned, engine-specific definition snapshot:
public relations/columns, constraints, indexes, enums, noninternal triggers, RLS
policies, routines, extensions, collations, standalone types, rules and sequence
configuration. It includes owners/ACLs and locale versions; it excludes OIDs,
sequence values, row statistics and application data. A baseline must come from a
separately reviewed fresh-migration rehearsal in the intended environment. Merely
capturing the live target does not approve its schema. Public aggregate routines
are refused because this profile does not serialize their transition machinery.
The 16 MiB cap bounds accepted serialized evidence, not server query memory.

`createSqlLegacyImporter` exposes maintenance-only `inspect`, `prepare` and
`apply`. It owns a strict copy of the reviewed source/schema/destination binding.
Every operation uses one constant database-wide advisory lock and explicit
exclusive locks over the journal, ledger and all 33 application tables. It checks
the actual database, session/current role, writeability, complete migration
history and catalog before reading or changing the saved run. The required
ordinary-table inventory is closed: 33 application tables and the import ledger.

The fixed search path is `pg_catalog, public, pg_temp`. Independent review proved
that omitting pg_temp puts temporary tables implicitly before public relations,
allowing a reused connection's temporary ledger to shadow durable operations.
Putting pg_temp last preserves the real public tables. Both PGlite and actual
PostgreSQL regressions cover temporary ledger/user tables across prepare/apply.

Preparation requires an empty application database and reserves only the exact
checkpoint. Application reloads and verifies that durable payload, inserts every
known row/column and then assigns owned ritual revision pointers. Statements use
at most 500 rows but all share one transaction. Full SQL reconciliation and a
second catalog/history check precede completion. No provider, file or backup I/O
runs inside the transaction. SQL lock/statement timeouts and a cooperative
30-second transaction deadline bound operation; the deadline is checked between
awaited steps and does not promise immediate CPU or driver cancellation.

Retries use the same run and payload. A completed retry verifies the original
baseline and never recreates a deleted row or repairs later application writes.
An uncertain commit acknowledgement returns `OUTCOME_UNKNOWN`; the next attempt
inspects the same durable run instead of allocating new IDs. Header dates are
also checked at their exact SQL millisecond domain, so a driver cannot round away
a one-microsecond mutation. Responses contain bindings, counts and dates, never
the protected payload or database diagnostics.

Independent review supplied 63 catalog tests and reviewed all 48 service tests;
no actionable finding remained after the search-path fix. Actual PostgreSQL
15.17 through Loom 1.24.0 validates simultaneous importer calls, writer locks,
no partial read visibility, late transaction rollback, lost acknowledgements,
temporary-table shadowing, schema drift and fresh-process completed replay.
Fifteen initial checks plus an unchanged migration/reconnect check pass with
all 60 source fingerprints unchanged. The owned database is removed. Evidence:
`/tmp/magickli-import-service-postgres/result.json`, SHA-256
`1977a437bd3fd5415dbae59b1ffa0cf03785256c735541c456dfe80ca54d3963`.

The pinned 190-record production backup also passes the actual loader, durable
checkpoint and atomic import in a separate disposable local PostgreSQL database.
Complete 33-table reconciliation includes all 656 active study cards and crosses
the statement chunk boundary. Prepared/completed retries and a new process after
an unchanged migration rerun preserve every saved row without further allocation.
All source/backup fingerprints remain unchanged. Private payload/rows existed
only in the owned database, which was removed with absence verified; local
reports contain only aggregate evidence. File destinations are synthetic and IDs
disposable. Evidence:
`/tmp/magickli-import-service-corpus-postgres/result.json`, SHA-256
`3bb7fd44772a62f46f9910f4efe8e12e412e41f27974579c1a119fac4273ea4f`.

## Dedicated maintenance connection

`createLegacyImportConnection` now takes one captured direct Neon URL and an
exact host/port/database/role selection. It refuses pooled/multiple hosts,
ambiguous routing/startup options, duplicate query keys, raw whitespace,
fragments and missing credentials. Encoded identifiers and credentials retain
their exact values. The returned client is lazy and dedicated; constructing it
does not contact a database or approve the selected provider destination.

The constructor supplies all installed postgres.js routing/lifetime/default
options explicitly, uses one connection and forces certificate/hostname
verification. Ambient PG variables cannot change the selected credentials,
destination, TLS or debug behavior. Connection and close waits are bounded;
notices are suppressed. It never imports the environment-selected runtime
singleton. The maintenance caller still owns SQL error handling and closing the
client in finally without obscuring an earlier import outcome.

Installed postgres.js 3.4.9 implements SCRAM-SHA-256 but not channel binding's
PLUS mechanism. An explicit `channel_binding=require` is therefore refused with
`UNSUPPORTED_CHANNEL_BINDING`; the constructor never silently drops a requested
security property. Supporting such a URL requires a separately reviewed driver
change or explicit connection-policy decision.

All 95 independently written tests pass with complete module coverage, including
actual installed-driver option parsing under hostile ambient PG variables.
Native TLS tests reject an untrusted certificate and a trusted wrong hostname
before PostgreSQL startup, and accept a matching trusted certificate through a
synthetic local PostgreSQL protocol server. No actual Neon connection occurs.
Evidence: `/tmp/magickli-import-connection-tls/result.json`, SHA-256
`da274004ed5cea532661262cf9fabac7472f84e396419a4855013d181b6b40bc`.

## Next integration

The maintenance command must bind the actual selected direct connection to fresh
Neon project/branch/endpoint evidence and an independently approved matching
catalog. Database/role strings and caller-provided target hashes alone cannot
establish Neon branch identity. The service does not query the control plane or
authorize a supplied baseline. Operational write and DDL pauses remain necessary;
table locks do not promise immunity to arbitrary concurrent administrative DDL.

Final cutover still requires a fresh backup under the approved write pause and
the separately tested canonical-auth, SQL runtime, private offline and recovery
paths. No Neon import, provider write, runtime switch or deployment has occurred.

The installed Loom migration preflight and runtime URL selector have different
precedence; the latter also does not establish provider branch identity. Do not
validate one selected URL and then import the ordinary singleton against another.
The dedicated constructor above addresses transport selection only. The next
launcher gates remain refreshed endpoint/branch evidence and protected reviewed
artifacts. The current Neon API exposes the required read-only
[endpoint](https://api-docs.neon.tech/reference/getprojectendpoint),
[branch](https://api-docs.neon.tech/reference/getprojectbranch) and
[project](https://api-docs.neon.tech/reference/getproject) metadata calls; their
availability is not evidence that this task has authenticated access to them.

The subsequent [authenticated provisioning check](004-neon-provisioning.md)
establishes access through the operator's `magickli` Neon CLI profile and matches
the exact Vercel Production direct URL to fresh project/branch/endpoint metadata.
The real maintenance client authenticates with certificate/hostname verification,
and a read-only transaction confirms the expected empty foundation and exact two
migration records. This is live connection evidence, not a finished maintenance
launcher: refreshed checks on each invocation, protected reviewed artifacts and a
matching separately reviewed PostgreSQL 18 catalog remain necessary. Preview
branching/readiness settings and effective deployment overrides remain unverified.

The subsequent [disposable Neon 18 rehearsal](004-neon-provisioning.md) passes
all 14 migrations, synthetic durable import with complete SQL reconciliation,
uncertain first-commit acknowledgement, exact receipt timestamps and fresh-process
completed replay after an unchanged migration rerun. Its 75 source hashes are
unchanged, and the owned branch is removed. Main remains at the two original
migrations with no imported rows. The engine-specific catalog is captured as
review evidence; this does not finish the trusted launcher, final target role
policy, Preview isolation or production import.
