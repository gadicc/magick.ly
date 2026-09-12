This document specifies the Mongo-to-Postgres data migration for Magickly. It records the aggregate production audit and completed local restore rehearsal from **12 September 2026**, then defines the requirements for later schema/import implementation. No SQL import or Neon provisioning has been performed by this audit. The [modernization plan](/home/dragon/www/projects/magickli/plans/001-modernization-research.md) supplies the broader sequence; the [implementation ledger](/home/dragon/www/projects/magickli/plans/002-implementation-ledger.md) records completed code changes.

The approved destination is Vercel London `lhr1` with Neon AWS London `aws-eu-west-2`. Canonical application IDs must be UUIDv7. A short write pause and one-time reauthentication are accepted. Pinecone remains authoritative for chat; the unused Mongo vector experiment is excluded. Private rituals must remain available offline, including after a cold start in airplane mode. The current [Loom manifest](/home/dragon/www/projects/magickli/loom.json) declares pnpm/package.json tooling and the active DB foundation. The alias table and UUIDv7 defaults have passed both a disposable local Postgres rehearsal and the [new London Neon migration/rerun checks](./004-neon-provisioning.md). The Better Auth identity/profile schema and import planner have also passed a local Postgres rehearsal; that migration has not been applied to Neon. The group/temple schema and mapper have also passed local Postgres verification. These domain migrations have not been applied to Neon; remaining domain schemas and application-data import are future work.

**Evidence and recovery baseline.** The audited source is [production-2026-09-12T10-51-01Z](/home/dragon/www/projects/magickli/dump/production-2026-09-12T10-51-01Z/manifest.json), a logical dump of the application database selected through the linked Vercel production configuration. The dump contains 21 compressed files totaling 767,839 bytes. SHA-256 hashes, file sizes, gzip streams, BSON decoding and JSON metadata were verified. It was taken live without an oplog and does not establish a coordinated point-in-time snapshot.

The manifest records a successful local-only restore rehearsal completed at 11:17:56 UTC on 12 September 2026. The isolated instance identity was checked; MongoDB 8.3.8 restored all ten collections, 190 documents and 20 indexes. Collection counts and index definitions matched the source, and every restored collection passed validation. The rehearsal instance was stopped. This proves the logical backup can be restored locally; it does not prove application journeys, SQL import parity, a final cutover snapshot, or recovery after new Postgres writes. These results supersede the earlier research note that restore testing was pending.

| Source collection | Documents | Proposed treatment |
| --- | ---: | --- |
| users | 12 | Preserve 12 identities and application profiles |
| accounts | 10 | Normalize nine account rows; exclude one old provider-configuration record; supplement three embedded-only identities from users |
| sessions | 36 | Discard at the authentication transition; require reauthentication |
| docs | 5 | Preserve every ritual; record one unresolved creator reference |
| docRevisions | 59 | Preserve exact source and all revision relationships |
| studySet | 49 | Preserve 48 logical user/set records after the explicit duplicate disposition below |
| files | 10 | Preserve metadata, hashes and object keys through Loom Files mapping |
| temples | 1 | Preserve invite/slug behavior; allow missing historical creator |
| templeMemberships | 7 | Preserve all seven unique user/temple memberships |
| userGroups | 1 | Preserve the group and independent membership/administration grants |

The 20 observed indexes are the collection `_id` and `__updatedAt` indexes. The existing database does not enforce the proposed application natural-key constraints. No top-level deletion/pending-delete markers were observed in this dump. This is not evidence that returning browsers have no pending deletes or other unsynchronized work.

Mongo file records do not contain the object bodies, and this backup does not include Pinecone vectors or Discourse data. The operator also made backups under `/home/dragon/backups/magickly` and `/home/dragon/backups/magickly-forums`. Those are additional recovery artifacts, not substitutes for separately verifying required object bodies and vector/forum recovery. The newest forum database archive previously inventoried was dated September 9, even though the backup/copy operation and forum configuration were dated September 12.

**Identity mapping must preserve source types.** Every primary ID in the domain collections is an ObjectId. Auth mixes representations: accounts have nine ObjectId IDs and one string ID; sessions have 23 ObjectId IDs and 13 string IDs. All five `docs.docRevisionId` values are strings pointing to ObjectId revisions. Two group-membership references and one group-administration reference are strings pointing to the ObjectId group. These eight reference conversions resolve without ambiguity in this snapshot.

Use Postgres `uuid` columns and actual UUIDv7 generation in the database and applicable Node/browser code. Verify the chosen Neon Postgres version and Loom/PGlite generation contract before writing migrations. Do not silently fall back to UUIDv4. Static study-set/card keys, provider account identifiers, slugs, file hashes and content-derived Pinecone keys remain domain identifiers rather than becoming generated UUIDs.

An alias record must identify `(source system, entity/collection, legacy ID type, legacy ID value)` and its canonical UUID. That source tuple is unique; the canonical target is not unique because multiple aliases can intentionally resolve to one entity. Retain ObjectId bytes as normalized hex and preserve string values exactly. A string and an ObjectId with identical characters are not globally interchangeable. Apply an explicit field-to-target mapping for the known revision/group reference conversions; fail if competing source entities make a conversion ambiguous.

Allocate each canonical UUIDv7 once and persist the mapping transactionally before importing dependents. Rehearsals, retries and interrupted imports must reuse that mapping. An importer must not generate fresh IDs every run or infer UUIDs from mutable names/emails. Keep aliases available to legacy URLs, account mappings and returning offline clients. Keep unresolved references in the import ledger; do not create an authenticated identity merely to satisfy a foreign key.

**Explicit dispositions for observed exceptions.** These are the implementation defaults to encode and test. Any final import encountering different or additional exceptions must report them before cutover.

| Observation | Required disposition | Remaining decision |
| --- | --- | --- |
| One ritual creator reference is absent from both current and historical local user records; its current revision author exists | Preserve the ritual with a nullable historical creator and a typed unresolved-reference ledger entry. Preserve all revision authors. Never assign the current editor as the creator merely because that user exists | The operator may identify the intended creator later. This need not block local schema/import work or require an invented user |
| One user/set pair has two study rows with the same 11 card keys; one contains review history and the other has zero correct/incorrect/time counters both globally and per card | Keep the reviewed baseline, alias both source IDs to it, archive the empty row and record the merge reason. Do not sum cumulative snapshots or choose by latest timestamp | The duplicate declaration must pin the independently reviewed full source fingerprint: zero counters alone cannot establish unchanged schedules. A future duplicate with two reviewed histories requires a separate decision |
| Eleven study rows have top-level correct/time totals different from card sums; incorrect totals agree | Import the stored totals and card state independently, with discrepancy counts in the report. Do not recompute or reset historical progress | Correcting historical totals is a separate product/data decision |
| The temple has no creator field; five users lack a creation timestamp | Keep historical creator/time provenance nullable. If an auth adapter requires a timestamp, distinguish its documented bookkeeping fallback from an asserted historical creation date | Implemented for auth: use the explicit, persisted import-run timestamp only for missing required adapter dates; keep historical dates null |
| Compiled rituals contain 152 `forMe` fields and no `ref` fields | Preserve original payloads in the protected migration archive. Treat `forMe` as derived reader state for new saves; record any removal as an explicit transformation when comparing compiled content | Semantic compiler comparison must establish whether legacy source and stored compiled output differ beyond derived state |

**Auth normalization.** The 12 embedded provider identities and nine modern account identities resolve to 12 distinct provider/account pairs. Nine pairs occur in both representations; three exist only embedded. Every pair maps to exactly one user. No user lacks a provider identity, and no provider identity or email is shared across users. Each user has one provider identity. Four redundant `user.id` strings agree with `_id`.

Implemented boundary: `src/migration/normalizeLegacyAuth.ts` projects decoded BSON into protected import DTOs and reports only counts for discarded sessions. It reconciles explicit redundant adapter aliases without treating equal ObjectId/string text as the same identity by default. Its synthetic tests cover the audited aggregate shape and conflicting/unknown records. It does not import data, allocate canonical IDs, set application grants, or select auth-adapter timestamp fallbacks.

Implemented SQL boundary: `src/migration/planBetterAuthImport.ts` maps normalized DTOs and preallocated durable UUIDv7 aliases into Better Auth 1.7.4 identity/account rows, application profiles and protected provenance. A provider-identity alias uses `(mongodb, auth-provider-identities, string, JSON.stringify([provider, subject]))`; modern account IDs are additional typed aliases. Primary emails are lowercased for adapter matching, with exact spelling and secondary verification evidence preserved privately. Required adapter timestamps use the explicit persisted import-run time only where history is missing, while provenance keeps nullable dates. Global access is a separate strict boolean projection; OAuth profiles cannot grant it. The planner rejects unknown providers, missing names/emails/aliases, collisions and providerless users. Synthetic actual-adapter tests verify same-subject sign-in despite changed email and reject implicit same-email linking. The nine new tables and migration passed disposable Postgres constraints/defaults/rollback and unchanged rerun checks; no live identity or session import has occurred. Test-only `onConflictDoNothing` exercises alias reuse, not the production importer policy: reconcile exact rows and refuse changed input or newer target writes.

Create one canonical account link per distinct provider/account pair, supplementing embedded-only identities rather than creating new users when they next sign in. Prefer the existing modern link when both shapes agree, with explicit profile normalization; reject cross-user disagreements. Do not merge users solely on email. All 12 users have verified embedded email data, whereas the seven modern top-level `emailVerified` values are null. Preserve verified-email provenance instead of blindly choosing the null field. There are 13 distinct email values across 12 users; retain secondary email aliases. Five user names are objects and seven are strings, so normalize their display shape deliberately.

The remaining account record has the old Gongo OAuth strategy-configuration shape and no user reference. Exclude it from account migration. Do not import obsolete access/ID tokens or configuration secrets without an identified runtime need. All 23 modern sessions were expired at audit time; the other 13 legacy sessions have no expiration field. Discard all legacy sessions at the agreed reauthentication boundary. Keep Auth.js during feature migration; the temporary SQL adapter and eventual Loom/Better Auth transition must use the same canonical user IDs. The choice between separate and combined auth/persistence releases remains an implementation tradeoff requiring a successful rehearsal.

**Relational schema constraints.** Preserve document-shaped data as validated JSON where useful, and use columns/foreign keys for identity, access, uniqueness and concurrency.

| Domain | Initial contract |
| --- | --- |
| Users/auth | Canonical UUIDv7 user ID; unique provider/account identity; separate application access/profile fields from adapter-owned records; nullable historical provenance where unknown |
| Groups | UUIDv7 groups and unique user/group grants; preserve membership and administration independently rather than deriving either from the other |
| Temples | UUIDv7 ID, unique normalized slug, nullable historical creator and separately protected invite configuration |
| Temple membership | UUIDv7 ID, user/temple foreign keys, unique user+temple, integer grade ≥ 0, admin flag, motto and typed dates |
| Rituals | UUIDv7 ID, access columns, nullable creator, current revision pointer and server-controlled concurrency version |
| Ritual revisions | UUIDv7 ID, ritual/author foreign keys, exact source text, typed timestamps, source/format/compiler versions and hashes; structured output only where available or explicitly derived |
| Study progress | UUIDv7 ID, unique user+logical-set key, preserved aggregate baseline and validated per-card scheduling payload; new operations must not fabricate historical review events |
| Files | Loom-compatible UUIDv7 records with legacy ID/hash aliases, original object keys and preserved metadata; unique hash/deduplication behavior tested before cutover |
| Sync/integration | UUIDv7 operation/receipt identities with account-scoped deduplication, explicit protocol version and durable Discourse work status where needed |
| Import state | Stable alias mapping, source fingerprint, batch/checkpoint state, transformation version and explicit imported/merged/excluded/unresolved dispositions |

Require a composite relationship ensuring that a ritual's current revision belongs to that ritual. Import ritual shells with null current pointers, import revisions, then assign validated pointers in a transaction. Do not expose partially imported shells through ordinary readers. Preserve all 59 revision source strings exactly; compiled output exists only on the five current documents, so historical revisions must not be presented as having pre-existing compiled snapshots. All current pointers resolve to their own document and its newest revision by `updatedAt`; revision counts per ritual are 1, 2, 7, 15 and 34. Document/current-revision timestamps differ by only 1–2 ms, consistent with separate timestamp calls; preserve both without treating that drift as lost history.

**Ritual SQL boundary.** `src/db/schema/rituals.ts` now separates canonical ritual metadata, exact source revisions, protected original compiled archives and explicitly versioned compiler artifacts. Composite foreign keys bind the current pointer and archived claimed pointer to their own ritual, and bind each generated artifact to its revision's exact source hash. SQL checks verify SHA-256 against actual UTF-8 text using built-in PostgreSQL functions; no additional extension is required. The new SQL concurrency version starts at zero and is not an interpretation of legacy sync timestamps. Those historical values remain separate.

The pure `planLegacyRitualImport` requires durable typed mappings and complete canonical user/group/temple sets. It preserves every source string, source field presence, typed references and nullable historical ritual dates. Required revision dates are not fabricated. Only the documented current-revision string/ObjectId conversion is inferred; other cross-type references need explicit aliases. The known orphan creator requires an exact reviewed ritual-and-creator exception, remains null in policy columns, and retains protected reference evidence. Unexpected, resolved or unused orphan exceptions fail. Unknown fields, pending/deletion markers, lossy JSON and unrepresentable PostgreSQL text fail preflight.

Original compiled content is stored as `json-stringify-utf8-v1` text with its hash, preserving serialized key order and all attributes including `forMe`. Keep the original BSON backup too; this is not a BSON wire archive. Every legacy snapshot remains marked for source-versus-compiled parity review. The planner creates no compiler artifacts and does not claim that a stored current pointer proves semantic parity. The initial SQL reader serves preserved output only when the archive's claimed revision matches that authorized parent's current pointer. Missing or stale archives return null. New saves must add explicitly versioned artifact selection with their write contract. Neither path may silently replace the original archive; a future cleanup must identify its transformation and compiler versions. The [protected preflight](005-protected-backup-preflight.md) records current source/compiled parity separately.

The schema and planner pass 46 synthetic tests and a real disposable PostgreSQL migration/import/constraint/default/rollback/rerun rehearsal. That rehearsal verifies leading BOM and CRLF source retrieval as well as hashes; PGlite's bare text result decoder drops a leading BOM even though SQL bytes remain intact, so its returned text alone is insufficient evidence for this edge case. No live ritual data or Neon schema was changed. The eventual importer still must persist evidence, fingerprints, aliases and checkpoints, reject conflicting newer target writes, and prove no incomplete ritual shells remain visible.

There are 667 card-state entries. All have typed due dates and SuperMemo state; 459 have repetition state. Missing repetition state is a supported legacy shape. One study row has an additional `quirk` field; preserve it in migration provenance unless its use is established. Encode/revive dates explicitly if card state is stored in JSON; JSON strings must not silently replace dates expected by scheduling code.

**Authorization remains a separate acceptance contract.** All five production rituals are temple-restricted, with minimum grades between zero and two. There is one global admin, two temple-admin memberships, two group-membership links and one group-administration link. All observed group admins are also group members. Membership grades are valid nonnegative integers; there are no duplicate user/temple pairs or unresolved membership references. Seven distinct Discourse IDs are attached to users.

The operator has now confirmed the shared policy in `src/doc/access.ts`: creators, global admins and matching group/temple admins can read, edit and access source history; ordinary group members can read, and ordinary temple members must meet the minimum grade. Anonymous users can read public rituals. Global admins can create in any scope and publish publicly; matching group/temple admins can create within their own scope. New scopes are exclusive, and malformed legacy combined scopes fail closed pending repair. A nullable historical creator grants nobody invented ownership and retains valid scope/admin access. Ordinary content saves cannot change creator, scope or minimum grade. Ownership transfers, other scope changes and deletion remain distinct decisions/commands.

List, detail, revision history, editor saves and offline downloads must use this same server policy. The Gongo publications and versioned ritual write command now share it; private offline reconciliation remains separate work. Preserve grade zero as valid. Default absent admin flags to false; do not promote users while normalizing profiles. Invite codes and auth/provider material must not enter ordinary user/temple projections.

**SQL ritual reads.** The server-only reader in `src/doc/sqlReads.ts` uses the
same policy with current persisted grants and exact parent/source bindings in a
read-only repeatable-read transaction. Metadata, source history and current
source have separate projections. Verification/database errors propagate to a
future safe transport boundary; no body identity, cached principal or guessed
alias is accepted. Concurrent revocation takes effect on the next read, while an
underway read retains a consistent snapshot. SQL reader activation still needs
the verified session adapter, deliberate compiled-output selection and offline
integration; this repository alone does not replace Gongo.

**Temporary ritual write bridge.** The editor now sends one version-1 `ritualWrite` save/create command instead of independent generic document/revision mutations. A server-only transaction checks the verified current actor, scope and revision/update tokens, compiles the exact source, appends a revision, updates its parent and inserts a UUIDv7 operation receipt atomically. Explicit public publication is restricted to global admins. Persisted Mongo document/revision IDs remain ObjectIds until the canonical alias conversion; every save creates a new revision rather than coalescing the old five-minute history. All six generic ritual mutation paths fail closed, so the converted editor and recovery code must ship with this service.

Include the new `ritualWriteReceipts` collection in every subsequent dump, structural audit and import. Preserve operation UUID, actor mapping, canonical request hash and original response semantics; do not reinterpret an old pending request under a new identity or generate a replacement operation merely because its response was lost. Receipts have no expiry until a supported retry window is defined. The original 190-record/10-collection backup predates these writes; final counts must come from a fresh audit, not these historical totals.

The temporary publications return full authorized ritual lists and source history, ignoring old delta/pagination arguments. Timestamps allocated before transaction commit cannot order different rituals safely; a delayed commit could otherwise disappear behind a collection watermark. Preserve real timestamps and parent-bound history. Monitor response size during the bridge, and replace this protocol with the SQL/offline repository; complete responses still do not evict revoked cached rows.

Browser recovery uses `magickli:ritual-recovery:v1:` localStorage records. Pending legacy rows are archived before generic retries are paused or incoming subscriptions can replace them. Retain raw source, original reference metadata, per-owner drafts and immutable unconfirmed requests during the future Dexie migration. Legacy ownership may identify a creator rather than the editing admin, so unattributed records require deliberate recovery, never guessed ownership or automatic replay. An old pending creation may already exist on the server; explicit recovery warns before making a new copy. Storage failure pauses polling to protect the only pending copy and offers a local export. This bridge does not establish private offline account partitioning or cache revocation.

Before deploying the Mongo bridge, verify production supports transactions and its database user has the necessary permissions; standalone Mongo fails closed without fallback writes. `pnpm test:mongo` runs boundary and transaction tests against a fresh disposable `/usr/bin/mongod` replica set on an unused loopback port. It accepts no existing database URI, cleans up its own process/directory, and must pass for changes to this temporary engine. The normal test suite skips the 14 replica-set cases; their real-database rehearsal is separate evidence from the normal per-module coverage gate.

**Group and temple SQL boundary.** `src/db/schema/memberships.ts` and `src/migration/planLegacyMembershipImport.ts` implement six tables and pure insert planning. Group membership/admin booleans remain independent; protected per-user evidence preserves each array's presence and ordered typed references, including duplicates. Only the documented group-array string/ObjectId conversion is permitted. Canonical UUID values normalize case before comparison; original source identity spelling and BSON type remain separate. Temple names and exact slugs are retained, nullable historical creator/date values stay null, and invite codes move to `temple_invites` instead of ordinary metadata. Memberships retain exact added/member-since dates, motto and grade zero, with unique user/temple keys. A present but unresolved creator fails preflight instead of inventing attribution.

The domain mapper requires every canonical user's grant projection. Unknown source fields, deletion/pending markers, invalid arrays/dates/grades, duplicate identities, ambiguous aliases and orphan references fail with only category/input position in errors. Slug collision preflight matches PostgreSQL `lower(btrim(slug))`, including its ASCII-space-only trimming; non-ASCII case behavior still needs production-input validation under the target collation. Foreign keys restrict incidental deletion. Returned source-field/reference evidence must be persisted by the final protected import ledger; returning a plan alone is not durable import bookkeeping. The generated migration, UUIDv7 defaults, constraints, rollback and unchanged rerun passed on disposable Postgres with synthetic rows. This schema does not activate temple commands, define deletion/last-admin semantics, clear existing browser invitation caches or activate the now-approved temple-creation bootstrap. Any signed-in user may create a temple and its first administrator membership atomically; the UI must explain who should create one and why, and distinguish joining an existing temple. New temples retain separate invite setup rather than inventing an invitation code. The SQL service in `src/temples/create.ts` commits temple, first grade-zero administrator and an immutable UUIDv7 creation receipt together. Replays confirm original IDs without restoring removed membership or deleted temples. Its receipt survives domain deletion; runtime auth and the explanatory creation UI remain to be integrated.

**Study SQL boundary.** `study_progress` keeps stored user/set totals, due dates
and a new SQL version independently of individual `study_card_states`. Exact
content keys stay strings; schedule dates hydrate to Date, SM2 floats retain
precision, and repetition state distinguishes absent, empty and numeric weight
(including zero). The snapshot adapter does not fill defaults or correct totals.
Every original source row is retained in protected `legacy_study_snapshots` as
versioned canonical EJSON with a checked SHA-256 and typed legacy identity.
Original BSON backups are still required; EJSON is not the original wire bytes.

`planLegacyStudyImport` is pure and requires reviewed canonical aliases. The
single duplicate disposition requires an explicit typed pair and a fixed SHA-256
of the independently reviewed archive source, in addition to matching owner/set/
card keys and zero counters. Never calculate this approval from arbitrary input
at import time: all scheduling, date and metadata changes must invalidate it.
All aliases, dispositions and discrepancy evidence still need durable checkpoints
in the final importer. No historical review events are fabricated, and stored
aggregate discrepancies remain. The synthetic 49-row/667-card/459-repetition
fixture reconciles to 48 active baselines, 656 active cards and 11 archived cards;
the actual source repetition split must be measured during the protected dry run.
Browser migration, anonymous adoption, offline receipts and runtime activation
remain separate work.

**Files and offline clients are part of import acceptance.** Ten file records have unique hashes; six distinct legacy hash URLs found in compiled documents all resolve to metadata. Absolute URLs also occur. Keep `/api/file2?sha256=...` aliases working and inventory actual image/font/resource dependencies before claiming a ritual is offline-ready. A metadata-only migration does not prove an image is retrievable. The operator approved preserving legacy public links while making new attachments follow ritual permissions. Do not invent owners for the ten legacy records or infer attachment authority merely from a URL embedded in source.

The metadata planner and generated Files schema now preserve all ten historical
rows, including seven SVGs, with UUIDv7 aliases and separate protected source
evidence. Legacy `meta` stays empty and ownership stays null. Source storage
provider and bucket must be explicit inputs; no object is copied or verified by
the planner. Duplicate digests, conflicting identities and unknown/lossy fields
fail instead of selecting a winner. Files remains a planned Loom feature until
permission-aware runtime adapters, legacy compatibility and the approved direct
20 MiB upload/finalization flow are verified. The new-upload allowlist does not
restrict existing public files.

Server import cannot recover unsynchronized browser data. Ship the Gongo export/recovery path before removing persisted collection registrations or turning off the legacy backend. Retain pending inserts/updates/deletes, bases, ObjectId metadata and account ownership in the browser migration. Use a separate Dexie database, resumable checkpoints and verification before cleaning old stores. Anonymous progress must not become another account's data through login switching. New offline operations need UUIDv7 operation IDs and durable idempotent receipts; an old cumulative snapshot must not be replayed as a new review event.

A downloaded private ritual must reopen after a cold start with no session/network request, including its required assets. Test reconnect, permission refresh, logout/account switching, two-tab migration, interrupted imports, stale service workers and long-offline clients. The operator now specifies a renewable **14-day offline-access window**. Only a
successful authenticated server permission check renews it; local reads, failed
requests and mere network availability never do. Explicit sign-out removes
private downloaded rituals and their cached images. Confirmed revocation removes
access on reconnect, and expiry blocks offline reading until a new permission
check succeeds. Recheck on cold start, foreground/resume and use, including
already open views; do not rely on a background timer alone.

Unsent drafts survive, but expiry or revocation locks reopening and export until
a successful online permission check. Preserve unique edits without offering a
recovery bypass around the private-content expiry. A different signed-in account
must not inherit them. Auth/session expiration and network failure are distinct
from an authenticated, confirmed permission denial.

This is an app access policy, not tamper-proof recall of bytes already delivered
to a user-controlled browser. Local browser controls can be bypassed by a user
with control of that device ([OWASP browser storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)).
System-clock rollback also prevents a browser from providing a trusted elapsed
time across restarts ([MDN timing guidance](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)).
Use server-issued expiry and conservative rollback detection for ordinary app
behavior, without promising DRM or deletion of copies. This 14-day policy
supersedes the earlier no-expiry proposal while retaining planned airplane-mode
use within the authorization window.

**Dry run and import validation.** Implement the importer only after sanitized fixtures capture the shapes above. Use controlled staging or a protected export for raw legacy material; committed fixtures and reports contain no production names, emails, source text, tokens, IDs or secrets. Aggregate exception reports may refer to local protected detail records without embedding their values.

1. Verify source fingerprints and target identity. Refuse an unexpected database/project/environment, an incompatible schema version, or a changed input that lacks a new import-run identity. Validate UUIDv7 defaults and driver behavior in PGlite and the selected disposable Postgres/Neon target.
2. Run a read-only structural pass that classifies every record, reference, alias and natural-key collision. The expected 190 source records must all receive an explicit disposition; do not silently filter unknown records.
3. Persist mappings and import dependency-ordered batches with transaction/checkpoint boundaries. Disable external side effects: no Google sign-in, mail, object upload, vector ingestion or Discourse mutation during rehearsal.
4. Check expected canonical results: 12 users, 12 provider-account links, five rituals, 59 revisions, 48 study baselines, ten file records, one temple, seven memberships and one group, plus the documented grant/alias/ledger rows. The expected session import count is zero. Reconcile source-to-target counts through dispositions rather than demanding identical table counts after normalization.
5. Check every foreign key and current-revision relationship, natural-key uniqueness, permission projection, exact UTF-8 source hash, typed date, stored study aggregate and scheduling field. Compare compiled content with declared transformations; any unexplained difference fails the gate. Verify all old URLs and aliases resolve to the intended entity without weakening authorization.
6. Rerun unchanged input and prove mappings, counts and target state are unchanged. Interrupt/resume representative batches. Fail or require an explicit conflict policy when the target has newer application writes; a rerun must not overwrite them.
7. Exercise application journeys against the rehearsed target: existing Google identity, global/temple/group roles, private reader offline, revision save/conflict, anonymous study adoption, outbox retries, image retrieval and Discourse mapping with external calls stubbed. Record elapsed import/verification time to establish whether the planned write pause is achievable.

PGlite repository tests are useful but do not establish Neon connection, extension or deployment behavior. A disposable real Postgres/Neon rehearsal and application checks remain necessary. The completed Mongo restore drill is independent evidence, not a substitute for these gates.

**Cutover and recovery gates.** Before production migration, ship compatible clients and stale-client recovery, establish the final policy for unresolved references, verify independent storage/vector/forum recovery, and rehearse the exact release artifact and importer. Keep one authoritative writer. Pause/fence server writes and external integration jobs during the approved short pause, take the final consistent export, rerun its structural audit and import validation, and only then switch repositories and reopen writes. London/London is already approved; resource plan, preview isolation and concrete release readiness still belong to the provisioning/release procedure.

Before Postgres accepts new application writes, recovery can restore traffic to the preserved Mongo authority after checking its unchanged state. After Postgres accepts new writes, reverting application code or restoring the old Mongo dump alone is not a valid rollback: it would lose acknowledged work. Either roll back to a compatible application that still uses Postgres, or pause writes and use a rehearsed reverse-transfer/replay procedure before returning to Mongo. Preserve and reconcile every accepted operation before reopening writes.

Retain the final backup, canonical alias mapping, import ledger, compatible release artifact and old Mongo data read-only for the agreed recovery period. Do not remove browser recovery tooling on a date alone: returning devices may still hold unique pending work. Stop the cutover if counts/dispositions, source hashes, references, permissions, offline journeys or recovery checks have unexplained failures. Prefer extending the maintenance window to accepting writes into an unverified state; measure and minimize that window through rehearsal.

The remaining decisions are deliberately narrow: identify the unresolved ritual creator if known; complete the auth-release boundary; define any remaining production permission cases and implement the approved 14-day offline/draft policy; and set a recovery window plus a tested policy for post-cutover writes. None requires repeating the approved region, UUIDv7, short-pause, private-offline or reauthentication decisions.
