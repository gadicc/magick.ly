# SQL ritual write v2 contract

The SQL service in [sqlWrites.ts](../src/doc/sqlWrites.ts) commits a ritual revision, its explicitly selected compiled artifact, parent concurrency state and operation receipt together. It uses the approved [ritual access policy](../src/doc/access.ts). This foundation does not activate a route, replace authentication, replay legacy operations or migrate browser storage.

## Wire and compatibility boundary

The browser-safe [contract types](../src/doc/sqlWriteContract.ts) use protocol `version: 2`, a lowercase UUIDv7 `operationId`, and a lowercase canonical UUIDv7 `expectedActorId`. The expected actor is an account-switch precondition; a verified current server session supplies the actual actor. Unknown fields, missing own required fields and noncanonical IDs are rejected.

| Command | Required command fields |
| --- | --- |
| `create` | Exclusive canonical `scope`, `title`, `source` |
| `save` | `ritualId`, nonnull `expectedRevisionId`, `expectedVersion`, `source`; optional `title` |
| `publish` | `ritualId`, nonnull `expectedRevisionId`, `expectedVersion` |

Expected versions are nonnegative safe integers. Creation produces parent version 1; each later save or publication increments it. The success response's `version` is the accepted parent CAS version, distinct from the request's protocol version. Success also contains canonical ritual/revision IDs, an ISO `updatedAt` and `replayed`.

The source limit remains 1 MiB of UTF-8 and the title limit remains 500 JavaScript string units. Creation requires a nonblank title and may begin with empty source. Saving requires nonempty source; an optional title retains the existing save semantics. Valid source/title spelling, line endings and Unicode are preserved exactly. NUL, lone surrogates and malformed numeric state are rejected instead of silently changing text for PostgreSQL.

An immutable queued request keeps its operation ID until its outcome is known. `RETRYABLE` and `UNAVAILABLE` require retrying that exact request. A conflict requires preserving the source and reconciling against fresh state. An unknown creation result must never automatically become a new creation operation or a second copy.

SQL v2 rejects legacy v1 requests with `UPGRADE_REQUIRED` before session/database work. It does not resolve ObjectId aliases, convert Mongo update timestamps into SQL versions, rewrite expected actors, or interpret old receipt hashes. The current legacy endpoint remains separate. Do not activate the SQL rejection boundary until the [legacy pending-write and receipt recovery gates](003-data-migration-contract.md) are complete. Retain original v1 commands, actor evidence, hashes and response semantics for that reconciliation.

## Atomic state and artifact selection

Every create/save appends an exact source revision with its SHA-256, server actor and explicit format version. There is no five-minute coalescing, source deduplication or historical timestamp rewrite. An explicitly versioned compiled artifact is inserted from that source in the same transaction. The parent update compares both the expected revision and SQL version, sets the new revision/artifact together and increments its version. A failure anywhere rolls back source, artifact, parent and receipt; there is no nontransactional fallback.

`rituals.currentCompiledArtifactId` is nullable for imported legacy rows. A composite foreign key binds a selected artifact to `currentRevisionId`, while the existing current-revision foreign key binds that revision to its own ritual. A selected artifact requires a current revision. Artifact source hashes remain bound to their exact revision by the existing composite foreign key.

The [SQL reader](../src/doc/sqlReads.ts) returns only the explicitly selected artifact for the current revision and a supported output-format profile. It never chooses the newest timestamp or an arbitrary compiler run. When there is no selected artifact, it can return the unchanged original archive only if the archive claims that same current revision. Missing, stale or incompatible selected output returns null without archive fallback, recompilation or cleanup.

The [compiler identity](../src/doc/compileContract.ts) records actual SHA-256 fingerprints of `prepare.js` and `shortcuts.ts`, plus reviewed Pug, MagicString, remapping and JRT package versions. Tests verify those identities against the source and installed packages. A code/dependency change requires a new compiler identity and parity review.

The output format is `json-rich-text`, compatibility profile `1`. This is a format contract, not the JRT npm version. Compatible future compilers remain readable under that profile even when their compiler identities differ. A dependency upgrade must not silently change the profile and make prior artifacts unreadable. New output profiles require deliberate reader support before selection. The writer records an empty transformation list; the preflight's `forMe` and empty-text-children comparison rules are not applied to stored data.

Publication is a separate global-admin command. It retains the current source/artifact, changes only the scope columns to public, and increments parent version/time. Ordinary saves cannot change scope, grade, creator or identity. Creation remains restricted to global admins or matching group/temple admins; temple creation itself follows its separate approved bootstrap policy.

## Permission and lock semantics

The service verifies the server session before opening a transaction. Inside a `READ COMMITTED`, read-write transaction it sets a five-second lock timeout and acquires a transaction-scoped advisory lock namespaced by the v2 operation UUID. Receipt lookup happens after that lock. A concurrent identical request waiting for a committed operation therefore sees its receipt rather than retrying creation from an older transaction snapshot.

The shared [SQL policy helper](../src/doc/sqlPolicy.ts) loads the same persisted user, global access, group grants and temple memberships used by readers. Writes key-share-lock the identity and share-lock observed grant rows, then update-lock the parent. These locks last through commit. A revocation committed before its grant is read is observed. A revocation that conflicts with an already acquired grant lock waits until the accepted write commits, then affects later operations. A write waiting for a changed parent sees its latest committed policy and concurrency tokens before proceeding.

Missing grants confer no permission. A concurrently added grant may require a later retry; it cannot create a false permission from an earlier absent row. Readers keep their read-only repeatable-read snapshot behavior. The write path's row locks provide stable authorized grants through commit without pretending all its reads share one repeatable-read snapshot.

The immutable v2 receipt stores operation/actor identity, the canonical parsed-request hash, command kind and original accepted result. It stores no raw request source, grants or invitation material and has no expiry. Domain result IDs are historical values rather than foreign keys that would prevent later domain deletion. The actor foreign key follows the existing temple receipt convention; account erasure remains an explicit retention decision.

Receipt replay requires the same actor/hash and current parent edit permission; publication replay additionally requires current global administration. Replay never recreates deleted rows or restores revoked grants. It returns the original acknowledged version/time, which may be older than the current parent after another write. Clients must reconcile current state before treating an old acknowledgement as a fresh editing base.

Database/verification failures never become anonymous writes. Lock timeout, cancellation, serialization and deadlock errors return a safe retry category; ambiguous connection/commit outcomes return `UNAVAILABLE`. Raw SQL errors, compiler diagnostics and private source never enter results.

## Verification and remaining gates

Synthetic PGlite tests cover shared creation/edit/publication policy, exact source/history, explicit artifact binding and compatible future compiler identities, stale CAS tokens, duplicate delivery, competing operations, lost commit acknowledgement, precommit rollback, current permission revocation, receipt reuse, legacy protocol rejection and schema constraints. Existing SQL read tests run against the same extracted policy helper. Compiler-source/package identity tests guard accidental unversioned changes.

The integrated suite passes 1,045 default tests with 37-module coverage, types, Biome, ordinary Loom checks and a production build. Fourteen Mongo replica-set cases remain separate from that default suite.

A disposable PostgreSQL 15.17 rehearsal through the installed Loom 1.24 driver passed duplicate-operation waits, competing parent CAS, global/group/temple revocation before and during grant locks, identity/parent deletion blocking, the five-second lock timeout, rollback and unknown-acknowledgement replay. It also preserved exact BOM/CRLF/Unicode source and original archives, enforced artifact bindings, and reran all nine migrations without changing 27 tables. Actual connection blocking was observed rather than inferred from timing. The unknown acknowledgement is a deterministic exception after commit. The owned database was removed and source hashes stayed unchanged. Evidence: `/tmp/magickli-write-postgres-rehearsal/` and `/tmp/magickli-sql-writes-*.log`. Production import, auth, browser recovery and runtime activation gates remain outstanding.

The offline permission endpoint must distinguish an authenticated policy denial from an authorized parent whose current output is unavailable, within one consistent transaction. Ordinary `getRendered()` null is intentionally ambiguous and must not become an offline revocation signal. The shared principal/policy helper supports that future endpoint; no separate network permission/content reads should introduce a race.
