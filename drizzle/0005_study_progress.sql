CREATE TABLE "legacy_study_snapshots" (
	"source_system" text NOT NULL,
	"legacy_id_type" "legacy_id_type" NOT NULL,
	"legacy_id_value" text NOT NULL,
	"progress_id" uuid NOT NULL,
	"disposition" text NOT NULL,
	"source_ejson" text NOT NULL,
	"source_sha256" text NOT NULL,
	"serialization_version" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "legacy_study_snapshots_source_system_legacy_id_type_legacy_id_value_pk" PRIMARY KEY("source_system","legacy_id_type","legacy_id_value"),
	CONSTRAINT "legacy_study_source_system" CHECK ("legacy_study_snapshots"."source_system" = 'mongodb'),
	CONSTRAINT "legacy_study_source_id" CHECK (length("legacy_study_snapshots"."legacy_id_value") > 0 and ("legacy_study_snapshots"."legacy_id_type" <> 'objectid' or "legacy_study_snapshots"."legacy_id_value" ~ '^[0-9a-f]{24}$')),
	CONSTRAINT "legacy_study_disposition" CHECK ("legacy_study_snapshots"."disposition" in ('baseline', 'empty-duplicate')),
	CONSTRAINT "legacy_study_serialization" CHECK ("legacy_study_snapshots"."serialization_version" = 'bson-canonical-ejson-v1'),
	CONSTRAINT "legacy_study_source_hash" CHECK ("legacy_study_snapshots"."source_sha256" = encode(sha256(convert_to("legacy_study_snapshots"."source_ejson", 'UTF8')), 'hex')),
	CONSTRAINT "legacy_study_source_json_object" CHECK (json_typeof("legacy_study_snapshots"."source_ejson"::json) = 'object')
);
--> statement-breakpoint
CREATE TABLE "study_card_states" (
	"progress_id" uuid NOT NULL,
	"card_key" text NOT NULL,
	"correct" bigint NOT NULL,
	"incorrect" bigint NOT NULL,
	"time_milliseconds" bigint NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"supermemo_interval" double precision NOT NULL,
	"supermemo_repetition" bigint NOT NULL,
	"supermemo_efactor" double precision NOT NULL,
	"repetition_present" boolean NOT NULL,
	"repetition_weight" bigint,
	CONSTRAINT "study_card_states_progress_id_card_key_pk" PRIMARY KEY("progress_id","card_key"),
	CONSTRAINT "study_card_key_nonempty" CHECK (length("study_card_states"."card_key") > 0),
	CONSTRAINT "study_card_correct_safe" CHECK ("study_card_states"."correct" between 0 and 9007199254740991),
	CONSTRAINT "study_card_incorrect_safe" CHECK ("study_card_states"."incorrect" between 0 and 9007199254740991),
	CONSTRAINT "study_card_time_safe" CHECK ("study_card_states"."time_milliseconds" between 0 and 9007199254740991),
	CONSTRAINT "study_card_repetition_safe" CHECK ("study_card_states"."supermemo_repetition" between 0 and 9007199254740991),
	CONSTRAINT "study_card_weight_safe" CHECK ("study_card_states"."repetition_weight" between 0 and 9007199254740991),
	CONSTRAINT "study_card_repetition_presence" CHECK ("study_card_states"."repetition_present" or "study_card_states"."repetition_weight" is null),
	CONSTRAINT "study_card_interval_finite" CHECK ("study_card_states"."supermemo_interval" >= 0 and "study_card_states"."supermemo_interval" < 'Infinity'::float8),
	CONSTRAINT "study_card_efactor_finite" CHECK ("study_card_states"."supermemo_efactor" > 0 and "study_card_states"."supermemo_efactor" < 'Infinity'::float8)
);
--> statement-breakpoint
CREATE TABLE "study_progress" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"set_id" text NOT NULL,
	"correct" bigint NOT NULL,
	"incorrect" bigint NOT NULL,
	"time_milliseconds" bigint NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"legacy_sync_updated_at_milliseconds" bigint,
	"version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "study_progress_user_set_unique" UNIQUE("user_id","set_id"),
	CONSTRAINT "study_progress_id_v7" CHECK (substring("study_progress"."id"::text from 15 for 1) = '7' and substring("study_progress"."id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "study_progress_set_nonempty" CHECK (length("study_progress"."set_id") > 0),
	CONSTRAINT "study_progress_correct_safe" CHECK ("study_progress"."correct" between 0 and 9007199254740991),
	CONSTRAINT "study_progress_incorrect_safe" CHECK ("study_progress"."incorrect" between 0 and 9007199254740991),
	CONSTRAINT "study_progress_time_safe" CHECK ("study_progress"."time_milliseconds" between 0 and 9007199254740991),
	CONSTRAINT "study_progress_version_safe" CHECK ("study_progress"."version" between 0 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "legacy_study_snapshots" ADD CONSTRAINT "legacy_study_snapshots_progress_id_study_progress_id_fk" FOREIGN KEY ("progress_id") REFERENCES "public"."study_progress"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_card_states" ADD CONSTRAINT "study_card_states_progress_id_study_progress_id_fk" FOREIGN KEY ("progress_id") REFERENCES "public"."study_progress"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_progress" ADD CONSTRAINT "study_progress_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_study_one_baseline" ON "legacy_study_snapshots" USING btree ("progress_id") WHERE "legacy_study_snapshots"."disposition" = 'baseline';--> statement-breakpoint
CREATE INDEX "legacy_study_progress_idx" ON "legacy_study_snapshots" USING btree ("progress_id");