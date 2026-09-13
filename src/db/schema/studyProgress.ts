import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { uuidV7 } from "./ids";
import { legacyIdType } from "./legacyIds";

const instant = (name: string) => timestamp(name, { withTimezone: true });
const count = (name: string) => bigint(name, { mode: "number" }).notNull();
const safe = (name: string, value: AnyPgColumn) =>
  check(name, sql`${value} between 0 and 9007199254740991`);

/** One cumulative baseline per owner/content key; these totals are not derived from card sums. */
export const studyProgress = pgTable(
  "study_progress",
  {
    id: uuidV7("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    setId: text("set_id").notNull(),
    correct: count("correct"),
    incorrect: count("incorrect"),
    time: count("time_milliseconds"),
    dueDate: instant("due_at").notNull(),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
    legacySyncUpdatedAtMilliseconds: bigint(
      "legacy_sync_updated_at_milliseconds",
      { mode: "number" },
    ),
    version: count("version").default(0),
  },
  (table) => [
    unique("study_progress_user_set_unique").on(table.userId, table.setId),
    check(
      "study_progress_id_v7",
      sql`substring(${table.id}::text from 15 for 1) = '7' and substring(${table.id}::text from 20 for 1) in ('8','9','a','b')`,
    ),
    check("study_progress_set_nonempty", sql`length(${table.setId}) > 0`),
    safe("study_progress_correct_safe", table.correct),
    safe("study_progress_incorrect_safe", table.incorrect),
    safe("study_progress_time_safe", table.time),
    safe("study_progress_version_safe", table.version),
  ],
);

/** Content card keys stay exact strings. SQL timestamps hydrate to Date for the scheduler. */
export const studyCardStates = pgTable(
  "study_card_states",
  {
    progressId: uuid("progress_id")
      .notNull()
      .references(() => studyProgress.id),
    cardKey: text("card_key").notNull(),
    correct: count("correct"),
    incorrect: count("incorrect"),
    time: count("time_milliseconds"),
    dueDate: instant("due_at").notNull(),
    interval: doublePrecision("supermemo_interval").notNull(),
    repetition: count("supermemo_repetition"),
    efactor: doublePrecision("supermemo_efactor").notNull(),
    // Preserve absent object vs present empty object vs a numeric weight.
    repetitionPresent: boolean("repetition_present").notNull(),
    repetitionWeight: bigint("repetition_weight", { mode: "number" }),
  },
  (table) => [
    primaryKey({ columns: [table.progressId, table.cardKey] }),
    check("study_card_key_nonempty", sql`length(${table.cardKey}) > 0`),
    safe("study_card_correct_safe", table.correct),
    safe("study_card_incorrect_safe", table.incorrect),
    safe("study_card_time_safe", table.time),
    safe("study_card_repetition_safe", table.repetition),
    safe("study_card_weight_safe", table.repetitionWeight),
    check(
      "study_card_repetition_presence",
      sql`${table.repetitionPresent} or ${table.repetitionWeight} is null`,
    ),
    check(
      "study_card_interval_finite",
      sql`${table.interval} >= 0 and ${table.interval} < 'Infinity'::float8`,
    ),
    check(
      "study_card_efactor_finite",
      sql`${table.efactor} > 0 and ${table.efactor} < 'Infinity'::float8`,
    ),
  ],
);

/** Immutable idempotency proof for one accepted account-scoped review event. */
export const studyReviewReceipts = pgTable(
  "study_review_receipts",
  {
    eventId: uuid("event_id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    requestHash: text("request_hash").notNull(),
    progressId: uuid("progress_id")
      .notNull()
      .references(() => studyProgress.id),
    acceptedVersion: count("accepted_version"),
    acceptedAt: instant("accepted_at").notNull(),
  },
  (table) => [
    check(
      "study_review_receipt_event_v7",
      sql`substring(${table.eventId}::text from 15 for 1) = '7' and substring(${table.eventId}::text from 20 for 1) in ('8','9','a','b')`,
    ),
    check(
      "study_review_receipt_hash_valid",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    safe("study_review_receipt_version_safe", table.acceptedVersion),
    index("study_review_receipt_actor_idx").on(table.actorId),
    index("study_review_receipt_progress_idx").on(table.progressId),
  ],
);

/** Protected original source snapshots, including every archived duplicate card and quirk. */
export const legacyStudySnapshots = pgTable(
  "legacy_study_snapshots",
  {
    sourceSystem: text("source_system").notNull(),
    legacyIdType: legacyIdType("legacy_id_type").notNull(),
    legacyIdValue: text("legacy_id_value").notNull(),
    progressId: uuid("progress_id")
      .notNull()
      .references(() => studyProgress.id),
    disposition: text("disposition")
      .$type<"baseline" | "empty-duplicate">()
      .notNull(),
    sourceEjson: text("source_ejson").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    serializationVersion: text("serialization_version").notNull(),
    importedAt: instant("imported_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceSystem, table.legacyIdType, table.legacyIdValue],
    }),
    check("legacy_study_source_system", sql`${table.sourceSystem} = 'mongodb'`),
    check(
      "legacy_study_source_id",
      sql`length(${table.legacyIdValue}) > 0 and (${table.legacyIdType} <> 'objectid' or ${table.legacyIdValue} ~ '^[0-9a-f]{24}$')`,
    ),
    check(
      "legacy_study_disposition",
      sql`${table.disposition} in ('baseline', 'empty-duplicate')`,
    ),
    check(
      "legacy_study_serialization",
      sql`${table.serializationVersion} = 'bson-canonical-ejson-v1'`,
    ),
    check(
      "legacy_study_source_hash",
      sql`${table.sourceSha256} = encode(sha256(convert_to(${table.sourceEjson}, 'UTF8')), 'hex')`,
    ),
    check(
      "legacy_study_source_json_object",
      sql`json_typeof(${table.sourceEjson}::json) = 'object'`,
    ),
    uniqueIndex("legacy_study_one_baseline")
      .on(table.progressId)
      .where(sql`${table.disposition} = 'baseline'`),
    index("legacy_study_progress_idx").on(table.progressId),
  ],
);
