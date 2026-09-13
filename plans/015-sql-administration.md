# SQL administration and Discourse integration

Global user/group administration and temple management now use request-time
server components and SQL services. The old Gongo subscriptions and browser
copies are no longer used by these pages. The coordinated global sign-in switch
is still pending; this commit is local integration, not a deployment.

Global admins can create groups and independently add/remove group membership
and administrator grants. Each action checks the current session and SQL global
grant, with the submitted actor ID used only to detect an account change.
Mutations serialize each group's edges and validate every selected target before
changing any of them. User projections omit session, credential and provenance
fields. Group creation retains its request UUID across a repeated submission.

Temple pages preserve scoped and global administration, grades, mottos, membership
dates and private join codes. Joining is an explicit confirmation POST; opening
an invitation does not create membership. A signed-in user can create a new
temple and its first admin atomically through the previously reviewed creator.
The UI explains that creating a temple starts a separate organization, rather
than joining an existing one. Membership edits cannot remove the last temple
admin. Global admins may promote their own existing membership. Writes lock the
temple before checking membership grants, avoiding crossed-admin lock ordering.

Discourse synchronization remains a global-admin action. Existing origin-scoped
forum links are authoritative. Missing linked users are reported without
rematching by email. Unlinked users are reconciled using verified current and
historical emails; ambiguity is skipped. A new link cannot overwrite another
link or claim an external ID owned by another local user. Uncertain account
creation is reported and requires reconciliation on retry. No SQL transaction
spans provider I/O, and current global access is rechecked between calls.

Group and membership pagination is complete and bounded, including members beyond
the initial 50. Pagination changes, duplicate rows and revoked authorization stop
the sync safely. Progress messages contain neither email addresses nor provider
diagnostics. Tests stub the external transport; no forum calls or messages were
sent during implementation or verification.

Root adversarial review corrected crossed membership lock ordering, unnecessary
global-admin self-promotion refusal and incomplete Discourse pagination. Seventy-
one focused SQL/PGlite tests pass, including a member on the second forum page
and authorization changes between pages. Isolated typechecking, production
build and targeted Biome pass. The obsolete Gongo membership form test is replaced
by SQL validation tests for the new server boundary. Evidence:
`/tmp/magickli-sql-admin-{tests,types,biome,build}.log`.
