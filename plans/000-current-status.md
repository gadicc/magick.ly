# Modernization status

Updated 15 September 2026. This page supersedes older pending-acceptance notes;
the [closeout checkpoint](025-pause-checkpoint.md) records preservation and
continuation boundaries.

Production is live on `4d9d10d37b5a3877d0f9230c5e75ff5a969c7e37`, deployment
`dpl_HHLsAXCa7vopfkqwiyVuqETkaaL2`, in London (`lhr1`) on Node 24.
[CI/release run 34994058815](https://github.com/gadicc/magick.ly/actions/runs/34994058815)
succeeded, including migrations, artifact checks, staged acceptance and promotion.
The final read-only receipt verified the exact deployment, Production target,
stable `magick.ly` alias and ten legacy images on both the public alias and fresh
deployment requests, preserving bytes, MIME and size. All twenty responses were
cache misses. The eight reviewed legacy environment changes were verified.

| Area | Completed evidence |
| --- | --- |
| Data and files | Fenced SQL import, unchanged completed replay, ten file relocations and exact retained-public-link checks |
| Product acceptance | Existing-account Google sign-in/navigation; publication of all five imported rituals with zero stops; private online reading and offline reload with text/images; new private upload confirmed |
| Runtime cleanup | Final Production deployment works without its retired settings; two shared credential records retain Development only and six obsolete records were deleted |
| Old credentials | Vercel release-token removal independently verified, preserving its replacement and unrelated identities; operator confirmed deletion of R2 token `magickly` and Atlas database user `magickli@admin` |

The product journeys above passed on the accepted `8ad3a978` deployment; the
final `4d9d10d` release adds the verified cleanup and retains that evidence within
its recorded scope. Mongo/R2 deletions are operator confirmations, not independent
provider inventories.

Final release receipt SHA-256:
`bfce8ec354712b9beac6d7a168b039f69b60540349af2a9bc470b61b32cf8aab`.
Vercel retirement receipt SHA-256:
`07d23afc8fb2bbcbd2469786ad7873d9ebb610bdc0e31d5171496be8f11c435d`.

Post-retirement verification passed on 15 September at 16:39–16:41 UTC:
20 live public/deployment responses preserved byte/hash/MIME parity, the exact
Production identity remained unchanged, and the uncached canonical Files API
returned the expected 400/404 responses. Cached image responses were explicitly
not treated as fresh storage proof. Ten direct GETs using the replacement R2
credential then verified all 7,790,234 migrated bytes and MIME types.

- Live parity receipt: `76ea55ef3be8ea2a2cc612036a6c55085b6f6fe692da15aff9eae3ae35cb4a46`.
- Direct R2 receipt: `9bf747d58d80284cecda401e66c47bca82a71133135aaa98427fa5ade6bf175a`.
- The three temporary credential handoff files were removed after verification;
  provider settings and backups were preserved. Cleanup receipt:
  `cc54da299fab7458b1b54b10d23ea117f2a2e6586d917db5e911e2c378936c8c`.

The reusable Loom `modernize-app` skill is committed locally as
`b3460006a8482270c4cb9427b6a6bd4af7c2d51e`. The full Deno suite passed
(64 tests, 634 steps), as did formatting/lint, skill validation and the npm build.
All six emitted skill resources match source and their references resolve.
The source commit is not yet pushed or published; Magickly remains pinned to
Loom 1.27.0. This documentation closeout is separate from the deployed code.

Normal SQL writes are open. The persistent legacy-upload write denial remains;
public reads remain available. The old database, old bucket/object bodies and
backups are retained. Do not rerun imports or make an old store authoritative
over acknowledged SQL writes.

Earlier release history remains distinct: run `34973396659`, attempt 2, promoted
successfully but failed its final checker; separate recovery evidence verified
the promotion (receipt prefix `d675bc3501d3`). Run `34992906681` failed a large SVG
test and never deployed. The final fix uses exact native byte comparisons and
excludes saved deployment test copies; validator behavior and deadlines remain
unchanged. Neither earlier failed run is relabeled successful.

Follow-ups are separate from the completed migration work:

- The current release token expires **2026-12-14T14:17:03.165Z**. Plan deliberate
  replacement before expiry; no automatic rotation is configured.
- Keep the separate `vector-dev` experiment paused until its unconfirmed
  credential is reviewed before any future unpause.
- Retain JRT source editing and format compatibility. WYSIWYG/editor evaluation,
  further JRT development and realtime collaboration are deferred product work.
  Pinecone remains the chat vector authority; pgvector is a future option.
- The 15 September push banner reported 60 dependency alerts (2 critical, 27 high,
  26 moderate, 5 low). The [dependency upgrade ledger](026-dependency-upgrades.md)
  records the 16 September reconciliation: the reachable alerts were resolved by
  upgrades and removals, four audit findings remain unreachable through the
  verified current paths, and the deferred majors list their revisit conditions.
  Dependabot re-evaluates its list after the push; this is not a complete audit.

- TODO: rate limiting for the public component image routes
  (`/api/render/*`, `/api/treeOfLife`). Each distinct query renders through
  WASM on request, and `/api/render/rose-sigil` adds up to about 330 ms of CPU
  for a 32-letter text, so the edge cache offers no protection against varied
  requests. Nothing in the app rate-limits today; see
  [plan 027](027-component-exports.md#adversarial-review).
- TODO: after the SEO release, resubmit `/sitemap.xml` in Search Console and
  remove `/sitemap-0.xml` if it was submitted directly (it is now a 404); see
  [plan 028](028-seo.md#follow-ups).
- TODO: SEO content follow-ups from [plan 028](028-seo.md#follow-ups):
  compute `/astrology/moon` dates only in the browser, replace the raw JSON
  rows on planet and grade pages, prerender the `/study` set list, consider
  public SQL rituals for the sitemap, and give the short app bar titles fuller
  names. The archangel data fix (17 September) moved the Tree image identity
  to `magickli-tree-image-outlines-v2`; see
  [plan 028](028-seo.md#archangel-data).
- Development runs on Turbopack since 17 September (`pnpm dev`;
  `pnpm dev:webpack` for parity), and production still builds with webpack;
  see [plan 029](029-turbopack-development.md). TODO: move production builds
  to Turbopack when relevant. The service worker must first leave
  `@serwist/next`'s webpack plugin; the steps and revisit conditions are in
  [plan 029](029-turbopack-development.md#production-builds-on-turbopack-deferred).
- TODO: drop the `webpack` devDependency once Serwist's webpack plugin is gone;
  it settles that plugin's optional peer
  ([plan 029](029-turbopack-development.md#choices)).
- Not yet released: from the next release, anonymous `/api/session` checks
  return 200 with a null user instead of 401 (changed 17 September). An
  anonymous tab left open across that release shows a study load error until
  it reloads; see
  [plan 013](013-sql-auth-runtime.md#runtime-entrypoints-prepared).
- TODO: name the authors of the two SVG Repo assets in the About page's
  credits (the Sentinel's eye, CC BY, and the Kerux's caduceus, public
  domain). svgrepo.com answered 429 when the credits were written, so only
  the source and licence are listed; CC BY asks for the creator's name where
  one is given.
- TODO: size tiles from the space they have, for the UX pass. `Tiles` takes
  MUI Grid breakpoints, which follow the viewport, so a page whose tiles sit
  in a narrower container has to pass its own `size`, as /astrology/planets
  now does. A CSS grid with `repeat(auto-fill, minmax(...))`, or container
  queries, would size each tile from its container instead.
- TODO: give each Tree of Life path's letter its own id. `TreeOfLife` uses
  `path<id>` for both the path outline and its letter, so every page with a
  tree has 22 duplicate ids. SVG export already renames the later copies
  (`svgExport.ts`), so exported files are valid. If a new id changes the
  generated tree image's bytes, bump `TREE_IMAGE_PROFILE` with it.

Majou2 and MyReiki were read-only skill-evaluation fixtures. Neither was migrated.
