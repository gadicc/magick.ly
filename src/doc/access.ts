/** Storage-independent policy; IDs have already been normalized at the boundary. */
export type RitualScope =
  | { kind: "public" }
  | { kind: "group"; groupId: string }
  | { kind: "temple"; templeId: string; minGrade: number };

/** Only persisted policy fields, never values claimed by a save request. */
export interface RitualPolicy {
  id: string;
  creatorId: string | null;
  scope: RitualScope;
}

/** Trusted server-side identity and current memberships (not client claims). */
export interface RitualPrincipal {
  userId: string;
  globalAdmin: boolean;
  groupIds: readonly string[];
  groupAdminIds: readonly string[];
  templeMemberships: readonly {
    templeId: string;
    grade: number | null;
    admin: boolean;
  }[];
}

/** Source and history are editing material; ordinary readers receive compiled content. */
export interface RitualAccess {
  read: boolean;
  edit: boolean;
  readSourceHistory: boolean;
}

export type RitualDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "not-an-editor"
        | "not-a-scope-admin"
        | "not-global-admin"
        | "creator-mismatch"
        | "invalid-policy"
        | "policy-change-requires-separate-command"
        | "revision-parent-mismatch"
        | "revision-author-mismatch"
        | "revision-identity-changed";
    };

/** Immutable identity fields of a revision, excluding its editable source text. */
export interface RitualRevisionIdentity {
  id: string;
  ritualId: string;
  authorId: string;
  createdAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value
  );
}

function isGrade(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validates new scopes strictly: one scope, with no irrelevant policy fields. */
export function parseRitualScope(value: unknown): RitualScope | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (value.kind === "public" && keys.length === 1) return { kind: "public" };
  if (value.kind === "group" && keys.length === 2 && isId(value.groupId)) {
    return { kind: "group", groupId: value.groupId };
  }
  if (
    value.kind === "temple" &&
    keys.length === 3 &&
    isId(value.templeId) &&
    isGrade(value.minGrade)
  ) {
    return {
      kind: "temple",
      templeId: value.templeId,
      minGrade: value.minGrade,
    };
  }
  return null;
}

function validPolicy(policy: RitualPolicy | null): policy is RitualPolicy {
  return (
    !!policy &&
    isId(policy.id) &&
    (policy.creatorId === null || isId(policy.creatorId)) &&
    parseRitualScope(policy.scope) !== null
  );
}

/** Invalid legacy policies fail closed even for creators/admins; repair is separate. */
export function getRitualAccess(
  policy: RitualPolicy | null,
  principal: RitualPrincipal | null,
): RitualAccess {
  const denied = { read: false, edit: false, readSourceHistory: false };
  if (!validPolicy(policy)) return denied;
  const scope = policy.scope;
  const authenticated = !!principal && isId(principal.userId);
  const templeMemberships =
    authenticated && scope.kind === "temple"
      ? principal.templeMemberships.filter(
          (item) => item.templeId === scope.templeId,
        )
      : [];
  const edit =
    authenticated &&
    (principal.globalAdmin === true ||
      (policy.creatorId !== null && principal.userId === policy.creatorId) ||
      (scope.kind === "group" &&
        principal.groupAdminIds.includes(scope.groupId)) ||
      (scope.kind === "temple" &&
        templeMemberships.some((item) => item.admin === true)));
  const read =
    edit ||
    scope.kind === "public" ||
    (authenticated &&
      ((scope.kind === "group" && principal.groupIds.includes(scope.groupId)) ||
        (scope.kind === "temple" &&
          templeMemberships.some(
            (item) => isGrade(item.grade) && item.grade >= scope.minGrade,
          ))));
  return { read, edit, readSourceHistory: edit };
}

function sameScope(a: RitualScope, b: RitualScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "public" && b.kind === "public") return true;
  if (a.kind === "group" && b.kind === "group") return a.groupId === b.groupId;
  return (
    a.kind === "temple" &&
    b.kind === "temple" &&
    a.templeId === b.templeId &&
    a.minGrade === b.minGrade
  );
}

/**
 * Content/title saves cannot change creator or visibility, even for global admins.
 * This deliberately does not define authority to create/publish/transfer rituals.
 * Compare full proposed policy after applying an allowlisted patch to persisted data.
 */
export function authorizeRitualContentUpdate(
  current: RitualPolicy | null,
  proposed: RitualPolicy | null,
  principal: RitualPrincipal | null,
): RitualDecision {
  if (!getRitualAccess(current, principal).edit)
    return { allowed: false, reason: "not-an-editor" };
  if (!validPolicy(current) || !validPolicy(proposed))
    return { allowed: false, reason: "invalid-policy" };
  if (
    current.id !== proposed.id ||
    current.creatorId !== proposed.creatorId ||
    !sameScope(current.scope, proposed.scope)
  ) {
    return {
      allowed: false,
      reason: "policy-change-requires-separate-command",
    };
  }
  // The proposed policy is identical, so the existing editor grant still applies.
  return { allowed: true };
}

/** New revision IDs/timestamps/authors are server-generated in the save command. */
export function authorizeRevisionInsert(
  parent: RitualPolicy | null,
  revision: RitualRevisionIdentity,
  principal: RitualPrincipal | null,
): RitualDecision {
  if (!getRitualAccess(parent, principal).edit)
    return { allowed: false, reason: "not-an-editor" };
  if (revision.ritualId !== parent?.id)
    return { allowed: false, reason: "revision-parent-mismatch" };
  if (revision.authorId !== principal?.userId)
    return { allowed: false, reason: "revision-author-mismatch" };
  return { allowed: true };
}

/**
 * Coalescing own revisions also requires current parent edit rights. A transaction
 * must separately check the current revision pointer, age window and base version.
 */
export function authorizeRevisionUpdate(
  parent: RitualPolicy | null,
  current: RitualRevisionIdentity,
  proposed: RitualRevisionIdentity,
  principal: RitualPrincipal | null,
): RitualDecision {
  const before = authorizeRevisionInsert(parent, current, principal);
  if (!before.allowed) return before;
  if (
    current.id !== proposed.id ||
    current.ritualId !== proposed.ritualId ||
    current.authorId !== proposed.authorId ||
    current.createdAt !== proposed.createdAt
  ) {
    return { allowed: false, reason: "revision-identity-changed" };
  }
  return authorizeRevisionInsert(parent, proposed, principal);
}

/**
 * A normal save attaches the caller's revision from this same parent. Restoring a
 * different author's historical text should create a new revision for the caller.
 */
export function authorizeRevisionAttachment(
  parent: RitualPolicy | null,
  revision: RitualRevisionIdentity,
  principal: RitualPrincipal | null,
): RitualDecision {
  return authorizeRevisionInsert(parent, revision, principal);
}

/** New rituals belong to the caller; only admins may create in their own scope. */
export function authorizeRitualCreation(
  proposed: RitualPolicy | null,
  principal: RitualPrincipal | null,
): RitualDecision {
  if (!validPolicy(proposed))
    return { allowed: false, reason: "invalid-policy" };
  if (!principal || !isId(principal.userId))
    return { allowed: false, reason: "not-a-scope-admin" };
  if (proposed.creatorId !== principal.userId)
    return { allowed: false, reason: "creator-mismatch" };
  const scope = proposed.scope;
  if (principal.globalAdmin === true) return { allowed: true };
  if (scope.kind === "group" && principal.groupAdminIds.includes(scope.groupId))
    return { allowed: true };
  if (
    scope.kind === "temple" &&
    principal.templeMemberships.some(
      (membership) =>
        membership.templeId === scope.templeId && membership.admin === true,
    )
  )
    return { allowed: true };
  return { allowed: false, reason: "not-a-scope-admin" };
}

/**
 * Explicit publication command: only global admins may move a valid ritual to
 * public scope, without changing its ID or creator. Other transfers stay separate.
 */
export function authorizeRitualPublication(
  current: RitualPolicy | null,
  proposed: RitualPolicy | null,
  principal: RitualPrincipal | null,
): RitualDecision {
  if (!principal || !isId(principal.userId) || principal.globalAdmin !== true)
    return { allowed: false, reason: "not-global-admin" };
  if (
    !validPolicy(current) ||
    !validPolicy(proposed) ||
    proposed.scope.kind !== "public"
  )
    return { allowed: false, reason: "invalid-policy" };
  if (current.id !== proposed.id || current.creatorId !== proposed.creatorId)
    return {
      allowed: false,
      reason: "policy-change-requires-separate-command",
    };
  return { allowed: true };
}
