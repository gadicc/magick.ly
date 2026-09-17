# Turbopack development

Research, decision and implementation record, 17 September 2026. Read
[current status](000-current-status.md) first. For development this replaces
the "keep webpack for now" notes in [plan 001](001-modernization-research.md)
and [plan 002](002-implementation-ledger.md); production builds still use
webpack.

Decision taken on 17 September: make development work under Turbopack, using
the bundlers' built-in module types where possible, and keep production on
webpack until the service worker can move. Moving production builds is
deferred ([below](#production-builds-on-turbopack-deferred)).

## Background

- Next 16 makes Turbopack the default for `next dev` and `next build`, and the
  upgrade guide recommends it for both; `--webpack` is the documented opt-out.
  No webpack deprecation or removal had been announced by 16.3.5 or the 16.4
  canaries. Next runs its own bundled webpack 5.98.0; the installed `webpack`
  package is not what builds the app.
- A plain `next dev` failed on every page once a ritual route had compiled.
  Next's own check for "a webpack config but no turbopack config" never fired:
  it reads `.webpack` from what the config function returns, and ours is
  `async`, so it returns a Promise.
- Sources: the bundled docs (`01-app/03-api-reference/08-turbopack.md`,
  `05-config/01-next-config-js/turbopack.md`,
  `02-guides/upgrading/version-16.md`); vercel/next.js
  [#95606](https://github.com/vercel/next.js/pull/95606) (`type: "text"` on by
  default), [#96558](https://github.com/vercel/next.js/pull/96558)
  (`type: "raw"` fix, 16.4 canaries only) and
  [#74825](https://github.com/vercel/next.js/issues/74825) (the related `!=!`
  inline form, still unsupported);
  [serwist#360](https://github.com/serwist/serwist/issues/360).

## Blockers and fixes

| Under Turbopack on `1cfdb0c` | Fix | Commit |
| --- | --- | --- |
| `!!raw-loader!` ritual imports cannot be parsed; the error shows on every page | `with { type: "text" }`, a webpack `asset/source` rule for `*.jade` and a `*.jade` declaration | 3 |
| `arraybuffer-loader!` WASM import in the ritual editor | `new URL("source-map/lib/mappings.wasm", import.meta.url)`; both bundlers emit `/_next/static/media/mappings.<hash>.wasm` | 3 |
| Every JSON5 file: "Unable to make a module from invalid JSON" | Turbopack rule through `loaders/json5-loader.mjs` with `as: "*.json"` | 4 |
| SVG imports become image objects ("Element type is invalid") | Turbopack `@svgr/webpack` rule | 4 |
| nlopt-js requires `fs` in the client bundle | `turbopack.resolveAlias` maps browser `fs` to `src/lib/emptyModule.ts` | 4 |
| `/api/study` returned 500 and `next build --turbopack` stopped collecting page data: `next/font/local` is undefined in route handlers | Sets name a `questionFont`; the quiz resolves it | 1 |
| The `/og/[...card]` trace held the whole project (1,166 files, 663 from `src/`) | `turbopackIgnore` on its build-time file reads | 2 |

Not blockers: Serwist is disabled in development under both bundlers, and its
Turbopack warning only prints when it is enabled. The `/gd/sigils` hydration
warning (one coordinate's last float digit differs between Node and the
browser) appears under both bundlers and was flagged as a separate task.

## Choices

- `turbopack.rules` with `type: "raw"` is documented but broken in 16.3.5: the
  import silently compiles to `void 0`. `?raw` is built into neither bundler,
  and `turbopackLoader` import attributes are Turbopack-only.
  `with { type: "text" }` works natively in Turbopack 16.3.5, although its docs
  do not list it yet. Next's webpack ignores the attribute and applies the
  extension rule. A `.jade` import without the attribute fails loudly under
  Turbopack ("Unknown module type"), and `check:turbopack` prerenders the
  built-in rituals, so a regression cannot pass CI quietly.
- The source-map WASM is now a separate 48 KB file rather than base64 in the
  editor chunk. Serwist precaches it with the other `static/media` assets, so
  offline editing keeps it.
- Rejected: precompiling the rituals into a TS module (about 117 KB duplicated
  and able to drift). Possible later, if the remaining rules become a burden:
  converting the JSON5 data to TS modules and the eight SVGs to components.
- Rejected: failing fast when Turbopack is used. A `process.env.TURBOPACK` guard
  in `next.config.ts` works for `next dev` and `next build`, but `next typegen`
  also defaults to Turbopack and loads the build-phase config, so `typecheck`
  would have needed `next typegen --webpack`.
- `raw-loader` and `arraybuffer-loader` were removed with a one-off
  `--config.minimum-release-age=0` lockfile regeneration, approved on
  17 September: the seven-day policy re-checks every locked version, and the
  lockfile already held younger releases from the 16 September upgrades. The
  diff only removed packages and added `libc` metadata to 34 native-binary
  entries. With that metadata pnpm skips musl-only binaries on glibc machines,
  so sharp's musl binaries (about 19 MB) are no longer installed or traced
  into server functions; the glibc binaries Vercel loads remain. The `webpack`
  devDependency stays because it settles the optional
  `webpack` peer of Serwist's plugin; removing it re-resolves that graph to
  newer releases.

## Development and checks

- `pnpm dev` runs Turbopack; `pnpm dev:webpack` runs the previous server for
  parity checks.
- `pnpm check:turbopack` is a Turbopack production build used only as a check,
  with Serwist's warning suppressed. CI runs it after the webpack build. It
  replaces `.next`, ships no service worker and leaves any `public/sw.js` from
  an earlier webpack build in place, so run `pnpm build` again before
  `pnpm start`.
- The service worker still cannot run in development under either bundler.
  Test it with `pnpm build` and `pnpm start`, as in
  [plan 024](024-local-acceptance.md).
- Browsers keep a service worker per origin. A `localhost` port once used for a
  production build stays controlled by that worker, which can serve stale pages
  to a later dev server on the same port. Check
  `navigator.serviceWorker.getRegistrations()` or use a fresh port.

## Production builds on Turbopack (deferred)

From reading Serwist 9.5.12 and a probe Turbopack build (which succeeded once
the blockers above were fixed, but shipped no service worker):

1. Replace `@serwist/next`'s webpack plugin with configurator mode
   (`@serwist/cli`, `next build && serwist build`), preferably through Loom's
   `pwa` feature, which already scaffolds it. `@serwist/turbopack` is labelled
   experimental and has an open Vercel crash (serwist#360).
2. Add fonts (`woff`, `woff2`, `ttf`, `otf`) and `wasm` to its precache glob.
   `assertShell` rejects any shell whose preloaded fonts are not precached, so
   the worker would not install.
3. Set `precachePrerendered: false`, so precached `/doc/*` HTML cannot bypass
   the public-shell handler.
4. Pass the deployment id into the worker build explicitly, and create
   `window.serwist` in the app; Loom's lifecycle does nothing without it.
5. Add a CI check that `public/sw.js` exists and its manifest contains the
   build manifest and the shell assets. Nothing checks this today, and a
   Turbopack build passes without a worker.
6. Rehearse a release. Turbopack writes hashed symlinks under
   `.next/node_modules` for `serverExternalPackages`, and moved or prebuilt
   output can lose them
   ([vercel/next.js#87737](https://github.com/vercel/next.js/issues/87737)).
   Our release uses `vercel build --standalone`.

Configurator mode does not depend on the bundler, so steps 1–5 can land and be
verified offline while production still builds with webpack. Switching
`build` to Turbopack is then a small final step.

Revisit when Next 16.4 is stable, Loom's PWA feature is adopted, the Vercel
symlink issue is resolved, or a webpack deprecation is announced.

## Commits

1. `e0bb503` fix(study): Keep next/font out of the study API. Sets name a
   `questionFont`; Vitest aliases `next/font/local` to a stub so tests that
   render the quiz can load the font module.
2. `24a2a47` fix(seo): Keep OG build reads out of tracing.
3. `71e23d5` refactor(doc): Drop inline webpack loader imports.
4. `a2bf0fd` build(app): Run development on Turbopack. Adds the `turbopack`
   config, the `dev`, `dev:webpack` and `check:turbopack` scripts, and the CI
   step.
5. `64b1390` chore(deps): Remove the unused inline loaders.
6. This record and the status follow-ups.

## Verification

Each commit passed the CI-equivalent gate in a fresh worktree on Node 24.18
with CI's environment: `pnpm install --frozen-lockfile`, `loom init` (no tree
changes), `loom check`, `loom check --production` (only the existing pnpm 11
advisories), `pnpm check`, `typecheck`, `test:coverage` (4,516 tests, 16
skipped; per-file thresholds met), `pnpm build` and, from commit 4,
`pnpm check:turbopack` without warnings. The first run of the series failed
`test:coverage` at every commit; that was the review's blocker below.

| Build output | Before | After |
| --- | --- | --- |
| Webpack `/og/[...card]` trace | 311 files | 311 files, identical, until commit 5; then 304 (sharp's musl binaries no longer installed) |
| Turbopack `/og/[...card]` trace | 1,166 files, 663 from `src/` | 302 files, none from `src/` |
| Serwist precache (webpack) | 291 entries | 292: adds `/_next/static/media/mappings.8a3e974c.wasm` |

On the final tree, with placeholder database and auth settings:

- `pnpm dev` (Turbopack) and `pnpm dev:webpack` both return 200 for `/`,
  `/about`, `/doc/zelator`, `/doc/neophyte`, an editor URL,
  `/astrology/planets`, `/geomancy/reference`, `/enochian/tablets`,
  `/kabbalah/yhvh/72angels`, `/gd/sigils`, `/gd/components`, `/study` and
  `/og/home.png`; `/api/study` returns 401 without a session. All 21 route
  handlers answer with the same statuses under both servers, and Turbopack
  logged no errors.
- In a browser on origins with no earlier service worker, under both dev
  servers: the rituals render, the home page draws the SVGR logo, the rose
  sigil draws through nlopt, the Enochian flashcards use the Enochian font, and
  a probe page (removed before committing) mapped a position through
  `SourceMapConsumer`, loading the emitted WASM.
- A webpack production build served by `pnpm start`: the worker from that
  build (its precache holds this build's `_buildManifest.js` and the WASM)
  activated and warmed the three ritual shells and `/offline/ritual`. With the
  server stopped, `/doc/theoricus` reloaded in full and the WASM still loaded
  (48,526 bytes). The editor URL server-renders.
- An earlier Turbopack production probe, with a stopgap for the study font,
  built and served the rituals, home page and Enochian tablets, but had no
  `/sw.js` and no `window.serwist`, as expected.

Not verified: the ritual editor with a signed-in session (no local database),
Safari, and a Vercel deployment.

## Adversarial review

An adversarial review (Loom Torvalds profile) of the first series, plus
the gates. A second pass over the final series found nothing to fix beyond
wording.

- Must fix, fixed: `src/study/client.test.tsx` renders the quiz, which now
  loads the font module, and `next/font/local` is empty outside Next, so the
  suite failed at every commit. Vitest now aliases it to a stub (commit 1).
- Should fix, fixed: literal `public/` paths in the OG route added
  `public/pentagram.png` to the webpack trace (312 files), contradicting the
  commit message. The route keeps its helper and marks it `turbopackIgnore`,
  so the webpack trace is unchanged. The reviewer's simulation expected the
  old trace to hold no public files; real builds show it already held
  `public/fonts`.
- Should fix, done: unused loaders and stale notes recorded here and in the
  status page; the loaders are now removed.
- Nits, applied: `satisfies` on the quiz's font map, the production build
  before the Turbopack check in CI, a config comment on why ritual sources
  need no Turbopack rule, and the note above that `check:turbopack` leaves a
  stale `public/sw.js`.
- Kept by decision: `with { type: "text" }` relies on Turbopack behaviour its
  16.3.5 docs do not list yet; `check:turbopack` covers it. The script name
  stays next to `check`.

## Follow-ups

- Production builds on Turbopack, as above.
- Drop the `webpack` devDependency when Serwist's webpack plugin goes.
- The `/gd/sigils` hydration warning was flagged on 17 September and started
  as a separate task.
