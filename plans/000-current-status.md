# Modernization status

Updated 14 September 2026. This is the current status; the implementation ledger
retains historical checkpoints and their original limitations.

| Area | Completed and verified | Remaining |
| --- | --- | --- |
| Tooling and framework | pnpm, Biome, Vitest, App Router, current React/MUI, Loom 1.26.0; final integrated tests, coverage, types, Biome and production build pass | Deployed acceptance |
| Database and import | UUIDv7 schemas, 17 migrations rehearsed on Neon, protected resumable import and reconciliation; separate empty Preview root migrated through 0016, including the relocation schema | Final consistent production snapshot/import |
| Authentication | Better Auth runtime, fresh SQL identity, import readiness gate, coordinated sign-out; committed `22ef750` | Real OAuth and deployed acceptance; one-time user reauthentication at cutover |
| Administration and integrations | SQL temple/group administration and Discourse mapping; Pinecone remains authoritative | Deployed acceptance and retirement of unused credentials after checking scope |
| Study | Durable account/anonymous projections and idempotent SQL receipts; cached identity cannot assign ownership | Integrated browser acceptance against the final runtime |
| Private offline reading | Fourteen-day leases, source/draft locks, sign-out purge, image dependency handling, offline discovery | Full deployed/offline journey with published bundles |
| Files and publication | Private scoped upload/read services; legacy public URLs preserved; durable publication/backfill; separate R2 credentials installed; ten legacy objects copied and verified, with readers supporting verified relocation | Final source reconciliation and SQL mapping activation; real upload/publication acceptance |
| Ritual editing | JRT/source editor integration `584e9c6`; ordinary-editor renewal of definitively expired attempts `e9b66ff`, retaining old evidence and exact retries | Browser/deployed acceptance against real publication storage |
| Legacy retirement | Old polling endpoint fenced; browser recovery retained; replaced auth/editors/upload helpers and unused dependencies retired in `ba1a487`; operator confirms Mongo user is dedicated to Magickly | Apply and verify the approved write pause at cutover; retire old credentials/storage after verification |
| Release | Reviewed staged workflow committed `6d7741d`; exact production Trusted Sources rule and protected GitHub project credential applied; isolated Preview database connection, native branch probe and cleanup verified | Full application Preview journeys, verified writer pause, staged acceptance and production promotion |
| Reusable Loom skill | Generic draft and references under `.loom/drafts/modernize-app`; validator passes | Final lessons and independent evaluation; save into Loom only after modernization finishes |

Production has not switched. The main Neon branch still has only migrations
0000–0001 and no private import. The two new R2 buckets are private. Separate
application credentials passed own-bucket PUT/GET and cross-bucket read-denial
checks; all synthetic objects were removed. Matching Vercel settings are verified.
London/London is the approved destination.

The operator approved the production-only GitHub OIDC Trusted Sources rule,
GitHub Production release configuration, separate private R2 credentials, and
legacy file relocation/retirement preparation. The exact Trusted Sources rule
and R2 settings were applied and verified on 14 September. GitHub Production
now permits only `master` and has a verified project-scoped deployment token
expiring 13 December. Shared credential/trust improvements shipped in Loom 1.26.0;
Magickly pins that release. Full deployment acceptance remains pending. The
original `magickli-db` resource is now Production-only, and the distinct London
`magickli-preview-db` resource is connected only to Preview with Sensitive
variables and the required Neon Preview action. An isolated native deployment
created a child of the sanitized Preview root. Its runtime-reported pooled and
direct host/database hashes matched that exact child, while separate read-only
SQL checks found 17 migrations, 36 application tables and zero rows on both the
child and root. Production remained at two migrations and zero aliases. The
temporary deployment, child branch and endpoint were then confirmed absent;
both roots and the live Production deployment remained unchanged.

The full app Preview environment has since been configured and an isolated
child imported with invented fixtures. Prepare, apply, reconciliation and an
identical retry pass; the sanitized root remains empty and Production retains
its original two migrations. The native full-app build from `918eb883` passed
compilation, TypeScript and output generation. Its deployment and same-source
retry failed Vercel's post-build `patchBuild` step with `patch_build_4xx` and an
internal-error reason.
No Preview alias was assigned. Packaging diagnosis must finish before deployed
OAuth, upload and offline acceptance; this is not a successful app deployment.

The hash-only runtime route proves Vercel injected the intended Preview hosts and
database name. It did not authenticate to PostgreSQL from the deployed runtime,
so actual application credential acceptance still belongs to full Preview
acceptance. The operator also rotated the Production database password and the
protected GitHub migration secret has been refreshed through Loom. Both database
URLs are Sensitive, so the readable migration fallback is no longer available.
GitHub Production now contains the verified direct
`MIGRATION_DATABASE_URL_UNPOOLED` secret and its expected-role metadata, installed
through Loom from authenticated Neon access. It uses the existing database owner
transitionally; a separate role needs a reviewed ownership/grants migration.
The isolated Vercel build with Loom-generated database placeholders passes its
artifact leakage check. The complete GitHub release still needs acceptance. See
[the completion decisions](022-release-and-storage-completion.md).

After the relocation unit and Loom 1.26.0 adoption, the integrated candidate
passes 4,255 tests (14 opt-in Mongo tests skipped), with 158 passing test files.
Its production build, TypeScript and Biome pass in an isolated copy using
synthetic build-only configuration. The earlier 4,238-test coverage run passed
all existing per-module gates; its selected instrumented modules had 97.97% statement, 96.47% branch, 99.60% function and
99.04% line coverage. This is not whole-application or browser-journey coverage.
The [final live rehearsal](023-final-migration-rehearsal.md) also passes all
17 migrations and source-free import/retry checks; its disposable branch was
deleted and the main branch remained unchanged. Loom's local production check passes with
pnpm-11 migration advice while this app remains pinned to pnpm 10.

Current production is still deployment `dpl_9m7ojZk6FZMJoCKsELDe53qiQkRp`,
commit `f51a84dd1a7177cfb54c20372f0f89a614651a74`. Read-only inspection confirms
its Mongo credential has `readWriteAnyDatabase` on a replica set. The operator
confirmed on 14 September that this user is dedicated to Magickly and approved
stopping writes at the appropriate final backup/import time. No credential or
role has been changed. The
[cutover writer review](020-cutover-writers.md) records the required scope check.

Earlier Sol agents reached the account usage limit; root completed that local
verification and its commits. Sol implementation delegation has resumed for the
new release and relocation work. No reset credit was consumed. The generic skill remains an ignored,
validated draft until the full modernization, including production cutover,
actually finishes.

WYSIWYG editing and realtime collaboration remain deferred. The current migration
preserves the source editor and JRT rather than changing document format during
the storage/authentication cutover.
