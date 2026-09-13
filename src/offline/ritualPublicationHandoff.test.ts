import { expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  clearCreationPublicationHandoff,
  createCreationPublicationHandoff,
  creationPublicationHandoffKey,
  parseCreationPublicationHandoff,
  readCreationPublicationHandoff,
  retainCreationPublicationHandoff,
} from "./ritualPublicationHandoff";

const actorId = createUuidV7();
const ritualId = createUuidV7();
const revisionId = createUuidV7();
const operationId = createUuidV7();
const write = {
  version: 2 as const,
  operationId,
  expectedActorId: actorId,
  kind: "create" as const,
  scope: { kind: "public" as const },
  title: "Synthetic ritual",
  source: "p Exact source",
};
const result = {
  ok: true as const,
  replayed: false,
  ritualId,
  revisionId,
  version: 1,
  updatedAt: "2026-09-13T12:00:00.000Z",
};

function memoryStorage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => rows.set(key, value)),
    removeItem: vi.fn((key: string) => rows.delete(key)),
    rows,
  };
}

it("retains the acknowledged create and publication under the resulting ritual", () => {
  const storage = memoryStorage();
  const handoff = createCreationPublicationHandoff(write, result);
  expect(handoff).toMatchObject({
    publication: {
      operationId,
      expectedActorId: actorId,
      ritualId,
      expectedRevisionId: revisionId,
      expectedVersion: 1,
    },
  });
  const serialized = retainCreationPublicationHandoff(storage, handoff!);
  expect(
    storage.rows.get(creationPublicationHandoffKey(actorId, ritualId)),
  ).toBe(serialized);
  expect(readCreationPublicationHandoff(storage, actorId, ritualId)).toEqual({
    value: handoff,
    serialized,
  });
});

it("rejects changed bindings and clears only the exact retained handoff", () => {
  const storage = memoryStorage();
  const handoff = createCreationPublicationHandoff(write, result)!;
  expect(
    parseCreationPublicationHandoff({
      ...handoff,
      publication: { ...handoff.publication, expectedVersion: 2 },
    }),
  ).toBeNull();
  const serialized = retainCreationPublicationHandoff(storage, handoff);
  const key = creationPublicationHandoffKey(actorId, ritualId);
  storage.rows.set(key, `${serialized} `);
  clearCreationPublicationHandoff(storage, handoff, serialized);
  expect(storage.removeItem).not.toHaveBeenCalled();
  storage.rows.set(key, serialized);
  clearCreationPublicationHandoff(storage, handoff, serialized);
  expect(storage.rows.has(key)).toBe(false);
});
