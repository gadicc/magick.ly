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

On 14 September the operator found the existing Vercel resource connection,
enabled deployment readiness, selected Preview only for branch deployment, and
saved the changes. A subsequent authenticated Vercel resource read confirms
`deployments.required: true` and the `Neon` action scoped to `preview` only on
the same connection. This verifies saved configuration, not a successful
deployment-action or effective-connection probe. The earlier attempt
to add a connection was rejected as already connected; no replacement connection
was needed.

Saving the connection also enabled `makeEnvVarsSensitive`; fresh variable
metadata confirms both database URLs are Sensitive in Production and Preview.
The earlier recommendation to leave Sensitive off during credential setup was
not the resulting provider state. A fresh GitHub Production secret-name check
found only `VERCEL_TOKEN`. Retrieve the direct connection through authenticated
Neon access and install/verify the protected migration secret before release;
there is no longer a readable Vercel database fallback.
The workflow already preserves the untouched Vercel pull snapshot, supplies
build-only placeholders for unreadable Sensitive values, rejects placeholder
leakage, and binds `MIGRATION_DATABASE_URL_UNPOOLED` only to verification and
migrations. Independent review confirms the Loom support and unit coverage;
the complete GitHub/Vercel Sensitive-database flow still needs live acceptance.
Provision and verify the migration credential before any release. Do not
expect `vercel pull` or `vercel env run` on GitHub to recover Sensitive values.
Credential-free evidence is `/tmp/magickli-preview-settings/saved-20260914.json`.

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

An inert native Preview deployment subsequently verified the actual integration.
Deployment `dpl_77LZxULUk2HeLyDJ7KAroApk36ep` ran in `lhr1`, reached `READY`,
and reported the integration ready. Its endpoint returned only SHA-256 hashes of
the parsed database hosts and names. Both runtime URLs matched fresh Neon
pooled/direct connection identities for branch `br-green-star-zacq6jov` and
endpoint `ep-gentle-sea-za11tx75`; the direct host also matched that branch's
independently listed endpoint. No SQL was executed by the probe.

The new branch was `preview/codex/preview-db-probe-2198b31e`, with main as its
parent and `init_source: parent-data`. This proves working deployment overrides
and also proves that native branching copies the parent's data. Before importing
private production records, establish a durable sanitized Preview source and
separate credential scope; a different host alone is insufficient.

The exact temporary deployment had no aliases and was removed with Vercel's
`--safe` guard. Neon automatically removed its branch and endpoint. Fresh provider
reads confirm only main remains and the old production deployment is unchanged.
Evidence is `/tmp/magickli-preview-db-probe-run/`, especially
`runtime-verification.json`, `cleanup-intent.json` and
`cleanup-verification.json`. The first CLI submission was rejected locally
because `--skip-domain` is production-only; later preflight corrections also
stopped before mutation. The successful probe used the corrected Preview command.

A separate Vercel-managed Neon resource named `magickli-preview-db`, store
`store_mtqKLpJtiM70K3hX`, was then provisioned under the approved isolation work.
It uses the free `free_v3` plan in `lhr1` / `aws-eu-west-2`, has Neon Auth
disabled, and owns the distinct PostgreSQL 18 project `small-wave-96978226`. Its root branch
`br-polished-morning-zazqd31j` has no parent. The store remains unconnected with
zero connected projects, so this step added no Vercel application environment
variables and did not change the existing Production connection.

A source- and target-bound runner from app commit `dfaa0c2` applied the 17
reviewed migrations to that empty root. The result verifies 17 migration journal
entries, 36 public application tables, and zero application rows. Production
retained its two-entry journal, zero legacy aliases, and exact before/after
catalog hash. The reviewed approval digest is
`511912b08cb8b34eea6bbdce7743317e2ab1b40c7039d766fa823072aed8114f`;
the migration source manifest is
`7017e67fe95d8d2f14f78ea29c2249e658932a10fb97a13ecb577dcd30710142`.
Evidence is `/tmp/magickli-preview-ancestry-run/{created,neon-target}.json` and
`/tmp/magickli-preview-base-migration/result.json`, whose SHA-256 is
`90804b7e77b20641cae4c7e0d6034275c40efe03d71217760a6a27319df0be04`.

The operator subsequently saved the original resource's Production-only policy.
Fresh metadata confirms its connection and both Sensitive database variables are
Production-only, with no Preview deployment action. The storage response does
not expose the resource-wide policy itself; that setting is operator-reported.
Evidence is `/tmp/magickli-production-only-verification/20260914T133013.json`.

After the operator reset `neondb_owner` on the same Neon project and main branch,
Vercel replaced its connection ID with `spc_XDFrBMjdzJtxpNow` and updated both
Sensitive Production variables. The store, Neon project and live deployment
remained unchanged. Metadata in
`/tmp/magickli-neon-rotation-verification/vercel-metadata.json` confirms that
update, but cannot prove the unreadable values work in a deployment.

The refreshed credential passed the exact-target read-only database probe and
Loom's connected migration permission check. The unchanged two-entry journal,
empty alias table and catalog hash were verified before the GitHub write. Loom
then refreshed `MIGRATION_DATABASE_URL_UNPOOLED` in GitHub Production at
`2026-09-14T13:40:55Z`; the role, master-only policy and other secret metadata
remained unchanged. The runner passed five focused offline tests and independent
review before execution. No credential was printed or saved locally.
Evidence is `/tmp/magickli-migration-secret-refresh/{plan,result}.json`; the
reviewed proposal digest is
`5b96f6461538ad0ea80a0358c437df1a90c7c9bf2bcdd94b3b974863331324c6`
and the result SHA-256 is
`ad5ae24036ed0c92f079a7b2e9a6a5beff3f543266d2be4726a24660527188f2`.
GitHub secret-value read-back is unavailable; the complete release workflow and
deployed runtime still need acceptance.

The new resource must now
be connected only to Preview with Sensitive variables and the required Preview
deployment action before another canary and the full application journey. No
private import or modernized application deployment occurred in these creation
and schema-migration steps.

Loom 1.26.0 models one database resource name, so its current network check does
not prove this intended two-resource environment topology. `loom.json` now declares
the verified Production-only scope of `magickli-db`; the separate Preview resource
is tracked here until shared configuration supports it. Exact provider metadata
and the follow-up canary remain the topology gate.

Full application Preview acceptance still needs isolated external services,
OAuth, uploads/publication and offline journeys. No private production import or
modernized application deployment has occurred. The reusable modernization skill
remains an unpublished draft until the complete modernization actually finishes.

## Published package adoption validation

Magickly pins Loom 1.26.0 with only the corresponding lockfile entry changed.
Installed package provenance matches source commit
`53d38019c2102bcc40d4eb9ab77b7c562f7c1404`. Independent adoption review found
no workflow compatibility blocker. The integrated app passes 4,255 tests across
158 files (14 opt-in Mongo tests skipped), a production build, TypeScript and
Biome. Build verification used an isolated checkout with synthetic build-only
values; it neither imported private data nor deployed the application. Logs are
`/tmp/magickli-loom-126-{tests-2,build-3,types,biome}.log`.
