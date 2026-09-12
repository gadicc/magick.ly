This plan recommends migrating Magickly in stages: finish the tooling transition, protect the important behavior with tests, adopt Loom and update dependencies, replace Gongo feature by feature behind explicit application APIs, and then perform a rehearsed Mongo-to-Neon cutover. Keep the ritual format stable through the database migration. Select the WYSIWYG engine with a separate trial using real ritual features.

Research date: **12 September 2026**, updated after the operator's follow-up. The operator has now authorized implementation and commits after successful isolated changes. The fresh production Mongo backup and `/dump/` Git ignore entry are complete. The research baseline below predates implementation; subsequent changes and verification are tracked in the implementation ledger.

**Confirmed requirements:** use UUIDv7 for new canonical database IDs and relevant Node/browser generation; retain legacy aliases during migration; private rituals must remain usable offline, including airplane mode; administration can start with RSC and no persistent client cache; retain JRT through the persistence migration; prioritize nontechnical editors in the eventual WYSIWYG milestone; real-time collaboration is out of scope. A short cutover write pause, moving compute, and one-time reauthentication are acceptable. Chat, image uploads and Discourse are used. **London/London is approved**: Vercel `lhr1` and Neon AWS London `aws-eu-west-2`. Pinecone is authoritative; the Mongo ingestion experiment was never used for retrieval and should be retired, restoring Pinecone ingestion where practical. Migrate file handling to Loom while preserving existing image URLs.

**The starting point is more modern than expected.** [package.json](/home/dragon/www/projects/magickli/package.json) already declares pnpm 10.18.0, Biome 2.2.5, Vitest 3.2.4, Next 15.5.9, and React 19.2.0. All 46 pages and seven route handlers are under `src/app`; there is no Pages Router migration to perform. There is one Vitest test and no existing Jest suite to port.

Some tooling cleanup remains: `lint` still invokes `next lint`; ESLint and Prettier files remain; Biome is a production dependency; its configuration contains many explicit rules rather than a minimal default configuration. There is no committed CI workflow or coverage setup. The existing `resolutions` entry should be checked against pnpm's actual resolved dependency graph before it is removed or translated to an override.

The research baseline was:

| Check | Result | Limit |
| --- | --- | --- |
| Installed Vitest, `run` | One test passed | Only geomancy computation is covered |
| Installed TypeScript, `--noEmit --incremental false` | Passed | Current configuration has `strict: false`, with `strictNullChecks: true` |
| Installed Biome, `check` | Passed; 165 files checked | Current configured rules, not proposed new defaults |
| Fresh install / frozen lockfile | Not performed | `pnpm exec` attempted to bootstrap its pinned pnpm outside writable roots; installed tools were invoked directly instead |
| Production build / browser flows | Not performed | Requires an isolated, complete environment; server imports include database connections and required external-service configuration |
| Coverage | Not measured | No coverage provider/configuration installed |

These checks ran on the host's Node 25.2.1. The manifest and deployed runtime use Node 22. Repeat the baseline under the selected supported runtime before implementation. The pre-existing untracked `dump/` was preserved.

**tRPC currently does no application work.** [The query module](/home/dragon/www/projects/magickli/src/app/api/trpc/queries/index.ts) and [mutation module](/home/dragon/www/projects/magickli/src/app/api/trpc/mutations/index.ts) export nothing; the latter contains only a commented Discourse export. The router combines those empty modules. [The client](/home/dragon/www/projects/magickli/src/lib/trpc.ts) has no application imports/callers. Remove this scaffold, its route and the two tRPC dependencies in the first cleanup after a final usage/build check. No active tRPC procedure needs porting.

Use Server Components to call server-side query/services directly, and authenticated Server Actions for ordinary form mutations. Retain versioned, validated Route Handlers for the offline outbox protocol, streaming chat, uploads and SVG/PNG responses. Durable offline operations should carry stable operation IDs and payloads, not serialized Server Action references tied to a deployment. RSC does not replace the offline client reader/cache. All entry points should call the same authorization and domain services. [Next.js data fetching](https://nextjs.org/learn/dashboard-app/fetching-data), [Server Functions and Actions](https://nextjs.org/docs/app/getting-started/mutating-data).

**The reference projects provide patterns, not a version set to copy.** [apthunt](/home/dragon/www/projects/apthunt/loom.json) has Loom DB/auth/jobs/mail and a compact PGlite harness. [shadowlang](/home/dragon/www/projects/shadowlang/loom.json) has Loom DB/auth/jobs/PWA/files and the relevant Dexie implementation. [porty3](/home/dragon/www/projects/porty3/loom.json) has a newer Loom integration and production release guidance. Their package versions differ and already lag some current releases.

Useful reference entry points are [Shadowlang's client cache](/home/dragon/www/projects/shadowlang/src/flashcards/clientCache.ts), [review outbox](/home/dragon/www/projects/shadowlang/src/flashcards/reviewOutbox.ts), [outbox drain](/home/dragon/www/projects/shadowlang/src/flashcards/drainOutbox.ts), [account/device cleanup](/home/dragon/www/projects/shadowlang/src/account/deviceCleanup.ts), and [Apthunt's PGlite harness](/home/dragon/www/projects/apthunt/tests/memory-pglite.ts). Reuse their design where appropriate; do not copy their language-learning schema, scheduling policy, or test-worker workarounds without evidence that Magickly needs them.

**Loom adoption should be selective.** I read the reference installation's [Loom skill](/home/dragon/www/projects/porty3/node_modules/@gadicc/loom/skills/loom/SKILL.md), [upgrade-deps skill](/home/dragon/www/projects/porty3/node_modules/@gadicc/loom/skills/upgrade-deps/SKILL.md), [DB skill](/home/dragon/www/projects/porty3/node_modules/@gadicc/loom/skills/loom-db/SKILL.md), and [auth skill](/home/dragon/www/projects/porty3/node_modules/@gadicc/loom/skills/loom-auth/SKILL.md). These are from Loom 1.21.2; the registry currently reports 1.23.0. Re-read the chosen installed version's skills when implementation starts.

Use `loom init` for an existing application, then activate only needed features. Add DB wiring and PGlite when introducing the SQL schema. Adopt auth after the existing identity behavior is understood. Files and PWA are good later candidates; jobs become useful for durable Discourse synchronization if that flow remains active. Do not scaffold over this app as if it were a new site. `loom add db` and `loom db neon setup` are separate operations: local DB wiring does not require creating a cloud database.

**The recommended order has explicit completion gates.** Small urgent fixes identified below can precede this sequence once implementation is authorized.

| Stage | Work | Ready to proceed when |
| --- | --- | --- |
| 0. Establish a reproducible baseline | Inventory active features and production data; document environment variable names; verify backup and isolate fixtures; record exposed experimental credentials for retirement; obtain an isolated build environment | Current tests, typecheck, lint and build are reproducible; intended permissions and critical journeys are recorded |
| 1. Finish tooling and bootstrap Loom | Align Node/pnpm; make check, typecheck, test, test:watch, coverage and build commands explicit; remove obsolete config and unused tRPC; adopt a small Biome config; add Loom bootstrap | Clean install and CI work; unrelated formatting is separated from behavior changes |
| 2. Add migration-focused tests | Protect compiler/rendering semantics, study scheduling and anonymous progress, permissions, revision saving, and legacy ID conversion | Important behavior is executable and independent of Gongo internals where practical |
| 3. Execute Loom `upgrade-deps` | Upgrade coupled package families incrementally; read migration guides; record successful updates, source migrations, removals and justified deferrals | Each family passes appropriate checks; full tests/build pass after framework/toolchain/major changes |
| 4. Introduce application APIs on Mongo | Extract session identity, authorization, repositories and commands; route both new APIs and remaining Gongo paths through consistent policy | New and existing callers have parity tests; Mongo remains the sole authority |
| 5. Design SQL and import tooling locally | Add Loom DB, Drizzle schemas, generated validation and PGlite; build resumable import and comparison reports | Sanitized legacy fixtures import repeatedly without unexplained differences |
| 6. Retire Gongo clients by feature | Move administration, ritual access/editing, and study to their appropriate API/cache model; migrate existing browser data | Each migrated feature survives refresh, login changes and relevant offline cases; old pending work remains recoverable |
| 7. Confirm placement and provision Neon | Present exact Vercel/Neon region, resource name, plan and environment wiring to the operator; provision through Loom only after confirmation | Operator has explicitly approved the concrete resource/region proposal; isolated preview and production targets are verified |
| 8. Rehearse the complete cutover | Run SQL migrations and full import against a disposable/preview branch; compare data and behavior; exercise auth, files and old-client handling | Counts, references, source hashes, permissions and critical journeys match; restore/recovery is demonstrated |
| 9. Switch production persistence | Use the approved short write pause; finalize import/deltas; stage deployment, verify target DB, migrate, promote and smoke-test | One authoritative writer, no unexplained data differences, and a defined recovery path for new writes |
| 10. Complete auth alignment | Migrate Auth.js to Better Auth through Loom as its own release, preserving canonical UUIDv7 identities and legacy account mappings | Google sign-in, authorization, callbacks and existing accounts work; one-time reauthentication is expected |
| 11. Introduce WYSIWYG editing | Run the editor trial, choose an engine, implement versioned document conversion and progressively enable editing | All supported ritual constructs survive import/edit/export and real-browser testing |
| 12. Remove transition code | Retire old endpoints, Mongo dependencies, temporary auth adapters and Gongo recovery tooling after the agreed compatibility window | No active dependency or recoverable pending data still requires them |

Stages 4–6 can be delivered as small releases. Stage 5's local SQL work can start before every client is migrated. The editor trial can also happen earlier without changing stored documents. Provisioning is deliberately separate from code/schema preparation. The operator has approved a short write pause in principle; its timing and concrete cutover still belong in the reviewed release procedure.

**Tests should protect behavior we intend to keep, with deliberate corrections for known defects.** Broad percentage targets before identifying important behavior would create misleading confidence. Add a coverage report over explicitly selected application modules, including unimported files in those modules. Establish and ratchet thresholds after the first useful baseline. Aim for complete cases in critical authorization/import/sync decisions rather than inflating coverage with static reference data or snapshots of markup.

| Area | Tests with the highest migration value |
| --- | --- |
| Ritual compiler | Shortcuts for speakers/actions, grade expressions, variables and bold variables; nested blocks; escaping/Unicode; malformed input; diagnostic source positions; representative built-in rituals |
| Ritual reader | Role aliases, `all`, officers and exclusions; variable declarations/options and URL state; titles/anchors; notes, summaries, footnotes, images and grade glyphs; previous/next relevant instruction; characterize current live-preview insert/remove behavior and distinguish known hook limitations from new regressions |
| Revision save | First save; five-minute coalescing boundary; author's revision selection; refresh after save; source and rendered document agreeing; rapid edit/save; invalid source; concurrent edits; failed network acknowledgement |
| Study | SuperMemo/repetition behavior using a fixed clock; grading time boundaries; due-date aggregation; wrong answers; newly added cards; refresh persistence; no-account use; enabling sync; repeated retries; second device and account switching |
| Access | Public, group, temple and grade-limited reads; regular member, temple admin, group admin and global admin writes; list/detail/revisions agreeing; permission changes; attempts to change ownership/scope; minimal user field projection |
| Temple flows | Create temple plus initial administrator membership; join code, repeated/concurrent joins, grade zero, promotion/demotion and changed membership permissions |
| Discourse | Existing linked users; legacy identity lookup; username/motto normalization; grade-group additions/removals; retry after a partial failure; stale membership removal; no live external writes in tests |
| Data import | Mixed ID representations, legacy auth shapes, duplicate natural keys, missing optional fields, missing references, tombstones, dates, unknown fields, reruns and interrupted runs |
| Browser lifecycle | Old Gongo IndexedDB migration; blocked upgrade from a second tab; downloaded private ritual reopening after a cold start in airplane mode, including images/fonts; reconnect; app update while dirty; account isolation and recovery from stale clients |
| Other features | File deduplication/metadata and access; chat streaming/source framing; geomancy and planetary-hour boundaries; SVG/PNG export and font rendering smoke checks |

Use Vitest for pure logic and API/service tests, Testing Library for ordinary interactive components, fake-indexeddb for Dexie tests, and Loom PGlite for SQL repository tests. Real browser tests are necessary for CodeMirror/contenteditable selections, mobile input, clipboard, service workers and multi-tab behavior. Use a disposable Postgres/Neon branch for migration, transaction and driver parity: PGlite is useful but does not prove Neon connection/runtime behavior.

Extract the shortcut compiler from its CodeMirror highlighters so its tests do not need an editor. Similarly extract study grading/scheduling from the page and access policy from publication callbacks. Test the public command results across Mongo and SQL implementations. Do not make Gongo's method names the permanent test contract.

**Dependency updates are a compatibility campaign.** The current npm registry snapshot is below; these are candidate targets, not a command to update everything together. Re-query before implementation. Sources are npm registry package metadata fetched read-only on the research date.

| Family | Current Magickly | Current registry candidate | Handling |
| --- | --- | --- | --- |
| Loom | Absent | [1.23.0](https://registry.npmjs.org/%40gadicc%2Floom/latest) | Bootstrap existing app; review peer minimums and feature contracts |
| Next / React | 15.5.9 / 19.2.0 | [16.3.5](https://registry.npmjs.org/next/latest) / [19.3.0](https://registry.npmjs.org/react/latest) | Upgrade runtime/framework together with matching types and MUI integration checks |
| Vitest | 3.2.4 | [5.0.0](https://registry.npmjs.org/vitest/latest) | Read both intervening migration guides; match coverage/browser packages exactly |
| Biome | 2.2.5 | 2.5.13 | Migrate config, keep it small; review new recommended-rule findings |
| TypeScript | 5.9.3 | 7.0.2 | Separate major migration; strictness expansion is a separate task |
| MUI / material-nextjs / date pickers | 7.3.x / 7.3.x / 7.9.x | 9.4.0 / 9.4.0 / 9.13.0 | Keep Emotion and adapters coherent; test forms, menus, themes and SSR |
| Serwist | 9.2.1 | 9.5.12 | Treat Next build integration and SW lifecycle as one compatibility unit |
| AI SDK / RSC | 2.1.3 / 1.0.60 | 7.0.99 / 3.0.99 | Substantial API migration; preserve chat streaming and Discourse progress behavior |
| Dexie | Absent | 4.4.6 | Add for durable browser data where needed |
| Better Auth | Absent | 1.7.4 | Separate identity migration, not merely a dependency addition |
| MongoDB | 6.2.0 | 7.6.0 | Do not spend on an unnecessary driver major if retirement is near; preserve Gongo compatibility until removed |
| Gongo client/server | 2.8.2 / 3.6.1 | Same | Retirement is an architectural change, not solved by updating these packages |
| JRT | 1.3.1 | [Same](https://registry.npmjs.org/json-rich-text/latest) | Published React peer is `^18.0.0`, while the app uses React 19; investigate renderer compatibility |
| AWS SDK | v2 | [v2 is end-of-support](https://registry.npmjs.org/aws-sdk/latest) | Replace actual uses with v3 or appropriate Loom file wiring |

Loom 1.23.0 raises relevant peers above this app's Valibot and SuperJSON versions, so those belong in the Loom compatibility unit. Keep an upgrade ledger with old/new versions, verification and reasons for deferral. Prove a package unused before removing it, including dynamic imports, build loaders and server entry points.

Target Node 24 across local development, CI and Vercel, with aligned Node types. Vercel supports Node 24; Vitest 5's registry engine range excludes this host's Node 25 and requires supported Node 22.12+, 24, or 26+. [Vercel runtime documentation](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [Vitest migration guide](https://vitest.dev/guide/migration/).

Keep Webpack initially when upgrading Next. This app uses inline `raw-loader!` imports for Jade documents, JSON5/YAML/SVG configuration, an `fs` fallback and Serwist's build plugin. Next 16 defaults to Turbopack and explicitly requires handling existing Webpack configuration. Use explicit Webpack development/build commands during the framework migration, then migrate bundling separately if worthwhile. Remove `next lint` and the obsolete Next `eslint` option. [Next 16 migration guidance](https://nextjs.org/docs/app/guides/upgrading/version-16).

Do not enable React Compiler as part of the initial modernization. The JRT renderer deliberately calls hooks from node render methods and suppresses hook-order errors. Keep this known constraint documented and characterize representative live edits before framework changes. A renderer redesign is deferred unless a reproduced compatibility failure makes it necessary; it is not a prerequisite for the persistence migration. Reconsider compiler adoption only after the renderer follows React's component/hook lifecycle.

**The default database strategy is application-level staging, followed by a persistence cutover.** Gongo is doing more than database access: subscriptions, optimistic updates, JSON Patch transport, IndexedDB persistence, deletion markers and authorization hooks all participate. Auth, Discourse and file code also call Mongo directly or reach through the Gongo adapter.

| Strategy | Benefit | Cost/risk | Recommendation |
| --- | --- | --- | --- |
| Rewrite client, server, auth and editor together | One visible transition | Too many simultaneous failure sources; difficult recovery | Avoid |
| Implement a general Mongo-compatible layer over Postgres | Broad legacy API compatibility | Query/operator emulation becomes a product of its own | Avoid for this app |
| Implement a narrow Gongo Postgres adapter | Could move server storage before changing clients | Must preserve sync, patch, ID and publication behavior; direct Mongo callers still need work | Conditional fallback if retiring Mongo first becomes a hard requirement |
| Introduce domain APIs on Mongo, migrate clients, then swap repositories to Postgres | Behavior changes are separable and testable; avoids a permanent compatibility layer | Mongo remains until the feature work is ready | Preferred default |
| Move individual domains to Neon while other domains stay on Mongo | Earlier incremental SQL use | Cross-database identity, joins and recovery complexity | Consider only if a long transition justifies it |

The narrow adapter is technically plausible: Gongo exposes a [DatabaseAdapter interface](/home/dragon/www/projects/magickli/node_modules/gongo-server/src/DatabaseAdapter.ts). It is not a driver substitution. A feasibility trial would have to prove ID serialization/ARSON, publication result shapes and update cursors, `__updatedAt`, deletion markers, patches against pending client bases, per-document failure acknowledgements and permissions. The app also uses `.getReal()`, `.dbPromise`, Mongo cursors/projections, ObjectId comparisons and a Mongo-specific auth adapter. Set an explicit supported subset and fail on unsupported operations; do not silently approximate Mongo semantics.

If that fallback is selected, test anonymous study adoption, nested study patches, concurrent revision saves, deletes and permission loss against both backends before committing to it. Give it an exit condition: deletion once the last Gongo caller and supported old client are retired.

In the preferred approach, introduce narrow commands such as `saveRitualRevision`, `recordStudyReview`, `joinTemple` and `changeMembership`, plus server-side query functions. Call these from RSC, Server Actions and the specific Route Handlers described above. Retire unused tRPC rather than build new dependencies on it. Authorization uses a stable canonical application identity and is evaluated on the server. A browser-supplied user/temple ID is input, not authority.

While Gongo and new APIs coexist, use the same server policy and ensure new writes remain visible to the old subscriptions, including required Gongo update metadata. Have one authoritative write path for each operation. Keep SQL implementations behind the same repository contracts and exercise them with PGlite and integration tests until cutover.

**Client storage should vary by feature.** Shadowlang's Dexie code implements caches and an explicit outbox; Dexie itself is not a Neon synchronization service. Dexie Cloud is an optional separate service and is not proposed here. [Dexie Cloud overview](https://dexie.org/docs/cloud/index).

| Feature | Proposed client behavior |
| --- | --- |
| Static reference pages and built-in rituals | Keep static/local data; cache necessary assets for offline reading |
| Temple/group/user administration | RSC reads and Server Actions first; refresh/invalidate after writes; persistent browser caching is optional and may be added later |
| Ritual list and private reader | Required account-scoped offline library and reader; persist authorized documents plus required images/fonts/assets; refresh permissions when online; distinguish loading, forbidden and missing states |
| Ritual editor | Durable local drafts; explicit save/acknowledgement; base revision/version check; retain both versions on conflict |
| Study | Dexie progress/cache plus a durable review outbox, following Shadowlang's general pattern |
| Files and chat | Ordinary APIs; do not persist arbitrary responses globally by default |

For study, write the local result and queued operation atomically. Generate UUIDv7 operation IDs in the browser, with server-side deduplication and transactional application. Preserve ordering where it affects scheduling; explicitly resolve late reviews from multiple devices. Do not blindly overwrite a complete `cards` object or sum cumulative snapshots on retry. Keep failed work visible and recoverable. Preserve the existing optional network/anonymous workflow unless the operator chooses a behavior change.

Separate anonymous data from each signed-in user's data. Anonymous-to-account import should be explicit and idempotent, with defined handling when that account already has progress. A logout/login must not cause account A's pending writes to be sent as account B. Browser caches should not expose another account's temple/user data. Private ritual downloads are required, not an optional future cache. Provide a clear saved/offline-ready state, verify all required resources before claiming readiness, and allow the cached reader to open without a live session request. Define account switching/logout cleanup and online permission refresh explicitly. Access already granted to an offline copy cannot be instantly revoked while that device remains offline; do not introduce a short online lease that defeats intentional airplane-mode use without discussing it with the operator.

**There are two independent data migrations: server storage and each browser's existing Gongo database.** [src/db.ts](/home/dragon/www/projects/magickli/src/db.ts) persists study sets, users/groups, temples/memberships, docs and revisions. Study can be used without networking; unsynced data may exist only on a user's device.

The installed Gongo IndexedDB implementation opens a database named `gongo` and can delete object stores that are no longer registered. Therefore do not simply remove `.persist()` registrations before the migration code has exported their contents. Preserve pending insert/update/delete metadata and pending bases, not just visible rows. Use a new Dexie database name, a resumable import marker, per-record provenance/deduplication and a verification report. Keep the old stores until a successful migration and recovery window have completed.

Ship the compatibility/recovery client before turning off the old backend. Handle two tabs, interrupted migration, storage failure, old service workers, and devices returning after a long offline period. Version the API/protocol. Unsupported stale writes should receive an actionable upgrade/recovery response while their local data remains intact. Do not promise that every offline device will have synchronized by a wall-clock cutover deadline.

**The SQL shape should be relational around identity and access, with JSON where the domain is document-shaped.** The following is a proposal to validate against a fresh production inventory, not a final migration schema.

| Data | Proposed storage and invariants |
| --- | --- |
| Users and auth records | UUIDv7 canonical application IDs; separate profile/access data from adapter-managed auth tables; explicit provider-account and legacy ID mapping |
| Groups and roles | Groups plus membership/admin relationships; preserve both legacy group membership and group administration |
| Temples | Stable ID, unique normalized slug, name and invite configuration; preserve existing invite links through a controlled transition |
| Temple membership | Foreign keys to user/temple, unique user+temple, nonnegative grade including zero, admin/motto/dates |
| Ritual documents | Metadata/access columns, current revision pointer and concurrency version |
| Ritual revisions | Exact source text, source/format/compiler versions, structured document, author/timestamps and content hashes |
| Study progress | Unique account+set, existing totals and scheduling state; initially preserve nested card data or normalize it with proven parity |
| Study reviews | New idempotent review operations and results where event-based synchronization is introduced; import old aggregates as a baseline, not invented historical events |
| Files | UUIDv7 canonical file IDs with preserved legacy hash/ID aliases, object keys and metadata; migrate to Loom Files without breaking ritual image URLs |
| Sync/integration state | Operation receipts and durable Discourse work/status where needed |

Postgres JSONB is suitable for structured ritual content and some legacy study payloads; use normal columns for foreign keys, authorization, filtering and concurrency. JSONB does not preserve original source whitespace or object-key order, so store exact editor source separately. Updating a JSONB document still locks its row, which matters for concurrent edits. [PostgreSQL JSON documentation](https://www.postgresql.org/docs/current/datatype-json.html).

Use Postgres `uuid` columns with a real UUIDv7 default, plus UUIDv7 generation in Node/browser where IDs must exist before a server write. [Shadowlang's schema helper](/home/dragon/www/projects/shadowlang/src/db/schema/ids.ts) uses `uuid_generate_v7()` and [its client helper](/home/dragon/www/projects/shadowlang/src/lib/ids.ts) generates v7 using Web Crypto. Reuse the installed Loom/reference generation contract after checking its production migration and PGlite behavior; do not silently substitute UUIDv4 defaults. Verify generated version/variant bits and default generation on the selected Neon Postgres version. Prefer native generation where supported or the reference SQL function using Neon-supported capabilities; no unsupported extension is required by this design.

Allocate each imported canonical UUIDv7 exactly once and persist the mapping before dependent rows import. Retain legacy aliases for existing URLs, auth/provider identities, Discourse mappings and returning offline clients. Mapping must account for collection/entity and original ID representation: a string and an ObjectId with the same characters are not automatically the same entity, but field-aware reference reconciliation may deliberately link them. Import reruns must reuse the same mapping. Keep public legacy URLs resolvable even after migration. Preserve dates as typed timestamps, distinguish missing/null, account for tombstones, and quarantine unknown/orphaned records for review. Import raw legacy material into a controlled staging/export artifact if needed; do not make an unvalidated JSON dump the permanent authorization schema.

The original local historical dump contains ten collections, including five docs, twenty revisions and twenty-one study sets, with observed update dates ending in December 2024. It demonstrates mixed string/ObjectId IDs in auth records and study ownership, string revision references, and document fields outside current interfaces. Sensitive values are not reproduced here.

The authorized **fresh production backup** is [production-2026-09-12T10-51-01Z](/home/dragon/www/projects/magickli/dump/production-2026-09-12T10-51-01Z/manifest.json), selected from the linked Vercel project's Production `MONGO_URL` and restricted to database `magickli`. Counts are: users 12, accounts 10, sessions 36, docs 5, docRevisions 59, studySet 49, files 10, temples 1, templeMemberships 7, userGroups 1: **190 documents across ten collections**. The 21 compressed dump files total 767,839 bytes. Every SHA-256/size, gzip stream, BSON document and JSON metadata file was verified. The manifest contains verification results and no connection credentials. Both dumps are now ignored by Git. This was a live logical dump with no oplog, not a coordinated point-in-time snapshot; it has not yet been restore-tested. A final consistent backup under the approved write pause and a rehearsal restore are still required. File rows contain metadata; this dump does not back up S3 object bodies or Pinecone vectors.

The operator also reports performing production backups today under [magickly](/home/dragon/backups/magickly/2026-09-12) and [magickly-forums](/home/dragon/backups/magickly-forums). Read-only file inventory confirms the dated Mongo directory and `app-2026-09-12.yml` forum configuration. The newest visible forum database archive is named `magick-ly-forums-2026-09-09-033426-v20260505161704.tar.gz`; distinguish today's backup/copy operation from the database snapshot date encoded in that filename when preparing recovery. These operator backups have not been content- or restore-verified in this task. Keep them as additional recovery artifacts alongside the separately verified dump.

Before import, complete the fresh backup's structural inventory: indexes/uniqueness, duplicate account+set and user+temple pairs, all reference relationships, public/group/temple/grade combinations, orphan documents/revisions, legacy auth providers/passwords and file-object references. Treat Pinecone and the separate experimental chat database as separate inventories, not collections silently included in this dump. Preserve the original export and checksums. Make each import batch restartable; emit counts, reference checks and exact source hashes. Re-run the importer and prove it does not duplicate or overwrite newer data unexpectedly.

**Authentication is an additional migration worth planning explicitly.** The references use Better Auth, while Magickly uses Auth.js v5 beta with a [custom adapter](/home/dragon/www/projects/magickli/src/api-lib/gongoAuthAdapter.ts). That adapter supports legacy provider identities embedded in users as well as account records. The dump also contains older auth shapes.

Keep Auth.js through Gongo retirement. For the Neon cutover, prepare and test a suitable Auth.js/Drizzle adapter boundary using the canonical UUIDv7 user IDs, preserved legacy mappings and required profile fields. This is a smaller temporary bridge than emulating all of Gongo. Then migrate to Better Auth through Loom in a separate release. If that temporary adapter proves more expensive than a combined transition, reconsider only after a successful rehearsal of the complete auth mapping. The operator accepts one-time reauthentication, so preserving old sessions is not a reason to build a complicated adapter or retain legacy ID types.

Plan Google callbacks, provider-account IDs, verified email semantics, global/temple/group roles and session enrichment. Do not merge users based only on unverified matching email. Expect users to sign in once again and explain that transition; never assume old cookies or session rows are interchangeable. Inventory historical passwords without enabling an unintended authentication method. [Better Auth's Auth.js migration guide](https://better-auth.com/docs/guides/next-auth-migration-guide).

**Vercel placement is verified; London/London is now approved.** Read-only Vercel API inspection confirmed the linked project is `magickly`, its current function region is **Paris (`cdg1`)**, and the production deployment also reports `cdg1` and Node `22.x`. The deployment was created on 12 December 2025. The approved target is Vercel `lhr1` and Neon `aws-eu-west-2`; research itself changed no Vercel settings.

Neon's current region list includes AWS London (`aws-eu-west-2`) and AWS Frankfurt (`aws-eu-central-1`), with no Paris region. Neon project regions cannot be changed in place. [Neon region documentation](https://neon.com/docs/introduction/regions). Prefer application compute close to the database; CDN delivery location is a separate concern. [Vercel function regions](https://vercel.com/docs/functions/configuring-functions/region).

| Placement option | Assessment |
| --- | --- |
| Vercel London `lhr1`; Neon AWS London `aws-eu-west-2` | Recommended given the confirmed mostly-UK audience; co-locates compute and database |
| Vercel Washington `iad1`; Neon AWS N. Virginia `aws-us-east-1` | Reasonable if deliberately prioritizing future Americas usage over today's UK audience |
| Vercel Frankfurt `fra1`; Neon AWS Frankfurt `aws-eu-central-1` | Reserve for an EU-location requirement; none has been specified |
| Keep Vercel Paris; Neon London or Frankfurt | Transitional option, not the preferred permanent placement now that a compute move is acceptable |

The following published measurements are **Vercel function → Neon hot HTTP query latency**, not browser round-trip or Magickly page timings. They illustrate geography; actual application performance still needs measurement. [Neon's regional latency dashboard](https://neon.com/demos/regional-latency), consulted 12 September 2026; rounded milliseconds:

| Probe location | London DB | Virginia DB |
| --- | ---: | ---: |
| London | 9 | 87 |
| Frankfurt | 20 | 102 |
| Washington | 84 | 11 |
| Portland | 139 | 72 |
| Singapore | 174 | 229 |
| Sydney | 276 | 218 |
| São Paulo | 194 | 124 |

My recommendation is London/London for the current audience. US East is a reasonable deliberate Americas preference, but is not universally best globally. Keep compute and DB together in either case: a remote visitor then crosses the ocean to the application, while the application's SQL calls stay local. Splitting London compute from a Virginia DB can add a transatlantic hop to every sequential database exchange. CDN assets, efficient requests and the required offline reader reduce the practical cost for distant readers. Choose based on actual usage and measure regional application timings after a preview exists. A later region move is another database migration, since Neon cannot change a project's region in place.

The operator gate must show the selected Vercel region, Neon region, resource name, existing/new Marketplace plan, preview-branch policy and any compute-region change. Then use the installed Loom version's `loom db neon setup` with the explicitly approved region. Loom's reference README documents Marketplace region codes such as `sin1`; do not confuse those with Neon API identifiers such as `aws-eu-west-2`. Verify the accepted code with the installed CLI before invoking setup.

The current Loom flow installs into Production and Preview, skips Development and avoids pulling env files automatically. Verify branch isolation rather than assuming Preview automatically means a separate database. Neon Auth is disabled by default because Loom uses Better Auth. Preserve that choice unless intentionally changed. Local tests can continue with PGlite and an explicitly configured disposable DB.

**Cutover must account for new writes and old clients.** The operator accepts a short pause on server writes, after compatible clients and the recovery path have shipped. Capture a final consistent export/delta, validate the import, switch the authoritative repository, and reopen writes. External Discourse operations and scheduled jobs should be paused or fenced during rehearsal/cutover so migrations do not replay real-world side effects.

If uninterrupted writes are required, replace the pause with a designed durable change-capture/reconciliation process and a final authority switch. Mongo timestamp fields alone are not proof of a complete change stream, particularly with direct writes and deletions. Avoid naive application dual writes that can succeed on one database and fail on the other.

Follow Loom's staged release pattern for SQL deployments: build/stage the production artifact, verify the migration connection and target, run backward-compatible migrations, promote, then smoke-test. Expand/contract schema changes must tolerate the previously deployed app while it is still serving. Prepare a fresh backup and restore drill; retain Mongo read-only for a defined period.

Before Neon accepts writes, reverting to the old application can be simple. After Neon has accepted writes, reverting the deployment alone loses or splits new data. Recovery must either fix forward or replay/reconcile those writes into the rollback target. Record this boundary in the cutover checklist, with the actual responsible operator and stop criteria.

**Ritual storage and editor choice are separate decisions.** The current chain is source shortcuts → Pug lexer/parser → JRT-like document → custom reader. Source revisions and rendered documents are saved separately. The renderer supports more than ordinary rich text: speech/actions and role expressions, variables with selectable options, special grades, notes, summaries, footnotes, images, styles and reader navigation. Preserve these semantics as first-class data.

Keep source text and existing document payloads through the SQL migration. Introduce explicit format/compiler versions and validated document types. Treat compiled output as derived for new saves, but compare legacy source and stored output before deciding which is authoritative for an existing document. Do not silently recompile every historical record and overwrite differences.

The local [JRT renderer](/home/dragon/www/npm/jrt/src/index.js) calls `node.render()` directly. [Node rendering](/home/dragon/www/npm/jrt/src/blocks/node.js) recursively calls each child's render method, so hooks run within the outer React component's hook sequence. Editing Pug can insert/remove such calls; the operator confirms that the current suppression is intentional. Dynamic React trees themselves can support stateful children when each node is rendered through a real component boundary with stable identity. A later renderer can use registered React components and stable node keys, with explicit handling of source recompilation and node identity. This needs design and tests rather than a mechanical hook rewrite. Defer it unless an upgrade exposes a concrete blocker. [React component/hook ownership](https://react.dev/reference/rules/react-calls-components-and-hooks).

JRT does contain editing groundwork: `detach`, `appendTo`, `replaceWith` and ancestor updates reuse node instances through an object-keyed map, and the cursor implements basic typing, paste and slash commands. This is useful design context, although selection/history/mobile behavior still needs a maintained editing engine or substantial work. Compare those ideas during the editor trial rather than assuming JRT has no editing implementation. The global block/role registry is an accepted current limitation; future per-ritual definitions belong in the editor/schema backlog. No local JRT source was changed.

The preferred long-term model is a versioned Magickly document schema with adapters to the chosen editor. It may evolve directly from JRT. Persist semantic node IDs/types/attributes, never DOM refs, editor selections or reader-specific `forMe` state. Keep editor machinery out of the read-only renderer so reading does not require downloading an editor framework.

| Option | Fit for Magickly | Main tradeoff |
| --- | --- | --- |
| Extend JRT and keep CodeMirror | Lowest-risk immediate path; preserves exact source and specialized rendering; existing mutation/cursor groundwork is worth understanding | Completing and maintaining a full editing engine, including selection/history/paste/mobile behavior, would be substantial |
| Slate | Natural React/custom-tree fit; plain JSON and flexible nested elements; worth a real trial given the project's preferences | Requires custom normalization, behavior and serializers; official docs still label it beta |
| Lexical | Custom element/text/decorator nodes; explicit serialization; documented Yjs collaboration integration | More editor-specific state/node integration; mappings still need to be written and tested |
| Tiptap / ProseMirror | Strong schema-based alternative with custom React node views and JSON persistence | Another schema/extension model; distinguish editor core from any separately licensed extensions or services |

Slate's flexibility and JSON model fit the ritual tree, but normalization constraints mean conversion is not simply renaming `value` to `text`. [Slate introduction](https://docs.slatejs.org/), [serialization](https://docs.slatejs.org/concepts/10-serializing), [normalization](https://docs.slatejs.org/concepts/11-normalizing). Lexical supports custom nodes and JSON serialization, and its React collaboration guide covers Yjs. [Lexical nodes](https://lexical.dev/docs/concepts/nodes), [serialization](https://lexical.dev/docs/serialization/), [collaboration](https://lexical.dev/docs/collaboration/react). Tiptap's node views can have custom interactive UI independently of their stored/output representation. [Tiptap node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views), [persistence](https://tiptap.dev/docs/editor/core-concepts/persistence).

My recommendation is **retain JRT/source now, trial Slate first, and use Lexical as the main comparator with Tiptap as the additional schema-oriented option**. Do not select an engine merely because it renders a sample paragraph. Current registry versions observed were Slate 0.126.2 / slate-react 0.126.4, Lexical 0.50.0 and Tiptap React 3.31.3; match each engine's related packages and re-check before the trial.

The WYSIWYG milestone can follow the migration, with **nontechnical editors as its primary users**. Use the same representative ritual excerpt in each trial: role-based speech and actions, an exclusion expression, a variable declaration and inline reference, a grade token, nested summary/note, a footnote and an image. Test insert/delete/reorder, selections across special nodes, undo/redo, pasted content, Hebrew/Enochian text and fonts, mobile composition, long-document responsiveness and read-only rendering. Include a full long ritual to expose selection/rendering costs. Ask an unfamiliar editor to complete realistic edits without Pug knowledge. Score semantic correctness, usability, integration work and maintenance burden; readable source/export is a useful secondary goal.

Exact source preservation is separate from semantic round-tripping and is not the first WYSIWYG milestone's priority. The current compiler discards formatting and some source-only information. A WYSIWYG edit cannot promise to reproduce original Pug comments/whitespace/shortcuts without retaining a syntax tree and doing source-aware edits. Preserve original source revisions during migration, but do not build a bidirectional concrete-syntax editor merely to retain identical formatting. Define one authoritative representation per save, readable export where useful, and a legacy/source fallback for unsupported constructs. Do not let independently editable source and JSON diverge silently.

Real-time collaboration is explicitly out of scope for this migration and the first editor milestone. Use optimistic concurrency and recoverable drafts. Keep future collaboration possible through versioned semantic nodes and clean editor/storage boundaries, without adding a collaboration server, CRDT or offline multi-author merge protocol now.

**Several additional findings deserve early attention.** These are concrete observations from the inspected code, not a completed security audit or proof of current production exploitability.

| Finding | Why it matters / proposed action |
| --- | --- |
| Credential-bearing Mongo URL in [chat/openai.ts](/home/dragon/www/projects/magickli/src/app/chat/openai.ts) | Treat as exposed. Operator accepts disabling it after migration/experimental-path retirement; its actual privileges remain unknown and need operator assessment. Do not reuse it for Neon, tests or backup. No credential was revoked or exercised during this research |
| Local dump files include auth/session material | Both historical and fresh dumps are now ignored via `/dump/`; use sanitized fixtures in commits |
| Permission inconsistencies in [gongoPoll](/home/dragon/www/projects/magickli/src/app/api/gongoPoll/route.ts) | `minGrade` is a server TODO; list/detail/revision logic differs; define one intended access matrix before preserving behavior |
| Temple invite secret projection mismatch | Publication strips `_joinPass`, while model/join lookup use `joinPass`; verify intended visibility and fix projections |
| Join performs a write while rendering a page | Move the join mutation to an explicit validated action and enforce uniqueness transactionally |
| Revision save can use the last compiled preview while source has changed | Add rapid-save/invalid-source tests; compile/validate the exact submitted source and update revision/current pointer atomically |
| JRT hook-order errors are deliberately suppressed | Known intentional behavior; characterize it before upgrades, defer redesign unless a reproduced compatibility failure requires it |
| Reader mutates document nodes with refs and `forMe` | Keep presentation state separate from saved data; current save strips refs but not every presentation field |
| Gongo IndexedDB upgrades can remove unregistered stores | Export and verify old browser data before removing collection registrations |
| Service-worker cleanup unregisters the worker | Verify mounting/unmounting and update behavior; protect dirty drafts and pending reviews during upgrades |
| Chat ingestion writes Mongo vector data; chat retrieval currently uses Pinecone | Keep active Pinecone retrieval. The training UI actually posts to the experimental Mongo ingestion route; retire or rewire that route explicitly when removing Mongo |
| AWS SDK v2 and bespoke upload path | Adopt Loom Files; preserve object keys, hashes, URLs and authorization; include referenced image bodies in offline ritual preparation |
| Discourse sync spans many external writes | Test partial failures and retries; consider durable Loom jobs with idempotent steps rather than a long request |
| Database/provider clients initialize at import time | Separate construction from operations where appropriate, allowing isolated tests and predictable builds |

Permission tests should assert intended rules, with an explicit record when those differ from today's implementation. In particular, restricted-content fixes should not wait until the entire database migration is complete.

**Chat, file and render follow-ups are explicit.** [Chat retrieval](/home/dragon/www/projects/magickli/src/app/chat/api/route.ts) uses `PineconeStore.fromExistingIndex`. [The training page](/home/dragon/www/projects/magickli/src/app/chat/train/page.tsx) posts to [the training upload route](/home/dragon/www/projects/magickli/src/app/chat/train/upload/route.ts), which uses `MongoDBAtlasVectorSearch.fromDocuments` and the separate `chatter.training_data` target. Thus the user's recollection and checked-in ingestion wiring differ; this code does not demonstrate a working Pinecone ingestion pipeline. Keep chat working with Pinecone, and do not finish the abandoned Mongo vector migration. Inventory any needed ingestion workflow before deciding whether to retire or replace it. Neon supports `pgvector`, enabled with `CREATE EXTENSION vector`; a later move should compare retrieval quality, embedding compatibility, filtering, latency and operational cost before replacing Pinecone. Local development may need the matching extension installed by the operator; use only Neon-supported capabilities. [Neon vector documentation](https://neon.com/docs/ai/ai-concepts).

The current [file API](/home/dragon/www/projects/magickli/src/app/api/file2/route.ts) serves existing `/api/file2?sha256=...` URLs backed by hash-keyed S3 objects and Mongo metadata. Map these to Loom file records with UUIDv7 IDs and legacy hash aliases. Keep a compatibility route so ritual images and saved offline copies continue working; do not force a bulk source rewrite or needless reupload. Validate metadata conversion, deduplication, content type, access and offline caching. Inventory object storage independently of the Mongo backup.

Record a separate consolidation task for the [tree-of-life SVG/PNG route](/home/dragon/www/projects/magickli/src/app/api/treeOfLife/route.ts) and interactive copy/download rendering. Introduce one component-render route with an explicit slug-to-component registry, schema-validated props, output size bounds and shared pure rendering/font setup. Preserve existing URLs through aliases. Never turn a request path into an unrestricted dynamic import. This can wait until the framework/files work establishes the shared runtime; it should not expand the database migration.

**The next implementation unit should be deliberately small:** align the runtime and make tooling/CI reproducible; remove obsolete configs and empty tRPC; establish initial compiler, study, permission and import-contract tests; then bootstrap Loom and run its dependency upgrade workflow in compatible groups. The backup and ignore entry are already complete. This gives subsequent changes a useful safety net without writing a large test suite around code about to disappear.

**Execution should use this task as the integration owner.** Staying on Astra/xhigh is reasonable for the cross-cutting architecture and migration review; that is a task-fit recommendation, not a measured claim about this repository. OpenAI describes Astra as suited to complex end-to-end coding and reasoning. [Official model guidance](https://developers.openai.com/api/docs/guides/latest-model). Use two or three bounded subagents once delegated work is explicitly started: compiler/reader behavior tests; data mapping/import audit; and offline study/private-ritual contracts. Give each concrete owned paths, inputs, acceptance criteria and an explicit stop condition. Early audits can run independently, while implementation work waits for agreed service/ID contracts. Keep package/lockfile/config changes, shared schemas, production actions and final integration under one owner. Do not send several agents to perform the entire migration independently. Retain the same model initially; reassess cost/latency only after tasks are mechanically scoped. No subagents have been started during this research follow-up.

Implementation and isolated commits are authorized. London/London, the short write pause, compute move, offline requirement, editor audience and one-time reauthentication need not be reconfirmed in principle. Resolve the concrete resource/plan and preview isolation details through Loom before provisioning, raising any unresolved consequential choice with a reviewable proposal. Raise behavior ambiguities when a specific flow is examined. Production release remains a staged, verified operation after the import/restore rehearsal and readiness review.
