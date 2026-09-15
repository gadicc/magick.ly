# Resume checkpoint — 15 September 2026

The operator requested a temporary pause with 10% usage remaining. All agents
stopped; no new work should run until requested. Production remains legacy
deployment `dpl_9m7ojZk6FZMJoCKsELDe53qiQkRp`. No maintenance fence, Mongo role
change, final backup/import, or modernized Production promotion has occurred.

On 15 September the operator resumed a bounded local session. The image
revocation journey below is complete and editor initialization fix `984301b`
is reviewed, tested and committed. No agent remains active. The next step is
building this exact reviewed source and confirming the real editor, then
refreshing Preview. Deployment and cutover remain deferred.

## Saved implementation

- Loom 1.27.0 is published. Magickly adopts it in `388123d`, Porty in `7a3eac1`,
  Shadowlang in `033b173`; reference-app commits remain local.
- Offline identity serialization is committed in `3586b18`, with exactly-once
  study reconnect verified in the local production build.
- Ritual permission retries are committed in `803c234`. All eight committed
  files match the frozen browser runtime manifest. Full suite: 4,335 passing,
  16 skipped; focused regressions and canonical Node 24 types pass.
- Editor initialization fix `984301b` passes 38 focused tests, Node 24.21 types
  and Biome. The delayed-view regression fails against the old source. No
  application code is left half-edited; real browser confirmation is pending.

## Resume the local acceptance work

The local runtime is `http://127.0.0.1:3115`, build
`-VN2VtQuqFqstawyEqjCg`, from `/tmp/magickli-local-runtime/source`.
Its source graph is recorded in `combined-source-manifest-3.json`; runtime
metadata is `final-running-2.json` in that directory. The committed-source and
test evidence binding is `/tmp/magickli-local-acceptance/reviewed-803c234.json`.

PostgreSQL and MinIO hold synthetic fixtures. Preserve their state and the
private settings/session files; **do not rerun the seed task**. Services were
left available, not restarted or deleted. Browser contexts were restored online.

The exact remaining image journey is prepared:

- Temple: `01a0a0ed-61ad-762d-9a6c-55437a96bd0b`.
- Ritual: `01a0a0f9-0de5-75d8-aac9-fa08f6c7a06f`.
- Reader: `019a0000-0000-7000-8000-000000000002`, now grade 0, not admin.
- Revision v4: `01a0a149-1323-7465-a79e-bb46bad9723d`.
- Published bundle: `01a0a149-12ec-7cf1-85d9-ddce87794c02`, one verified asset.
- `magickli-reader-final3` is online at the offline catalog with v4 and its
  image purged after successful revocation. `magickli-creator-final2` is
  online at the editor; `magickli-creator-final` is online at temple admin.

The v4 image journey passed on 15 September: a rendered 1,878-byte, 16×16 Blob
image matched the upload SHA-256, with one cached bundle and asset. Creator UI
revocation followed by an ordinary online reload removed both; offline direct
and catalog access stayed unavailable, with a failed network probe proving the
offline condition. The reader was restored online. Preserve the receipt at
`output/playwright/local-acceptance/image-revocation-20260915.json`; there is no
need to repeat this unchanged-runtime journey. The earlier text-only result is
`/tmp/magickli-local-acceptance/final-revocation-result.json`.

The initial editor race is fixed in `984301b`: the one-shot microtask could run
before `viewRef` existed. A small layout synchronization reads current access
and draft refs when the initially empty view arrives; it suppresses persistence
for that synchronous fill. The gated source load compiles explicitly. Regression
tests cover delayed initialization, lock-before-view and regrant isolation;
existing user-edit/save flows pass. The old-source failure log is
`/tmp/magickli-local-acceptance/editor-init-old-code-negative-oskq4__i.log`.
Do not repeat the source investigation; verify the actual editor after the next
reviewed production build. The existing 3115 runtime still serves `803c234`.

## Prepared Preview build

Packet: `output/preview-refresh-803c234/` (ignored, mode 0700). It contains a
clean isolated checkout, frozen dependencies with published Loom 1.27.0, and
verified synthetic inputs. No standalone build, provider access or upload ran.
Use the existing dependency tree after updating this unbuilt checkout to the
new reviewed commit `984301b` (or its documentation-only descendant) and
rebinding its provenance. Do not allocate another full
dependency tree unnecessarily: `/tmp` previously ran short of inodes.

The first install used pnpm's embedded Node 20 and issued an engine warning.
Use absolute Node 24.19 plus Corepack pnpm 10.18 for the remaining commands.
Recipe: `/tmp/magickli-preview-refresh-plan.md`. Still required: production Loom
check, metadata-backed placeholders, standalone build, complete artifact scan,
review, exact provider/Neon binding, Preview upload and stable alias verification.

Stable Preview remains `https://magickly-preview-9fd4f93a-wastelands.vercel.app`,
deployment `dpl_5PJAB3NodZAdquB9bgwTDRmvF7nq`, Loom 1.26.1. Its imported Neon
child is `br-snowy-thunder-za04f8ck` in `small-wave-96978226`. Preserve both real
Google sessions and the QA temple; **do not rerun the Preview import**. Use those
sessions for the small real R2 upload/publication check after refreshing Preview.

An optional Preview-secret retrieval was rejected by automatic approval review;
no credentials were retrieved. That approach is stopped. Existing signed-in
operator sessions are the chosen deployed acceptance path.

## Cutover and shared skill

Atlas project is `magickli`, Cluster0 is Free, and the operator can edit database
user `magickli@admin`. Roles remain unchanged. Review the Free-tier drain and
persistent legacy-upload fence corrections in `020-cutover-writers.md` before
using the older private readiness draft. No new monitoring credential is needed
merely for the unsupported `$currentOp` aggregation. External/manual use of the
dedicated credential still needs operator confirmation at cutover preparation.

After deployed acceptance: prepare and verify fences/drain; take a consistent
backup; apply final production migrations/import/reconciliation and relocation;
verify staged release and promote; then retire old credentials/storage with
the established rollback constraints. The production SQL root still has only
0000–0001 and no private import.

The reusable modernization skill is an ignored, validated draft under
`.loom/drafts/modernize-app`. It includes this session's evidence and widget
lifecycle lessons. Finish and review it only after the complete modernization;
do not publish it to Loom while this task is paused.
