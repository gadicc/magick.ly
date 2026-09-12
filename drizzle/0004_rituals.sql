CREATE TYPE "public"."ritual_scope_kind" AS ENUM('public', 'group', 'temple');--> statement-breakpoint
CREATE TABLE "legacy_ritual_compiled_archives" (
	"ritual_id" uuid PRIMARY KEY NOT NULL,
	"claimed_revision_id" uuid NOT NULL,
	"content_json" text NOT NULL,
	"content_sha256" text NOT NULL,
	"serialization_version" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "legacy_ritual_archive_hash_matches" CHECK ("legacy_ritual_compiled_archives"."content_sha256" = encode(sha256(convert_to("legacy_ritual_compiled_archives"."content_json", 'UTF8')), 'hex')),
	CONSTRAINT "legacy_ritual_archive_json_object" CHECK (json_typeof("legacy_ritual_compiled_archives"."content_json"::json) = 'object'),
	CONSTRAINT "legacy_ritual_archive_serialization" CHECK ("legacy_ritual_compiled_archives"."serialization_version" = 'json-stringify-utf8-v1')
);
--> statement-breakpoint
CREATE TABLE "ritual_compiled_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"source_sha256" text NOT NULL,
	"compiler_version" text NOT NULL,
	"output_format" text NOT NULL,
	"output_format_version" text NOT NULL,
	"transformations" text[] NOT NULL,
	"content_json" text NOT NULL,
	"content_sha256" text NOT NULL,
	"compiled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ritual_compiled_artifacts_id_v7" CHECK (substring("ritual_compiled_artifacts"."id"::text from 15 for 1) = '7' and substring("ritual_compiled_artifacts"."id"::text from 20 for 1) in ('8', '9', 'a', 'b')),
	CONSTRAINT "ritual_compiled_artifact_hash_matches" CHECK ("ritual_compiled_artifacts"."content_sha256" = encode(sha256(convert_to("ritual_compiled_artifacts"."content_json", 'UTF8')), 'hex')),
	CONSTRAINT "ritual_compiled_artifact_json_object" CHECK (json_typeof("ritual_compiled_artifacts"."content_json"::json) = 'object'),
	CONSTRAINT "ritual_compiled_artifact_compiler_nonempty" CHECK (length(btrim("ritual_compiled_artifacts"."compiler_version")) > 0),
	CONSTRAINT "ritual_compiled_artifact_format_nonempty" CHECK (length(btrim("ritual_compiled_artifacts"."output_format")) > 0),
	CONSTRAINT "ritual_compiled_artifact_format_version_nonempty" CHECK (length(btrim("ritual_compiled_artifacts"."output_format_version")) > 0),
	CONSTRAINT "ritual_compiled_artifact_transformations_named" CHECK (array_position("ritual_compiled_artifacts"."transformations", NULL) is null and array_position("ritual_compiled_artifacts"."transformations", '') is null)
);
--> statement-breakpoint
CREATE TABLE "ritual_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"ritual_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_sha256" text NOT NULL,
	"source_format" text NOT NULL,
	"source_format_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"legacy_sync_updated_at_milliseconds" bigint,
	CONSTRAINT "ritual_revisions_parent_id_unique" UNIQUE("ritual_id","id"),
	CONSTRAINT "ritual_revisions_source_hash_unique" UNIQUE("id","source_sha256"),
	CONSTRAINT "ritual_revisions_id_v7" CHECK (substring("ritual_revisions"."id"::text from 15 for 1) = '7' and substring("ritual_revisions"."id"::text from 20 for 1) in ('8', '9', 'a', 'b')),
	CONSTRAINT "ritual_revisions_source_hash_matches" CHECK ("ritual_revisions"."source_sha256" = encode(sha256(convert_to("ritual_revisions"."source", 'UTF8')), 'hex')),
	CONSTRAINT "ritual_revisions_format_nonempty" CHECK (length(btrim("ritual_revisions"."source_format")) > 0),
	CONSTRAINT "ritual_revisions_format_version_nonempty" CHECK (length(btrim("ritual_revisions"."source_format_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "rituals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"title" text NOT NULL,
	"creator_id" uuid,
	"scope" "ritual_scope_kind" NOT NULL,
	"group_id" uuid,
	"temple_id" uuid,
	"min_grade" bigint,
	"current_revision_id" uuid,
	"version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"legacy_sync_updated_at_milliseconds" bigint,
	CONSTRAINT "rituals_id_v7" CHECK (substring("rituals"."id"::text from 15 for 1) = '7' and substring("rituals"."id"::text from 20 for 1) in ('8', '9', 'a', 'b')),
	CONSTRAINT "rituals_exclusive_scope" CHECK (
    ("rituals"."scope" = 'public' and "rituals"."group_id" is null and "rituals"."temple_id" is null and "rituals"."min_grade" is null)
    or ("rituals"."scope" = 'group' and "rituals"."group_id" is not null and "rituals"."temple_id" is null and "rituals"."min_grade" is null)
    or ("rituals"."scope" = 'temple' and "rituals"."group_id" is null and "rituals"."temple_id" is not null and "rituals"."min_grade" is not null and "rituals"."min_grade" between 0 and 9007199254740991)),
	CONSTRAINT "rituals_version_safe" CHECK ("rituals"."version" between 0 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "legacy_ritual_compiled_archives" ADD CONSTRAINT "legacy_ritual_compiled_archives_ritual_id_rituals_id_fk" FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_ritual_compiled_archives" ADD CONSTRAINT "legacy_ritual_archive_own_revision" FOREIGN KEY ("ritual_id","claimed_revision_id") REFERENCES "public"."ritual_revisions"("ritual_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_compiled_artifacts" ADD CONSTRAINT "ritual_compiled_artifact_exact_source" FOREIGN KEY ("revision_id","source_sha256") REFERENCES "public"."ritual_revisions"("id","source_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_revisions" ADD CONSTRAINT "ritual_revisions_ritual_id_rituals_id_fk" FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ritual_revisions" ADD CONSTRAINT "ritual_revisions_author_id_auth_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_creator_id_auth_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_temple_id_temples_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temples"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_current_revision_own_parent" FOREIGN KEY ("id","current_revision_id") REFERENCES "public"."ritual_revisions"("ritual_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ritual_compiled_artifact_revision_idx" ON "ritual_compiled_artifacts" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "ritual_revisions_author_idx" ON "ritual_revisions" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "rituals_group_idx" ON "rituals" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "rituals_temple_idx" ON "rituals" USING btree ("temple_id");--> statement-breakpoint
CREATE INDEX "rituals_creator_idx" ON "rituals" USING btree ("creator_id");