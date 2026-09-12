import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Loom-managed schema blueprint: files v3.
// Keep app-specific schema additions in separate local schema files.
export const loomFilesTable = pgTable(
  "loom_files",
  {
    id: uuid("id").default(sql`uuid_generate_v7()`).primaryKey(),
    sha256: text("sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    originalFilename: text("original_filename"),
    contentType: text("content_type"),
    detectedContentType: text("detected_content_type"),
    kind: text("kind").notNull().default("other"),
    storageProvider: text("storage_provider").notNull(),
    bucket: text("bucket"),
    objectKey: text("object_key").notNull(),
    ownerType: text("owner_type"),
    ownerId: text("owner_id"),
    visibility: text("visibility").notNull().default("private"),
    imageMeta: jsonb("image_meta").$type<Record<string, unknown> | null>(),
    audioMeta: jsonb("audio_meta").$type<Record<string, unknown> | null>(),
    meta: jsonb("meta").$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("loom_files_sha256_unique").on(
      table.sha256,
    ),
    index("loom_files_owner_idx").on(
      table.ownerType,
      table.ownerId,
    ),
    index("loom_files_storage_object_idx").on(
      table.storageProvider,
      table.bucket,
      table.objectKey,
    ),
  ],
);
