# Modernization closeout checkpoint

Updated 15 September 2026. See [current status](000-current-status.md) for the live
result. Earlier [release/storage](022-release-and-storage-completion.md),
[migration rehearsal](023-final-migration-rehearsal.md) and
[local acceptance](024-local-acceptance.md) plans retain their historical scope.

Production commit `4d9d10d37b5a3877d0f9230c5e75ff5a969c7e37` is served by ready
London/Node 24 deployment `dpl_HHLsAXCa7vopfkqwiyVuqETkaaL2`.
[Run 34994058815](https://github.com/gadicc/magick.ly/actions/runs/34994058815)
completed successfully. The final collector verified its completed promotion,
exact deployment/alias, eight environment changes and ten public legacy images
through both alias and fresh deployment requests, with exact byte/hash/MIME/size
parity. Receipt profile: `magickli-final-production-release-v1`; SHA-256:
`bfce8ec354712b9beac6d7a168b039f69b60540349af2a9bc470b61b32cf8aab`.

Existing-account sign-in/navigation, all five imported publications with zero
stops, private online/offline text and images, and new private upload acceptance
already passed on `8ad3a978`. Do not repeat completed journeys solely because an
older checkpoint still says pending.

## Retired access and retained data

- Eight environment operations completed: actions 1/2 narrowed shared records to
  Development only; recovery completed deletions 3–8. Receipt SHA-256:
  `787ebaf4b1888925dbecfb3669e5142a693e229991021f90dd76f4909d7b4b1c`.
- The obsolete Vercel release token was removed and independently verified, with
  the replacement, other token identities and saved OAuth preserved. Result
  SHA-256: `07d23afc8fb2bbcbd2469786ad7873d9ebb610bdc0e31d5171496be8f11c435d`.
- The operator confirmed deletion of old R2 token `magickly` and Atlas database
  user `magickli@admin`. No independent Mongo/R2 inventory is claimed.
- The old database, bucket/object bodies and backups remain retained. Credential
  retirement does not authorize deletion of those recovery assets.

Post-retirement acceptance passed on 15 September at 16:39–16:41 UTC. The
`magickli-post-retirement-live-parity-v1` receipt verified the unchanged live
identity, 20 byte/hash/MIME-matching responses and canonical Files 400/404 behavior
(SHA-256 `76ea55ef3be8ea2a2cc612036a6c55085b6f6fe692da15aff9eae3ae35cb4a46`).
The images were CDN-cached; earlier attempts correctly refused to label them
fresh storage reads. A separate `magickli-post-retirement-r2-verification-v1`
receipt verified all ten objects and 7,790,234 bytes through direct GETs with the
replacement Production credential (SHA-256
`9bf747d58d80284cecda401e66c47bca82a71133135aaa98427fa5ade6bf175a`).
The prior exact-build fresh-runtime proof remains separately recorded.

The R2, Discourse and Vercel temporary credential handoff files were removed after
these checks, without changing provider settings or backups. Cleanup receipt
SHA-256: `cc54da299fab7458b1b54b10d23ea117f2a2e6586d917db5e911e2c378936c8c`.
Historical verification helpers that need those handoffs cannot be rerun without
a new authorized credential source; preserve their non-secret evidence.

## Preserve the recovery boundary

Normal writes are open on SQL; the persistent legacy-upload write denial stays in
place. Do not rerun the importer, relocation activation, completed backfill or old
promotion. Do not restore Mongo write privileges or reapply the broad pause as
routine continuation. Recovery after new writes must preserve acknowledged SQL
work; restoring an old database snapshot alone is not a rollback.

Keep immutable backup/import, relocation, environment-recovery and firewall
receipts. Preserve the failed CI history: `34973396659` attempt 2 promoted but
failed a verifier missing `rollbackInfo=true`; independent recovery receipt
prefix `d675bc3501d3` verified the live result. `34992906681` failed the SVG corpus
timeout and skipped deployment. Only the subsequent `34994058815` is the fully
successful final run.

## Shared skill and subsequent work

Loom skill closeout is committed locally as
`b3460006a8482270c4cb9427b6a6bd4af7c2d51e` (`modernize-app`). The full Deno
suite passed (64 tests, 634 steps), formatting/lint and skill validation passed,
and the npm build emitted exactly six matching resources with resolvable links.
Root reviewed the final integrated change, including common managed-skill
registration and preservation of consumer-local instructions. Draft provenance
is excluded. The commit has not been pushed or published; existing consumers
retain their pins. Majou2/MyReiki remain untouched historical evaluation fixtures,
not completed migrations or automatically authorized next tasks.

The replacement release credential expires **2026-12-14T14:17:03.165Z**; no
automatic rotation is configured. Review the separate unconfirmed `vector-dev`
credential before any future unpause. Preserve canonical storage/auth settings
and Development scopes; this closeout is not Development runtime acceptance.

WYSIWYG/JRT editor work, pgvector evaluation and realtime collaboration are
deferred follow-ups. Pinecone remains authoritative for chat vectors. Reconcile
the dated 60-alert dependency banner against current manifests and actual sinks;
the migration does not claim a complete security audit.
