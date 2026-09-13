import {
  parseSqlRitualCreateRequest,
  parseSqlRitualWriteResult,
  type SqlRitualCreateRequest,
} from "../doc/sqlEditorContract";
import type { SqlRitualWriteResult } from "../doc/sqlWriteContract";
import { isUuidV7 } from "../lib/ids";
import {
  parseRitualPublicationRequest,
  type RitualPublicationRequestV1,
} from "./ritualPublicationContract";

export interface CreationPublicationHandoffV1 {
  version: 1;
  write: SqlRitualCreateRequest;
  result: Extract<SqlRitualWriteResult, { ok: true }>;
  publication: RitualPublicationRequestV1;
}

const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
export const creationPublicationHandoffKey = (
  ownerId: string,
  ritualId: string,
) => {
  if (!id(ownerId) || !id(ritualId))
    throw new TypeError("Invalid publication handoff identity");
  return `magickli:ritual-publication:v1:${ownerId}:${ritualId}`;
};

export function createCreationPublicationHandoff(
  writeValue: unknown,
  resultValue: unknown,
): CreationPublicationHandoffV1 | null {
  const write = parseSqlRitualCreateRequest(writeValue);
  if (!write) return null;
  const result = parseSqlRitualWriteResult(write, resultValue);
  if (!result?.ok) return null;
  return {
    version: 1,
    write,
    result,
    publication: {
      version: 1,
      operationId: write.operationId,
      expectedActorId: write.expectedActorId,
      ritualId: result.ritualId,
      expectedRevisionId: result.revisionId,
      expectedVersion: result.version,
    },
  };
}

export function parseCreationPublicationHandoff(
  value: unknown,
): CreationPublicationHandoffV1 | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 4
  )
    return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1) return null;
  const handoff = createCreationPublicationHandoff(row.write, row.result);
  const publication = parseRitualPublicationRequest(row.publication);
  return handoff &&
    publication &&
    JSON.stringify(publication) === JSON.stringify(handoff.publication)
    ? handoff
    : null;
}

export function retainCreationPublicationHandoff(
  storage: Pick<Storage, "setItem">,
  value: CreationPublicationHandoffV1,
): string {
  const parsed = parseCreationPublicationHandoff(value);
  if (!parsed) throw new TypeError("Invalid publication handoff");
  const serialized = JSON.stringify(parsed);
  storage.setItem(
    creationPublicationHandoffKey(
      parsed.write.expectedActorId,
      parsed.result.ritualId,
    ),
    serialized,
  );
  return serialized;
}

export function readCreationPublicationHandoff(
  storage: Pick<Storage, "getItem">,
  ownerId: string,
  ritualId: string,
): { value: CreationPublicationHandoffV1; serialized: string } | null {
  const serialized = storage.getItem(
    creationPublicationHandoffKey(ownerId, ritualId),
  );
  if (!serialized) return null;
  try {
    const value = parseCreationPublicationHandoff(JSON.parse(serialized));
    return value && JSON.stringify(value) === serialized
      ? { value, serialized }
      : null;
  } catch {
    return null;
  }
}

export function clearCreationPublicationHandoff(
  storage: Pick<Storage, "getItem" | "removeItem">,
  value: CreationPublicationHandoffV1,
  serialized: string,
) {
  const key = creationPublicationHandoffKey(
    value.write.expectedActorId,
    value.result.ritualId,
  );
  if (storage.getItem(key) === serialized) storage.removeItem(key);
}
