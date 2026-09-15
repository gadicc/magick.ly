# Modernization status

Updated 15 September 2026. This page is the current status. The
[resume checkpoint](025-pause-checkpoint.md) records the exact continuation
boundaries. The [implementation ledger](002-implementation-ledger.md) and the
other numbered plans retain dated evidence; their present-tense limitations are
historical and do not override this page.

Modernized commit `8ad3a978429ae35d31edd238b7aac4410358485e` is serving
Production from Vercel deployment `dpl_6TcqMFzJtFkNyjiniRxZYx3Hctfz` in London.
Both the project Production target and `magick.ly` resolve to that exact ready
deployment. Normal application writes are open. A verified persistent firewall
rule denies legacy `/api/file2` writes, including normalized path variants, while
ordinary reads remain available. The traffic switch has happened; final cutover
acceptance and retirement are still in progress.

The final fenced Mongo snapshot was imported into Production SQL and replayed
against its completed fingerprint without allocating new identities. All ten
reviewed legacy file mappings are active and their public bytes, hashes and media
types reconcile. Do not rerun the importer or relocation activation. The dedicated
legacy Mongo principal remains restricted to exactly `readAnyDatabase@admin`; its
safe zero-match write probe was denied by Atlas. Do not restore its write role.

GitHub release run `34973396659`, attempt 2, completed its build, artifact scan,
Production staging, migrations, staged runtime checks, import gate and promotion.
Only its original final checker failed because the Vercel project request omitted
the `rollbackInfo=true` projection that exposes `lastAliasRequest`. Independent
recovery receipt `production-release-recovery.json` then verified the terminal
promotion, exact deployment, stable alias and anonymous runtime; its receipt hash
starts `d675bc3501d3`. The corrected checker is local commit `d295164` and has not
yet been pushed. Runtime and release-policy cleanup is reviewed in local commit
`651f1a1`; it is also unpushed. The failed CI attempt remains failed, and a later
successful release run is still required.

| Area | Current verified state | Remaining |
| --- | --- | --- |
| Runtime and release | Exact modern Production deployment is ready in `lhr1`; project target and public alias match; independent recovery passed | After Production acceptance and legacy-setting cleanup, push the two reviewed follow-up commits and obtain a clean deployed release run |
| Database and import | Seventeen migrations and the final private-data import are complete; completed-fingerprint replay is unchanged | Production browser acceptance; preserve immutable import and backup receipts |
| Files and legacy routes | Ten SQL file mappings are active; public legacy files reconcile; permanent legacy-write firewall passed 98 edge observations and 14 strict same-host normalizations | Run the bounded backfill for up to five imported rituals, then verify their online and offline reads |
| Authentication and private access | Real Preview Google OAuth, two-account authorization, private image upload/save/publication and offline reload passed | Complete Production Google OAuth and the bounded Production account/permission journeys |
| Study and offline lifecycle | Local production-build cold offline and exactly-once reconnect passed; deployed Preview private offline reading passed | Confirm the selected Production journeys after bundle backfill |
| Chat and Discourse | Live chat passed against the retained corpus. The replacement Discourse key is Production-only, rotated and validated through bounded read-only routes | Verify required Production integration behavior without sending test forum mutations |
| Writer and rollback safety | Application writes are open; legacy file writes stay denied; Mongo is read-only; final backup and reconciliation receipts are retained | Keep legacy authorities available only for the rollback window, without restoring them as writers |
| Retirement | Legacy runtime use is bounded and current environment metadata is captured | Remove legacy environment entries after acceptance; identify and retire the dedicated old R2 token and Mongo credential under the rollback policy while preserving the old bucket and backups |
| Reusable Loom skill | The generic modernization skill remains an ignored, validated draft | Final review and evaluation after cutover completion; only then save and commit it into Loom |

Preview acceptance used two real Google accounts and the isolated Preview database.
It covered temple authorization, private upload/save/publication, image rendering
and offline reload. Revocation, expiry and image-purge behavior passed separate
local production-build browser tests. The live chat check also completed without
writing the retained corpus. These checks support the Production rollout but do
not replace the remaining Production OAuth, bundle backfill and browser acceptance.

The replacement Discourse credential is installed as a Production Sensitive
setting and the revoked predecessor was not restored. Read-only groups, admin and
staff-log capabilities were validated. The remaining acceptance must not create
forum messages, invitations or synthetic users merely to prove connectivity.

The persistent legacy-upload edge check has passed. Its earlier `308` response for
a doubled-slash path was a same-host normalization to the canonical path, whose
write was then denied. The final checker follows only that strict normalization;
it does not accept arbitrary redirects.

## Next gates

1. Complete Production Google sign-in and verify the existing imported account,
   temple and ritual access.
2. Run the bounded backfill for up to five imported rituals and verify current
   permission, image and offline behavior without replaying the primary import.
3. Finish the bounded Production acceptance journeys.
4. Remove the reviewed legacy runtime environment settings while the accepted
   `8ad3a978` deployment remains immutable. Preserve shared Development scopes.
5. Push reviewed commits `d295164` and `651f1a1`, then obtain a fully successful
   CI release and deployed verification without the retired settings.
6. Retire the dedicated legacy credentials only after their identity and rollback
   conditions are satisfied. Preserve the old bucket and backups until a separate
   retention decision is authorized.
7. Reconcile, independently evaluate, save and commit the generic Loom skill after
   the modernization is complete.

WYSIWYG editing and realtime collaboration remain deferred. The migration retains
the JRT source editor and existing document format.
