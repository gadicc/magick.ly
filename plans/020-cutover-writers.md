# Writer pause before the final import

The operator approved a short write pause. Its exact mechanism is not yet
established. Do not treat a domain promotion or the new app's disabled Gongo
route as a fence for historical deployments.

Read-only Vercel inspection on 13 September 2026 resolves current production to
deployment `dpl_9m7ojZk6FZMJoCKsELDe53qiQkRp`, commit
`f51a84dd1a7177cfb54c20372f0f89a614651a74`. The local `origin/master` snapshot
matches that exact commit. It predates the modernization work.

The deployed source has these write boundaries:

| Boundary | Why it belongs in the pause |
| --- | --- |
| `/api/gongoPoll` | Generic browser mutations persist study, ritual and administration changes |
| `/api/auth/[...nextauth]` | Auth adapter writes users/accounts/sessions; GET callbacks also matter |
| `POST /api/file2` | Writes file metadata and object storage |
| Temple administration server actions | Discourse synchronization changes the forum and stores local links |
| Old deployment URLs and external callers | Moving the public alias alone does not retire their database credentials |

The old tRPC mutation and query registries are empty. This does not establish
that no external job, other app or manual tool can write the database.

The production Mongo credential was inspected using only `connectionStatus`
with effective privileges and `hello`. It authenticates one principal with the
`readWriteAnyDatabase` role on `admin`; the server is a replica set. Its effective
privileges include inserts, updates, removals and DDL across databases. This is
the live app credential, not an assessment of the abandoned training experiment's
separate credential. No database records, users, roles or access settings were changed.

Mongo roles grant privileges cumulatively: adding a database-specific `read`
role cannot override `readWriteAnyDatabase`. The actual credential's sharing and
administrative ownership must be established before changing it.
[MongoDB authorization](https://www.mongodb.com/docs/manual/core/authorization/),
[built-in roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/?deployment-type=self).

The next review must establish the precise credential principal, every service
that uses it, available administrative access and the narrowest reversible
change that fences Magickly writes. Retain the previous role configuration
privately for recovery. A shared credential must not be disabled or weakened
blindly, and a global Mongo lock must not be used to pause one app.

Before taking the final snapshot, verify the chosen fence on the production
alias and retained deployment URLs, stop relevant jobs, drain already-started
database and Discourse work, and verify that the old writer credential can no
longer write. Any probe that can change production data needs its own reviewed
exact operation. Finish the consistent backup, audit, import, reconciliation and
staged acceptance before reopening application writes. Retain a fence on old
writers after promotion; new SQL writes make a simple return to the old Mongo
snapshot unsafe.

No firewall, project-pause, credential-change or cutover command has been
executed from this note. On 14 September the operator confirmed that the live
Mongo user is dedicated to Magickly and approved stopping writes at the
appropriate final backup/import time. Ownership is now resolved; the exact
narrow, reversible method still needs preparation and verification before use.
This is not yet a tested operational recipe. Evidence is in
`/tmp/magickli-current-production-metadata.json` and the mode-0600
`/tmp/magickli-legacy-writer-identity.json`; neither contains connection secrets.

The later read-only preparation identified the production Atlas hostname as
`cluster0.ko9xx.mongodb.net`, database `magickli`. No authenticated Atlas
administrator or all-user operation-monitoring credential is available locally;
the operator identified the Atlas project as `magickli` on 14 September and
confirmed database-user Edit access for `magickli@admin` (username `magickli`).
Cluster0 uses Atlas Free, so the operation-drain recipe must account for that
tier's command restrictions. The intended role-only
change replaces the existing role with `read` on `magickli`, preserving all other
user settings. It has not been applied.

The old file route writes its object before inserting Mongo metadata, so the
Mongo role change alone cannot freeze its object inventory. Vercel's project
firewall can match HTTP methods and deny requests. A proposal under
`/tmp/magickli-firewall-readiness/proposal.json` temporarily blocks non-read
methods across this project's hostnames and environments, while the separate
Mongo fence covers writes triggered by GET requests. This also interrupts
Preview mutations, so deployed acceptance must finish first.
[Vercel rule configuration](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration).

Read-only inspection found the project firewall disabled, no custom rules or
draft changes, and no enabled managed rulesets. The proposal remains local;
enabling/publishing it still requires a fresh pre-state comparison and review.
The complete preparation, including active-operation and external-work drains,
is `/tmp/magickli-writer-pause-readiness.md`. Neither proposal changes the rule
that SQL writes prevent simply restoring the old Mongo writer as a rollback.

A fresh read of the live legacy deployment reports
`config.functionTimeout: 300` with Fluid compute. Its exact deployed source has
no `maxDuration` or `functionTimeout` override. The recorded drain interval is
therefore at least five minutes after ingress and administrator activity stop,
alongside the separate Mongo operation checks and Discourse audit. Recheck this
deployment identity and configuration immediately before the pause; the API
response does not include per-function output configuration. Vercel describes
the invocation limit in its
[maximum-duration documentation](https://vercel.com/docs/functions/configuring-functions/duration).

The later Atlas Free review supersedes the draft's mandatory `$currentOp`
aggregation: that stage is unsupported on Free. Do not provision a monitoring
credential merely to satisfy it. The proposed alternative combines the exact
read-only role and denied-write proof with the verified invocation drain,
Discourse audit and R2 reconciliation, then primary/majority checks and a primary
dump while the fences remain. A majority read does not make the dump atomic;
consistency depends on stopping all writes throughout it. The operator still
needs to confirm no external/manual consumer uses the dedicated credential.
[Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/),
[MongoDB dump consistency](https://www.mongodb.com/docs/manual/tutorial/backup-and-restore-tools/).

Do not simply remove the broad ingress fence after promotion: that would reopen
historical `/api/file2` object writes. A narrower persistent upload-route fence
must remain until the old storage credential can be retired. Its exact path
matching and URL normalization checks are still to be prepared and reviewed.
No fence or role change was applied before the operator paused work.
