import { ObjectId } from "bson";
import type { LegacyAliasKey } from "../db/legacyIds";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  classifyLegacyAuthSource,
  type LegacyAuthSourceDispositions,
} from "./classifyLegacyAuthSource";
import {
  type NormalizedLegacyAuth,
  normalizeLegacyAuth,
} from "./normalizeLegacyAuth";
import {
  type BetterAuthImportPlan,
  legacyProviderAlias,
  planBetterAuthImport,
  planLegacyUserAccess,
} from "./planBetterAuthImport";
import {
  type LegacyDiscourseImportPlan,
  planLegacyDiscourseImport,
} from "./planLegacyDiscourseImport";
import {
  type LegacyFileImportOptions,
  type LegacyFileImportPlan,
  planLegacyFileImport,
} from "./planLegacyFileImport";
import {
  type LegacyMembershipImportPlan,
  planLegacyMembershipImport,
} from "./planLegacyMembershipImport";
import {
  type LegacyRitualImportPlan,
  planLegacyRitualImport,
} from "./planLegacyRitualImport";
import {
  type EmptyStudyDuplicate,
  type LegacyStudyImportPlan,
  planLegacyStudyImport,
} from "./planLegacyStudyImport";

export const LEGACY_IMPORT_COLLECTIONS = [
  "users",
  "accounts",
  "sessions",
  "docs",
  "docRevisions",
  "studySet",
  "files",
  "temples",
  "templeMemberships",
  "userGroups",
] as const;
export type LegacyImportCollectionName =
  (typeof LEGACY_IMPORT_COLLECTIONS)[number];
/** Transient decoded BSON only. This object must never be spread into a checkpoint. */
export type LegacyImportCollections = {
  [K in LegacyImportCollectionName]: readonly unknown[];
} & { ritualWriteReceipts?: readonly unknown[] };
/** Reviewed source meaning, copied into the plan and bound by the outer checkpoint envelope. */
export interface LegacyImportConfigV1 {
  profile: "magickli-legacy-import-config-v1";
  files: Pick<
    LegacyFileImportOptions,
    "storageProvider" | "sourceBucket" | "sourceObjectKeyPrefix"
  >;
  sourceForumOrigin: string;
  emptyStudyDuplicates: readonly EmptyStudyDuplicate[];
  unresolvedCreators: NonNullable<
    Parameters<typeof planLegacyRitualImport>[1]["unresolvedCreators"]
  >;
  receiptPolicy:
    | "require-empty-collection"
    | "allow-reviewed-pre-bridge-absence";
}
/**
 * The protected plan itself is the allocation manifest. After durable preparation,
 * retries apply these exact rows; they never recompose from source or allocate IDs.
 */
export interface PreparedLegacyImportV1 {
  profile: "magickli-prepared-legacy-import-v1";
  importedAt: Date;
  config: LegacyImportConfigV1;
  auth: Omit<BetterAuthImportPlan, "aliases" | "emails"> & {
    emails: (BetterAuthImportPlan["emails"][number] & { id: string })[];
  };
  access: ReturnType<typeof planLegacyUserAccess>;
  memberships: Omit<LegacyMembershipImportPlan, "aliases">;
  rituals: Omit<LegacyRitualImportPlan, "aliases">;
  study: Omit<LegacyStudyImportPlan, "aliases">;
  files: Omit<LegacyFileImportPlan, "aliases">;
  discourse: LegacyDiscourseImportPlan;
  aliases: {
    id: string;
    source: LegacyAliasKey;
    canonicalId: string;
    createdAt: Date;
  }[];
  sourceDispositions: {
    collections: Record<LegacyImportCollectionName, number>;
    auth: LegacyAuthSourceDispositions;
    excludedAccounts: NormalizedLegacyAuth["excluded"];
    /** Exact unused historical profile fields; not login or grant attributes. */
    legacyUserFields: {
      source: LegacyAliasKey;
      fields: { path: string; value: string | null }[];
    }[];
    ritualWriteReceipts: "absent-reviewed" | "present-empty";
  };
}

/** A preparation failure reports only a category and fixed source position. */
export class LegacyImportPreparationError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = "LegacyImportPreparationError";
  }
}

type Row = Record<string, unknown>;
type Alias = { source: LegacyAliasKey; canonicalId: string };
function fail(code: string, path: string): never {
  throw new LegacyImportPreparationError(code, path);
}
function row(
  value: unknown,
  fields: readonly string[] | null,
  path: string,
): Row {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail("invalid-object", path);
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.entries(Object.getOwnPropertyDescriptors(value)).some(
      ([key, descriptor]) =>
        (fields !== null && !fields.includes(key)) ||
        !descriptor.enumerable ||
        !("value" in descriptor),
    )
  )
    fail("unclassified-properties", path);
  return value as Row;
}
function array(value: unknown, path: string): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getOwnPropertySymbols(value).length ||
    Object.getOwnPropertyNames(value).length !== value.length + 1
  )
    fail("invalid-array", path);
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !entry.enumerable || !("value" in entry))
      fail("invalid-array", path);
  }
  return value;
}
function text(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\0")
  )
    fail("invalid-text", path);
  return value;
}
const key = (source: LegacyAliasKey) =>
  JSON.stringify([
    source.sourceSystem,
    source.entityType,
    source.legacyIdType,
    source.legacyIdValue,
  ]);
function configAlias(
  value: unknown,
  entity: string,
  path: string,
): LegacyAliasKey {
  const source = row(
    value,
    ["sourceSystem", "entityType", "legacyIdType", "legacyIdValue"],
    path,
  );
  const id = text(source.legacyIdValue, path);
  if (
    source.sourceSystem !== "mongodb" ||
    source.entityType !== entity ||
    !id.trim() ||
    (source.legacyIdType !== "string" && source.legacyIdType !== "objectid") ||
    (source.legacyIdType === "objectid" && !/^[0-9a-f]{24}$/.test(id))
  )
    fail("invalid-config-alias", path);
  return {
    sourceSystem: "mongodb",
    entityType: entity,
    legacyIdType: source.legacyIdType,
    legacyIdValue: id,
  };
}
function copyConfig(value: LegacyImportConfigV1): LegacyImportConfigV1 {
  row(
    value,
    [
      "profile",
      "files",
      "sourceForumOrigin",
      "emptyStudyDuplicates",
      "unresolvedCreators",
      "receiptPolicy",
    ],
    "config",
  );
  if (
    value.profile !== "magickli-legacy-import-config-v1" ||
    (value.receiptPolicy !== "require-empty-collection" &&
      value.receiptPolicy !== "allow-reviewed-pre-bridge-absence")
  )
    fail("unsupported-config-profile", "config");
  const files = row(
    value.files,
    ["storageProvider", "sourceBucket", "sourceObjectKeyPrefix"],
    "config.files",
  );
  return {
    profile: "magickli-legacy-import-config-v1",
    files: {
      storageProvider: text(
        files.storageProvider,
        "config.files.storageProvider",
      ),
      sourceBucket: text(files.sourceBucket, "config.files.sourceBucket"),
      sourceObjectKeyPrefix: text(
        files.sourceObjectKeyPrefix,
        "config.files.sourceObjectKeyPrefix",
      ),
    },
    sourceForumOrigin: text(
      value.sourceForumOrigin,
      "config.sourceForumOrigin",
    ),
    receiptPolicy: value.receiptPolicy,
    emptyStudyDuplicates: array(
      value.emptyStudyDuplicates,
      "config.emptyStudyDuplicates",
    ).map((item, index) => {
      const at = `config.emptyStudyDuplicates[${index}]`;
      const entry = row(item, ["keep", "archive", "expectedArchiveSha256"], at);
      const digest = text(entry.expectedArchiveSha256, at);
      if (!/^[0-9a-f]{64}$/.test(digest))
        fail("invalid-approved-fingerprint", at);
      return {
        keep: configAlias(entry.keep, "studySet", `${at}.keep`),
        archive: configAlias(entry.archive, "studySet", `${at}.archive`),
        expectedArchiveSha256: digest,
      };
    }),
    unresolvedCreators: array(
      value.unresolvedCreators,
      "config.unresolvedCreators",
    ).map((item, index) => {
      const at = `config.unresolvedCreators[${index}]`;
      const entry = row(item, ["ritual", "creator"], at);
      return {
        ritual: configAlias(entry.ritual, "docs", `${at}.ritual`),
        creator: configAlias(entry.creator, "users", `${at}.creator`),
      };
    }),
  };
}
function sourceOf(
  entity: string,
  value: unknown,
  path: string,
): LegacyAliasKey {
  if (typeof value === "string" && value.trim())
    return {
      sourceSystem: "mongodb",
      entityType: entity,
      legacyIdType: "string",
      legacyIdValue: text(value, path),
    };
  if (!(value instanceof ObjectId)) fail("invalid-source-id", path);
  return {
    sourceSystem: "mongodb",
    entityType: entity,
    legacyIdType: "objectid",
    legacyIdValue: value.toHexString(),
  };
}
function withoutAliases<T extends { aliases: Alias[] }>(
  value: T,
): Omit<T, "aliases"> {
  const { aliases: _aliases, ...rest } = value;
  return rest;
}

/** Copy only application projections before the injected allocator can run. */
function snapshotApplication(value: unknown): unknown {
  let nodes = 0;
  const ancestors = new Set<object>();
  function copy(item: unknown, depth: number): unknown {
    if (++nodes > 1_000_000 || depth > 256) fail("source-limit", "application");
    if (item === null || typeof item !== "object") {
      if (["function", "symbol", "bigint"].includes(typeof item))
        fail("unsupported-source-value", "application");
      return item;
    }
    if (ancestors.has(item)) fail("cyclic-source", "application");
    if (Object.getPrototypeOf(item) === Date.prototype)
      return new Date(Date.prototype.getTime.call(item));
    if (Object.getPrototypeOf(item) === ObjectId.prototype)
      return new ObjectId(ObjectId.prototype.toHexString.call(item));
    ancestors.add(item);
    let result: unknown;
    if (Array.isArray(item))
      result = array(item, "application").map((entry) =>
        copy(entry, depth + 1),
      );
    else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== null && prototype !== Object.prototype)
        fail("unsupported-source-value", "application");
      const target = Object.create(prototype) as Row;
      if (Object.getOwnPropertySymbols(item).length)
        fail("unclassified-properties", "application");
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(item),
      )) {
        if (!descriptor.enumerable || !("value" in descriptor))
          fail("unclassified-properties", "application");
        Object.defineProperty(target, key, {
          value: copy(descriptor.value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      result = target;
    }
    ancestors.delete(item);
    return result;
  }
  return copy(value, 0);
}

/**
 * Compose only reviewed domain output. UUID generation is the sole injected
 * allocation effect; timestamps use importedAt, with no database/env/provider I/O.
 */
export function prepareLegacyImport(
  input: LegacyImportCollections,
  options: {
    importedAt: Date;
    config: LegacyImportConfigV1;
    generateId?: () => string;
  },
): PreparedLegacyImportV1 {
  row(input, [...LEGACY_IMPORT_COLLECTIONS, "ritualWriteReceipts"], "input");
  row(options, ["importedAt", "config", "generateId"], "options");
  if (
    !(options.importedAt instanceof Date) ||
    !Number.isFinite(options.importedAt.getTime())
  )
    fail("invalid-import-time", "options.importedAt");
  const importedAt = new Date(options.importedAt);
  const config = copyConfig(options.config);
  const collections = {} as Record<LegacyImportCollectionName, number>;
  for (const name of LEGACY_IMPORT_COLLECTIONS)
    collections[name] = array(input[name], `input.${name}`).length;
  let receiptDisposition: "absent-reviewed" | "present-empty";
  if (!Object.hasOwn(input, "ritualWriteReceipts")) {
    if (config.receiptPolicy !== "allow-reviewed-pre-bridge-absence")
      fail("missing-receipt-collection", "ritualWriteReceipts");
    receiptDisposition = "absent-reviewed";
  } else {
    if (array(input.ritualWriteReceipts, "ritualWriteReceipts").length)
      fail("legacy-receipt-recovery-required", "ritualWriteReceipts");
    receiptDisposition = "present-empty";
  }
  const authInput = {
    users: input.users,
    accounts: input.accounts,
    sessions: input.sessions,
  };
  const authDisposition = classifyLegacyAuthSource(authInput);
  const normalized = normalizeLegacyAuth(authInput);
  const legacyUserFields: PreparedLegacyImportV1["sourceDispositions"]["legacyUserFields"] =
    [];
  for (const [index, original] of input.users.entries()) {
    const user = original as Row;
    const fields: { path: string; value: string | null }[] = [];
    for (const field of ["locale", "gender"] as const)
      if (Object.hasOwn(user, field))
        fields.push({ path: field, value: user[field] as string | null });
    function photoProviders(photos: Row[] | undefined, path: string) {
      for (const [index, photo] of (photos ?? []).entries())
        if (Object.hasOwn(photo, "provider"))
          fields.push({
            path: `${path}[${index}].provider`,
            value: photo.provider as string | null,
          });
    }
    photoProviders(user.photos as Row[] | undefined, "photos");
    for (const [index, service] of (
      (user.services as Row[] | undefined) ?? []
    ).entries())
      photoProviders(
        (service.profile as Row | undefined)?.photos as Row[] | undefined,
        `services[${index}].profile.photos`,
      );
    if (fields.length)
      legacyUserFields.push({
        source: { ...normalized.users[index].source },
        fields,
      });
  }
  // Auth normalization has already projected identity into value-only DTOs.
  // Copy the separately classified application fields without retaining old
  // OAuth/session material or exposing raw input to an allocator callback.
  const users = input.users.map((item, index) => {
    const original = item as Row;
    const projection: Row = {};
    for (const field of ["admin", "groupIds", "groupAdminIds", "discourseId"])
      if (Object.hasOwn(original, field)) projection[field] = original[field];
    return {
      row: snapshotApplication(projection) as Row,
      source: normalized.users[index].source,
    };
  });
  const domain = snapshotApplication({
    userGroups: input.userGroups,
    temples: input.temples,
    templeMemberships: input.templeMemberships,
    docs: input.docs,
    docRevisions: input.docRevisions,
    studySet: input.studySet,
    files: input.files,
  }) as Pick<
    LegacyImportCollections,
    | "userGroups"
    | "temples"
    | "templeMemberships"
    | "docs"
    | "docRevisions"
    | "studySet"
    | "files"
  >;
  const allocator = options.generateId ?? createUuidV7;
  if (typeof allocator !== "function")
    fail("invalid-allocator", "options.generateId");
  const generated = new Set<string>();
  function generate() {
    let value: unknown;
    try {
      value = allocator();
    } catch {
      fail("allocator-failed", "allocation");
    }
    if (!isUuidV7(value)) fail("invalid-generated-id", "allocation");
    const id = value.toLowerCase();
    if (generated.has(id)) fail("generated-id-collision", "allocation");
    generated.add(id);
    return id;
  }
  const ids = new Map<string, string>();
  const aliases = new Map<string, Alias>();
  function allocate(source: LegacyAliasKey) {
    const name = key(source);
    if (!ids.has(name)) ids.set(name, generate());
  }
  const lookup = (source: LegacyAliasKey) => ids.get(key(source)) ?? null;
  function merge(values: Alias[]) {
    for (const value of values) {
      const name = key(value.source),
        previous = ids.get(name);
      if (
        !generated.has(value.canonicalId) ||
        (previous !== undefined && previous !== value.canonicalId)
      )
        fail("alias-conflict", "aliases");
      ids.set(name, value.canonicalId);
      aliases.set(name, {
        source: { ...value.source },
        canonicalId: value.canonicalId,
      });
    }
  }
  for (const item of normalized.users) allocate(item.source);
  for (const item of normalized.accounts) allocate(legacyProviderAlias(item));
  const auth = planBetterAuthImport(normalized, { importedAt, lookup });
  merge(auth.aliases);
  const access = planLegacyUserAccess(
    users.map(({ row: user, source }) => ({
      source,
      ...(Object.hasOwn(user, "admin") ? { admin: user.admin as boolean } : {}),
    })),
    auth,
    lookup,
  );
  const archived = new Set(
    config.emptyStudyDuplicates.map((entry) => key(entry.archive)),
  );
  for (const name of [
    "userGroups",
    "temples",
    "templeMemberships",
    "docs",
    "docRevisions",
    "studySet",
    "files",
  ] as const) {
    for (const [index, item] of domain[name].entries()) {
      const path = `${name}[${index}]`;
      const source = sourceOf(name, row(item, null, path)._id, `${path}._id`);
      if (name !== "studySet" || !archived.has(key(source))) allocate(source);
    }
  }
  const canonicalUserIds = auth.users.map((user) => user.id);
  const memberships = planLegacyMembershipImport(
    {
      users: users.map(({ row: user, source }) => ({
        source,
        ...(Object.hasOwn(user, "groupIds") ? { groupIds: user.groupIds } : {}),
        ...(Object.hasOwn(user, "groupAdminIds")
          ? { groupAdminIds: user.groupAdminIds }
          : {}),
      })),
      groups: domain.userGroups,
      temples: domain.temples,
      memberships: domain.templeMemberships,
    },
    { lookup, canonicalUserIds, importedAt },
  );
  merge(memberships.aliases);
  const rituals = planLegacyRitualImport(
    { rituals: domain.docs, revisions: domain.docRevisions },
    {
      lookup,
      canonicalUserIds,
      canonicalGroupIds: memberships.groups.map((group) => group.id),
      canonicalTempleIds: memberships.temples.map((temple) => temple.id),
      importedAt,
      unresolvedCreators: config.unresolvedCreators,
    },
  );
  merge(rituals.aliases);
  const study = planLegacyStudyImport(domain.studySet, {
    lookup,
    canonicalUserIds,
    emptyDuplicates: config.emptyStudyDuplicates,
    importedAt,
  });
  merge(study.aliases);
  const files = planLegacyFileImport(domain.files, {
    lookup,
    ...config.files,
    importedAt,
  });
  merge(files.aliases);
  const discourse = planLegacyDiscourseImport(
    users.map(({ row: user, source }) => ({
      source,
      ...(Object.hasOwn(user, "discourseId")
        ? { discourseId: user.discourseId }
        : {}),
    })),
    {
      lookup,
      canonicalUserIds,
      sourceForumOrigin: config.sourceForumOrigin,
      importedAt,
    },
  );
  if (aliases.size !== ids.size) fail("unused-canonical-allocation", "aliases");
  return {
    profile: "magickli-prepared-legacy-import-v1",
    importedAt,
    config,
    auth: {
      ...withoutAliases(auth),
      emails: auth.emails.map((email) => ({ ...email, id: generate() })),
    },
    access,
    memberships: withoutAliases(memberships),
    rituals: withoutAliases(rituals),
    study: withoutAliases(study),
    files: withoutAliases(files),
    discourse,
    aliases: [...aliases.values()].map((alias) => ({
      ...alias,
      id: generate(),
      createdAt: new Date(importedAt),
    })),
    sourceDispositions: {
      collections,
      auth: authDisposition,
      excludedAccounts: normalized.excluded.map((entry) => ({
        source: { ...entry.source },
        reason: entry.reason,
      })),
      legacyUserFields,
      ritualWriteReceipts: receiptDisposition,
    },
  };
}
