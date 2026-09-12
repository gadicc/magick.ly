import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { loomFilesTable } from "./loomFiles";
import { rituals } from "./rituals";

const instant = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Durable immutable upload identity and completion receipt. Historical domain IDs
 * deliberately do not reference deletable records. A completed claim is retained
 * as evidence; only an uncompleted claim is an active worker lease. No credentials
 * or direct-upload capabilities belong in this table.
 */
export const ritualUploadIntents = pgTable(
  "ritual_upload_intents",
  {
    operationId: uuid("operation_id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    ritualId: uuid("ritual_id").notNull(),
    requestHash: text("request_hash").notNull(),
    filename: text("filename").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    sha256: text("sha256").notNull(),
    fileId: uuid("file_id").notNull().unique(),
    attachmentId: uuid("attachment_id").notNull().unique(),
    stagingProvider: text("staging_provider").notNull(),
    stagingBucket: text("staging_bucket").notNull(),
    stagingObjectKey: text("staging_object_key").notNull(),
    canonicalProvider: text("canonical_provider").notNull(),
    canonicalBucket: text("canonical_bucket").notNull(),
    canonicalObjectKey: text("canonical_object_key").notNull(),
    createdAt: instant("created_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    claimId: uuid("claim_id"),
    claimStartedAt: instant("claim_started_at"),
    claimExpiresAt: instant("claim_expires_at"),
    completedAt: instant("completed_at"),
  },
  (t) => [
    ...[t.operationId, t.ritualId, t.fileId, t.attachmentId, t.claimId].map(
      (c) =>
        check(
          `ritual_upload_intents_${c.name}_v7`,
          sql`substring(${c}::text from 15 for 1) = '7' and substring(${c}::text from 20 for 1) in ('8','9','a','b')`,
        ),
    ),
    unique("ritual_upload_intents_link_binding").on(
      t.operationId,
      t.ritualId,
      t.fileId,
      t.attachmentId,
      t.actorId,
    ),
    uniqueIndex("ritual_upload_intents_staging_unique").on(
      t.stagingProvider,
      t.stagingBucket,
      t.stagingObjectKey,
    ),
    uniqueIndex("ritual_upload_intents_canonical_unique").on(
      t.canonicalProvider,
      t.canonicalBucket,
      t.canonicalObjectKey,
    ),
    index("ritual_upload_intents_expiry_idx").on(t.expiresAt),
    check(
      "ritual_upload_intents_digest",
      sql`${t.sha256} ~ '^[0-9a-f]{64}$' and ${t.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ritual_upload_intents_declared_file",
      sql`${t.byteSize} between 1 and 20971520 and ${t.contentType} in ('image/png','image/jpeg','image/gif','image/webp') and length(${t.filename}) between 1 and 1024`,
    ),
    check(
      "ritual_upload_intents_locations",
      sql`length(btrim(${t.stagingProvider})) > 0 and length(btrim(${t.stagingBucket})) > 0 and length(${t.stagingObjectKey}) > 0 and length(btrim(${t.canonicalProvider})) > 0 and length(btrim(${t.canonicalBucket})) > 0 and length(${t.canonicalObjectKey}) > 0 and (${t.stagingProvider},${t.stagingBucket},${t.stagingObjectKey}) <> (${t.canonicalProvider},${t.canonicalBucket},${t.canonicalObjectKey})`,
    ),
    check(
      "ritual_upload_intents_expiry",
      sql`${t.createdAt} >= '1970-01-01T00:00:00Z'::timestamptz and ${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '24 hours'`,
    ),
    check(
      "ritual_upload_intents_claim",
      sql`(${t.claimId} is null and ${t.claimStartedAt} is null and ${t.claimExpiresAt} is null) or (${t.claimId} is not null and ${t.claimStartedAt} is not null and ${t.claimStartedAt} >= ${t.createdAt} and ${t.claimExpiresAt} is not null and ${t.claimExpiresAt} > ${t.claimStartedAt} and ${t.claimExpiresAt} <= ${t.expiresAt} and ${t.claimExpiresAt} <= ${t.claimStartedAt} + interval '120 seconds')`,
    ),
    check(
      "ritual_upload_intents_completion",
      sql`${t.completedAt} is null or (${t.claimId} is not null and ${t.completedAt} >= ${t.claimStartedAt} and ${t.completedAt} < ${t.claimExpiresAt})`,
    ),
  ],
);

/** Explicit ritual association; uploader ownership alone never grants a download. */
export const ritualFileLinks = pgTable(
  "ritual_file_links",
  {
    id: uuid("id").primaryKey(),
    operationId: uuid("operation_id").notNull().unique(),
    ritualId: uuid("ritual_id")
      .notNull()
      .references(() => rituals.id),
    fileId: uuid("file_id")
      .notNull()
      .references(() => loomFilesTable.id),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => user.id),
    createdAt: instant("created_at").notNull(),
    deletedAt: instant("deleted_at"),
  },
  (t) => [
    foreignKey({
      name: "ritual_file_links_upload_binding",
      columns: [t.operationId, t.ritualId, t.fileId, t.id, t.uploaderId],
      foreignColumns: [
        ritualUploadIntents.operationId,
        ritualUploadIntents.ritualId,
        ritualUploadIntents.fileId,
        ritualUploadIntents.attachmentId,
        ritualUploadIntents.actorId,
      ],
    }),
    uniqueIndex("ritual_file_links_active_unique")
      .on(t.ritualId, t.fileId)
      .where(sql`${t.deletedAt} is null`),
    check(
      "ritual_file_links_dates",
      sql`${t.createdAt} >= '1970-01-01T00:00:00Z'::timestamptz and (${t.deletedAt} is null or ${t.deletedAt} >= ${t.createdAt})`,
    ),
  ],
);
