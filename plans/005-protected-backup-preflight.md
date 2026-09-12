# Protected backup import preflight

The 2026-09-12 backup passes the current pure auth, membership, ritual and study import planners with the two reviewed exceptions in the [migration contract](003-data-migration-contract.md). The preflight read BSON in memory, used disposable UUIDv7 allocations, and made no database writes or provider requests. All 21 manifest-listed files and the manifest matched their fingerprints before and after; no production mappings or private fixtures were retained.

## Results

The backup contains 190 documents across 10 collections. A separate metadata inventory found 10 images: 3 JPEG and 7 SVG, all with valid creation dates and no owner field. Stored image formats, MIME types and byte sizes agree. Legacy SVG links must remain supported independently of the new-upload format allowlist; file import planning is separate.

| Boundary | Preserved result |
| --- | --- |
| [Auth normalization](../src/migration/normalizeLegacyAuth.ts) and [auth import](../src/migration/planBetterAuthImport.ts) | 12 users, 12 provider identities, 13 email records; no shared-email collisions. One obsolete strategy configuration excluded and 36 sessions discarded. Five missing historical creation dates remain explicit. |
| [Membership import](../src/migration/planLegacyMembershipImport.ts) | 1 group, 2 combined membership/admin grants, 1 temple, 1 protected invite and 7 temple memberships, including grade zero. The global access projection retains 1 administrator. |
| [Ritual import](../src/migration/planLegacyRitualImport.ts) | 5 rituals, 59 revisions and 5 exact original compiled archives. One unresolved creator remains nullable with explicit evidence; the current revision author is not substituted. |
| [Study import](../src/migration/planLegacyStudyImport.ts) | 49 source rows become 48 active baselines and 1 protected duplicate archive. All 49 full EJSON snapshots and hashes match the source. |

No new source-shape rejection required a mapper or schema relaxation.

## Reviewed study duplicate

The reviewed duplicate contains the same 11 card keys as its retained counterpart. Its set/card correct, incorrect and time counters are zero; all cards have initial SM2 interval/repetition/ease and repetition weight 1. Every card due date is a genuine Date at the same instant as the set due date. Historical creation/update dates are absent, while legacy sync bookkeeping is present.

The exception uses the independently reviewed full-source SHA-256 and typed source references tied to the unchanged backup manifest. Without that declaration, the planner rejects the duplicate. Future input must match the fixed fingerprint; zero counters alone do not establish approval.

All state remains accounted for:

- 667 card states: 656 active plus 11 archived.
- 459 repetition objects: 448 active plus 11 archived.
- 208 active cards have no repetition object; no empty repetition objects occur in this backup.
- All 48 reconstructed active snapshots match the original scheduler fields, Date values, counters, card keys and repetition presence.
- One quirk-bearing row and 11 aggregate discrepancy rows remain preserved. No totals were recomputed and no historical review events were created.

## Ritual source and compiled output

All 59 historical revision sources compile under the current compiler. Four of the five current trees match structurally after removing the 152 derived `forMe` properties from comparison copies only.

The remaining difference is one stored text node with `children: []`, where the current compiler omits that property. There is no remaining text, node-type, attribute-value or child-count difference. A synthetic test against installed `json-rich-text` verifies identical rendered markup for those two shapes and unchanged stored input.

All **5/5 current trees are semantically equivalent under the two named comparison rules**, `derived-forMe` and `empty-text-children`; the result remains **4/5 after `forMe` alone**. These rules apply only to comparison copies. Original compiled archives remain exact, including `forMe`, empty arrays and unknown JRT attributes.

The initial [SQL ritual reader](../src/doc/sqlReads.ts) may return an original archive only when its claimed revision is the current revision of that same authorized ritual. Missing or stale archives fail closed. New saves must introduce explicitly versioned artifact selection as part of their write contract; this preflight does not authorize automatic replacement with recompiled import output.

## Remaining cutover gates

This preflight validates the pure planning boundaries, not a live import. Transactional import and durable UUID aliases, a final backup under the approved write pause, legacy write-receipt handling, file migration, the one-time reauthentication switch and private offline acceptance remain separate gates. Follow the [migration contract](003-data-migration-contract.md) and [implementation ledger](002-implementation-ledger.md) for their status.
