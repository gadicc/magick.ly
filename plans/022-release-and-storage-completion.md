# Release and legacy storage completion decisions

The operator completed the current approval questions on 14 September 2026.
Resume implementation and reviewed isolated commits; avoid repeat confirmation
for these already authorized steps.

## Release configuration

- The exact production-only GitHub OIDC Trusted Sources rule is approved and
  applied. It binds canonical repository `gadicc/magick.ly`, immutable repository
  ID `271738405`, branch `master`, GitHub environment `Production`, and workflow
  `.github/workflows/release.yml`. Vercel returned the exact reviewed state.
- GitHub Production setup is approved, including a Vercel deployment credential.
  Prefer a project-scoped credential after verifying current provider support
  and the actual release commands. Team scope was also explicitly approved as
  the previously proposed path, but must not be a silent fallback.
- Implement shared Loom improvements: explicit scope/expiry and rotation,
  preservation of existing credentials on rerun, safe partial-failure handling,
  branch-policy verification, and shared Trusted Sources planning/checks.
  These shipped in Loom 1.26.0 from commit
  `53d38019c2102bcc40d4eb9ab77b7c562f7c1404`; GitHub publication succeeded.
  Independent review found and closed a target-binding defect: the approved
  digest now covers the complete destination, expected state and patch.
- Validate through Magickly first. Other consumers adopt through their own
  reviewed workflows and dependency changes.

GitHub's `Production` environment now has exactly one custom deployment policy:
branch `master`. The published Loom CLI created a project-scoped deployment token,
verified access to Magickly and denial of team-level access, and installed it as
`VERCEL_TOKEN`. Non-secret token metadata records expiry
`2026-12-13T10:06:28.427Z`. A complete deployment workflow still needs acceptance;
these credential checks alone do not prove every release command works.
An identical setup rerun preserved the same token and expiry. At that checkpoint,
the network check found the GitHub release variables/secret and advised that a
dedicated migration secret was not installed; the then-readable Vercel direct URL
provided the supported fallback. The later Sensitive change below removes that
fallback. The overall network check is not yet green: the app has not
recorded the final R2 provider policy in `loom.json`. Its exact Preview upload
origin and CORS still need to be settled with the Preview deployment.

The published trust planner/checker also verified the existing provider rule
without changing it. Its complete-proposal approval digest is
`e62bd6b1c6e77b2ad653460f3ad273b4fc15bc1114c82b4a40340a90194006f0`.
The proposal is `/tmp/magickli-loom-1.26-trust.json`. Earlier patch-only
fingerprints below describe the original provider operation, not this stronger
approval envelope.

Trusted Sources grants HTTP access through Deployment Protection. Deployment API
credentials remain a separate permission. Applying the trust rule did not
deploy Magickly, run migrations or pause writes.

The applied state SHA-256 is
`52126d15dbe25d2df4497832165c239bdcbbbab902059aaba40f6ae7af6cd763`.
The exact patch file SHA-256 is
`17c9822730efe13d2b7369ae74d3745be39ea9981b00cad943edf9bc793cb782`.
Credential-free review and guarded runner are under
`/tmp/magickli-trusted-sources-*`; the decision ledger is
`/tmp/magickli-modernization-approval-decisions.json`.

## Existing files and consolidation

Fresh read-only Vercel Production inspection confirms that existing uploads use
Cloudflare R2 bucket `magickly` via `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`. Despite their AWS names, these are the existing R2
application credentials. Original object bytes remain there; Mongo contains the
file metadata. Earlier direct-provider and public-route checks verified all ten
inventoried files, 7,790,234 bytes, against the backup sizes and SHA-256 hashes.
No original objects were moved or deleted.

On 14 September, a fresh complete source listing contained exactly those ten
objects and no extras. The reviewed runner copied all ten to
`magickli-files-production/legacy-file2/<sha256>` using conditional writes,
then verified destination sizes, actual SHA-256 hashes and historical Mongo
MIME types. Source inventory and all backup fingerprints remained unchanged.
This is a preliminary copy while the legacy site remains live: repeat final
reconciliation after fencing writers and verify destination bytes after import
before inserting SQL relocation evidence. No SQL mappings have been activated.
The exact reviewed copy-plan digest is
`b562af14b75892fcdd94f7412c64fcc63a5df359110f3a0b8b048a05cd1a3ccd`;
the completed report is
`/tmp/magickli-legacy-file-relocation/copy-17586a29-956c-4ac3-947d-d51196e009d4.json`.
The same-plan rerun verified all ten destinations again and reused every object
with zero PUT attempts; its report is
`/tmp/magickli-legacy-file-relocation/copy-fb3d8501-26ab-4e38-8b24-444251c776ac.json`.

The operator approved separate Object Read & Write credentials for
`magickli-files-production` and `magickli-files-preview`, each restricted to its
own bucket and corresponding Vercel environment. The operator supplied them
through the hidden-input helper. Both passed direct object PUT/GET and SHA-256
verification; each was denied access to the other's existing test object with
HTTP 403. All disposable test objects were removed.

Four credential variables are installed as Vercel Sensitive values, alongside
ten non-secret settings, only in their matching Production/Preview environments.
Development and the old AWS-named variables remain unchanged. Metadata and
non-secret values were read back and verified. These checks establish the
tested object permissions, not an exhaustive audit of token privileges.
Reports are under `/tmp/magickli-r2-setup-proposal/`, including
`vercel-storage-configuration.json`. The mode-0600 credential handoff file is
temporarily retained for the approved legacy copy and storage acceptance, then
must be deleted; Vercel does not return Sensitive values after installation.

The approved end state is one production bucket, one preview bucket, unchanged
legacy public URLs, and no runtime dependency on the old storage credentials:

1. Inventory the complete old bucket and all consumers. Reconcile later uploads
   and extra objects; fence old upload writers before final reconciliation.
2. Copy legacy files into a dedicated prefix in the new production bucket with
   resumable, conditional writes and verified destination size/SHA-256.
3. Retain original import evidence and record verified destination mappings.
   Switch both the legacy public reader and ritual publication image catalog;
   future publications and offline images must also work without old storage.
4. Preserve legacy filenames, MIME types (including SVG), and the exact public
   `/api/file2?sha256=...` URLs. Only the imported legacy-public whitelist may be
   served publicly; the destination bucket stays private.
5. Following deployment acceptance and a rollback window, remove old app storage
   variables and revoke old credentials after checking their full scope and any
   other consumers. The Mongo ownership answer does not establish R2 ownership.
6. Review final bucket inventory and backup evidence before destructive deletion.
   The final deletion operation has not yet been presented or executed.

Relocation is an additional implementation milestone. Both readers need the
verified mapping before switching, and the live legacy deployment still reads
the original bucket. Copying bytes alone does not activate the new runtime.

Migration `0016_volatile_moondragon` adds the application-owned relocation table.
Public reads and ritual publication join its evidence to the original snapshot;
missing evidence retains the source, while mismatched evidence fails closed.
Canonical Files credentials can serve all relocated objects without the old
variables. The import command includes the new migration and requires this table
to be empty during import; final import reconciliation precedes mapping activation.
The foundation passes 453 focused tests, TypeScript, generated-schema refresh,
Biome and Loom checks. The refreshed live Neon rehearsal now covers 0000–0016 with Loom 1.26.0,
including durable source-free import/retry and verified owned-branch cleanup.
See [the final rehearsal evidence](023-final-migration-rehearsal.md).

## Write pause and outstanding operational evidence

The operator confirmed that the live MongoDB user is dedicated to Magickly and
approved a short write pause at the appropriate time. Prepare and verify a narrow
reversible fence before the final consistent backup, import and reconciliation.
Historic deployments and in-flight external writes must be covered; see
[the writer review](020-cutover-writers.md).

The database resources now have separate, verified project connections. Original
store `store_rjlna7Me15XXCA25` uses connection `spc_XDFrBMjdzJtxpNow` for
Production only, with Sensitive variables and no deployment action. Preview store
`store_mtqKLpJtiM70K3hX` uses connection `spc_TrPb70tlUSASUwi4` for Preview only,
with Sensitive variables and the required `Neon` action scoped to Preview. No
Development database connection exists. Credential-free before/after evidence is
in `/tmp/magickli-isolated-preview-probe-run/{baseline,cleanup-verification}.json`.

Sensitive database URLs are not readable through `vercel pull` or
`vercel env run`. The workflow preserves the untouched Vercel pull snapshot, supplies
build-only placeholders for unreadable Sensitive values, rejects placeholder
leakage, and binds `MIGRATION_DATABASE_URL_UNPOOLED` only to verification and
migrations. Independent review confirms the Loom support and unit coverage;
the complete GitHub/Vercel Sensitive-database flow still needs live acceptance.

The protected migration credential was subsequently installed through Loom 1.26.0
at `2026-09-14T11:18:14Z`. A guarded read-only preflight used authenticated Neon
profile `magickli`, bound the exact London main branch/endpoint/database/role,
verified the unchanged two-entry migration journal and empty alias table, and
passed `loom db migrations verify-env --connect`. The reviewed proposal also
bound GitHub's canonical repository and immutable ID, its existing `Production`
environment and sole `master` branch policy, the source graph, and the setup
script hashes. Review caught and corrected implicit GitHub target selection.
A stopped first preflight exposed an unsupported `gh repo view` field; the
corrected runner uses REST repository metadata. The failed preflight changed no
provider state.

Loom sent the credential through stdin to GitHub and recorded
`LOOM_MIGRATION_DATABASE_ROLE=neondb_owner`. The post-write check confirmed the
secret name, exact role metadata and unchanged branch policy; an independent
GitHub metadata read confirmed the secret and installation timestamp. This uses
the existing owner as an explicit transition, without Neon password, role, grant,
ownership or schema changes. A separate least-privilege role needs a deliberate
ownership/default-grants migration and runtime/importer verification.

Evidence is `/tmp/magickli-migration-credential-setup/{plan,result}.json`;
`github-secret-metadata.json` in the same directory retains the independently
read secret names and timestamps without values. The
complete reviewed proposal digest is
`20ef8f2f03c0e78f557566585a8ec31fb567a01e36ad1207be4b206e597712d6`.
No credential value was printed or saved locally. GitHub does not expose its
stored secret for read-back: live credential verification preceded installation,
while a complete Actions run still must prove the stored-secret, generated
placeholder, build/artifact, migration and staged-runtime path.

A subsequent isolated build closes the local placeholder/artifact check. The
unchanged application source from `994d476` used Loom's actual preparation command
with a synthetic metadata fixture matching the two newly Sensitive database
variables. It generated exactly two unique PostgreSQL placeholders; Vercel
59.13.1 built the production artifact with Node 24.19.0 and pnpm 10.18.0, and
Loom's artifact scan found neither marker. All 776 archived source files remained
unchanged. Evidence is
`/tmp/magickli-sensitive-placeholder-build/evidence/{source-binding,result}.json`.
This used synthetic values, offline Vercel settings and the already verified
dependencies; it did not query providers, deploy or exercise the GitHub secret.
An initial Next/TypeScript child-process failure was specific to the restricted
local sandbox; the unchanged build passed outside it. No application workaround
was needed.

An earlier inert probe against the original resource established why isolation
was required: native Preview branches inherit their root's data. Its disposable
deployment, branch and endpoint were removed before the separate Preview resource
was connected.

The free London resource `magickli-preview-db`, store
`store_mtqKLpJtiM70K3hX`, owns distinct PostgreSQL 18 project
`small-wave-96978226`. Neon Auth is disabled, and root branch
`br-polished-morning-zazqd31j` has no parent. The reviewed migration runner
applied all 17 migrations; the root has 36 public application tables and zero
application rows. Production retained its two-entry journal and zero legacy
aliases. Creation and migration evidence remains under
`/tmp/magickli-preview-ancestry-run/` and
`/tmp/magickli-preview-base-migration/`.

The original resource is now Production-only. After its `neondb_owner` password
was reset, Vercel replaced the project connection with
`spc_XDFrBMjdzJtxpNow` and synchronized its Sensitive Production variables while
leaving the store, Neon project and live legacy deployment unchanged. The
refreshed credential passed the exact-target read-only check, and Loom refreshed
GitHub Production's protected `MIGRATION_DATABASE_URL_UNPOOLED` without exposing
the value. Evidence is under `/tmp/magickli-production-only-verification/`,
`/tmp/magickli-neon-rotation-verification/`, and
`/tmp/magickli-migration-secret-refresh/`. The live legacy deployment does not
use Neon and must not be redeployed merely because this credential changed.

The Preview resource is connected to exact project `magickly` through
`spc_TrPb70tlUSASUwi4`, scoped only to Preview, with unprefixed Sensitive
variables and the required `Neon` action scoped only to Preview. A bound inert
deployment from commit `4acbcf157e851c3d40c8d94a8b97632751e599d9`
reached `READY` in `lhr1`; the integration created child branch
`br-mute-sky-zasb4heu` from the sanitized root and endpoint
`ep-curly-moon-zapdaa40`.

The deployment's hash-only route returned HTTP 200. Its pooled and direct host
hashes matched the exact child connection identities, and both database-name
hashes matched `neondb`. Separate read-only external SQL verification found 17
migration journal entries, 36 application tables and zero rows on both the child
and root; Production remained at two migrations and zero aliases. This proves
the native action, ancestry, environment injection and external database state.
The deployed route did not open a PostgreSQL connection, so it does not yet prove
that the application runtime can authenticate with the injected credentials.

The disposable deployment `dpl_GAyWfYDijvxkrRBrZUzdT3fSzZDK`, child branch and
endpoint were deleted. Fresh provider reads confirm all three exact identities
are absent, only each resource's root branch remains, both connection policies
remain intact, and live Production deployment
`dpl_9m7ojZk6FZMJoCKsELDe53qiQkRp` is unchanged. Evidence is
`/tmp/magickli-isolated-preview-probe-run/{baseline,provider-status,runtime-and-data-verification,cleanup-verification}.json`.

Loom 1.26.0 still models one database resource name, so its network check cannot
prove this two-resource topology by itself. The provider evidence above remains
the topology gate. Full application Preview acceptance still covers runtime SQL
authentication, OAuth, uploads/publication and offline journeys. The writer
pause, final private import, staged Production acceptance and controlled cutover
also remain; no modernized Production deployment has occurred. The reusable
modernization skill remains unpublished until the modernization finishes.

## Published package adoption validation

Magickly pins Loom 1.26.0 with only the corresponding lockfile entry changed.
Installed package provenance matches source commit
`53d38019c2102bcc40d4eb9ab77b7c562f7c1404`. Independent adoption review found
no workflow compatibility blocker. The integrated app passes 4,255 tests across
158 files (14 opt-in Mongo tests skipped), a production build, TypeScript and
Biome. Build verification used an isolated checkout with synthetic build-only
values; it neither imported private data nor deployed the application. Logs are
`/tmp/magickli-loom-126-{tests-2,build-3,types,biome}.log`.
