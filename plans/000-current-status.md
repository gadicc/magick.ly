# Modernization status

Updated 14 September 2026. This is the current status; the implementation ledger
retains historical checkpoints and their original limitations.

| Area | Completed and verified | Remaining |
| --- | --- | --- |
| Tooling and framework | pnpm, Biome, Vitest, App Router, current React/MUI, Loom 1.25.0; final integrated tests, coverage, types, Biome and production build pass | Deployed acceptance |
| Database and import | UUIDv7 schemas, all 16 migrations, protected resumable import and reconciliation; exact command restart/retry rehearsal passes on disposable Neon | Final consistent production snapshot/import |
| Authentication | Better Auth runtime, fresh SQL identity, import readiness gate, coordinated sign-out; committed `22ef750` | Real OAuth and deployed acceptance; one-time user reauthentication at cutover |
| Administration and integrations | SQL temple/group administration and Discourse mapping; Pinecone remains authoritative | Deployed acceptance and retirement of unused credentials after checking scope |
| Study | Durable account/anonymous projections and idempotent SQL receipts; cached identity cannot assign ownership | Integrated browser acceptance against the final runtime |
| Private offline reading | Fourteen-day leases, source/draft locks, sign-out purge, image dependency handling, offline discovery | Full deployed/offline journey with published bundles |
| Files and publication | Private scoped upload/read services; legacy public URLs preserved; durable publication and bounded admin backfill committed `965c49d` | Approved bucket-scoped application credentials, environment setup, verified legacy-object relocation and real upload/publication acceptance |
| Ritual editing | JRT/source editor integration `584e9c6`; ordinary-editor renewal of definitively expired attempts `e9b66ff`, retaining old evidence and exact retries | Browser/deployed acceptance against real publication storage |
| Legacy retirement | Old polling endpoint fenced; browser recovery retained; replaced auth/editors/upload helpers and unused dependencies retired in `ba1a487`; operator confirms Mongo user is dedicated to Magickly | Apply and verify the approved write pause at cutover; retire old credentials/storage after verification |
| Release | Reviewed staged workflow committed `6d7741d`; 24 release tests, 25 shell syntax checks, synthetic environment-policy rehearsal; exact production Trusted Sources rule applied and verified | Approved shared Loom release improvements and GitHub setup, effective Preview isolation, verified writer pause, staged acceptance and production promotion |
| Reusable Loom skill | Generic draft and references under `.loom/drafts/modernize-app`; validator passes | Final lessons and independent evaluation; save into Loom only after modernization finishes |

Production has not switched. The main Neon branch still has only migrations
0000–0001 and no private import. The two new R2 buckets are private; their
creation and Cloudflare OAuth login do not establish application object access.
London/London is the approved destination.

The operator approved the production-only GitHub OIDC Trusted Sources rule,
GitHub Production release configuration, separate private R2 credentials, and
legacy file relocation/retirement preparation. The exact Trusted Sources rule
was applied and verified on 14 September; the other provider changes remain
pending. Shared Loom improvements will add safer credential setup and reusable
Trusted Sources commands before adopting the new release. Saved Preview
branching/readiness settings and the deployment's effective database destination
still need evidence. See [the completion decisions](022-release-and-storage-completion.md).

The integrated candidate passes 4,238 tests (14 opt-in Mongo tests skipped), with
157 passing test files. All existing per-module coverage gates pass; the selected
instrumented modules have 97.97% statement, 96.47% branch, 99.60% function and
99.04% line coverage. This is not whole-application or browser-journey coverage.
Production build, TypeScript and Biome pass; Loom's production check passes with
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
