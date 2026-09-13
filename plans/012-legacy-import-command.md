# Reviewed legacy import command

`pnpm migration:legacy` now connects the verified backup loader, immutable local
checkpoint and atomic SQL importer. It is a maintenance command, separate from
runtime routes. The [checkpoint contract](011-legacy-import-checkpoint.md) covers
source accounting, serialization and SQL reconciliation.

## Operator inputs and actions

Run from the reviewed project root, using its installed dependencies and the
authoritative Loom environment loader:

```text
pnpm migration:legacy prepare \
  --review /absolute/private/review.json --review-sha256 <review-file-sha256> \
  --run /absolute/private/run.json \
  --neon-cli /absolute/neon --profile magickli
```

Use the same arguments with `inspect` or `apply`. The review is an independently
checked artifact, not a baseline automatically captured from the intended
destination. Its exact shape is exported as `LegacyImportCommandReview` in
`src/migration/legacyImportCommand.ts`. It names:

- The exact Neon project, branch, endpoint, actual parent, region, PostgreSQL
  major, direct host, database and role, plus the intended environment label.
- The fixed backup directory/database/manifest, import date and domain
  configuration, including approved source exceptions and provider locations.
- A separately reviewed matching catalog file and its byte digest, the complete
  migration manifest digest, and hashes for the implementation/schema/migration
  graph. All 74 required artifacts must be pinned; additional pins are permitted.

Review, catalog and checkpoint files must be regular, owner-private files; the
checkpoint directory must be owner-private too. Use a protected durable location
for an actual import. The checkpoint contains private data and is an import
artifact, not a log to print or commit. The local run uses the tagged import codec,
not plain JSON despite the example filename. Keep the exact reviewed source and
dependencies available for recovery. The lockfile is pinned; the command assumes
the installed dependency tree is trusted and does not hash every installed file.

The database URL is captured once from environment variables, in this order:
`MIGRATION_DATABASE_URL_UNPOOLED`, `MIGRATION_DATABASE_URL`,
`DATABASE_URL_UNPOOLED`, `DATABASE_URL`. A present empty or invalid override fails
instead of selecting a fallback. Never put a URL in command arguments. The
dedicated connection requires the reviewed direct Neon destination, verifies TLS
certificates/hostname and refuses unsupported channel-binding requirements.

`prepare` allocates all IDs and writes/fsyncs an immutable local checkpoint before
reserving its SQL record. Publication uses an exclusive hard link and directory
fsync; it never replaces or deletes the published run, including after a late
filesystem error. Subsequent `prepare`, `inspect` and `apply` use those exact saved
allocations without rereading BSON. `inspect` reports the SQL state; `apply`
commits the saved plan through the existing fenced transaction. Neither action
creates a missing local run.

The command checks source artifact hashes and fresh authenticated Neon metadata
before preparation and immediately before SQL. Provider calls are read-only,
use an explicit CLI profile and official API/OAuth hosts, and exclude inherited
CLI routing overrides and application secrets. SQL operations separately verify
actual database/role, complete migration history and catalog under locks.
The environment label and matching provider metadata do not establish Preview
isolation, writer pause or authorization for a production cutover.

## Recovery and limits

Successful command output contains only an aggregate receipt. Errors expose a
stable code without raw provider/SQL diagnostics. `OUTCOME_UNKNOWN` retains its
meaning: inspect/retry with the same reviewed run, rather than allocate a new
one. If only connection cleanup fails after an acknowledged result,
`CONNECTION_CLOSE_FAILED` includes that receipt. Filesystem errors after local
publication also require reusing the existing run.

This command does not provision resources, migrate schemas, approve a catalog,
pause writers, select configuration automatically or activate application
traffic. Completed retries reconcile the original baseline; they do not repair
later application changes. POSIX ownership, no-follow opens, bounded reads and
local fsync behavior are part of this maintenance tool's supported environment.
The whole saved run is limited to 64 MiB, including its envelope.

## Verification on 13 September 2026

All 101 independently authored command tests pass. They cover real private BSON
preparation and checkpoint files, artifact/provider drift, publication races,
file and directory fsync failures, recovery without source files, invalid private
files, safe errors and acknowledged results followed by cleanup failure. A
TypeScript-resolved import-graph test checks that local command dependencies are
included in the required artifact registry. Provider and SQL service calls are
mocked in these command tests; the Neon rehearsal below tests the actual path.

The full suite passes 3,860 tests with 14 opt-in Mongo cases skipped. All
85-module coverage gates pass: 98.23% statements, 97.13% branches, 99.83%
functions and 99.28% lines. Types, Biome and ordinary Loom check pass. Known Loom
advisories concern future pnpm migration and the still-pending production release
workflow. Five malformed real-entrypoint cases and help output also pass. No
route or bundling behavior changed; the preceding integrated build remains the
build evidence for this maintenance-only addition.

The full command ran against Neon PostgreSQL 18.6 with only invented data:

1. Create one owned temporary branch and apply all 14 unchanged migrations.
2. Pin the previously independently reviewed Neon catalog, exact target and 74
   required artifacts; run the actual `pnpm migration:legacy prepare` command.
3. Remove only the synthetic source backup. Run fresh-process prepare and inspect,
   then apply the same saved checkpoint successfully.
4. Rerun unchanged migrations and use fresh-process completed inspect/apply.
   Saved IDs, bindings, payload and expected rows remain identical throughout;
   the local run file remains byte-identical.
5. Verify all 77 frozen source fingerprints, main's unchanged catalog/original
   two migration records/empty alias table, and removal of the owned branch.

The branch was `br-autumn-glade-zahopc31`; its provider-reported initialization
was `parent-schema` after a `schema-only` request. This is not a claim of
independent-root ancestry or safe private Preview data. No private corpus,
runtime authentication or actual private R2 objects were exercised, and no
environment or deployment settings changed. Earlier service-level Neon evidence
separately covers lost commit acknowledgements and exact timestamp drift.

Final independent review found no remaining blocker. It decoded the saved
synthetic run and recomputed all 76 expected rows across 33 application tables,
all six CLI receipts and their source/target/schema/payload/configuration hashes.
It also verified the 77 source pins, unchanged main snapshots and recorded
owned-branch cleanup without making additional provider or SQL calls.

Evidence: `/tmp/magickli-import-command-neon/README.md`, aggregate result SHA-256
`d84029e2d450f4a773c5feedce2103af4f60f2551921f6c281b6c6a35659dbc3`,
`/tmp/magickli-import-command-full-coverage.log`,
`/tmp/magickli-import-command-types.log`,
`/tmp/magickli-import-command-loom.log` and
`/tmp/magickli-import-command-argv.json`.

Production still has only migrations 0000–0001 and no private import. Final
provider configuration, effective Preview isolation/readiness, private file
storage, runtime/authentication integration, browser acceptance and the paused
cutover remain pending. The reusable modernization skill remains a local draft.

## Study runtime receipt migration

Migration `0014_good_power_pack.sql` adds `study_review_receipts` for UUIDv7
review IDs, authenticated actor, canonical request hash and the accepted progress
version. It is additive and has not been applied to the live Neon database.
Legacy import creates no review events: the closed inventory now checks 34
application tables, including this deliberately empty table. Reconciliation
rejects an unexpected receipt instead of adopting runtime writes into the import.
The command's required artifact list includes migration 0014 and its snapshot,
so older reviews/checkpoints cannot silently authorize the changed schema.

The scoped command/catalog/reconciliation/import suite passes 313 tests. Two
named-pipe fixture tests required running the command suite outside the filesystem
sandbox; all 101 command tests then passed. The other 212 scoped tests passed in
the initial run. Isolated typechecking and targeted Biome pass. Evidence:
`/tmp/magickli-study-import-boundary-tests.log`,
`/tmp/magickli-study-import-command-tests.log`,
`/tmp/magickli-study-import-types.log` and
`/tmp/magickli-study-import-boundary-biome.log`. Live migration, runtime review
acceptance and final cutover are separate steps.

## Final command rehearsal with the current schema

The 16-migration set, including migration 0015, now passes the real maintenance
command on a disposable London Neon branch. The command checks all 34 application
tables against the approved 35-table catalog. The synthetic fixture retains 76
expected rows; runtime-only tables remain deliberately empty.

After `prepare`, the runner removes only its invented source backup. A fresh
`prepare` and `inspect` return the identical prepared receipt; `apply` completes
from the immutable saved plan. An unchanged migration rerun and fresh completed
`inspect`/`apply` preserve the exact completed receipt. The saved plan SHA-256
remains `37ff6f2e565f3964739ba0f9cd741bc8cfa782db4afd4017a492be0e97d15f10`.
The launcher holds and rechecks all 81 source fingerprints throughout the run.

Independent review verifies receipt equality, source and saved-plan hashes,
owned-branch absence and the unchanged main catalog/journal/empty aliases.
See [the provisioning evidence](004-neon-provisioning.md#final-16-migration-synthetic-rehearsal).
This proves the current command and schema with synthetic data. Effective
Preview isolation, real application journeys, the final writer pause, a fresh
consistent production snapshot and production import remain separate gates.
