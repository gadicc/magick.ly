Implementation began on 12 September 2026, following the approved [modernization plan](./001-modernization-research.md). Commit each verified, isolated change. Keep package/configuration changes and final integration under one owner; bounded agents own compiler tests, study tests and a read-only migration audit.

| Unit | Status | Verification / notes |
| --- | --- | --- |
| Planning and backup protection | Complete | Production dump checksums, gzip, BSON and JSON verified; dump directory ignored; London/London confirmed |
| Runtime and tooling baseline | In progress | Node 24 selected; verify install, lint, typecheck, tests and build before dependency upgrades |
| Unused tRPC | Planned | Empty procedures and no client callers confirmed |
| Compiler characterization | Complete | 33 tests; output and source-map parity across eight samples including three complete built-in rituals; typecheck and scoped Biome pass |
| Study characterization | Complete | 24 tests cover grading boundaries, schedules, totals, anonymous initialization and nonmutation; contained edge fixes follow separately |
| Data mapping audit | In progress | Aggregate inspection only; never commit private dump values |

Pinecone is the authoritative vector store. Retire the unused Mongo ingestion experiment and inspect history for a recoverable Pinecone ingestion implementation. Defer pgvector migration until retrieval parity and operational tradeoffs can be measured.
