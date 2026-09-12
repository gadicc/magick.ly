CREATE TABLE "ritual_write_receipts_v2" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"kind" text NOT NULL,
	"ritual_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ritual_write_receipts_v2_operation_id_v7" CHECK (substring("ritual_write_receipts_v2"."operation_id"::text from 15 for 1) = '7' and substring("ritual_write_receipts_v2"."operation_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_write_receipts_v2_ritual_id_v7" CHECK (substring("ritual_write_receipts_v2"."ritual_id"::text from 15 for 1) = '7' and substring("ritual_write_receipts_v2"."ritual_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_write_receipts_v2_revision_id_v7" CHECK (substring("ritual_write_receipts_v2"."revision_id"::text from 15 for 1) = '7' and substring("ritual_write_receipts_v2"."revision_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "ritual_write_receipts_v2_hash_valid" CHECK ("ritual_write_receipts_v2"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ritual_write_receipts_v2_kind_valid" CHECK ("ritual_write_receipts_v2"."kind" in ('create','save','publish')),
	CONSTRAINT "ritual_write_receipts_v2_version_safe" CHECK ("ritual_write_receipts_v2"."version" between 1 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "rituals" ADD COLUMN "current_compiled_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "ritual_write_receipts_v2" ADD CONSTRAINT "ritual_write_receipts_v2_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_compiled_artifacts" ADD CONSTRAINT "ritual_compiled_artifacts_revision_id_unique" UNIQUE("revision_id","id");--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_current_artifact_own_revision" FOREIGN KEY ("current_revision_id","current_compiled_artifact_id") REFERENCES "public"."ritual_compiled_artifacts"("revision_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_selected_artifact_requires_revision" CHECK ("rituals"."current_compiled_artifact_id" is null or "rituals"."current_revision_id" is not null);
