The importer now has a pure preparation step and exact protected checkpoint
format. It allocates every canonical, alias-row and email-provenance UUID before
serialization. The SQL checkpoint table, atomic apply transaction, authoritative
backup loader and maintenance command remain to be implemented. No runtime route
uses this code.

## Preparation and source accounting

`prepareLegacyImport` accepts ten explicit decoded BSON collections, optional
`ritualWriteReceipts`, a fixed `importedAt`, reviewed configuration and an optional
UUIDv7 allocator. Configuration records the forum origin, file location,
fingerprinted study duplicate and unresolved-creator declarations. Unknown or
missing collections, unknown auth fields, conflicting IDs, unclassified domain
state and unused allocations stop preparation.

The grouped plan preserves identity/access, membership, rituals, study, files,
Discourse and protected evidence. Sessions are discarded count-only. Known OAuth
tokens, obsolete strategy configuration and opaque provider profile subtrees
never enter the checkpoint. Historical locale/gender values and photo provider
labels remain protected evidence by typed user identity and exact field position,
with no new runtime meaning. Unknown login/password fields are refused.

The saved plan itself is the allocation manifest; resume never recomposes it.
All canonical IDs, email-evidence IDs, alias-row IDs and alias creation dates are
explicit. Approved aliases share canonical IDs only through existing planners;
the archived study duplicate receives no independent ID. Configuration, BSON IDs,
dates and application projections are copied before the allocator can run.

Receipt policy is explicit. `require-empty-collection` refuses absence;
`allow-reviewed-pre-bridge-absence` permits the specifically reviewed snapshot
predating the undeployed Mongo write bridge. Both refuse nonempty receipts until
exact v1 archive/recovery handling exists. No receipt is translated into SQL v2.

## Checkpoint representation and authority

`legacyImportValue` preserves JSON scalars/containers and genuine Dates through
tagged containers. Literal tags and arbitrary own keys remain data; date-looking
strings stay strings. There is no custom class revival, path interpretation or
global registry. Installed SuperJSON rejects legitimate keys such as
`constructor`; the import-specific codec preserves them without changing object
prototypes. Shared references are copied by value. Cycles, sparse arrays,
accessors, hidden properties, unsupported classes and lossy values are refused.

Accepted output is bounded to 64 MiB, one million logical values and depth 256.
JSON framing and escaped bytes are charged before stringification. Wire depth and
token bounds are checked before parsing, followed by canonical reserialization.
These are representation bounds, not a total process-memory claim.

`createLegacyImportCheckpoint` binds exact payload bytes to a UUIDv7 run ID and
source-manifest, source-descriptor, schema and destination hashes. It hashes the
actual copied configuration. Resume verifies every binding plus payload and
configuration digests and returns fresh owned values without ID allocation.
This provides integrity for trusted maintenance data, not target authentication,
arbitrary row validation or browser import authority. The future SQL service
must bind the actual connection and reconcile known table rows.

## Verification on 13 September 2026

Independent source/allocation/SQL design reviews and 123 independently authored
codec cases informed the implementation. Review found and fixed escaped-string
budget expansion. Local adversarial review found and fixed application mutation
through the allocator callback. Review workers then hit the account usage limit;
final composition/envelope review and remaining tests were completed locally.
The whole final unit did not receive a completed second-agent review.

All 272 new tests pass: combined domain planning, typed aliases, reviewed
exceptions, secret exclusion, mutation isolation, receipt policies, historical
profile evidence, damaged checkpoints and serialization boundaries. The full
suite passes 3,288 tests with 14 opt-in Mongo cases skipped. All 77-module coverage
gates pass at 98.30% statements, 97.15% branches, 99.90% functions and 99.34% lines.
Types, Biome, ordinary Loom check and production build pass.

The protected corpus pass accounts for 190 documents: 12 users, 12 provider
accounts, 13 email evidence rows, 175 aliases, five rituals, 59 exact sources,
five archives, 48 study baselines, 656 active cards, 49 snapshots, ten files and
seven forum links. It classifies 36 discarded sessions, one strategy row, ten
embedded token fields, 17 opaque profile subtrees and 41 modern OAuth fields.
Protected evidence also retains four locale values, one gender value and six
photo provider labels. Repeat preparation and checkpoint round trips match with
a 3,425,036-byte payload; all 21 backup files/767,839 bytes and 11 module
fingerprints remain unchanged.

That pass uses disposable IDs and explicitly synthetic file/schema/target
configuration. The payload is never saved or usable as a production checkpoint.
It reuses the earlier native-scalar BSON projection; exact wire-type verification
belongs to the future owned loader. There were no database/provider calls or
writes. Evidence: `/tmp/magickli-prepared-import-preflight/report.json`, SHA-256
`a1a341e21fca0843aacf16f066028ab776a725456f384937ec2dae3ba8cd433e`,
`/tmp/magickli-import-preparation-{coverage,types,biome,loom,build}.log`, and
`/tmp/magickli-import-{plan,source,sql}-design.md`.

## Next integration

Use one protected singleton prepared run and one ordered atomic application
transaction under a fixed database-wide import lock. Refuse a nonempty target;
verify exact migration artifacts and the actual selected destination. Reconcile
complete expected rows before recording completion. An uncertain commit resumes
the saved plan; completed retries never recreate deleted rows or overwrite newer
state. This corpus does not need a generic batch or expiring-claim framework.

The owned source loader must verify the pinned manifest/files, bound gzip/BSON
decoding, retain raw frame/type evidence before native scalar projection and
refuse unknown collections or receipt-policy violations. Final cutover still
requires a fresh backup under the approved write pause and the separately tested
canonical-auth, SQL runtime, private offline and recovery paths.
