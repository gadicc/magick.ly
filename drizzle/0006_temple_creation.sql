CREATE TABLE "temple_creation_receipts" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"temple_id" uuid NOT NULL,
	"first_admin_membership_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "temple_creation_receipts_operation_id_v7" CHECK (substring("temple_creation_receipts"."operation_id"::text from 15 for 1) = '7' and substring("temple_creation_receipts"."operation_id"::text from 20 for 1) in ('8', '9', 'a', 'b')),
	CONSTRAINT "temple_creation_receipts_temple_id_v7" CHECK (substring("temple_creation_receipts"."temple_id"::text from 15 for 1) = '7' and substring("temple_creation_receipts"."temple_id"::text from 20 for 1) in ('8', '9', 'a', 'b')),
	CONSTRAINT "temple_creation_receipts_first_admin_membership_id_v7" CHECK (substring("temple_creation_receipts"."first_admin_membership_id"::text from 15 for 1) = '7' and substring("temple_creation_receipts"."first_admin_membership_id"::text from 20 for 1) in ('8', '9', 'a', 'b')),
	CONSTRAINT "temple_creation_receipts_hash_valid" CHECK ("temple_creation_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "temple_creation_receipts_slug_nonempty" CHECK (length(btrim("temple_creation_receipts"."slug")) > 0)
);
--> statement-breakpoint
ALTER TABLE "temple_creation_receipts" ADD CONSTRAINT "temple_creation_receipts_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;