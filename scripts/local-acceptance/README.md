# Local acceptance identities

`pnpm local-acceptance:seed` creates real Better Auth sessions for three fixed,
synthetic users in the dedicated local PostgreSQL database. It uses Better
Auth's `testUtils()` only in this external command. The production-build
acceptance harness keeps password login disabled and deployed login Google-only.
The optional development UI is separate: it requires the seeded identities,
`NODE_ENV=development`, `LOOM_LOCAL_TEST_LOGIN=1` and no Vercel marker.

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

Private upload, finalized-file reads, bundle publication and offline downloads
use the dedicated local MinIO bucket. Read its endpoint, bucket and credentials
from the private `0600` settings file and configure Loom's canonical variables
with `FILES_STORAGE_PROVIDER=minio`, `FILES_S3_REGION=auto` and
`FILES_S3_FORCE_PATH_STYLE=true`. Set `MAGICKLI_LOCAL_ACCEPTANCE=1` explicitly.
MinIO CORS must allow the exact `http://127.0.0.1:3115` origin, `PUT`, and the
headers declared in `loom.json`.

The application accepts this path in development and production mode when the
configured auth origin and MinIO origin are exact numeric-loopback HTTP origins,
every configured Loom runtime database URL is numeric-loopback without a query
or fragment, and no Vercel marker is present. R2 keeps its existing closed HTTPS
configuration and provider identity. Never point this local harness at cloud or
LAN storage.
