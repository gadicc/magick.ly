CREATE TABLE "study_review_receipts" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"progress_id" uuid NOT NULL,
	"accepted_version" bigint NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "study_review_receipt_event_v7" CHECK (substring("study_review_receipts"."event_id"::text from 15 for 1) = '7' and substring("study_review_receipts"."event_id"::text from 20 for 1) in ('8','9','a','b')),
	CONSTRAINT "study_review_receipt_hash_valid" CHECK ("study_review_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "study_review_receipt_version_safe" CHECK ("study_review_receipts"."accepted_version" between 0 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "study_review_receipts" ADD CONSTRAINT "study_review_receipts_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_review_receipts" ADD CONSTRAINT "study_review_receipts_progress_id_study_progress_id_fk" FOREIGN KEY ("progress_id") REFERENCES "public"."study_progress"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_review_receipt_actor_idx" ON "study_review_receipts" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "study_review_receipt_progress_idx" ON "study_review_receipts" USING btree ("progress_id");