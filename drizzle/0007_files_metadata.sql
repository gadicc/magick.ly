CREATE TABLE "legacy_file_snapshots" (
	"source_system" text NOT NULL,
	"legacy_id_type" "legacy_id_type" NOT NULL,
	"legacy_id_value" text NOT NULL,
	"file_id" uuid NOT NULL,
	"source_ejson" text NOT NULL,
	"source_sha256" text NOT NULL,
	"serialization_version" text NOT NULL,
	"legacy_public_path" text NOT NULL,
	"source_storage_provider" text NOT NULL,
	"source_bucket" text NOT NULL,
	"source_object_key" text NOT NULL,
	"legacy_sync_updated_at_milliseconds" bigint,
	"imported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "legacy_file_snapshots_source_system_legacy_id_type_legacy_id_value_pk" PRIMARY KEY("source_system","legacy_id_type","legacy_id_value"),
	CONSTRAINT "legacy_file_source_system" CHECK ("legacy_file_snapshots"."source_system" = 'mongodb'),
	CONSTRAINT "legacy_file_source_id" CHECK (length("legacy_file_snapshots"."legacy_id_value") > 0 and ("legacy_file_snapshots"."legacy_id_type" <> 'objectid' or "legacy_file_snapshots"."legacy_id_value" ~ '^[0-9a-f]{24}$')),
	CONSTRAINT "legacy_file_sync_timestamp" CHECK ("legacy_file_snapshots"."legacy_sync_updated_at_milliseconds" between 0 and 9007199254740991),
	CONSTRAINT "legacy_file_serialization" CHECK ("legacy_file_snapshots"."serialization_version" = 'bson-canonical-ejson-v1'),
	CONSTRAINT "legacy_file_source_hash" CHECK ("legacy_file_snapshots"."source_sha256" = encode(sha256(convert_to("legacy_file_snapshots"."source_ejson", 'UTF8')), 'hex')),
	CONSTRAINT "legacy_file_source_json_object" CHECK (json_typeof("legacy_file_snapshots"."source_ejson"::json) = 'object'),
	CONSTRAINT "legacy_file_source_location" CHECK (length(btrim("legacy_file_snapshots"."source_storage_provider")) > 0 and length(btrim("legacy_file_snapshots"."source_bucket")) > 0 and "legacy_file_snapshots"."source_object_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_file_public_path" CHECK ("legacy_file_snapshots"."legacy_public_path" = '/api/file2?sha256=' || "legacy_file_snapshots"."source_object_key")
);
--> statement-breakpoint
CREATE TABLE "loom_files" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"original_filename" text,
	"content_type" text,
	"detected_content_type" text,
	"kind" text DEFAULT 'other' NOT NULL,
	"storage_provider" text NOT NULL,
	"bucket" text,
	"object_key" text NOT NULL,
	"owner_type" text,
	"owner_id" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"image_meta" jsonb,
	"audio_meta" jsonb,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_file_snapshots" ADD CONSTRAINT "legacy_file_snapshots_file_id_loom_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."loom_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_file_snapshot_file_unique" ON "legacy_file_snapshots" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loom_files_sha256_unique" ON "loom_files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "loom_files_owner_idx" ON "loom_files" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "loom_files_storage_object_idx" ON "loom_files" USING btree ("storage_provider","bucket","object_key");