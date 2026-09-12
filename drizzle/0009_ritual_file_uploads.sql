CREATE TABLE "ritual_file_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"ritual_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ritual_file_links_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "ritual_file_links_dates" CHECK ("ritual_file_links"."created_at" >= '1970-01-01T00:00:00Z'::timestamptz and ("ritual_file_links"."deleted_at" is null or "ritual_file_links"."deleted_at" >= "ritual_file_links"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "ritual_upload_intents" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"ritual_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"filename" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"file_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"staging_provider" text NOT NULL,
	"staging_bucket" text NOT NULL,
	"staging_object_key" text NOT NULL,
	"canonical_provider" text NOT NULL,
	"canonical_bucket" text NOT NULL,
	"canonical_object_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claim_id" uuid,
	"claim_started_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ritual_upload_intents_file_id_unique" UNIQUE("file_id"),
	CONSTRAINT "ritual_upload_intents_attachment_id_unique" UNIQUE("attachment_id"),
	CONSTRAINT "ritual_upload_intents_link_binding" UNIQUE("operation_id","ritual_id","file_id","attachment_id","actor_id"),
	CONSTRAINT "ritual_upload_intents_operation_id_v7" CHECK (substring("ritual_upload_intents"."operation_id"::text from 15 for 1) = '7' and substring("ritual_upload_intents"."operation_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_upload_intents_ritual_id_v7" CHECK (substring("ritual_upload_intents"."ritual_id"::text from 15 for 1) = '7' and substring("ritual_upload_intents"."ritual_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_upload_intents_file_id_v7" CHECK (substring("ritual_upload_intents"."file_id"::text from 15 for 1) = '7' and substring("ritual_upload_intents"."file_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_upload_intents_attachment_id_v7" CHECK (substring("ritual_upload_intents"."attachment_id"::text from 15 for 1) = '7' and substring("ritual_upload_intents"."attachment_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_upload_intents_claim_id_v7" CHECK (substring("ritual_upload_intents"."claim_id"::text from 15 for 1) = '7' and substring("ritual_upload_intents"."claim_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_upload_intents_digest" CHECK ("ritual_upload_intents"."sha256" ~ '^[0-9a-f]{64}$' and "ritual_upload_intents"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ritual_upload_intents_declared_file" CHECK ("ritual_upload_intents"."byte_size" between 1 and 20971520 and "ritual_upload_intents"."content_type" in ('image/png','image/jpeg','image/gif','image/webp') and length("ritual_upload_intents"."filename") between 1 and 1024),
	CONSTRAINT "ritual_upload_intents_locations" CHECK (length(btrim("ritual_upload_intents"."staging_provider")) > 0 and length(btrim("ritual_upload_intents"."staging_bucket")) > 0 and length("ritual_upload_intents"."staging_object_key") > 0 and length(btrim("ritual_upload_intents"."canonical_provider")) > 0 and length(btrim("ritual_upload_intents"."canonical_bucket")) > 0 and length("ritual_upload_intents"."canonical_object_key") > 0 and ("ritual_upload_intents"."staging_provider","ritual_upload_intents"."staging_bucket","ritual_upload_intents"."staging_object_key") <> ("ritual_upload_intents"."canonical_provider","ritual_upload_intents"."canonical_bucket","ritual_upload_intents"."canonical_object_key")),
	CONSTRAINT "ritual_upload_intents_expiry" CHECK ("ritual_upload_intents"."created_at" >= '1970-01-01T00:00:00Z'::timestamptz and "ritual_upload_intents"."expires_at" > "ritual_upload_intents"."created_at" and "ritual_upload_intents"."expires_at" <= "ritual_upload_intents"."created_at" + interval '24 hours'),
	CONSTRAINT "ritual_upload_intents_claim" CHECK (("ritual_upload_intents"."claim_id" is null and "ritual_upload_intents"."claim_started_at" is null and "ritual_upload_intents"."claim_expires_at" is null) or ("ritual_upload_intents"."claim_id" is not null and "ritual_upload_intents"."claim_started_at" is not null and "ritual_upload_intents"."claim_started_at" >= "ritual_upload_intents"."created_at" and "ritual_upload_intents"."claim_expires_at" is not null and "ritual_upload_intents"."claim_expires_at" > "ritual_upload_intents"."claim_started_at" and "ritual_upload_intents"."claim_expires_at" <= "ritual_upload_intents"."expires_at" and "ritual_upload_intents"."claim_expires_at" <= "ritual_upload_intents"."claim_started_at" + interval '120 seconds')),
	CONSTRAINT "ritual_upload_intents_completion" CHECK ("ritual_upload_intents"."completed_at" is null or ("ritual_upload_intents"."claim_id" is not null and "ritual_upload_intents"."completed_at" >= "ritual_upload_intents"."claim_started_at" and "ritual_upload_intents"."completed_at" < "ritual_upload_intents"."claim_expires_at"))
);
--> statement-breakpoint
ALTER TABLE "ritual_file_links" ADD CONSTRAINT "ritual_file_links_ritual_id_rituals_id_fk" FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_file_links" ADD CONSTRAINT "ritual_file_links_file_id_loom_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."loom_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_file_links" ADD CONSTRAINT "ritual_file_links_uploader_id_auth_user_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_file_links" ADD CONSTRAINT "ritual_file_links_upload_binding" FOREIGN KEY ("operation_id","ritual_id","file_id","id","uploader_id") REFERENCES "public"."ritual_upload_intents"("operation_id","ritual_id","file_id","attachment_id","actor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_upload_intents" ADD CONSTRAINT "ritual_upload_intents_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ritual_file_links_active_unique" ON "ritual_file_links" USING btree ("ritual_id","file_id") WHERE "ritual_file_links"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ritual_upload_intents_staging_unique" ON "ritual_upload_intents" USING btree ("staging_provider","staging_bucket","staging_object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ritual_upload_intents_canonical_unique" ON "ritual_upload_intents" USING btree ("canonical_provider","canonical_bucket","canonical_object_key");--> statement-breakpoint
CREATE INDEX "ritual_upload_intents_expiry_idx" ON "ritual_upload_intents" USING btree ("expires_at");