CREATE TABLE "legacy_user_group_grants" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"group_ids_present" boolean NOT NULL,
	"group_admin_ids_present" boolean NOT NULL,
	"group_references" jsonb NOT NULL,
	"group_admin_references" jsonb NOT NULL,
	"imported_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temple_invites" (
	"temple_id" uuid PRIMARY KEY NOT NULL,
	"join_pass" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temple_memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"temple_id" uuid NOT NULL,
	"grade" integer NOT NULL,
	"admin" boolean DEFAULT false NOT NULL,
	"motto" text,
	"added_at" timestamp with time zone NOT NULL,
	"member_since" timestamp with time zone,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"legacy_sync_updated_at_milliseconds" bigint,
	CONSTRAINT "temple_memberships_id_v7" CHECK (substring("temple_memberships"."id"::text from 15 for 1) = '7' and substring("temple_memberships"."id"::text from 20 for 1) in ('8', '9', 'a', 'b')),
	CONSTRAINT "temple_memberships_grade_nonnegative" CHECK ("temple_memberships"."grade" >= 0)
);
--> statement-breakpoint
CREATE TABLE "temples" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"legacy_sync_updated_at_milliseconds" bigint,
	CONSTRAINT "temples_id_v7" CHECK (substring("temples"."id"::text from 15 for 1) = '7' and substring("temples"."id"::text from 20 for 1) in ('8', '9', 'a', 'b')),
	CONSTRAINT "temples_slug_nonempty" CHECK (length(btrim("temples"."slug")) > 0)
);
--> statement-breakpoint
CREATE TABLE "user_group_grants" (
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"member" boolean DEFAULT false NOT NULL,
	"admin" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_group_grants_user_id_group_id_pk" PRIMARY KEY("user_id","group_id"),
	CONSTRAINT "user_group_grants_has_grant" CHECK ("user_group_grants"."member" or "user_group_grants"."admin")
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"legacy_sync_updated_at_milliseconds" bigint,
	CONSTRAINT "user_groups_id_v7" CHECK (substring("user_groups"."id"::text from 15 for 1) = '7' and substring("user_groups"."id"::text from 20 for 1) in ('8', '9', 'a', 'b'))
);
--> statement-breakpoint
ALTER TABLE "legacy_user_group_grants" ADD CONSTRAINT "legacy_user_group_grants_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temple_invites" ADD CONSTRAINT "temple_invites_temple_id_temples_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temples"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temple_memberships" ADD CONSTRAINT "temple_memberships_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temple_memberships" ADD CONSTRAINT "temple_memberships_temple_id_temples_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temples"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temples" ADD CONSTRAINT "temples_created_by_id_auth_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_grants" ADD CONSTRAINT "user_group_grants_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_grants" ADD CONSTRAINT "user_group_grants_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "temple_memberships_user_temple_unique" ON "temple_memberships" USING btree ("user_id","temple_id");--> statement-breakpoint
CREATE INDEX "temple_memberships_temple_idx" ON "temple_memberships" USING btree ("temple_id");--> statement-breakpoint
CREATE UNIQUE INDEX "temples_slug_normalized_unique" ON "temples" USING btree (lower(btrim("slug")));--> statement-breakpoint
CREATE INDEX "temples_created_by_idx" ON "temples" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "user_group_grants_group_idx" ON "user_group_grants" USING btree ("group_id");