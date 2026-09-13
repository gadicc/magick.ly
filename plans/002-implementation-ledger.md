Implementation began on 12 September 2026, following the approved [modernization plan](./001-modernization-research.md). Commit each verified, isolated change. Keep package/configuration changes and final integration under one owner; bounded agents own compiler tests, study tests and a read-only migration audit.

Current infrastructure boundary: the new London Neon database is connected and has the identity foundation, while the live application and all domain data remain on Mongo. No deployment or compute move has occurred. See the [provisioning record](./004-neon-provisioning.md) for verified state and remaining release gates. Earlier verification paragraphs below describe their individual checkpoints.

| Unit | Status | Verification / notes |
| --- | --- | --- |
| Legacy public-image reader | Complete locally; integrated into plan v2 | Whole-batch archive/current-row checks, bounded SDK GET/error streams and validated owned snapshots; all ten actual objects pass with unchanged SHA, served MIME and backup fingerprints; all six archived legacy occurrences resolve; no runtime activation |
| Fixed-reference external-image reader | Complete locally; plan integration pending | Exact reference/byte pins, bounded DNS/HTTPS with checked IP/TLS and no redirects; all four actual representations pass, including explicitly recorded Wikimedia replacement; no runtime activation |
| Planning and backup protection | Complete | Production dump checksums, gzip, BSON and JSON verified; isolated Mongo restore validated all 190 documents, 10 collections and 20 indexes; dump directory ignored; London/London confirmed |
| Runtime and tooling baseline | Complete | Node 24/pnpm 10.18; frozen install, Biome, typecheck, coverage and build pass; explicit CI and scripts; obsolete ESLint/Prettier removed; redundant Biome defaults removed |
| Unused tRPC | Complete | Removed scaffold and both dependencies; lockfile update removes only tRPC; generated route types, full typecheck and 58-test suite pass |
| Compiler characterization | Complete | 33 tests; output and source-map parity across eight samples including three complete built-in rituals; typecheck and scoped Biome pass |
| Study characterization | Complete | 24 tests cover grading boundaries, schedules, totals, anonymous initialization and nonmutation; contained edge fixes follow separately |
| Study edge cases | Complete | Six additional tests; new cards initialize and become due; single-card selection and repetition cannot get stuck |
| Data mapping audit | Complete | Aggregate-only [migration contract](./003-data-migration-contract.md) records identity/reference conversions, duplicate study disposition, auth merge, import and recovery gates |
| Pinecone ingestion restoration | Complete | 28 tests including real PDF parsing; server-side global-admin checks, validation, stable retry keys and preserved embedding/index/namespace contract; Mongo vector path/dependency removed |
| Tarot module import | Complete | Correct namespace import; six card lookup/local-image tests pass; production build confirms the missing-default-export warning is gone |
| Tarot image filenames | Complete | Correct four existing filename mismatches; 11 tarot tests verify all 22 major-arcana images and numeric/string ranks |
| Loom bootstrap and Biome | Complete | Loom 1.23.0, Biome 2.5.13, SuperJSON 2.2.6 and Valibot 1.5.0; managed instructions/skill links and manifest; frozen install, 98 tests, scoped coverage, typecheck, lint and production build pass |
| Vitest upgrade | Complete | Vitest/coverage-v8 5.0.0 and Vite 8.3.0; explicit ESM config; frozen install, 103 tests, seven-file coverage scope, typecheck, lint, Loom check and production build pass |
| Next and React upgrade | Complete | Next 16.3.5/React 19.3.0, Auth.js beta.32 compatibility bridge, Serwist 9.5.12 and MUI Next adapter 7.3.10; all automated gates pass; browser checks cover ritual roles, variables, stateful component insertion/removal, compiler error recovery and anonymous training access |
| Native image renderer | Complete | Sharp 0.29.3→0.35.4, matching Next's packaged native dependency; migrated its metadata type import; frozen install, lint, typecheck, 103 tests, Loom check and production build pass; real SVG/PNG API checks verify signatures, default and requested dimensions |
| Canonical sitemap URLs | Complete | next-sitemap 2.5.28→4.2.3 with explicit ESM config; full build and postbuild pass; XML validation proves all 58 page URLs use the canonical origin, with route parity apart from four excluded admin/utility pages; index and robots verified |
| SQL identity foundation | Complete locally | Loom DB wiring, Drizzle 0.45.2, UUID 14.0.1 and typed durable aliases; 26 new tests; real Postgres 15.17 migration/rerun/concurrency/rollback rehearsal passes and disposable databases removed; app still uses Mongo |
| Chat SDK and wire protocol | Complete locally | AI SDK 7.0.99, React adapter 4.0.102, OpenAI adapter 4.0.66, RSC 3.0.99; shared service with legacy/plaintext and v2/SSE adapters; 40 additional tests, full build and browser error/retry/reset checks pass; no live provider calls |
| London Neon provisioning | Complete | Separate `magickli-db` resource, existing Free plan preserved, Production/Preview connected, Development excluded; PostgreSQL 18.6 and London direct endpoint verified; both foundation migrations, rerun, UUIDv7 defaults and rollback checks pass with zero imported aliases |
| Legacy auth normalization | Complete locally | Pure BSON-to-import boundary; 23 synthetic tests cover provider-link reconciliation, typed aliases, verified/secondary email provenance, nullable historical dates and credential/session exclusion; no auth or database writes |
| Shared ritual permission policy | Defined and tested; reads and writes integrated locally | 139 policy cases cover creator/global/scoped-admin editing and history, ordinary graded reads, creation/publication, nullable orphan attribution and revision-parent/author guards; see the coupled write/editor unit below |
| MUI and membership date fields | Complete locally | MUI 9.4.0, date pickers 9.13.0, current Emotion/Dayjs and jsdom 30; operator accepts Safari/iOS 17+; 28 form/schema tests, full 359-test suite, coverage, typecheck, lint, frozen install and production build pass |
| Native Pinecone client | Complete locally | SDK 9.0.0 replaces direct LangChain retrieval/embedding adapters; shared cancellable corpus boundary; 385 tests, coverage, typecheck, lint, frozen install, Loom check and production build pass; both Node chat routes verified locally |
| date-fns upgrade | Complete locally | 2.29.3→4.4.0; no runtime source changes; 16 planetary-hour characterization tests, date-label/DST comparison, full 401-test suite, coverage, typecheck, lint, frozen install and production build pass |
| Luxon upgrade | Complete locally | 2.5.2→3.7.2 with matching 3.7.5 declarations; current moon/Mercury formatting matches baseline across five timezones and two locales; full 401-test suite, coverage, typecheck, lint, frozen install and production build pass |
| Ritual read authorization | Complete locally | Shared policy now governs all three Gongo ritual publications; current server grants, graded reads, exact parent-bound history and allowlisted projections; 36 integration tests, full 437-test suite, coverage, typecheck, lint and production build pass |
| Offline ritual variable changes | Complete locally | Native history updates replace RSC navigation for client-only variables; four UI regressions, full 441-test suite, typecheck, lint, coverage and build pass; real offline browser role/text edits preserve URL state and update ritual rendering |
| Better Auth identity foundation | Complete locally | Better Auth 1.7.4; nine new tables and pure import planner; 34 synthetic adapter/import tests; disposable Postgres migration, constraints, rollback and unchanged rerun pass; 475-test suite, coverage, typecheck, lint, frozen install and production build pass; runtime remains Auth.js and Neon has not received this migration |
| FilePond compatibility and upload characterization | Complete locally | FilePond 4.32.12/react-filepond 7.1.3 declares React 19 support; seven real-control/image upload tests; 482 tests, coverage, typecheck, lint, frozen install and production build pass; browser confirms native image selection, hash deduplication, multipart submission and anonymous training gate with mocked storage |
| Temple invite projection | Complete locally | Ordinary membership responses omit both invite field spellings; existing scoped/global admin sharing remains; nine actual-route/Gongo-helper regressions and full 491-test suite, types and Biome pass; previously cached codes are not erased |
| Redundant external font stylesheet | Complete locally | Removed duplicate Google Roboto link; existing next/font weights remain; Biome and production build pass; all 63 prerendered pages omit the old stylesheet and generated CSS retains self-hosted Roboto |
| Group and temple SQL foundation | Complete locally | Six tables, UUIDv7 domain identities and strict legacy import planning; 40 new tests; 531 tests, scoped coverage, typecheck, Biome and production build; real Postgres migration/defaults/constraints/rollback and unchanged four-migration rerun; runtime remains on Mongo |
| Verified Gongo HTTP sessions | Complete locally | Auth.js verified nested identity is adapted to Gongo; absent/malformed sessions suppress legacy token fallback; 19 actual-transport regressions, 550 tests, scoped coverage, typecheck, Biome and production build pass |
| Atomic ritual writes and editor recovery | Complete locally | Versioned save/create/publication commands, compare-and-swap tokens, exact source, server compilation and durable operation receipts; converted editor/creation UI, full authorized snapshots and explicit legacy recovery; 646 default tests plus 14 disposable Mongo cases, scoped coverage, types, Biome and production build pass; six browser scenarios with synthetic HTTP responses pass |
| Ritual and revision SQL foundation | Complete locally | Four tables distinguish exact source, original compiled archives and versioned artifacts; strict typed import plan and parent/source-hash constraints; 46 new tests, 692 full-suite tests, types/Biome/coverage/build and real Postgres migration/rollback/unchanged rerun pass; no live import |
| Shared form dependencies | Complete locally | React Hook Form 7.88.0, resolvers 5.9.1 and Radash 12.1.1; no source changes; 28 actual membership form/schema tests, all 692 tests, unchanged coverage, typecheck, Biome, frozen install and production build pass |
| Public ritual offline query shells | Complete locally | Three literal static ritual shells, anonymous build-bound worker cache and exact deployment asset matching; 43 new tests, 845 full-suite tests, coverage/types/Biome/build and nine two-build Chromium scenarios pass |
| Atomic SQL temple creation | Complete locally; UI activation pending | Any verified existing user creates temple, first grade-zero admin and durable retry receipt atomically; no automatic invite; 37 new tests, 802 full-suite tests, coverage/types/Biome/build and real Postgres races/lock-timeout/replay checks pass |
| Authorized SQL ritual reads | Complete locally | Server-only repository shares policy and loads current grants/source in read-only repeatable-read transactions; 20 new tests, 765 full-suite tests, coverage/types/Biome/build and real Postgres concurrent-demotion/source-preservation acceptance pass |
| Preserved SQL rendered rituals | Complete locally | Exact current compiled archives under ordinary read permissions; nine query regressions and installed JRT legacy-shape test; 855 tests, scoped coverage/types/Biome/build; protected backup preflight passes with reviewed exceptions |
| Files metadata SQL foundation | Complete locally; runtime planned | Exact Loom UUIDv7 schema and protected legacy provenance; 71 new tests, 926 full-suite tests, coverage/types/Biome/build and real Postgres migration/date/metadata/rollback/rerun acceptance; all ten actual metadata rows pass read-only preflight |
| Protected image finalization | Complete locally; adapters pending | Strict v1 requests, actual bytes/hash/all-frame decoding, Loom private save and current-policy atomic publication contract; 98 new tests, 1,344 default tests, coverage/types/Biome/Loom/build; native decode deadline smoke passes |
| SQL ritual upload publication | Complete locally; provider/UI pending | Immutable intents, current grants, fenced claims and atomic file/link/receipt; 97 new cases, 1,441 default tests, coverage/types/Biome/Loom/build; 16 real Postgres race/constraint gates and unchanged ten-migration/29-table rerun |
| Verified legacy file locations | Complete locally; import pending | All ten canonical R2 reads prove bucket-prefixed keys; explicit import prefix/provenance preserves public URLs; 1,506 tests, full checks/build, production-bound in-memory preflight and real Postgres upgrade/rerun pass |
| Protected R2 storage adapter | Complete locally; activation pending | Explicit SQL-bound locations, signed size/SHA/provenance, cancellable reads and same-operation orphan reconciliation through Loom; 62 new cases, 1,568 tests, coverage/types/Biome/Loom/build pass |
| JRT discarded-tree cache | Complete locally | Pinned one-line WeakMap patch preserves live identity/mutations and output profile; 1,573 tests, full checks, clean emitted-bundle verification and ten Chromium stages pass; known hook recovery unchanged |
| Editor scripting and compile lifetime | Complete locally | Owned console handle cleanup, inert retired callbacks, stale-result fencing and source-map release; 1,651 tests, full checks/build and twelve Chromium stages pass, preserving scripts/save/recovery |
| Rendered ritual asset inventory | Complete locally; resolution pending | Exact source paths/query/fragment identity and actual child/task/footnote rules; 65 new tests, 1,638 tests, coverage/types/Biome/Loom pass; protected preflight exposes two stale PNG paths |
| Legacy static image links | Complete locally | Two exact permanent redirects restore current canonical PNGs; target decode tests, types/Biome/Loom/build and built HTTP size/SHA/MIME/query checks pass; all five archived trees now enumerate completely without source changes |
| Verified static raster catalog | Complete locally; resolver pending | Bounded immutable byte snapshots, exact alias/canonical binding and validator identity; 46 new cases, 1,699 tests, expanded coverage/types/Biome/Loom/build pass; nine real raster files and two aliases validate, six SVGs remain unresolved |
| Private offline lease policy | Pure rules complete; storage/UI pending | Renewable 14-day read/source authorization, owner/epoch/request guards, expiry/rollback locks and preserved locked recovery; 36 tests, 962 full-suite tests, scoped coverage/types/Biome pass; no runtime activation |
| Offline storage and view lifecycle | Complete locally; runtime integration pending | Dexie repository plus synchronous view guards, two-tab sign-out fence, owned Blob cleanup and opaque locked recovery; 1,499 tests, coverage/types/Biome/Loom/build; ten native lifecycle scenarios pass |
| Study-progress SQL foundation | Complete locally | Three tables preserve cumulative totals, exact schedules and protected full-source archives; 47 new tests, 745 full-suite tests, expanded scoped coverage, types/Biome/build and disposable Postgres migration/rollback/unchanged rerun pass |
| Published Loom lifecycle adoption | Complete locally | Loom 1.24.0 published through its approved main workflow and pinned exactly; shared consent lifecycle, explicit waiting worker and master release-branch config; 698 tests, scoped coverage, types, Biome, frozen install and production build pass |
| SuperMemo compatibility upgrade | Complete locally | 2.0.17→2.0.23 keeps the algorithm and moves package entrypoints to ESM/CJS; 14,320 exact old/new comparisons, all 692 tests, unchanged scoped coverage, typecheck, Biome, frozen install and production build pass |
| Unused dependency removal | Complete locally | Removed Passport, Google Passport strategy, dotenv, npm zlib and the obsolete Jade CodeMirror package after source/config/peer audit; 441 tests, coverage, typecheck, lint, frozen install and production build pass |

Pinecone is the authoritative vector store. The unused Mongo ingestion experiment and its dependency are removed. History contained no reusable Pinecone ingestion path, so the uploader now uses the installed Pinecone API directly through a small service. Ingestion pins `text-embedding-ada-002` and newline stripping to match the installed retrieval defaults; retain this compatibility during the AI dependency upgrade. Uploads are limited to 4 MiB by the existing Vercel request path; larger-file ingestion can follow Loom Files/jobs adoption. No live vectors were written. Existing unrelated vector IDs cannot be deduplicated by the new content-derived retry IDs. Defer pgvector migration until retrieval parity and operational tradeoffs can be measured.

The Node 24 baseline production build completes with existing tarot import and BSON target warnings, expected local-placeholder Mongo connection errors from eager initialization, and an invalid sitemap base URL caused by the old config loader. These are tracked for separate fixes. Service credentials were overridden with local/build-only values; Google Font downloads were allowed. CI is configured but has not run on GitHub yet.

Coverage currently gates thirty-two extracted compiler, study, geomancy, chat/training, identity, auth-import, ritual-policy, recovery and domain-import modules: 98.63% statements, 99.27% lines, 100% functions and 96.96% branches. This is intentionally scoped coverage, not a whole-site percentage. Expand the include list as domain logic is extracted. The default suite has 845 tests; 14 additional real Mongo transaction tests run through the explicit `pnpm test:mongo` rehearsal. The Mongo write engine is verified there, rather than counted as covered by default CI's boundary tests.

Loom is bootstrapped with no application features active yet. Its required formatter compatibility prompted the Biome update and configuration migration. The new SVG parser is excluded from existing designer assets. The explicitly intentional JRT hook model has a file-scoped exception; an unrelated unused hook component was removed. Forty-four newly reported array-index-key findings remain warnings while their owning features are migrated: changing component identity as a formatting fix would be unsafe. Import ordering uses the new defaults.

CI actions now use verified release commit hashes, maintained by Dependabot. `loom check --production` passes with advisory warnings about a future pnpm 11 migration and the missing Next 15 agent-docs fallback. pnpm stays on the verified 10.18.0 pin; Next 16 will provide its bundled docs. The successful build still reports the previously recorded BSON target warning, eager local Mongo connection failures and sitemap configuration issue. No production services or configuration were changed.

The Vitest 3→5 upgrade follows the official [v4 migration guide](https://github.com/vitest-dev/vitest/blob/v4.1.10/docs/guide/migration.md) and [v5 migration guide](https://vitest.dev/guide/migration/). Existing tests already use compatible constructor mocks, awaited assertions and top-level mock factories. Keep the new defaults. No assertion or threshold was weakened; the same seven files remain covered. Renaming the config to `.mts` makes its ESM contract explicit for Vite's future native loader, and TypeScript includes that file. Existing runtime-package peer warnings are tracked with their owning upgrade/removal units.

The Next 16 migration deliberately keeps Webpack for Serwist and the existing Jade/raw, YAML, JSON5, SVG and WASM loaders. React Compiler stays disabled for JRT's intentional rendering model. The MUI cache provider now uses its Next 16 export; React Testing Library now supports React 19. Next generated its bundled-documentation instructions and TypeScript defaults. Production build, frozen install, typecheck, lint, Loom check and all 103 tests pass with unchanged coverage gates. `next typegen` reports a Serwist/Turbopack advisory although the actual dev/build commands explicitly use Webpack.

Local browser checks used synthetic credentials and no production database: built-in rituals, role/variable controls, adding and removing hook-bearing preview nodes, invalid-source diagnostics and recovery all worked. Anonymous training showed the permission message without an upload control. SVG rendering passed. PNG rendering exposed a separately reproduced pre-existing Sharp 0.29.3/system-libvips mismatch; its dependency alignment is the next isolated fix. The worker registered and activated, but an origin-stopped reload hit the in-app browser's error-page policy, so offline acceptance remains unverified and belongs to the dedicated offline migration gate. Existing eager Mongo, sitemap, AWS SDK v2 and Edge-runtime warnings remain assigned to their owning units.

The Sharp mismatch reproduced outside Next: the old binary linked the current system libvips and failed even a synthetic SVG conversion, while Sharp 0.35.4's packaged binary passed. The [0.35 migration](https://sharp.pixelplumbing.com/changelog/v0.35.0/) is compatible with Node 24; retain optional platform packages during installation. After upgrading, `/api/treeOfLife` returns valid SVG and PNG at 341×598 and PNG at the requested 200×300. Image metadata parsing and a visual check of the Hebrew glyphs pass. The route's existing `/var/task` font configuration still emits a local portability warning; font packaging belongs to the later rendering consolidation and needs deployment verification.

The sitemap fix replaces the obsolete configuration loader with an explicit `.mjs` config consumed by next-sitemap 4.2.3. Generated URLs previously began with `undefined`; they now use `https://magick.ly`. The 62-route baseline is preserved except `/admin`, `/temples/admin`, `/upload` and `/manifest.json`, leaving 58 page entries. The sitemap index references the generated child sitemap and robots retains the canonical sitemap URL. XML parsing and path-set comparison, frozen install, lint, typecheck, all 103 tests, Loom check and the full production/postbuild workflow pass. Generated sitemap files remain ignored; dynamic-route indexing expansion is separate work.

Loom DB now supplies env-aware migration/generation tasks, thin Neon HTTP/transaction wrappers, generated Valibot schemas and the PGlite harness. The app-owned identity layer generates UUIDv7 in Node/browser code and uses `pg_uuidv7` defaults in SQL. A custom extension migration precedes the generated alias table. Alias keys preserve source system, entity, ID type and value; explicit remaps fail, retries converge, and deliberate many-to-one merges are supported. Drizzle metadata and generated Valibot files are excluded from manual formatting. Regeneration finds no schema drift.

All 129 tests, the expanded coverage gates, frozen install, lint, typecheck, production build and ordinary `loom check` pass. The real local Postgres rehearsal verifies both migrations, UUIDv7 defaults, typed separation, conflicting remaps, eight concurrent allocations, rollback and rerun idempotence; its disposable databases were removed. Evidence is in `/tmp/magickli-postgres-rehearsal/result.json`. PGlite stays on Loom's 0.3.16 baseline for this foundation; its newer major belongs to a separate compatibility unit. CI now hydrates and checks Loom. `loom check --production` intentionally remains blocked by the unwired production migration/release workflow and Vercel deployment fencing. Configure and verify that gate before any release; account for this repository's `master` branch rather than blindly following the checker's `main` assumption. No Neon resource, existing database, or production configuration changed.

The chat client now uses typed UI-message parts and `/chat/api/v2`; the original `/chat/api` keeps its metadata-prefix/plaintext response for cached clients. Both call one service. The two original GPT-4o Chat Completions prompts, temperature, Pinecone index/namespace (including its default namespace), ada-002 newline preprocessing and MMR settings remain unchanged. Citations travel separately from answer text and no longer contaminate follow-up history. New chat/message IDs use UUIDv7. Remove the unused `openai-edge` dependency. The existing LangChain retrieval adapter remains until the native Pinecone unit; it cannot cancel an in-flight vector request, although cancellation stops subsequent answer generation and both model calls receive the abort signal.

All 169 tests, expanded coverage, typecheck, lint, frozen install, ordinary Loom check and the exact-source production build pass. Tests use the real AI SDK stream/transport with mocked providers to cover prompt/legacy-byte parity, typed citations, Unicode, errors, regeneration and cancellation in both protocols. Browser checks verify initial state, submit, visible configuration error, retry and New Chat. Actual RSC server/client helpers preserve Discourse progress and completion/error-as-message termination. Live model/vector integration and authenticated Discourse side effects were not exercised. Edge runtime and the previously recorded release-workflow gate remain for later units.

The auth normalizer projects protected legacy BSON records into explicit import DTOs without database access, UUID allocation, clock access or user merging. It joins agreeing modern and embedded provider identities, retains typed references and explicit adapter aliases, and rejects unresolved or conflicting identities. It preserves email verification evidence and historical timestamp gaps. Provider tokens, raw profiles, strategy configuration and all sessions (including potentially sensitive session IDs) are excluded. Application grants remain a separate importer responsibility. The audited local backup shape passes aggregate-only normalization; 23 synthetic tests, the full 192-test suite, expanded coverage floors, typecheck and scoped Biome pass. Better Auth integration and actual import remain outstanding.

The storage-independent ritual policy grants read/edit/source-history to creators, global admins and matching group/temple admins; ordinary members receive read access with temple grades enforced. Null historical creators confer no creator grant and do not suppress legitimate scope/admin access. New scopes are exclusive; malformed legacy combined scopes require explicit repair. The operator confirmed scoped-admin creation and global-admin-only public publication. Ordinary content saves cannot change scope, grade requirement or creator. Revision guards bind parent and current authenticated author; they do not make persistence atomic. Legacy normalization handles only known identity fields and actual BSON/driver ObjectIds. All 331 tests, expanded coverage, typecheck and scoped Biome pass. Publication/read integration, an atomic or CAS save command, cached-client handling and offline revocation remain separate work; this commit alone does not enforce the policy in the live routes.

MUI's current major uses slot props and `sx` in place of removed component/system props. Browser checks cover chat submission/reset, ritual action menus and zoom, keyboard table-of-contents navigation, sigil clearing and Enochian filtering/direction. The membership date picker now distinguishes a fully cleared optional date from a partially erased date: MUI 9 emits null for incomplete sections, so submission checks its public field-section API before saving. Invalid Dayjs values are rejected by both client and server schemas. Real page tests cover calendar selection, typed dates, partial/invalid input, clearing, correction and both submit buttons with the actual form/schema/picker. jsdom 30 supports actual submit-button clicks and raises the project's Node floor to 24.15.0; verification used 24.19.0. Authenticated membership browser and live database writes were not exercised.

The native Pinecone corpus preserves ada-002 LF preprocessing, original citation text and flattened metadata, the existing index/namespaces (including the empty namespace on the wire), top-10 cosine MMR selection of four sources, stable `pdf-v1` IDs and existing PDF parsing/chunking. SDK 9's supported fetch adapter forwards cancellation through host discovery and vector requests; cancellation also stops waiting during retry backoff. Tests use actual SDK requests with synthetic responses, and 500 migration-only comparisons match the old ranking algorithm. Malformed vectors fail explicitly; missing source text becomes an empty string. Embeddings are completed before sequential 100-record upserts; success means every batch resolved, not a verified server count. Retain parser/splitter LangChain dependencies until a separate corpus-versioning decision. Both chat routes now use Node because the SDK requires Node APIs. Local HTTP checks preserve legacy/v2 error shapes and invalid-input handling, and browser submission/reset recovers correctly. No live provider requests, reindexing or vector writes occurred.

date-fns 4 retains the existing named imports, local date labels, relative study durations and planetary-hour minute calculations. Comparison against the old libraries covers 2,200 outcomes across UTC, London, New York, Tokyo and Auckland, including DST transitions and actual utility output; no date-fns/Luxon differences were found. Sixteen committed tests preserve the Chaldean cycle, sunrise/sunset anchoring, minute truncation, local weekday rulers and seven-day future window. SunCalc remains independently deferred at 1.9.0: version 2 changes calculated London event times by roughly one to three minutes and returns null for unavailable polar events. Existing polar handling already fails downstream; a deliberate unavailable state in both astrology and geomancy must precede that upgrade. Do not invent replacement hours or silently redesign the browser-local timezone contract.

The three Gongo ritual publications now resolve current user/membership grants on the server and share the agreed policy. Anonymous public detail reads work; temple grades are enforced; creators/global/scoped admins receive source history only from the exact authorized parent. Top-level allowlists preserve compiled JRT while excluding source/history and unknown fields. The actual Gongo cursor helper retains delta timestamps, sorting and limits. Thirty-six tests exercise it with a synthetic Mongo boundary, including typed-reference ambiguity and grant changes. Legacy removal erases scope/parent fields, so erased tombstones are suppressed rather than broadcasting private IDs. Empty responses do not evict cached data or reset regrant watermarks. Client list filters, account/revocation reconciliation, private offline persistence and transactional writes remain explicit follow-up work; this is a read-boundary change, not complete authorization/caching acceptance.

Real offline testing exposed ritual variable changes calling `router.replace`, which requested uncached RSC data and fell back to a failed navigation. Native `history.replaceState` updates Next's search-parameter hook locally. Each debounced edit starts from the current URL, retaining other edits, duplicate query parameters, pathname and fragment. The four-test actual-control suite fails against the old implementation and passes with the fix. In Chromium offline, Member→Hierophant changed highlighted tasks from 22 to 154; queued candidate name/motto edits rendered correctly, with unchanged page time origin and preserved URL details. A separate cold-load test at a URL with query parameters failed under the existing worker cache, and new Unicode content attempted external Roboto font requests from a redundant legacy stylesheet. Thus this unit proves local interactions, not arbitrary-query cold starts or complete asset/private ritual offline acceptance; those remain worker/cache requirements.

The unused-dependency audit checked source/config imports, loader chains, installed peer requirements and the active Gongo auth entrypoint. Passport and its Google strategy have been replaced by Auth.js; the old Jade CodeMirror package is unused by the CodeMirror 6 editor; Next/Loom own environment loading; Node does not need the obsolete npm zlib package. All five direct dependencies are removed. Keep SuperJSON for Loom fixtures, Zod for AI peers, QR/CodeMirror/Emotion peers and the active compiler/PDF/build dependencies. The corpora archive pin remains required by tarot-deck. The production Loom check still reports the already tracked migration-workflow/deployment-fence gates; no new issue was introduced by removal.

The Better Auth foundation separates adapter identity/session tables from app profile, global access and protected legacy provenance. Provider subjects and explicit typed aliases determine identity; emails never merge users. Unknown providers, collisions, missing mappings and malformed dates fail preflight. Required adapter dates use the persisted import-run timestamp only where historical dates are absent; provenance retains null. Actual Better Auth 1.7.4 sign-in/session tests recognize an imported Google subject after its email changes, reject implicit linking by matching email, and reject a revoked session. Sessions and obsolete provider tokens are not imported. All four auth tables enforce UUIDv7 IDs. The real Postgres rehearsal imported synthetic rows transactionally, checked constraints/defaults and rollback, and proved all ten table contents and three migration records unchanged on rerun; every disposable database was removed. The test-only repeat importer is not the production conflict policy: the final importer still needs fingerprints, transform versions, checkpoints and row reconciliation. Schema generation now formats generated files through Biome while leaving generated-code lint/assists disabled. Runtime Auth.js/Gongo remains in place until UUID sessions and domain access are ready together; no private data was imported and the new migration has not been applied to Neon.

FilePond tests use the actual React wrapper and core with controlled XHR, checking multipart PDF metadata/file, progress, structured/proxy errors, retry and cancellation. The image page has separate FileReader/SHA256 preflight/result tests for its later Loom Files migration. Chromium checked the actual image form: existing hashes avoid POST; missing hashes send native FormData containing the selected PNG and digest, then display the returned file. All storage responses were mocked in a fresh context with service workers disabled; this does not test S3 or authenticated training in a browser. Actual FilePond UI behavior is covered by the real-control jsdom tests. The image uploader still lacks a catch/finally for rejected requests or invalid JSON and can retain an old error after a later success; preserve this as a Files migration/fix requirement.

The ordinary temple publication previously excluded `_joinPass` while persisted invite codes use `joinPass`. It now omits both names for non-admin members, and only a strict stored `admin: true` takes its admin branch. Nine tests exercise the actual registered callbacks and installed Gongo cursor helper, covering invalid truthy flags, forged client claims, membership filtering, demotion, anonymous/nonmember responses and retained scoped/global admin sharing. This corrects new responses; it does not erase invitation codes already delivered to browser storage. Cache reconciliation and intentional invite rotation remain separate.

The redundant Google Roboto stylesheet identified during offline ritual editing is removed. The theme already self-hosts the same four font weights through next/font, so the active font configuration is unchanged. The production build and Biome pass; all 63 prerendered HTML files omit that external link and the generated CSS still contains the self-hosted Roboto font. The separate cold-query ritual reload gap remains: Serwist uses exact query cache keys, while its navigation helper can skip fetching based on ignoreSearch. A future narrowly scoped public-shell handler must account for navigation preload, anonymous cache population, hydration and build-version compatibility; this font change does not claim to fix that gap or private offline access.

The group/temple SQL foundation preserves independent membership and administration flags, including valid admin-only group grants. Protected evidence retains ordered typed group references, duplicates and absent-versus-empty arrays. Temple metadata excludes invite codes; a separate protected table keeps the exact existing reveal/copy value. Memberships retain grade zero, exact motto/date values and nullable history, with unique user/temple keys. Domain foreign keys restrict deletion so an incidental auth deletion cannot erase a temple or grants. The pure planner rejects unknown fields, malformed IDs/dates, ambiguous aliases, orphan references and conflicting natural keys; canonical UUID casing is normalized while legacy source spelling remains exact. Slug preflight matches PostgreSQL btrim, including tabs/nonbreaking spaces/newlines, and does not regenerate old URLs. Forty synthetic tests plus a real disposable Postgres rehearsal cover these contracts; all sixteen table contents and four journal entries survive migration rerun unchanged, and the temporary database is removed. This adds no runtime commands or live import; temple-creation bootstrap policy, deletion/last-admin behavior and offline reconciliation remain separate.

The global Gongo HTTP bridge runs inside Auth.js verification. It derives top-level Gongo userId only from the verified nested user.id and preserves the nested identity for application RPCs; malformed/missing identities become a non-null empty trusted principal. Installed Gongo previously fell back from a null session to request-body or legacy-cookie tokens, and its legacy session lookup did not check expiry. Nineteen tests through the actual installed HTTP transport/Auth/Users path reproduce that issue and verify the fix, with zero legacy session lookups on rejected tokens. They also verify the valid-session nested/top-level mismatch is corrected, forged body identity cannot override the session, and anonymous public RPCs and ARSON payloads remain intact. The bridge currently accepts legacy ObjectId strings only; UUID sessions remain gated on the domain/auth cutover. Auth.js still owns cookie validation/refresh. This does not claim general malformed-protocol hardening or remove the broader legacy Gongo error/logging behavior.

The built local Gongo endpoint also passes HTTP smoke checks: anonymous echo preserves ARSON Dates, all three synthetic body/legacy-cookie token paths return an anonymous user subscription, and malformed ARSON text returns 400. Only dummy provider/database settings were used; the server was stopped afterward.

Ritual saves now commit exact source, a new revision, server-derived compiled content, the current pointer and a UUIDv7 operation receipt in one Mongo transaction. Stable requests survive lost acknowledgements; stale revision/update tokens reject conflicting writes; current verified identity and grants govern every command and replay. Creation derives its creator from the caller, and explicit publication requires global administration. All generic ritual insert/update/remove handlers are closed in the same change as the editor/creation conversion. The production Mongo transaction topology remains a deployment gate; the service never falls back to independent writes. Before SQL cutover, map persisted ObjectIds and preserve accepted receipt/request semantics as described in the migration contract.

The editor persists account-associated source and immutable pending requests, shows conflicts without marking the source saved, and offers explicit recovery/export. Legacy pending mutations are archived before polling and paused without deletion or automatic replay. Earlier creations may already exist, so recovery warns before making a deliberate new copy. A storage failure preserves the current in-memory source and pauses polling before incoming data can replace the only old pending copy. This temporary localStorage bridge does not provide complete private offline persistence, revocation or account cache partitioning.

Full authorized ritual/history snapshots replace unsafe cross-document timestamp deltas and the old history limit. A real Mongo regression pauses one transaction until another advances a legacy watermark, then proves the late commit remains visible. Group creation choices now validate legacy grants and construct ObjectIds correctly. A real installed client/transport test verifies IndexedDB population precedes archival and dispatch, with one transport even when network is enabled early. Its initial test-only fake-timer hang was reproduced with immediate versus delayed archive completion and corrected without increasing timeouts.

The exact production build passed six Chromium scenarios against synthetic Auth.js/Gongo responses: source preview and errors, stale-version conflict/export/restore, lost committed response with identical retry and continued typing, account-switch rejection/recovery, old pending-row archival with no generic writes, and explicit/retried creation after reload. Provider calls and service workers were blocked in fresh profiles. The known old worker registration rejection was recorded separately; the reviewed Loom PWA replacement handles it, but adoption is still pending publication. These browser checks exercise the real controls/compiler with simulated HTTP outcomes; actual authentication and database guarantees come from the separate transport and disposable Mongo tests. They do not establish private offline or production-provider acceptance. Client chunks contain no ritual transaction/receipt implementation.

The ritual SQL foundation adds four tables and a strict dependency-ordered import plan. Exact source revisions, original compiled archives and new compiler artifacts remain distinct; hashes are checked against PostgreSQL UTF-8 content and composite foreign keys enforce parent/source relationships. Only the reviewed legacy current-pointer alias conversion and explicit orphan-creator disposition are accepted. Forty-six synthetic tests and four independent review probes pass. A real Postgres rehearsal applies all five migrations, imports synthetic source/archive data, checks scope/pointer/hash/UUID constraints and rollback, and proves an unchanged rerun across twenty tables. It also confirms exact leading-BOM/CRLF retrieval, covering a PGlite decoder limitation. The disposable database was removed. All 692 default tests, scoped coverage, typecheck, Biome, Loom check and production build pass. Runtime repository activation, compiled parity, durable importer bookkeeping and accepted-operation conversion remain separate; no new migration was applied to Neon and no private records were imported.

The shared form dependency unit upgrades React Hook Form 7.65.0→7.88.0, resolvers 5.2.2→5.9.1 and Radash 12.1.0→12.1.1. Their sole app consumer remains the Valibot-backed temple membership form. Existing real-control tests cover date selection, partial/invalid input, clearing/correction and both submit actions; all 28 form/schema tests and the full 692-test suite pass without source changes. The lockfile package/snapshot inventory confirms only these three versions changed. Regeneration from the verified lock with `pnpm install --prefer-offline` avoids the unrelated transitive editor/tooling refresh performed by `pnpm update`. Typecheck, Biome, frozen install, coverage and production build pass. `loom check --production` still fails solely on the recorded migration-workflow/deployment-fence gaps, including the published checker's main-versus-master assumption; this upgrade does not enable release.

SuperMemo 2.0.23 changes package entrypoints to explicit ESM/CJS exports while retaining the same SM2 algorithm. Source inspection and 14,320 exact comparisons cover every grade across interval/repetition/ease boundaries, frozen input and one hundred deterministic hundred-review sequences. Existing study characterization and the full 692-test suite pass with unchanged schedules and coverage. Typecheck, Biome, frozen install, ordinary Loom check and the production/browser bundle pass. Only the SuperMemo package resolution changes; no stored schedules are recomputed or migrated by this dependency unit.

The operator approved publishing the two reviewed shared Loom commits. The normal
[release workflow](https://github.com/gadicc/loom/actions/runs/34697003106)
published [1.24.0](https://github.com/gadicc/loom/releases/tag/v1.24.0), whose npm
gitHead is exactly `3a84d424bb19d3b82bd3de2263d820912670e323`. Magickly now pins
that registry artifact and integrity; no local override remains. The installed
PWA JavaScript modules match the reviewed, browser-rehearsed package byte for
byte, with the client directive first. Six tests use the actual published
lifecycle: acceptance/decline, first install, cleanup, polling and async errors.
The app keeps its confirmation dialog and 60-second interval, waits for consent
before worker activation, and no longer unregisters on component cleanup.

All 698 default tests, unchanged scoped coverage, TypeScript, Biome, frozen
offline install and production build pass. Ordinary Loom checks pass; production
checks correctly still fail for the missing deployment fence and migration
workflow, now naming the configured `master` branch. Those remain release work,
not waived checks. No Magickly deployment or other consumer upgrade occurred.
Evidence: `/tmp/magickli-loom-1.24-adoption/`; the prior two-build Chromium
acceptance remains in `/tmp/magickli-loom-release-review.md`. Public query-shell
caching and private offline storage remain separate units.

Temple creation policy is now approved: any signed-in user may create a temple
and become its first administrator atomically. The creation screen must explain
that this is for someone setting up/managing a temple, and direct existing
members toward joining their temple instead. Preserve the existing separate
invite setup. SQL commands and explanatory UI remain to be integrated.

The study SQL foundation preserves stored totals independently of card sums,
typed dates, exact content keys, finite SM2 floats and all three repetition
presence states. Every legacy row receives a protected canonical EJSON snapshot
and checked hash. The reviewed duplicate is archived only when its full source
fingerprint matches; zero counters alone cannot prove an untouched schedule.
No scheduling defaults, aggregate corrections or historical events are invented.
Forty-seven new tests include a fully synthetic 49-row/667-card/459-repetition
shape and the unchanged scheduler. All 745 default tests, expanded 28-module
coverage, types, Biome, Loom checks and production build pass.

A disposable Postgres rehearsal using installed Loom 1.24.0 verified six
migrations and 23 tables, exact Date/ObjectId EJSON hashes, BOM/CRLF/Unicode
content keys, UUIDv7/defaults, relational constraints, repetition presence,
fingerprint refusal, rollback and unchanged rerun. The synthetic output retains
48 baselines and 656 active cards plus all 11 duplicate cards in its archive;
eleven stored aggregate discrepancies remain. The owned database was removed.
Evidence: `/tmp/magickli-study-postgres-rehearsal/` and
`/tmp/magickli-study-{coverage,types,check,build,loom}.log`. No private source was
imported, no Neon domain migration ran, and runtime study/offline behavior still
uses the legacy engine.

The operator approved retaining existing public file links and protecting new
ritual attachments under ritual permissions. File ownership is not invented for
the ten legacy records. Files activation, object verification and the new upload
UI remain separate work.

`createSqlRitualReader` now provides fixed metadata projections, current source
and parent-bound history through the shared ritual policy. Each valid call
verifies its current server identity and reads grants, parent policy and source
in one read-only repeatable-read transaction. Metadata never includes source,
invites or migration evidence; public readability does not grant editing history.
Current source follows the explicit pointer, not timestamps. No cross-request
cache or runtime auth switch is added.

Twenty real-query PGlite cases and a separate two-connection Postgres rehearsal
verify permissions, grade zero, admin-only group grants, account changes, exact
source and pointer selection. The underway read remains consistent when another
connection demotes the member and changes source; the next read denies access.
Regrant exposes the new pointer/version and preserves old history. BOM, CRLF
and Unicode survive the Loom Postgres driver. All 765 default tests, 29-module
coverage, types, Biome, ordinary Loom checks and production build pass. Evidence:
`/tmp/magickli-ritual-reads-postgres/` and `/tmp/magickli-sql-reads-*.log`.
Compiled output selection, HTTP/RSC adapters, writes and offline bundles remain
separate integration work.

The operator approved new uploads by authorized ritual editors, with a selected
ritual, for PNG/JPEG/GIF/WebP up to 20 MiB. Supporting that approved size on
Vercel requires direct-to-storage transfer and validated server finalization;
the ordinary function request cannot carry 20 MiB. Keep legacy links available
and defer SVG, audio and general new uploads.

The SQL temple creation service implements the approved policy for any verified
existing user. It creates the temple, first grade-zero administrator membership
and immutable receipt in one transaction. It preserves separate invite setup,
rejects normalized slug collisions, and checks the expected account. A UUIDv7
operation lock serializes identical retries; receipts confirm the original result
without restoring removed records or administration. Request changes and
cross-account receipt reuse fail. Unknown acknowledgements keep the same request.

All 802 default tests, 30-module coverage, types, Biome, ordinary Loom checks and
production build pass. Real Postgres with seven migrations/24 tables proves
concurrent identical requests create one result, colliding slugs produce one
safe conflict, lost acknowledgements replay once, an externally held lock times
out after five seconds with zero writes, and demotion/deletion stays effective
on replay. The disposable database was removed. Evidence:
`/tmp/magickli-temple-create-postgres/` and `/tmp/magickli-temple-*.log`.
The service is transport-neutral; runtime auth and the creation form still need
conversion. Reviewed copy distinguishes joining an existing temple from creating
one to manage, states the first-admin responsibility, and uses an explicit CTA
instead of the old Add button. No inactive SQL service is presented as live UI.

Public bundled rituals now have three literal static page wrappers and a shared
Suspense shell. Database IDs remain request-bound. The worker warms only
canonical anonymous HTML for those three pages and serves known display-query
variants from that build-bound cache. It verifies Next build/deployment identity,
loaded assets and explicit public caching headers; it never consumes credentialed
navigation preload. Exact matching deployment parameters on declared static
assets support offline hydration without broadly ignoring query strings.

Serwist's auxiliary navigation cache is disabled because browser evidence showed
it retaining private/authenticated HTML despite no-store. Activation clears that
old `pages` cache and this helper's obsolete caches, preserving other stores.
The published Loom consent lifecycle is unchanged. A wrong-build shell prevents
the new worker from installing and leaves the prior version usable offline.

All 845 default tests, 32-module coverage, types, Biome, ordinary Loom checks and
the integrated production build pass. The built manifest contains exactly the
three intended public static routes while the dynamic ID route remains excluded.
Nine Chromium scenarios across two synthetic production builds verify cold
offline queries, real controls, no authenticated/preload sentinel in the dedicated
cache, removal of the old HTML cache, no speculative navigation worker, failed
update recovery, consent and exact-deployment asset hydration. HTTP checks retain
private-route no-store behavior and editor/alias routes. Evidence:
`/tmp/magickli-public-ritual-shells/` and `/tmp/magickli-public-shells-*.log`.
This covers public bundled rituals after successful online installation. Private
ritual bundles, existing general authenticated caches, cache eviction and Safari
device acceptance remain distinct gates; the approved private 14-day policy does
not apply to these publicly bundled texts.

The protected backup preflight now accepts the unchanged source through every
current auth, membership, ritual and study planner with the two reviewed
exceptions. All 48 active study snapshots reproduce the stored scheduler state;
the duplicate remains in its full protected archive. All 59 ritual sources
compile. Five current trees are equivalent under the named comparison-only
rules for derived `forMe` and empty text children; originals remain untouched.
The aggregate report is [protected backup preflight](005-protected-backup-preflight.md).

The SQL ritual reader can now return exact archived rendered content to ordinary
authorized readers, independently of editor-only source history. It selects only
the archive bound to that parent's current revision within the same permission
snapshot. Missing or stale output returns null, without recompilation or another
artifact fallback. New SQL writes must add explicit artifact selection before
advancing those pointers.

All 855 default tests, 32-module coverage, types, Biome, ordinary Loom checks and
the production build pass. The expanded SQL tests cover exact JSON/hash,
revocation, account changes, own-parent binding and missing/stale output. An
installed-JRT renderer test preserves the observed legacy empty-text-child shape
and proves identical markup without mutating it. Evidence:
`/tmp/magickli-rendered-sql-*.log` and `/tmp/magickli-protected-preflight/`.
No private SQL import or runtime repository switch was performed.

The Files foundation uses Loom's unchanged v3 managed schema with UUIDv7 IDs.
An app-owned protected table retains full legacy EJSON/hash, typed identity,
original public path, storage location and sync bookkeeping. None of that
provenance enters public `meta`. Legacy files stay public with null ownership;
all object keys, MIME/size claims, filenames, image metadata and creation dates
are preserved. The canonical update date explicitly records import time.
Unknown fields, lossy metadata, duplicate hashes and alias conflicts stop the
planner. Array accessors and hidden fields are rejected before values are read.

All 926 default tests, 33-module coverage, types, Biome, ordinary Loom checks and
the production build pass. Eight generated migrations create 26 tables in a
disposable Postgres rehearsal. The actual Loom driver preserves BOM/CRLF/Unicode
filenames, nested metadata, source EJSON/hashes and dates, including under a
London database session timezone. Constraints, UUIDv7/private defaults, rollback
and unchanged migration rerun pass; the owned database was removed. Evidence:
`/tmp/magickli-files-postgres/` and `/tmp/magickli-files-*.log`.

A separate read-only preflight accepts the ten actual file metadata rows with
all source snapshots, fields and aliases accounted for and all 21 backup
fingerprints unchanged. It uses explicitly synthetic storage-location inputs;
production location binding and all ten object-byte checks remain outstanding.
Evidence: `/tmp/magickli-protected-preflight/files-plan-report.json`.
Files remains `planned` in Loom until the closed runtime adapters are complete.
No new routes, provider writes, private attachment grants or Neon migrations
were activated by this unit.

The approved private offline policy now has a pure implementation and a reviewed
[integration design](006-private-offline.md). A fresh authenticated ritual
permission check grants at most 14 days; local reads and generic session/network
success do not renew it. The local deadline conservatively accounts for request
start and remaining server time. Expiry and observed clock rollback latch until
a new allowed check. Account epochs and latest request IDs fence late replies.

Read and source/edit capabilities are separate. Confirmed denial removes
renewable downloads and locks unique recovery; edit-only revocation keeps read
access but removes source snapshots and locks draft reopening/export. Temporary
auth or network failure preserves only the existing lease's remaining window.
All 962 default tests, 34-module coverage, types, Biome and ordinary Loom checks
pass. The 36 pure lease cases have complete scoped coverage. Evidence:
`/tmp/magickli-offline-lease-*.log`.

Dexie transactions, complete bundles/assets, the permission endpoint, migration,
sign-out and reader/editor guards remain to be integrated together. No current
Gongo cache gains a lease through this module. Never-updating old clients cannot
be retrofitted with expiry. Application locks preserve unique source bytes and
are not a promise of tamperproof recall or physical deletion of every copy.

The [SQL v2 ritual write service](007-sql-ritual-write-contract.md) now commits
exact source, a versioned compiled artifact, parent revision/version pointers
and an immutable operation receipt together. Current grants remain locked through
accepted writes; retries recheck current permission and preserve operation
identity. Ordinary saves cannot change scope or attribution. Public publication
is a separate global-admin command. Readers select the exact supported artifact,
with legacy archive fallback only for imported parents without a selection.
Output compatibility is independent of the compiler's code/package identity.

All 1,045 default tests, 37-module coverage, types, Biome, ordinary Loom checks
and production build pass. Real PostgreSQL verifies concurrent replay/CAS,
revocation for all three grant types, deletion blocking, five-second lock timeout,
rollback, lost acknowledgement, exact source/artifact preservation and unchanged
migration rerun across nine migrations and 27 tables. The generated composite
unique constraint precedes its referencing foreign key. The disposable database
was removed; source hashes stayed unchanged. Evidence:
`/tmp/magickli-write-postgres-rehearsal/` and `/tmp/magickli-sql-writes-*.log`.

No SQL write route or runtime identity switch was activated. Legacy v1 commands,
Mongo receipts and browser recovery must be reconciled before the new protocol
boundary ships. Migration 0008 and the preceding domain migrations remain local;
no new Neon migration or private import ran.

The account-scoped ritual repository now uses exact Dexie 4.4.6 and test driver
fake-indexeddb 6.2.5. It atomically gates private reads, publishes only complete
hashed bundles, fences stale account/check replies, and preserves unique recovery
through expiry, revocation and failed sign-out cleanup. Draft CAS retains separate
conflicting variants. The SQL-v2 save outbox verifies immutable payload checksums,
serializes claims across tabs and retries the original operation after uncertainty.

All 1,103 default tests, 39-module coverage, types, Biome, ordinary Loom checks
and production build pass. Nine native Chromium scenarios verify Blob persistence/decoding across a
full restart, two-tab checks/claims, locked recovery, account isolation and native
rollback after injected quota/deletion errors. The owned browser/server were
stopped. Evidence: `/tmp/magickli-dexie-repository/browser/` and
`/tmp/magickli-dexie-*.log`. This is repository acceptance; runtime private-reader,
auth, service-worker, lifecycle and legacy recovery integration remain separate.

The local Vercel configuration now records the approved London function region
and disables automatic Git deployments of `master`. Vercel documents that
unspecified branches retain their existing enabled default; no broad preview
exception can override the production fence. References:
[Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
and [function regions](https://vercel.com/docs/functions/configuring-functions/region).
This file has not been pushed or deployed, so the live Paris compute and existing
provider settings remain unchanged. A reviewed migration/release workflow,
preview database isolation and staged acceptance are still required before
release; the production Loom check must continue failing on the missing workflow.

A read-only verification of all ten legacy public image URLs returned HTTP 200
with matching backup SHA-256, size and MIME type: 7,790,234 bytes in total. Streams
were bounded and no raw image bodies retained. All 21 backup fingerprints stayed
unchanged. The local environment has no AWS/S3 settings, so this verifies the
existing application delivery path, not direct bucket access, private policy or
CORS. Evidence: `/tmp/magickli-file-object-preflight/public-route-report.json`.
Provider binding and private-upload acceptance remain required. Separately,
`fb07660` removed session-token and full profile/user debug logs from the legacy
authentication path; types/Biome pass without changing sign-in behavior.

The server permission checker now reloads current identity, policy and selected
output in one SQL snapshot, returning explicit bound denial, authentication or
temporary outcomes. An allowed parent whose output is unavailable still receives
its bounded source/read capability. Only editors receive source CAS tokens;
ordinary readers get opaque render identity. The shared selector preserves the
existing exact artifact/archive rules. Strict parsing rejects malformed, cached,
wrong-origin or generic HTTP responses as temporary rather than revocation.

Dexie now accepts check-only grants with an explicit accepted lease marker.
Source installation binds the latest accepted request and current lease; an
unaccepted check cannot borrow old permission. No complete bundle ID means no
bundle installation or renewal. All 1,246 default tests, 42-module coverage,
types, Biome, ordinary Loom checks and production build pass. Evidence:
`/tmp/magickli-permission-check/`, `/tmp/magickli-check-only-repository/` and
`/tmp/magickli-permission-*.log`. No HTTP route, auth switch or download activation
occurred; transport validation, source response binding and complete asset
manifests remain integration work.

The [protected Files finalizer](008-protected-ritual-files.md) validates exact
staged bytes and every supported image frame before a private Loom save. The SQL
publication callback must recheck current identity/edit access and atomically
commit file/link/receipt after provider I/O. Staging replacement, cross-owner
deduplication, truncated animations, late completion and mutable limit settings
are covered. Actual native deadline/cancellation smoke checks passed, with the
remaining native-memory/concurrency limit explicitly recorded. All 1,344 default
tests, 46-module coverage, types, Biome, ordinary Loom checks and production build
pass. No provider adapter or route is activated by this unit.

Authenticated Vercel CLI inspection also established the existing provider as
Cloudflare R2. Direct reads verified all ten objects (7,790,234 bytes) against
backup SHA/size without retaining raw bodies or changing provider/backup state.
Storage MIME headers differ from Mongo on all ten; legacy delivery must preserve
Mongo MIME precedence. Bucket privacy/CORS and direct-upload restrictions remain
unverified. The [preflight](005-protected-backup-preflight.md) supersedes the earlier
local-configuration limitation with this narrower direct-read evidence.

The protected Files SQL adapter now implements immutable initiation, bounded worker
claims, current-policy atomic publication and replay without resurrection. The
actual PostgreSQL duplicate race exposed postgres-js's `constraint_name` field;
the corrected mapping has direct/wrapped driver regressions and only recognizes
the managed digest constraint. All 1,441 default tests, 47-module coverage, types,
Biome, ordinary Loom checks and production build pass. Sixteen real Postgres
acceptance gates and unchanged migration rerun across 29 tables pass; the owned
database was removed. See the [Files contract](008-protected-ritual-files.md) and
`/tmp/magickli-upload-postgres-rehearsal/`. Migration 0009 is local only; no route,
auth, provider or private-data cutover occurred.

The [offline lifecycle](006-private-offline.md) now coordinates cold start, resume,
expiry, account changes and sign-out with the gated Dexie repository. A separate
permission-check token repairs expired access without granting cached bytes.
Cross-tab close notifications cannot reopen the old account before its durable
fence. Opaque recovery survives coordinator disposal and failed persistence.
Review reproduced and fixed unviewed old-bundle retention after check-only renewal
and duplicate persistence from reentrant observers. All 1,499 default tests,
49-module coverage, types, Biome, ordinary Loom checks and production build pass.
Ten native Chromium lifecycle scenarios pass with no external requests or page
errors. No reader/editor/auth/service-worker activation occurred.

Canonical R2 reads exposed the legacy bucket-prefixed object keys. The importer
now records an explicit verified prefix and keeps the public digest URL separate.
All ten actual files pass the bound in-memory preflight; all 1,506 tests, scoped
coverage, types, Biome, ordinary Loom checks and production build pass. Real
Postgres verifies existing-row upgrade, exact key bytes, rollback constraints and
unchanged eleven-migration/29-table rerun. Migration 0010 remains local.

Live R2 probes also confirm signed SHA/length and conditional-write enforcement.
All newly created tiny rehearsal objects were removed, with no changes to existing
files or bucket configuration. Provenance must be signed HTTP headers: R2 ignored
query-hoisted metadata. Canonical CORS inspection is denied to the current object
credentials; private bucket configuration and full browser uploads remain pending.
See the [Files contract](008-protected-ritual-files.md) for exact evidence and limits.

The R2 adapter now implements those verified provider constraints with explicit
configuration and immutable SQL descriptors. It bounds signed capabilities and
streams, preserves uncertain canonical writes for exact-operation reconciliation,
and uses Loom conditional storage without overwriting or deleting objects.
All 1,568 default tests, scoped coverage, types, Biome, ordinary Loom checks and
production build pass. No existing package version changed when adding SDK v3;
legacy AWS v2 remains until the old file route is replaced. Private bucket setup,
authenticated upload/download integration and complete browser acceptance remain
required before activating Files.

JRT's private node cache now uses WeakMap through a pinned pnpm patch. The exact
installed module hash enters compiler/renderer identity; compatible output profile
1 remains unchanged. All 1,573 default tests, coverage, types, Biome, frozen install,
ordinary Loom checks and a clean production build pass. Actual browser bytes prove
the patch reached the editor after stale incremental output was detected and
discarded. Ten browser stages preserve rendering, editing, recovery and saving;
known hook-order errors still recover as before. Controlled GC evidence remains
outside CI. See the [offline record](006-private-offline.md) for evidence and the
separate editor-console reference cleanup. No JRT release or private UI activation
occurred. Production Loom validation still fails only on the missing migration
release workflow.

The editor now retires its console scripting handle on unmount or account
replacement, ignores late compilation results, and releases source-map consumers.
Console scripts, current error reporting and retained drafts remain usable.
All 1,651 tests, scoped coverage, types, Biome, ordinary Loom checks and production
build pass. Twelve native browser stages cover same-document navigation, account
changes, actual scripting, saving and cold-reload recovery. Known hook-order
recovery remains unchanged; private offline runtime integration is still pending.
See the [offline record](006-private-offline.md) for the separate unit/browser
evidence and the corrected same-document browser harness.

The SVG compatibility profile now validates all six public files, seven legacy
uploaded files and the backed-up inline SVG while retaining exact original bytes.
Unicode IDs, parsed CSS and inherited paint dependencies are covered; new SVG
uploads remain unsupported. All 1,891 tests, expanded coverage, types, Biome,
ordinary Loom checks and production build pass. Six public images also preserve
pixels when rendered from offline Blob bytes in Chromium. Complete asset-plan
and private runtime integration remain pending; see the
[offline record](006-private-offline.md).

Inline-image transport now preserves decoded bytes under finite size limits,
with 90 new cases and exact-byte acceptance for both backed-up inline images and
the four PNGs embedded in public SVGs. All 1,789 tests, expanded coverage, types,
Biome and ordinary Loom checks pass. SVG validation and offline runtime wiring
remain pending; see the [offline record](006-private-offline.md).

The static raster catalog now verifies configured public images once and retains
their exact compressed bytes under a deterministic catalog identity. Lookup copies
cannot mutate the snapshot, disk changes require a new catalog, and unresolved
files never enter usable membership. All 1,699 tests, expanded scoped coverage,
types, Biome, ordinary Loom checks and production build pass. Actual public-file
acceptance preserves all 15 source hashes. The [offline record](006-private-offline.md)
tracks resource bounds, the TypeScript target correction and remaining SVG,
inline/generated/external resolution and complete-bundle integration.

The static catalog now incorporates the verified SVG profile. All 15 canonical
public images and both exact aliases are available, retaining original bytes;
four embedded rasters also pass full decoding. SVG dependency evidence remains
distinct from raster pixel facts. All 1,908 tests, expanded coverage, types, Biome,
ordinary Loom checks and production build pass. Static SVG resolution is complete;
the remaining asset sources, complete authorized manifests and private runtime
activation are still pending. See the [offline record](006-private-offline.md).

The static/inline resolution plan now binds exact selected-content bytes to all
image occurrences, preserving query/fragment identity and reporting missing media
explicitly. Two archived trees and two public builtin trees have complete image
plans; the remaining source kinds are still pending. All 1,933 tests, expanded
coverage, types, Biome, ordinary Loom checks and production build pass. The verified corpus and
public files remain unchanged. This is server image evidence; authenticated
bundle publication and private reader activation remain separate requirements.
See the [offline record](006-private-offline.md).

Read-only [image acquisition findings](009-ritual-image-acquisition.md) verify
three external originals and a same-file standard-size Wikimedia replacement.
The generated Tree of Life font probe works offline but exposes asynchronous font
settling after `image.decode()`. The original sources and runtime routes remain
unchanged; durable acquisition and generated-image acceptance are still required.
Browser artifacts now have a scoped Git ignore rule.

The [legacy public-image reader](009-ritual-image-acquisition.md) now captures
only verified import projections using exact recorded R2 keys. Independent
adversarial review found and closed sparse-array validation before I/O. Synthetic
tests exercise provenance mismatches, collisions, MIME/byte validation, failed
and stalled SDK responses, cancellation and copy ownership. Actual acceptance
passes all ten legacy objects without provider/database writes; the live file
route and private reader remain unchanged. The validator identity extraction
preserves existing static catalog semantics.

This checkpoint passes 77 new cases and all 2,010 default tests (14 opt-in Mongo
tests skipped). The expanded 57-module coverage gates pass at 98.18% statements,
96.80% branches, 99.87% functions and 99.28% lines. Typecheck, Biome, ordinary
Loom check and production build pass with existing warnings. Final review and
provider acceptance used the same reader source hash; logs are
`/tmp/magickli-legacy-catalog-{coverage,types,biome,loom,build}.log`.

The reusable `modernize-app` skill is being developed in ignored
`.loom/drafts/modernize-app/`, following the operator's instruction to keep it out
of Loom until this modernization is complete. Conversation review, structural
validation and an independent synthetic Gongo/internal-auth forward test are
complete for the initial draft. Runtime migration and cutover lessons remain to
be added; no shared skill has been committed, installed or published.

Legacy-image plan integration passes independent adversarial review, all 37 plan
tests (12 new), and 2,022 default tests with 14 opt-in Mongo cases skipped. The
57-module coverage gates pass at 98.18% statements, 96.81% branches, 99.87%
functions and 99.29% lines; types, Biome, ordinary Loom check and production build
pass. Actual corpus acceptance resolves 12/17 archived image occurrences, leaving
four external and one generated-image gap. Plan v2 binds the optional legacy
catalog identity and copied bytes while retaining exact source/query/fragment
identity. No runtime route, cache readiness or private-file grant changed.
Evidence: `/tmp/magickli-legacy-plan-acceptance.json` and
`/tmp/magickli-legacy-plan-{coverage,types,biome,loom,build}.log`.

The external image reader uses a closed four-reference policy with pinned acquired
bytes rather than permitting arbitrary host/path requests. Native acquisition
validates three unchanged originals and the same-file Wikimedia standard-size
replacement, 331,535 bytes total. Unknown references produce no DNS/HTTP call.
The default suite passes 2,101 tests (79 new; 14 opt-in Mongo cases skipped).
All 58-module coverage gates pass: 98.19% statements, 96.78% branches, 99.87%
functions and 99.31% lines. Types, Biome, ordinary Loom check and production build
pass. The reader has independent design/code review, including Node 24 connection
and proxy behavior. No provider/database writes, raw reference/image retention or
runtime route changes occurred. See the [acquisition record](009-ritual-image-acquisition.md)
and `/tmp/magickli-external-catalog-{acceptance.json,coverage.log,types.log,biome.log,loom.log,build.log}`.
