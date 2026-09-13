import { createHash } from "node:crypto";
import { isUuidV7 } from "../lib/ids";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";
import type { PreparedLegacyImportV1 } from "./prepareLegacyImport";

const PROFILE = "magickli-legacy-import-checkpoint-v1";
const BINDING_FIELDS = [
  "runId",
  "sourceManifestSha256",
  "sourceDescriptorSha256",
  "schemaSha256",
  "targetSha256",
] as const;
const PLAN_FIELDS = [
  "profile",
  "importedAt",
  "config",
  "auth",
  "access",
  "memberships",
  "rituals",
  "study",
  "files",
  "discourse",
  "aliases",
  "sourceDispositions",
] as const;

/**
 * Captured by the maintenance launcher, not accepted from a browser. Target
 * evidence must describe the actual selected connection; a hash alone does not
 * establish database identity. Schema identity binds the reviewed import artifact.
 */
export interface LegacyImportBinding {
  runId: string;
  sourceManifestSha256: string;
  sourceDescriptorSha256: string;
  schemaSha256: string;
  targetSha256: string;
}

/** Exact protected payload for durable preparation; never a public/log response. */
export interface LegacyImportCheckpoint {
  payload: string;
  payloadSha256: string;
  configurationSha256: string;
}

/** Safe failure category; no input, private row or deserializer diagnostics. */
export class LegacyImportCheckpointError extends Error {
  constructor() {
    super("INVALID_IMPORT_CHECKPOINT");
    this.name = "LegacyImportCheckpointError";
  }
}
function invalid(): never {
  throw new LegacyImportCheckpointError();
}
function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function fields(value: unknown, expected: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== expected.length
  )
    invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
  }
  return value as Record<string, unknown>;
}
function binding(value: unknown): LegacyImportBinding {
  const input = fields(value, BINDING_FIELDS);
  if (!isUuidV7(input.runId) || input.runId !== input.runId.toLowerCase())
    invalid();
  for (const key of BINDING_FIELDS.slice(1)) if (!digest(input[key])) invalid();
  // Normalize only property order; values are never rewritten.
  return Object.fromEntries(
    BINDING_FIELDS.map((key) => [key, input[key]]),
  ) as unknown as LegacyImportBinding;
}
function plan(value: unknown): PreparedLegacyImportV1 {
  const input = fields(value, PLAN_FIELDS);
  if (
    input.profile !== "magickli-prepared-legacy-import-v1" ||
    !(input.importedAt instanceof Date) ||
    !Number.isFinite(input.importedAt.getTime()) ||
    !input.config ||
    typeof input.config !== "object" ||
    (input.config as { profile?: unknown }).profile !==
      "magickli-legacy-import-config-v1"
  )
    invalid();
  return value as PreparedLegacyImportV1;
}

/**
 * Snapshot a reviewed builder result and bind the exact configuration, source,
 * schema and destination. All row IDs/Dates already belong to the prepared plan.
 * This envelope adds integrity, not row validation or import authorization.
 */
export function createLegacyImportCheckpoint(
  prepared: PreparedLegacyImportV1,
  expected: LegacyImportBinding,
): LegacyImportCheckpoint {
  try {
    const copiedBinding = binding(expected);
    // Copy before inspecting the profile/configuration; the codec rejects
    // getters and unsupported values anywhere inside the protected plan.
    const copiedPlan = plan(
      parseLegacyImportValue(serializeLegacyImportValue(prepared)),
    );
    const payload = serializeLegacyImportValue({
      profile: PROFILE,
      binding: copiedBinding,
      prepared: copiedPlan,
    });
    return {
      payload,
      payloadSha256: hash(payload),
      configurationSha256: hash(serializeLegacyImportValue(copiedPlan.config)),
    };
  } catch {
    return invalid();
  }
}

/**
 * Resume only the exact saved plan, never reallocate or rerun transformations.
 * Expected hashes and binding come from the separately checked durable header
 * and trusted launcher. The SQL importer still owns row/target reconciliation.
 */
export function readLegacyImportCheckpoint(
  checkpoint: LegacyImportCheckpoint,
  expected: LegacyImportBinding,
): PreparedLegacyImportV1 {
  try {
    const input = fields(checkpoint, [
      "payload",
      "payloadSha256",
      "configurationSha256",
    ]);
    const wanted = binding(expected);
    if (
      typeof input.payload !== "string" ||
      !digest(input.payloadSha256) ||
      !digest(input.configurationSha256) ||
      hash(input.payload) !== input.payloadSha256
    )
      invalid();
    const envelope = fields(parseLegacyImportValue(input.payload), [
      "profile",
      "binding",
      "prepared",
    ]);
    if (envelope.profile !== PROFILE) invalid();
    const actual = binding(envelope.binding);
    if (BINDING_FIELDS.some((key) => actual[key] !== wanted[key])) invalid();
    const prepared = plan(envelope.prepared);
    if (
      hash(serializeLegacyImportValue(prepared.config)) !==
      input.configurationSha256
    )
      invalid();
    return prepared;
  } catch {
    return invalid();
  }
}
