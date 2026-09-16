# Dependency upgrade ledger

Updated 16 September 2026. This closes the dependency-alert follow-up recorded in
[current status](000-current-status.md) and the [closeout checkpoint](025-pause-checkpoint.md).
It is a reconciliation of current manifests and reachable dependency paths, not
a complete security audit.

## Method

Every unit below passed the CI-equivalent gate on Node 24 before the next unit
started: `pnpm install --frozen-lockfile`, `loom check`, `biome check`,
`next typegen && tsc --noEmit`, `vitest run --coverage` and `next build --webpack`
with the CI placeholder environment; the final tree also passed
`loom check --production`, the release workflow's form. The baseline on `5a39d3d` passed the same
gate (163 test files, 4,361 tests). Registry data and official release notes were
read for every major. Units that needed source changes were checked against the
previous implementation with real inputs; those checks are listed per unit.

`pnpm audit` reported 65 findings before the work (2 critical, 31 high, 28
moderate, 4 low) against the 60-alert Dependabot banner. Dependabot re-evaluates
its alerts against the pushed lockfile; the numbers here come from the local
audit of the final tree.

## Results

| Unit | Change | Result | Verification beyond the gate |
| --- | --- | --- | --- |
| Patch and minor releases | `ai` 7.0.102 and its `@ai-sdk` packages, CodeMirror 6.x, AWS SDK 3.1133, `better-auth` 1.7.5, `zod` 4.6.5, `uuid`, `qrcode`, Vitest 5.0.1, Biome 2.5.14 (schema updated), `@types/node` 24.13.5, `@types/slug`, `@types/pdf-parse`, `@testing-library/dom` | clean | — |
| LangChain | removed `langchain` 0.2 and the deprecated `@langchain/community` 0.2; added `@langchain/core` 1.2 and `@langchain/textsplitters` 1.0; PDF page extraction moved to `src/app/chat/train/pdfPages.ts` on the pdf.js build that `pdf-parse` 1.x already bundles | migration | Byte-identical pages, metadata and chunks for 5 real PDFs (98 pages, 238 chunks) between the retired loader/splitter and the replacements; the loader now destroys its pdf.js task on success and failure |
| `@svgr/webpack` 6.5 → 8.1 | Babel/SVGO alert chain removed | migration-free | All 8 imported SVGs rendered through both loader versions: 6 pixel-identical at 8× density, 2 differ in under 0.01% of channels by at most 9/255 (anti-aliasing) |
| `react-syntax-highlighter` 15.5 → 16.1 | prismjs ≥ 1.30 | clean | Identical token counts and markup length for four languages |
| Transitive refresh | `mdast-util-to-hast`, `ajv`, `fast-uri`, `@babel/*`, `yaml`, `browserslist`; `webpack` 5.111 declared explicitly so the copy installed for `raw-loader` resolves to a fixed release | clean | — |
| Removals | `rehype-add-classes` (a `components.table` override adds the same class), `@ai-sdk/rsc`, `yaml-loader` and its unused webpack rule | removed | Import search over `src`, `scripts`, `tests`, configs and workflows |
| Chat rendering | `react-markdown` 9 removed `linkTarget`; links now render through `components.a` with `target="_blank"` and `rel="noopener noreferrer"`, keeping the default unsafe-URL transform; filtered URLs render as inert placeholders and fragment links stay in the tab | migration | `src/app/chat/markdown.test.tsx` covers safe, filtered, fragment and mail links, GFM tables and highlighted code |
| Other majors | `slug` 12, `source-map` 0.8, `dot-prop` 10 (`getProperty`, which throws on malformed bracket paths; query-string field paths on the Tree of Life now degrade to blank labels through `readFieldPath`), `@vercel/functions` 3, `bson` 6.10.4, `react-toastify` 11 | migration | `slug`: 209,206 inputs with no output change; `source-map`: identical `originalPositionFor` results on 1,207 lookups and a browser run of the editor's compile step (shortcut transform, WASM consumer, `checkSrc`) mapping diagnostics to source lines; `react-toastify`: a browser harness showed, styled and dismissed toasts through the app's `ToastContainer` |
| `@electric-sql/pglite` 0.3.16 → 0.5.8 | Postgres 18 test engine | clean | All database suites pass |
| TypeScript 5.9.3 → 6.0.3 | bridge release with the compiler API Next 16 requires | clean | `scripts/tsconfig.scripts.json` also type-checks |
| `file-type` 19.0.0 → 21.3.2 | fixes the ASF infinite loop (GHSA-5v7r-6r5c-r473, patched 21.3.1) and the known-size ZIP inflation bound (GHSA-j47w-4g3g-c36v, patched 21.3.2) | migration | Identical detection for PNG, JPEG, GIF, WebP and APNG cases and all 66 images in `public/`; bounded regression checks for both advisories run detection in a worker with a deadline; see the validation identity section |
| `tsconfig.json`, `.gitignore` | `output` excluded from typecheck and ignored wholesale; saved deployment source snapshots there broke local typecheck after the upgrades | config | Vitest already excluded that directory |

The combined tree received an adversarial review (eight finder angles, one
verifier per candidate). Ten findings were addressed: the dot-prop fallback and
placeholder links above, a dead clause in the publication retry guard, a
redundant PDF byte copy and inert pdf.js options, tighter advisory regression
checks, test fixture reuse, the `output` ignore and this ledger's gate wording.

## Validation identity transition

`file-type` is part of `STATIC_RASTER_VALIDATION_COMPONENTS`, so its version is
a new ritual-image validation identity. Every catalog and asset plan embeds that
identity, and a publication request hash covers the plan hash. Until now a retry
of an operation started under the previous identity was rejected as
`OPERATION_CONFLICT` before the completed receipt was checked, which stranded an
otherwise correct retry and produced a duplicate bundle on the next attempt.

`initiate` now treats a rebuilt request as the same operation when its manifest
and policy are unchanged and only the server-side plan provenance differs.
Actor and policy binding, the stale-selection check and content conflicts are
unchanged. `src/offline/ritualPublicationTransition.test.ts` covers, across an
identity change: an earlier publication stays readable through the SQL reader
and the manifest contract; a validated upload, save and publication succeed under
the new identity; a pending reservation replays and completes with its original
provenance; a completed publication whose acknowledgement was lost returns its
original receipt without provider work or a second marker; and a reused
operation ID for different content is still rejected. Historical receipts,
imports and the backfill were not rerun.

## Remaining advisories

`pnpm audit` reports four findings on the final tree. None is reachable through
the verified current paths; none is cleared unconditionally.

- `browserslist` 4.28.6 (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g), pinned
  exactly by `@serwist/next`/`serwist` 9.5.12. It runs at build time on the
  project's own browserslist configuration, not on request input.
- `esbuild` 0.18.20 (GHSA-67mh-4wv8-2f99) under `drizzle-kit`'s
  `@esbuild-kit/esm-loader`. The advisory concerns esbuild's development server,
  which the migration CLI never starts; the runtime does not bundle it.

Revisit both when serwist or drizzle-kit publish releases that move these ranges.

## Deferred

- `suncalc` 2.0: the ESM build has no default export and the rewritten solar
  model moves sunrise/sunset by about 75 s (median across six locations over two
  years; up to 25 min near the pole). Upgrade when that change in planetary-hour
  times is accepted, together with the `import * as` change and null guards.
- `mongodb` 7 / `bson` 7: `gongo-server-db-mongo` 3.3.1 pins both at 6.2.0 and
  the legacy import path mixes their `ObjectId` types. Remove these packages
  with that path instead of upgrading them.
- `pdf-parse` 2: it no longer ships the pdf.js build the loader imports and has a
  new native-canvas API. Revisit as a pdf.js migration.
- `magic-string` 1.x: part of the reviewed ritual compiler identity; a change
  needs its own parity review.
- TypeScript 7: no compiler API for Next 16 outside `experimental.useTypeScriptCli`
  and no `next` editor plugin support. Revisit when Next supports it directly.
- Pre-existing peer warnings (`gongo-*` and `react-filepond` declaring React 18,
  `gongo-server-db-mongo` declaring `bson` 6.2.0) are unchanged.

## Release-age policy

`pnpm-workspace.yaml` now sets `minimumReleaseAge: 10080` (seven days) while
keeping `@gadicc/loom` excluded. The setting applies at resolution time, so
frozen installs of the committed lockfile are unaffected. The same omission
exists in the reference apps and belongs in a shared Loom improvement.

During the first attempt, `pnpm update` moved `kysely` from 0.29.5 to 0.29.6
(published that day) and typecheck failed with about 1,100 type-identity errors
between drizzle-orm instances, reproducibly after a clean install. The lockfile
keeps 0.29.5. Later probes of 0.29.6 on the final dependency set typecheck
cleanly with TypeScript 5.9.3 and 6.0.3 and with pglite 0.3.16 and 0.5.8, and the
full gate passes with it on the final tree (4,374 tests and the production
build), so the earlier failure came from the intermediate dependency graph rather
than from kysely itself. No override was added; the release-age policy would have
kept that same-day release out of the first attempt.

## Follow-ups

- `loom check` still warns about pnpm 11 preparation (`onlyBuiltDependencies`
  to `allowBuilds`, `pnpm/setup` in workflows). Out of scope here.
- Push the branch so Dependabot reconciles its alert list against the new
  lockfile, then compare with the four findings above.
