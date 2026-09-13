# Private ritual image delivery

Loom Files is active locally with the managed UUIDv7 metadata schema and the
app's configured access, repository, storage and route modules. Its GET route
serves only finalized ritual attachments; generic POST and digest lookup remain
disabled. Uploads still use the separately reviewed signer/finalizer. Legacy
public images continue through their protected compatibility lookup.

A canonical source locator binds the file, attachment and ritual IDs. The upload
form exposes that locator for copying and editor insertion. Current editors can
preview a newly finalized image before saving its first source reference.
Ordinary readers need current ritual access and an exact reference in the
selected rendered content. The uploader identity alone grants no access.

The repository joins the managed file row, live ritual association and completed
upload intent. It rejects inconsistent ownership, MIME, digest or object location
and never returns legacy public rows. Object reads use the configured private R2
origin/bucket and finalized prefix. Delivery verifies bounded bytes, MIME and
SHA-256 between fresh association and permission checks. The route sends private
no-store, same-origin resource policy and nosniff headers, with safe errors and
ASCII-safe inline disposition. Source locators cannot select metadata responses.

The private image catalog captures these authorized bytes and image-validation
facts for offline asset planning. It is a separate input to publication, not a
publication marker. Plan v5 / inventory v3 records the additional provenance.
Migration 0015 accepts that new contract alongside historical v4/v2 records;
completed historical bundles remain readable without rewriting their JSON or
hashes. Mixed version pairs are rejected. The protected importer now pins the
new migration and snapshot artifacts as well.

Root adversarial review found the pre-save image-preview failure and a returned
buffer that escaped cleanup on cancellation. Both are fixed. Actual Loom-route
tests cover successful private delivery, metadata/locator refusal, revocation
during object I/O and safe database errors. SQL tests prove unchanged historical
bundle reads and mixed-version rejection.

The combined focused scope passes 743 cases across 18 files. The existing FIFO
importer tests require execution outside the filesystem sandbox; their rerun
passes. The final configured repository passes its 23-case integration subset,
isolated TypeScript, Biome, ordinary Loom checks and a production build using
synthetic credentials and closed loopback service endpoints.

Evidence is under `/tmp/magickli-private-file-*`. No Neon migration, provider
object write, application credential configuration or deployment happened in
this unit. Publication/backfill, the complete editor flow and live acceptance
remain separate gates.
