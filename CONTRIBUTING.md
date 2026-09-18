# Contributing

Bug reports, fixes, data corrections and new correspondences are all welcome.
Open an issue or a pull request at
[github.com/gadicc/magick.ly](https://github.com/gadicc/magick.ly).

## Licensing of contributions

The app is AGPL-3.0-or-later, the data is CC BY 4.0, and the marked components
are MIT; [README.md](./README.md) says which is which.

By contributing, you agree that:

- your contribution is licensed under the licence of the files it touches, and
- you grant Gadi Cohen the right to license your contribution under other
  terms as well, including terms that are not open source.

You keep the copyright in what you write. The second point keeps two doors
open that the AGPL alone would close: selling a licence to someone who cannot
accept the AGPL, and publishing a build through app stores whose terms
conflict with it. Neither is possible if any part of the code cannot be
relicensed, which is why this is asked for up front rather than later.

If you would rather not grant that, say so in the pull request. Your work can
still go in under the AGPL alone, and it will simply be kept out of any build
that needs other terms.

## Before opening a pull request

```bash
pnpm check      # formatting and lint
pnpm typecheck
pnpm test
```
