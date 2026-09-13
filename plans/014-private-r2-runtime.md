# Private R2 runtime provisioning

On 13 September 2026 the refreshed Wrangler OAuth login was checked against the
canonical R2 account endpoint in the existing Vercel Production configuration.
The authenticated account list contained exactly that account. No credential
values or email addresses were printed or retained in the inspection reports.

Two previously absent buckets were created with the Western Europe placement
hint and default jurisdiction:

| Environment | Bucket | Public access | Browser uploads |
| --- | --- | --- | --- |
| Production | `magickli-files-production` | r2.dev disabled; no custom domains | Only `https://magick.ly` |
| Preview | `magickli-files-preview` | r2.dev disabled; no custom domains | No CORS policy yet |

Both report location `WEUR`, Standard storage and zero objects immediately after
creation. Location is a provider placement hint, not a London residency promise.
Production's saved CORS policy allows only PUT, a 300-second maximum age and
these headers: `content-type`, `if-none-match`, `x-amz-checksum-sha256`,
`x-amz-meta-magickli-file-id`, `x-amz-meta-magickli-operation-id` and
`x-amz-meta-sha256`. It exposes no response headers. Preview requires an exact
deployment origin before its policy is configured.

The existing legacy bucket, public links and credentials were not changed.
No application deployment, SQL import or private object publication occurred.
Wrangler administration does not supply application S3 signing credentials.
The operator has been asked to create separate Object Read & Write credentials,
each scoped only to its corresponding new bucket. A local hidden-input helper
stages them in an exclusive mode-0600 file outside the repository; values must
never be pasted into conversation or committed.

The next integration steps are the closed Loom file wrappers, environment
configuration, verified Preview database isolation, synthetic upload/download
acceptance, and resumable publication of imported ritual bundles. Do not mark
the Files feature active or the private reader ready solely because the buckets
exist. A compiled archive without a published bundle is not an offline download.

Evidence lives in `/tmp/magickli-r2-setup-proposal/`: `auth-report.json`,
`private-bucket-inspection.json`, `provision-report.json`, the two bucket info,
domain and public-URL reports, and `cors-verification-report.json` with the saved
Production CORS projection. The Preview CORS read explicitly reports absence.
All provider changes were limited to these two new migration-specific buckets.

References: [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/),
[R2 data location](https://developers.cloudflare.com/r2/reference/data-location/).
