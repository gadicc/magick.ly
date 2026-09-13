CREATE TABLE "ritual_bundle_assets" (
	"operation_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"ritual_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"asset_index" integer NOT NULL,
	"reference" text NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"storage_provider" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"receipt_json" text,
	"receipt_sha256" text,
	"verified_at" timestamp with time zone,
	CONSTRAINT "ritual_bundle_assets_bundle_key" PRIMARY KEY("bundle_id","key"),
	CONSTRAINT "ritual_bundle_assets_operation_index" UNIQUE("operation_id","asset_index"),
	CONSTRAINT "ritual_bundle_assets_destination" UNIQUE("storage_provider","bucket","object_key"),
	CONSTRAINT "ritual_bundle_assets_key_v7" CHECK (substring("ritual_bundle_assets"."key"::text from 15 for 1) = '7' and substring("ritual_bundle_assets"."key"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_bundle_assets_identity" CHECK ("ritual_bundle_assets"."key" <> "ritual_bundle_assets"."bundle_id" and "ritual_bundle_assets"."asset_index" between 0 and 511 and octet_length("ritual_bundle_assets"."reference") between 1 and 1048576 and position('#' in "ritual_bundle_assets"."reference") = 0 and "ritual_bundle_assets"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ritual_bundle_assets_bytes" CHECK (("ritual_bundle_assets"."mime" in ('image/png','image/jpeg','image/gif','image/webp') and "ritual_bundle_assets"."byte_size" between 1 and 20971520) or ("ritual_bundle_assets"."mime" = 'image/svg+xml' and "ritual_bundle_assets"."byte_size" between 1 and 4194304)),
	CONSTRAINT "ritual_bundle_assets_destination_nonempty" CHECK (octet_length("ritual_bundle_assets"."storage_provider") between 1 and 128 and length(btrim("ritual_bundle_assets"."storage_provider")) > 0 and octet_length("ritual_bundle_assets"."bucket") between 1 and 255 and length(btrim("ritual_bundle_assets"."bucket")) > 0 and octet_length("ritual_bundle_assets"."object_key") between 1 and 1024),
	CONSTRAINT "ritual_bundle_assets_receipt" CHECK (("ritual_bundle_assets"."receipt_json" is null and "ritual_bundle_assets"."receipt_sha256" is null and "ritual_bundle_assets"."verified_at" is null) or ("ritual_bundle_assets"."receipt_json" is not null and "ritual_bundle_assets"."receipt_sha256" is not null and "ritual_bundle_assets"."verified_at" is not null and "ritual_bundle_assets"."verified_at" >= '1970-01-01T00:00:00Z'::timestamptz and isfinite("ritual_bundle_assets"."verified_at") and octet_length("ritual_bundle_assets"."receipt_json") between 1 and 16384 and json_typeof("ritual_bundle_assets"."receipt_json"::json) = 'object')),
	CONSTRAINT "ritual_bundle_assets_receipt_binding" CHECK ("ritual_bundle_assets"."receipt_json" is null or coalesce("ritual_bundle_assets"."receipt_json"::json ->> 'profile' = 'magickli-ritual-bundle-object-receipt-v1' and "ritual_bundle_assets"."receipt_json"::json ->> 'operationId' = "ritual_bundle_assets"."operation_id"::text and "ritual_bundle_assets"."receipt_json"::json ->> 'bundleId' = "ritual_bundle_assets"."bundle_id"::text and "ritual_bundle_assets"."receipt_json"::json ->> 'assetKey' = "ritual_bundle_assets"."key"::text and "ritual_bundle_assets"."receipt_json"::json ->> 'storageProvider' = "ritual_bundle_assets"."storage_provider" and "ritual_bundle_assets"."receipt_json"::json ->> 'bucket' = "ritual_bundle_assets"."bucket" and "ritual_bundle_assets"."receipt_json"::json ->> 'objectKey' = "ritual_bundle_assets"."object_key" and "ritual_bundle_assets"."receipt_json"::json ->> 'sha256' = "ritual_bundle_assets"."sha256" and "ritual_bundle_assets"."receipt_json"::json ->> 'mime' = "ritual_bundle_assets"."mime" and json_typeof("ritual_bundle_assets"."receipt_json"::json -> 'byteSize') = 'number' and ("ritual_bundle_assets"."receipt_json"::json ->> 'byteSize')::numeric = "ritual_bundle_assets"."byte_size" and json_typeof("ritual_bundle_assets"."receipt_json"::json -> 'verifiedAtMs') = 'number' and ("ritual_bundle_assets"."receipt_json"::json ->> 'verifiedAtMs')::numeric = extract(epoch from "ritual_bundle_assets"."verified_at") * 1000, false)),
	CONSTRAINT "ritual_bundle_assets_receipt_hash" CHECK ("ritual_bundle_assets"."receipt_sha256" = encode(sha256(convert_to("ritual_bundle_assets"."receipt_json", 'UTF8')), 'hex'))
);
--> statement-breakpoint
CREATE TABLE "ritual_bundle_publication_intents" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"ritual_id" uuid NOT NULL,
	"current_revision_id" uuid NOT NULL,
	"current_compiled_artifact_id" uuid,
	"parent_version" bigint NOT NULL,
	"descriptor_sha256" text NOT NULL,
	"content_sha256" text NOT NULL,
	"publication_policy_id" text NOT NULL,
	"manifest_json" text NOT NULL,
	"manifest_sha256" text NOT NULL,
	"plan_json" text NOT NULL,
	"plan_sha256" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claim_id" uuid,
	"claim_started_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ritual_bundle_publication_intents_bundle_id_unique" UNIQUE("bundle_id"),
	CONSTRAINT "ritual_bundle_intents_asset_binding" UNIQUE("operation_id","bundle_id","ritual_id"),
	CONSTRAINT "ritual_bundle_intents_completion_binding" UNIQUE("operation_id","bundle_id","ritual_id","current_revision_id"),
	CONSTRAINT "ritual_bundle_intents_operation_id_v7" CHECK (substring("ritual_bundle_publication_intents"."operation_id"::text from 15 for 1) = '7' and substring("ritual_bundle_publication_intents"."operation_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_bundle_intents_bundle_id_v7" CHECK (substring("ritual_bundle_publication_intents"."bundle_id"::text from 15 for 1) = '7' and substring("ritual_bundle_publication_intents"."bundle_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_bundle_intents_ritual_id_v7" CHECK (substring("ritual_bundle_publication_intents"."ritual_id"::text from 15 for 1) = '7' and substring("ritual_bundle_publication_intents"."ritual_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_bundle_intents_current_revision_id_v7" CHECK (substring("ritual_bundle_publication_intents"."current_revision_id"::text from 15 for 1) = '7' and substring("ritual_bundle_publication_intents"."current_revision_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_bundle_intents_current_compiled_artifact_id_v7" CHECK (substring("ritual_bundle_publication_intents"."current_compiled_artifact_id"::text from 15 for 1) = '7' and substring("ritual_bundle_publication_intents"."current_compiled_artifact_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_bundle_intents_claim_id_v7" CHECK (substring("ritual_bundle_publication_intents"."claim_id"::text from 15 for 1) = '7' and substring("ritual_bundle_publication_intents"."claim_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_bundle_intents_identity" CHECK ("ritual_bundle_publication_intents"."parent_version" between 0 and 9007199254740991 and "ritual_bundle_publication_intents"."descriptor_sha256" ~ '^[0-9a-f]{64}$' and "ritual_bundle_publication_intents"."content_sha256" ~ '^[0-9a-f]{64}$' and "ritual_bundle_publication_intents"."request_hash" ~ '^[0-9a-f]{64}$' and "ritual_bundle_publication_intents"."publication_policy_id" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'),
	CONSTRAINT "ritual_bundle_intents_manifest_hash" CHECK ("ritual_bundle_publication_intents"."manifest_sha256" = encode(sha256(convert_to("ritual_bundle_publication_intents"."manifest_json", 'UTF8')), 'hex')),
	CONSTRAINT "ritual_bundle_intents_plan_hash" CHECK ("ritual_bundle_publication_intents"."plan_sha256" = encode(sha256(convert_to("ritual_bundle_publication_intents"."plan_json", 'UTF8')), 'hex')),
	CONSTRAINT "ritual_bundle_intents_manifest" CHECK (octet_length("ritual_bundle_publication_intents"."manifest_json") between 1 and 16777216 and coalesce(json_typeof("ritual_bundle_publication_intents"."manifest_json"::json) = 'object' and "ritual_bundle_publication_intents"."manifest_json"::json ->> 'version' = '1' and "ritual_bundle_publication_intents"."manifest_json"::json ->> 'bundleId' = "ritual_bundle_publication_intents"."bundle_id"::text and "ritual_bundle_publication_intents"."manifest_json"::json ->> 'ritualId' = "ritual_bundle_publication_intents"."ritual_id"::text and "ritual_bundle_publication_intents"."manifest_json"::json -> 'descriptor' ->> 'descriptorSha256' = "ritual_bundle_publication_intents"."descriptor_sha256" and "ritual_bundle_publication_intents"."manifest_json"::json -> 'descriptor' ->> 'contentSha256' = "ritual_bundle_publication_intents"."content_sha256" and "ritual_bundle_publication_intents"."manifest_json"::json -> 'descriptor' ->> 'outputFormat' = 'json-rich-text' and "ritual_bundle_publication_intents"."manifest_json"::json -> 'descriptor' ->> 'outputFormatVersion' = '1', false)),
	CONSTRAINT "ritual_bundle_intents_plan" CHECK (octet_length("ritual_bundle_publication_intents"."plan_json") between 1 and 16777216 and coalesce(json_typeof("ritual_bundle_publication_intents"."plan_json"::json) = 'object' and "ritual_bundle_publication_intents"."plan_json"::json ->> 'profile' = 'magickli-ritual-asset-plan-v4' and "ritual_bundle_publication_intents"."plan_json"::json ->> 'inventoryProfile' = 'magickli-jrt-assets-v2' and "ritual_bundle_publication_intents"."plan_json"::json ->> 'contentSha256' = "ritual_bundle_publication_intents"."content_sha256" and "ritual_bundle_publication_intents"."plan_json"::json ->> 'resolutionComplete' = 'true' and json_typeof("ritual_bundle_publication_intents"."plan_json"::json -> 'issues') = 'array' and json_array_length("ritual_bundle_publication_intents"."plan_json"::json -> 'issues') = 0 and not ("ritual_bundle_publication_intents"."plan_json"::jsonb ? 'sha256'), false)),
	CONSTRAINT "ritual_bundle_intents_expiry" CHECK ("ritual_bundle_publication_intents"."created_at" >= '1970-01-01T00:00:00Z'::timestamptz and "ritual_bundle_publication_intents"."expires_at" > "ritual_bundle_publication_intents"."created_at" and "ritual_bundle_publication_intents"."expires_at" <= "ritual_bundle_publication_intents"."created_at" + interval '24 hours'),
	CONSTRAINT "ritual_bundle_intents_claim" CHECK (("ritual_bundle_publication_intents"."claim_id" is null and "ritual_bundle_publication_intents"."claim_started_at" is null and "ritual_bundle_publication_intents"."claim_expires_at" is null) or ("ritual_bundle_publication_intents"."claim_id" is not null and "ritual_bundle_publication_intents"."claim_started_at" is not null and "ritual_bundle_publication_intents"."claim_started_at" >= "ritual_bundle_publication_intents"."created_at" and "ritual_bundle_publication_intents"."claim_expires_at" is not null and "ritual_bundle_publication_intents"."claim_expires_at" > "ritual_bundle_publication_intents"."claim_started_at" and "ritual_bundle_publication_intents"."claim_expires_at" <= "ritual_bundle_publication_intents"."expires_at" and "ritual_bundle_publication_intents"."claim_expires_at" <= "ritual_bundle_publication_intents"."claim_started_at" + interval '120 seconds')),
	CONSTRAINT "ritual_bundle_intents_completion" CHECK ("ritual_bundle_publication_intents"."completed_at" is null or ("ritual_bundle_publication_intents"."claim_id" is not null and "ritual_bundle_publication_intents"."completed_at" >= "ritual_bundle_publication_intents"."claim_started_at" and "ritual_bundle_publication_intents"."completed_at" < "ritual_bundle_publication_intents"."claim_expires_at" and "ritual_bundle_publication_intents"."completed_at" <= "ritual_bundle_publication_intents"."expires_at"))
);
--> statement-breakpoint
CREATE TABLE "ritual_bundles" (
	"bundle_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"ritual_id" uuid NOT NULL,
	"current_revision_id" uuid NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ritual_bundles_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "ritual_bundles_published_at" CHECK ("ritual_bundles"."published_at" >= '1970-01-01T00:00:00Z'::timestamptz and isfinite("ritual_bundles"."published_at"))
);
--> statement-breakpoint
ALTER TABLE "ritual_bundle_assets" ADD CONSTRAINT "ritual_bundle_assets_intent_binding" FOREIGN KEY ("operation_id","bundle_id","ritual_id") REFERENCES "public"."ritual_bundle_publication_intents"("operation_id","bundle_id","ritual_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_bundle_publication_intents" ADD CONSTRAINT "ritual_bundle_publication_intents_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_bundles" ADD CONSTRAINT "ritual_bundles_intent_binding" FOREIGN KEY ("operation_id","bundle_id","ritual_id","current_revision_id") REFERENCES "public"."ritual_bundle_publication_intents"("operation_id","bundle_id","ritual_id","current_revision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_bundles" ADD CONSTRAINT "ritual_bundles_own_revision" FOREIGN KEY ("ritual_id","current_revision_id") REFERENCES "public"."ritual_revisions"("ritual_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ritual_bundle_intents_expiry_idx" ON "ritual_bundle_publication_intents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ritual_bundle_intents_ritual_idx" ON "ritual_bundle_publication_intents" USING btree ("ritual_id");--> statement-breakpoint
CREATE INDEX "ritual_bundles_ritual_idx" ON "ritual_bundles" USING btree ("ritual_id","published_at");