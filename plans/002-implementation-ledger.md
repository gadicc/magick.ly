Implementation began on 12 September 2026, following the approved [modernization plan](./001-modernization-research.md). Commit each verified, isolated change. Keep package/configuration changes and final integration under one owner; bounded agents own compiler tests, study tests and a read-only migration audit.

| Unit | Status | Verification / notes |
| --- | --- | --- |
| Planning and backup protection | Complete | Production dump checksums, gzip, BSON and JSON verified; isolated Mongo restore validated all 190 documents, 10 collections and 20 indexes; dump directory ignored; London/London confirmed |
| Runtime and tooling baseline | Complete | Node 24/pnpm 10.18; frozen install, Biome, typecheck, coverage and build pass; explicit CI and scripts; obsolete ESLint/Prettier removed; redundant Biome defaults removed |
| Unused tRPC | Complete | Removed scaffold and both dependencies; lockfile update removes only tRPC; generated route types, full typecheck and 58-test suite pass |
| Compiler characterization | Complete | 33 tests; output and source-map parity across eight samples including three complete built-in rituals; typecheck and scoped Biome pass |
| Study characterization | Complete | 24 tests cover grading boundaries, schedules, totals, anonymous initialization and nonmutation; contained edge fixes follow separately |
| Study edge cases | Complete | Six additional tests; new cards initialize and become due; single-card selection and repetition cannot get stuck |
| Data mapping audit | In progress | Aggregate inspection only; never commit private dump values |
| Pinecone ingestion restoration | Complete | 28 tests including real PDF parsing; server-side global-admin checks, validation, stable retry keys and preserved embedding/index/namespace contract; Mongo vector path/dependency removed |
| Tarot module import | Complete | Correct namespace import; six card lookup/local-image tests pass; production build confirms the missing-default-export warning is gone |
| Loom bootstrap and Biome | Complete | Loom 1.23.0, Biome 2.5.13, SuperJSON 2.2.6 and Valibot 1.5.0; managed instructions/skill links and manifest; frozen install, 98 tests, scoped coverage, typecheck, lint and production build pass |

Pinecone is the authoritative vector store. The unused Mongo ingestion experiment and its dependency are removed. History contained no reusable Pinecone ingestion path, so the uploader now uses the installed Pinecone API directly through a small service. Ingestion pins `text-embedding-ada-002` and newline stripping to match the installed retrieval defaults; retain this compatibility during the AI dependency upgrade. Uploads are limited to 4 MiB by the existing Vercel request path; larger-file ingestion can follow Loom Files/jobs adoption. No live vectors were written. Existing unrelated vector IDs cannot be deduplicated by the new content-derived retry IDs. Defer pgvector migration until retrieval parity and operational tradeoffs can be measured.

The Node 24 baseline production build completes with existing tarot import and BSON target warnings, expected local-placeholder Mongo connection errors from eager initialization, and an invalid sitemap base URL caused by the old config loader. These are tracked for separate fixes. Service credentials were overridden with local/build-only values; Google Font downloads were allowed. CI is configured but has not run on GitHub yet.

Coverage currently gates the extracted compiler, study scheduler, geomancy and training services/route: 100% statements/lines/functions and 98.57% branches. This is intentionally scoped coverage, not a whole-site percentage. Expand the include list as domain logic is extracted. The current full suite has 98 tests.

Loom is bootstrapped with no application features active yet. Its required formatter compatibility prompted the Biome update and configuration migration. The new SVG parser is excluded from existing designer assets. The explicitly intentional JRT hook model has a file-scoped exception; an unrelated unused hook component was removed. Forty-four newly reported array-index-key findings remain warnings while their owning features are migrated: changing component identity as a formatting fix would be unsafe. Import ordering uses the new defaults.

CI actions now use verified release commit hashes, maintained by Dependabot. `loom check --production` passes with advisory warnings about a future pnpm 11 migration and the missing Next 15 agent-docs fallback. pnpm stays on the verified 10.18.0 pin; Next 16 will provide its bundled docs. The successful build still reports the previously recorded BSON target warning, eager local Mongo connection failures and sitemap configuration issue. No production services or configuration were changed.
