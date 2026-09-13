# Durable study progress

Study pages now read an account-scoped Dexie projection and send immutable review
events to the SQL study service. Local recording commits the event and displayed
progress together before networking. SQL commits each scheduling update and its
UUIDv7 receipt in one transaction; exact retries return their receipt and current progress without
counting a review twice. Existing imported cumulative totals remain the baseline.

The browser claims one account event at a time across tabs. A GET snapshot may
already contain an event whose reply was lost, so it cannot replace that set's
baseline while an uncertain local event is pending. Once exact receipts settle,
the authoritative snapshot is combined with later queued events. Unknown,
malformed and transient failures remain retryable. Explicit permanent failures
retain their event evidence but do not inflate the authoritative displayed totals.

Anonymous progress has a stable separate device identity and never becomes an
account outbox. An offline restart can reopen only the previously verified local
account. Explicit sign-out hides account views synchronously, aborts network and
identity work, persists the signed-out state and informs other tabs. Account rows
and unsent events remain associated with their original owner. Fresh verified
activation is required to resume after sign-out.

Quiz state survives same-set repository refreshes; storage errors are visible
rather than an indefinite spinner. Views are keyed to their exact account and
set, so account or route changes cannot display the preceding snapshot. The
existing scheduling behavior and repetition/supermemo modes are preserved.

The schema/import boundary was committed separately in migration 0014. This
runtime unit does not apply it to Neon, copy legacy browser rows automatically,
activate the global login switch or deploy. The earlier legacy recovery archive
remains separate from new study storage.

Root review corrected lost-reply baseline double counting, permanent rejection of
unknown outcomes, quiz unmounts after answers, hidden storage failures and delayed
or cross-tab identity changes after sign-out. Fifty-three focused tests cover SQL
receipts, fake IndexedDB, actual hooks/quiz continuity and route boundaries.
Evidence: `/tmp/magickli-study-runtime-{tests,types,biome,build}.log`.

The frozen isolated runtime passes all 53 focused tests, TypeScript, targeted
Biome, ordinary Loom check and a production build. No live SQL or provider
requests were made.
