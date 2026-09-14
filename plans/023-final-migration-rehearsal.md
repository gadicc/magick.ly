# Final migration rehearsal with Loom 1.26.0

On 14 September 2026, the reviewed application at `2881872` passed a live
Neon rehearsal using synthetic data and an independently reviewed runner.
The exact frozen graph contains 80 required importer artifacts plus three
fixture modules; all 83 source/copy hashes remained unchanged.

- Applied all 17 migrations (0000–0016) on a new schema-only London branch.
- Verified 36 ordinary application relations, including the import checkpoint,
  against the 35-table import contract.
- Prepared durable import state, then removed the synthetic backup directory.
- Repeated preparation and inspection without that backup; applied the saved
  import, reran unchanged migrations, and repeated completed inspection/apply.
- Confirmed the same saved IDs, rows and receipt across fresh processes.
- Confirmed the main branch's catalog, two migration journal entries and zero
  application rows were unchanged before and after rehearsal.
- Deleted only the owned branch `br-summer-pond-zabr2wqx` and verified removal.

The report is
`/tmp/magickli-neon-rehearsal-relocation-2/result.json`. Source manifest SHA-256:
`19df41c39d7ec0df4dcb02b2d4a78f7ed53e7caeb8f2ec6e4710d8b28526f8cd`.
Immutable run-file SHA-256:
`afeb3fff194b9af41134f0375751eaa94937af29a59ce1e8cd9054d11fc35c7b`.

The first attempt applied the same migrations but the importer correctly refused
an overly permissive local checkpoint directory before importing any data.
That branch was removed. The corrected runner requires an owner-only mode-0700
directory before any provider call. The successful second report supersedes the
first attempt at `/tmp/magickli-neon-rehearsal-relocation/result.json`.

This verifies the migration and resumable import mechanism. It does not verify
Preview isolation, production-data acceptance, OAuth, publication or cutover.
The main branch still contains only migrations 0000–0001 and no private import.
The final production snapshot must follow the approved writer pause. Legacy
file relocation mappings activate only after completed import reconciliation
and fresh destination-byte verification; their operator recipe remains a draft
under `/tmp/magickli-legacy-file-relocation/activation/`.
