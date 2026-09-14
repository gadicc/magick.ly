# London database provisioning

Provisioned on 12 September 2026 after the operator approved London/London.
The live application still uses Mongo. This record contains no credentials.

## Verified resource

| Setting | Observed value |
| --- | --- |
| Vercel project / team | `magickly` / `wastelands` |
| Resource name | `magickli-db` |
| Vercel resource ID | `store_rjlna7Me15XXCA25` |
| Neon project ID | `red-fire-54607378` |
| Region | Marketplace `lhr1`; direct endpoint in `eu-west-2` |
| Plan | Existing installation's Free `free_v3`, unchanged |
| PostgreSQL | `18.6 (2078fcb)` |
| Environments | Production and Preview; no Development DB variables |
| Neon-managed Auth | Disabled |
| Installed application extension | `pg_uuidv7` 1.6 |
| Available future vector extension | `vector` 0.8.6, not installed |

Command used, through the existing authenticated Vercel integration:

```sh
pnpm exec loom db neon setup --name magickli-db --region lhr1
```

The plan flag was omitted to preserve the existing Free installation, whose
billing scope includes other team resources. No other database was moved or
modified. Loom recorded the connection in `loom.json`.

`loom db neon check` passed all six checks. A read-only SQL probe verified the
direct London endpoint, PostgreSQL version, extension availability and initially
empty public schema. The protected connection was held only in process memory;
no database credentials were pulled into local env files or written to this
record.

`loom db migrations verify-env --connect` authenticated the new database's
existing `neondb_owner` role and checked schema privileges. The authoritative
`pnpm db:migrate` task applied migrations 0000 and 0001. A second run left exactly
two journal entries. A synthetic alias insert verified UUIDv7 defaults and was
rolled back; the alias table contains zero rows. No users, rituals, sessions,
study records, files or vector data have been imported.

Vercel CLI 59.13.1 automatically installed two provider skills during setup,
despite `--no-env-pull`. These incidental additions were reviewed and moved to
`/tmp/magickli-vercel-auto-skills-20260912`; the application's reviewed Loom
skill setup remains authoritative.

## Gates before cutover

- Vercel still reports compute region `cdg1`, dashboard Node `22.x`, and
  production branch `master`. Configure `lhr1` and reconcile Node 24 during the
  release work; provisioning did not change them.
- Loom 1.24.0 now supports the configured `master` branch. Wire and verify the
  migration workflow and deployment fencing against the actual Vercel settings;
  the production Loom check remains a release gate.
- Verify native Preview branching and resource readiness blocking. Merely
  connecting Preview-scoped variables does not prove database isolation.
- Use a sanitized or schema-only preview dataset before importing private
  production data. Previews currently also receive the legacy `MONGO_URL`;
  isolate that and all remaining external writes before preview deployment.
- Establish the final application and migration role boundaries, protected
  migration credential and backup/retention policy before production traffic.
- Complete domain/auth schemas, deterministic import/reconciliation, offline
  acceptance and the approved final write-pause snapshot before cutover.

Pinecone remains authoritative. `vector` availability keeps a later migration
possible without enabling it as part of this foundation.

Provider references: [Neon regions](https://neon.com/docs/introduction/regions),
[Vercel native integration](https://neon.com/docs/guides/vercel-native-integration),
[extension matrix](https://neon.com/docs/extensions/pg-extensions).

## Authenticated identity check, 13 September 2026

The operator completed browser authentication with official Neon CLI 4.17.3,
installed in the existing user-owned Node 25 prefix. Profile `magickli` has
owner-only credential/profile files under `~/.config/neon`. No manually created
API key, app environment file, Neon link/init operation or onboarding feature
was needed. Use `neon ... --profile magickli` for this existing login; it is not
the default profile. Account OAuth permissions are broader than the read-only
operations performed here.

Fresh authenticated Neon metadata identifies:

| Setting | Observed value |
| --- | --- |
| Neon organization | `org-shiny-haze-86859918` |
| Project | `red-fire-54607378`, `magickli-db` |
| Region / engine | `aws-eu-west-2`, PostgreSQL 18 |
| Only branch | `br-empty-rice-zafjq6hv`, `main`, ready/default, not protected |
| Only endpoint | `ep-cold-waterfall-zagugviy`, read/write, enabled |
| Direct hostname | `ep-cold-waterfall-zagugviy.c-2.eu-west-2.aws.neon.tech` |
| Database / role | `neondb` / `neondb_owner` |
| Vercel connection | `spc_0nuxJnHVTNY0bJXS`, Production and Preview |

Vercel's standard environment-pull API returns usable URLs through the existing
authenticated CLI. Ordinary environment/resource metadata omits their values.
The Production direct URL was captured once in process memory, matched against
Neon's authenticated endpoint, and passed to the actual certificate-validating
maintenance client. Fresh control-plane reads before and after SQL confirmed the
same project, branch and endpoint. The SQL transaction was read-only and verified
PostgreSQL `18.6 (2078fcb)`, exact current/session role, schema USAGE/CREATE,
both original migration hashes/timestamps, only the empty `legacy_id_aliases`
application table, and `pg_uuidv7` 1.6. Connecting woke the idle compute; no schema,
row, role, environment or deployment configuration changed.

Credential-free evidence: `/tmp/magickli-neon-identity/result.json`, SHA-256
`1c1be3f778131ffb604c7fbc35e03239afe328ce2c34a97537553a42b1999f26`.

The current Production and Preview **base** URLs both select this main endpoint.
That does not establish the destination of a Preview deployment: the native
integration can inject branch-specific overrides only at deployment time. Store,
connection, project, installation and product metadata do not expose the saved
branching/readiness action settings. Independent read-only investigation could
not access a working dashboard browser. Required → Preview and Resource must be
active before deployment therefore remain unverified; neither the existing
ready status nor the base variables prove those gates. Evidence:
`/tmp/magickli-preview-settings/report.json`, SHA-256
`233a12337acc012147814727405ebe145aa5c93a3c68f89c4658a1b49260eed0`.

The [current native-integration documentation](https://neon.com/docs/guides/vercel-managed-integration)
describes these deployment overrides and copy-on-write branches. Even correctly
isolated branches can inherit private parent data. Establish schema-only or
sanitized Preview ancestry before the production import, and verify the effective
deployment connection. A plain environment pull cannot prove that final mapping.

## Disposable Neon 18 rehearsal, 13 September 2026

The reviewed launcher created one temporary branch in the same approved London
project, requested `init_source: schema-only` and fixed 0.25 CU, and left the
Vercel connection and plan unchanged. Neon reported `init_source: parent-schema`;
the SQL verifier independently proved the inherited alias table and Drizzle
journal contained no rows. The result does not establish independent-root
ancestry or any future Preview branch policy.

On that owned branch only, the verifier removed the empty inherited foundation,
then the unchanged Loom-aware `pnpm db:migrate` task applied all 14 migrations.
The actual maintenance connection verified certificates and hostnames. Invented
fixtures passed durable preparation, atomic import, complete 33-table SQL
reconciliation and completed retry. A deliberately lost acknowledgement after
the first real import commit resolved against the saved receipt and rows. A
one-microsecond receipt mutation was refused and rolled back. An unchanged
migration rerun and a fresh process replayed the saved run without importing
fixtures or allocating new IDs.

All 75 copied source/artifact fingerprints remained unchanged. Read-only probes
before and after verified the same main public catalog, original two migration
records and zero aliases. The temporary branch `br-misty-math-zax90ooz` was
removed, with absence checked. No private backup data entered Neon, and no
production migration, app activation or deployment occurred.

Evidence: `/tmp/magickli-neon-rehearsal-fixed/result.json`, SHA-256
`7836553959e000ec4a5f20bd90cb7ab2e422625c6b8b6d847f0fd50c636b7208`.
The captured PostgreSQL 18 catalog has identity
`47b66502b42f7fe8b9794283bc34da5977f278d5ddbf9bca66f23cb5444b7724`;
its JSON file SHA-256 is
`7b7629695640a95fcf5016770f8968594261854bc1c88c70549e28aa7b5c411c`.
This is a rehearsal baseline; final target permissions, catalog approval and
fresh control-plane checks still belong to the trusted maintenance launcher.

Independent review recomputed the catalog/history identities and matched the
actual schema to final Drizzle snapshot 0013. All 34 tables, 303 table columns,
explicit constraints/indexes and enum labels match; all actual indexes and
constraints are valid. A separate authenticated listing confirms only main
remains. No actionable finding remains in the evidence or checkpoint docs.
Review: `/tmp/magickli-neon-rehearsal-fixed/independent-review.md`.

The first attempt and two diagnostic attempts stopped locally: Neon CLI 4.17.3
rejects its advertised `--data -` syntax as `Unknown command: -` before any
request. Full-entrypoint reproduction with synthetic credentials and network
blocked verifies `--data=-` on Node 24 and 25, preserving the exact JSON body.
No provider plan or permission rejection was established. The original failed
records remain under `/tmp/magickli-neon-rehearsal`; CLI evidence is
`/tmp/magickli-neon-cli-stdin-probe/final-report.json`, SHA-256
`770f1f0dad3accf179f93c6c14939bc9657ce11b2b4d24443e39e2235adf211b`.

## Final 16-migration synthetic rehearsal

The current migration set (0000–0015) passed on a fresh schema-only London
branch using the actual `pnpm migration:legacy` command. Its approved catalog
contains all 35 ordinary tables: 34 application import tables and the protected
import-run table. Preparation, inspection and application work across fresh
processes after removal of the synthetic source backup. Completed inspection,
completed application retry and an unchanged migration rerun preserve the same
saved identities, rows and receipts.

All 81 reviewed source fingerprints stayed unchanged. The branch
`br-withered-cloud-za1valmp` was removed. A separate authenticated check confirmed
only the original main branch remains; a separate read-only SQL probe matched
the before/after main catalog, original two migration records and zero aliases.
No production schema change or private import occurred.

Evidence: `/tmp/magickli-neon-rehearsal-final-2/result.json`, SHA-256
`c7c846685de7302350ec194f8eeb49b06abc9ca2a06b233b7a1e066593e3c268`,
and `independent-verification.json` in the same directory. The final rehearsal
catalog identity is
`cd9d2a2b34abf69ee01f541ca722a5d8948adbe7b0aa2766fdc6b91ba16972ba`.
The preceding run stopped before application when a concurrent tooling edit
changed its reviewed fingerprint. Its branch was also removed and its failure
artifacts remain intact under `/tmp/magickli-neon-rehearsal-final`.

## Preview configuration confirmed, 14 September 2026

The operator saved deployment readiness enabled and branch deployment enabled for
Preview only on the existing `magickly` connection. The Vercel add-connection
dialog had correctly refused a duplicate connection. A fresh authenticated API
read confirms `deployments.required: true` and the `Neon` action scoped to
`preview` only on the same connection. That settings read alone did not prove
provisioning order or the runtime's connection. The canary below later verified
the runtime override; readiness ordering for the full application build remains
part of Preview acceptance. Sanitized Preview ancestry remains a gate before
importing private production data.

Saving also enabled Sensitive for the database connection, confirmed by fresh
metadata for both database URLs. A verified protected GitHub
`MIGRATION_DATABASE_URL_UNPOOLED` secret is therefore required before release;
retrieve it through authenticated Neon access. The external release build cannot
obtain Sensitive values with `vercel pull`; see the current transition record in
[the completion decisions](022-release-and-storage-completion.md).

The subsequent native Preview probe passed both runtime database identity checks
in London. Its new branch reported `init_source: parent-data` from main; a durable
sanitized Preview source remains necessary before the private import. Removing
the exact temporary deployment also automatically removed its branch and
endpoint, with production unchanged. The GitHub migration secret and an isolated
placeholder/artifact build check are now verified as recorded in the completion
decisions. Full application and release acceptance remain outstanding.
