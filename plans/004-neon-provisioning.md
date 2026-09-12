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
- Fix Loom's hard-coded `main` assumptions, then wire and verify the migration
  workflow and deployment fencing for `master`. The production Loom check
  remains a release gate.
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
