CREATE TABLE "legacy_file_relocations" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"source_storage_provider" text NOT NULL,
	"source_bucket" text NOT NULL,
	"source_object_key" text NOT NULL,
	"source_metadata_sha256" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"destination_storage_provider" text NOT NULL,
	"destination_bucket" text NOT NULL,
	"destination_object_key" text NOT NULL,
	"verification_profile" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "legacy_file_relocation_file_id_v7" CHECK (substring("legacy_file_relocations"."file_id"::text from 15 for 1) = '7' and substring("legacy_file_relocations"."file_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "legacy_file_relocation_source" CHECK (length(btrim("legacy_file_relocations"."source_storage_provider")) > 0 and length(btrim("legacy_file_relocations"."source_bucket")) > 0 and length("legacy_file_relocations"."source_object_key") > 0 and "legacy_file_relocations"."source_metadata_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_file_relocation_content" CHECK ("legacy_file_relocations"."content_sha256" ~ '^[0-9a-f]{64}$' and "legacy_file_relocations"."byte_size" between 1 and 20971520),
	CONSTRAINT "legacy_file_relocation_destination" CHECK ("legacy_file_relocations"."destination_storage_provider" = 'r2' and "legacy_file_relocations"."destination_bucket" = 'magickli-files-production' and "legacy_file_relocations"."destination_object_key" = 'legacy-file2/' || "legacy_file_relocations"."content_sha256" and ("legacy_file_relocations"."source_storage_provider", "legacy_file_relocations"."source_bucket", "legacy_file_relocations"."source_object_key") <> ("legacy_file_relocations"."destination_storage_provider", "legacy_file_relocations"."destination_bucket", "legacy_file_relocations"."destination_object_key")),
	CONSTRAINT "legacy_file_relocation_verification" CHECK ("legacy_file_relocations"."verification_profile" = 'magickli-legacy-file-relocation-v1' and "legacy_file_relocations"."verified_at" >= '1970-01-01T00:00:00Z'::timestamptz and isfinite("legacy_file_relocations"."verified_at"))
);
--> statement-breakpoint
ALTER TABLE "legacy_file_relocations" ADD CONSTRAINT "legacy_file_relocations_file_id_loom_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."loom_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_file_relocation_destination_unique" ON "legacy_file_relocations" USING btree ("destination_storage_provider","destination_bucket","destination_object_key");