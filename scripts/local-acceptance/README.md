# Local acceptance identities

`pnpm local-acceptance:seed` creates real Better Auth sessions for three fixed,
synthetic users in the dedicated local PostgreSQL database. It uses Better
Auth's `testUtils()` only in this external command. The application auth
configuration, HTTP routes, disabled password login and Google-only deployed
login remain unchanged.

The command refuses every Vercel context and requires these exact targets:

- PostgreSQL database and role `magickli_acceptance_20260914` at
  `127.0.0.1:5432`, supplied as `DATABASE_URL_UNPOOLED`
- `BETTER_AUTH_URL=http://127.0.0.1:3115`
- a local-only `BETTER_AUTH_SECRET` of at least 32 characters

Run it through the project task so Loom supplies the private environment:

```sh
pnpm local-acceptance:seed
```

The database must be freshly migrated and empty. The command adds a clearly
labelled synthetic completed-import readiness row, ordinary creator and reader
users, one global-admin user with an app-owned `user_access` grant, and one
actual session per user. It refuses to overwrite an existing fixture.

Private Playwright state is written under the ignored directory
`output/playwright/local-acceptance/auth/` with directory mode `0700` and file
mode `0600`. Use `creator.storage-state.json`, `reader.storage-state.json` and
`admin.storage-state.json` in three separate browser contexts at the exact
loopback origin. Do not copy these bearer cookies into logs, screenshots or
test reports. Recreate the dedicated database and output directory for a fresh
run.

For a production-mode browser run, set the same direct database URL, origin and
auth secret for both `next build --webpack` and `next start -p 3115`. Set
all configured Loom runtime database URL candidates to the exact same loopback
database and role; the seeder refuses a higher-priority candidate that could
redirect the application. A new browser context on the fixed loopback origin
avoids stale state; wait for
`navigator.serviceWorker.ready` before testing offline navigation because
Serwist is enabled only in production builds.

The current ritual-storage validator deliberately accepts only a canonical
Cloudflare R2 HTTPS origin. It rejects the loopback MinIO endpoint, so this
fixture currently supports auth, temple, membership, reader and administrator
journeys without file upload. Local upload/offline-file acceptance needs a
separately reviewed local-only storage transport; do not weaken the deployed R2
origin check or point this harness at cloud storage.
