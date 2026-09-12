CREATE TYPE "public"."legacy_id_type" AS ENUM('objectid', 'string');--> statement-breakpoint
CREATE TABLE "legacy_id_aliases" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"source_system" text NOT NULL,
	"entity_type" text NOT NULL,
	"legacy_id_type" "legacy_id_type" NOT NULL,
	"legacy_id_value" text NOT NULL,
	"canonical_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_id_aliases_source_nonempty" CHECK (length(btrim("legacy_id_aliases"."source_system")) > 0),
	CONSTRAINT "legacy_id_aliases_entity_nonempty" CHECK (length(btrim("legacy_id_aliases"."entity_type")) > 0),
	CONSTRAINT "legacy_id_aliases_objectid_format" CHECK ("legacy_id_aliases"."legacy_id_type" <> 'objectid' or "legacy_id_aliases"."legacy_id_value" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "legacy_id_aliases_canonical_uuid_v7" CHECK (substring("legacy_id_aliases"."canonical_id"::text from 15 for 1) = '7' and substring("legacy_id_aliases"."canonical_id"::text from 20 for 1) in ('8', '9', 'a', 'b'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_id_aliases_source_key_unique" ON "legacy_id_aliases" USING btree ("source_system","entity_type","legacy_id_type","legacy_id_value");--> statement-breakpoint
CREATE INDEX "legacy_id_aliases_canonical_idx" ON "legacy_id_aliases" USING btree ("entity_type","canonical_id");