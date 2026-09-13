# Staged production release

The app-owned release workflow runs for `master` after the reusable quality
workflow succeeds. Vercel's automatic `master` deployment remains disabled.
The release job uses the GitHub `Production` environment, with its Vercel token
limited to provider steps and its project/team IDs read from environment vars.
Third-party Actions and the Vercel CLI are pinned.

The workflow preserves an untouched, mode-0600 production environment snapshot
before preparing build-only placeholders. Loom validates the selected direct
migration connection before building. Vercel metadata determines which unreadable
Sensitive values may receive placeholders, and Loom rejects a built artifact
containing any placeholder marker. A configured protected migration URL overlays
the preserved snapshot only during validation and migration.

The production artifact is uploaded without moving domain aliases. Compatible
Drizzle migrations run before HTTP checks. The staged checks obtain a short-lived
GitHub OIDC identity and send it only to the API-verified production artifact.
Vercel Trusted Sources must restrict that identity to this repository, `master`,
the `Production` GitHub environment, and Vercel's production environment. No
persistent deployment-protection bypass is created by the workflow. Both the
homepage and anonymous Better Auth session endpoint must return exactly HTTP
200, and the latter must return JSON `null`. Redirects and HTML login pages fail.
The auth handler requires the protected legacy-import singleton to be complete
and reconciled; the release workflow never imports the legacy corpus itself.

Only a successful staged check permits promotion. A CLI timeout does not cancel
the provider's promotion, so the following check polls the project's actual
`lastAliasRequest`, verifies the exact production deployment and `magick.ly`
alias, then smokes the public site without a bypass token. A partial failed
promotion also receives the public smoke before the job reports failure. An
unresolved outcome stops with an explicit recovery instruction; the next release
refuses any still-pending alias change regardless of its age. Inspect the Vercel
project/alias and verify the live app before retrying an uncertain promotion.

Provider contracts: [Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources),
[promotion timeout semantics](https://vercel.com/docs/cli/promote).
The installed Vercel CLI 59.13.1 confirms that `vercel curl` can create a persistent
bypass and that its promotion-status age cutoff is unsuitable as the release
recovery guard. The app's checks use the underlying read-only project state.

This workflow has been reviewed locally. Twenty-four focused release-check
tests pass, including delayed promotion, wrong artifact, old unresolved jobs,
overlapping promotions, partial failure, redirects, and token scoping. Both YAML
files parse and all 25 shell blocks pass syntax checks. A synthetic rehearsal
validates all 24 environment requirements, rejects leaked placeholders and missing
database metadata, and preserves the untouched migration snapshot. These checks
do not establish a successful GitHub or Vercel run. The required environment
policy now includes the active/readable ritual publication policy IDs. Protected
GitHub and Trusted Sources configuration, private storage credentials, fresh
import and deployed acceptance must be completed before the first release.

Read-only GitHub inspection found existing `Preview` and `Production`
environments. `Production` has no environment secrets, variables or branch
policy yet. This does not describe repository-level secrets. Configure the
reviewed release environment through Loom and verify the remote settings before
dispatching a release. Do not bypass the import gate to bootstrap deployment.
