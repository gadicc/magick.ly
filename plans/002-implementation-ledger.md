Implementation began on 12 September 2026, following the approved [modernization plan](./001-modernization-research.md). Commit each verified, isolated change. Keep package/configuration changes and final integration under one owner; bounded agents own compiler tests, study tests and a read-only migration audit.

| Unit | Status | Verification / notes |
| --- | --- | --- |
| Planning and backup protection | Complete | Production dump checksums, gzip, BSON and JSON verified; dump directory ignored; London/London confirmed |
| Runtime and tooling baseline | Complete | Node 24/pnpm 10.18; frozen install, Biome, typecheck, coverage and build pass; explicit CI and scripts; obsolete ESLint/Prettier removed; redundant Biome defaults removed |
| Unused tRPC | Complete | Removed scaffold and both dependencies; lockfile update removes only tRPC; generated route types, full typecheck and 58-test suite pass |
| Compiler characterization | Complete | 33 tests; output and source-map parity across eight samples including three complete built-in rituals; typecheck and scoped Biome pass |
| Study characterization | Complete | 24 tests cover grading boundaries, schedules, totals, anonymous initialization and nonmutation; contained edge fixes follow separately |
| Study edge cases | Complete | Six additional tests; new cards initialize and become due; single-card selection and repetition cannot get stuck |
| Data mapping audit | In progress | Aggregate inspection only; never commit private dump values |

Pinecone is the authoritative vector store. Retire the unused Mongo ingestion experiment and inspect history for a recoverable Pinecone ingestion implementation. Defer pgvector migration until retrieval parity and operational tradeoffs can be measured.

The Node 24 baseline production build completes with existing tarot import and BSON target warnings, expected local-placeholder Mongo connection errors from eager initialization, and an invalid sitemap base URL caused by the old config loader. These are tracked for separate fixes. Service credentials were overridden with local/build-only values; Google Font downloads were allowed. CI is configured but has not run on GitHub yet.

Coverage currently gates only the extracted compiler, study scheduler and geomancy modules: 100% statements/lines/functions and 97.8% branches. This is intentionally scoped coverage, not a whole-site percentage. Expand the include list as domain logic is extracted. The current full suite has 92 tests, including the pending Pinecone ingestion slice.
