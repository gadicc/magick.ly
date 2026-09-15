# Resume checkpoint — Production transition

Updated 15 September 2026. This supersedes the earlier paused-session and local-QA
instructions previously kept in this file. Historical implementation evidence is
preserved in the [implementation ledger](002-implementation-ledger.md),
[release and storage plan](022-release-and-storage-completion.md),
[migration rehearsal](023-final-migration-rehearsal.md) and
[local acceptance plan](024-local-acceptance.md).

## Authoritative current state

- Production serves commit `8ad3a978429ae35d31edd238b7aac4410358485e`
  from ready London deployment `dpl_6TcqMFzJtFkNyjiniRxZYx3Hctfz`. The
  Production target and `magick.ly` alias match it.
- The final Production SQL import, unchanged completed-fingerprint replay and all
  ten legacy file mapping activations are complete.
- Normal application writes are open. The broad pause firewall is gone. The
  persistent firewall denies legacy `/api/file2` writes and its final normalized
  edge check passed.
- The dedicated legacy Mongo user has exactly `readAnyDatabase@admin`; primary
  majority reads passed and the targeted zero-match, `upsert:false` write was
  denied. Keep it read-only.
- Preview acceptance passed real Google OAuth with two accounts, private image
  upload/save/publication and private offline reload. Revocation, expiry and image
  purge passed separate local production-build browser tests. Live chat passed
  against the existing providers and corpus.
- The replacement Discourse key is installed for Production as Sensitive and
  passed bounded read-only groups, admin and staff-log checks. The revoked key
  remains revoked.
- Release run `34973396659`, attempt 2, promoted the exact deployment but remains
  failed because its final checker requested the reduced Vercel project response.
  Independent recovery `production-release-recovery.json` (SHA-256 prefix
  `d675bc3501d3`) passed with the expanded promotion projection.
- Local commit `d295164` fixes that checker and passes its focused tests. Local
  commit `651f1a1` contains the reviewed runtime and release-policy cleanup. Neither
  commit is pushed or deployed; Production remains the immutable `8ad3a978` build.
- The generic modernization skill remains unpublished under the ignored
  `.loom/drafts/modernize-app` directory.

The Production traffic switch is real, but completion is pending Production OAuth,
bounded backfill for up to five imported rituals, final browser acceptance,
legacy-environment cleanup, credential retirement and a fully successful CI release.

## Immutable evidence and replay boundaries

Keep the final backup, source comparison, import, reconciliation, promotion and
firewall receipts under their existing private packets. In particular:

- `/tmp/magickli-cutover-20260915/evidence/production-release-recovery.json`
  is independent recovery evidence; it does not turn the failed CI attempt into a
  successful run.
- `/tmp/magickli-cutover-20260915/evidence/06-persistent-waf-live.json` and
  `06b-persistent-waf-verified.json` establish the persistent policy.
- `production-persistent-file2-edge.json` establishes canonical and normalized
  legacy-write denial. Its first stopped observation remains historical evidence,
  not a bypass.
- The final backup/import packets and their completed receipts are immutable.
  Reuse their read-only evidence; do not regenerate their identities or reapply
  their mutations.

Do not rerun the importer, relocation activation or promotion. Do not restore the
legacy Mongo write role or remove the persistent legacy-upload rule. Do not reapply
the earlier broad pause/import sequence as ordinary continuation; a future incident
may require a separately reviewed forward-repair fence. A new release must use the
corrected checker and the ordinary reviewed release workflow.

## Continue from here

1. Use an existing imported operator account to complete Production Google OAuth
   and verify account, temple and ritual identity.
2. Run the bounded authenticated backfill for up to five imported rituals. Treat
   primary imported revisions as already authoritative.
3. Verify the bounded Production reader, editor, upload, offline and permission
   journeys. No forum mutations are required for this acceptance.
4. Remove only the reviewed legacy environment settings after accepting Production
   `8ad3a978`. Preserve shared Development scopes where recorded.
5. Push reviewed commits `d295164` and `651f1a1`, then require a fully successful
   CI release and deployed verification without the retired settings.
6. Identify the dedicated old R2 token in the operator account. Retire it and the
   dedicated Mongo credential only after modern runtime independence and the
   rollback window are accepted. Preserve the old bucket and backups until a
   separate retention decision is authorized. The paused vector experiment remains
   out of scope.
7. Finalize and independently evaluate the generic modernization skill; save and
   commit it into Loom only after the whole modernization is complete.

This documentation update changes no provider, database, runtime or credential
state.
