CREATE TABLE "discourse_user_links" (
	"user_id" uuid NOT NULL,
	"forum_origin" text NOT NULL,
	"discourse_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discourse_user_links_user_id_forum_origin_pk" PRIMARY KEY("user_id","forum_origin"),
	CONSTRAINT "discourse_user_links_external_id_safe" CHECK ("discourse_user_links"."discourse_user_id" between 1 and 9007199254740991),
	CONSTRAINT "discourse_user_links_forum_origin_shape" CHECK (octet_length("discourse_user_links"."forum_origin") <= 255 and "discourse_user_links"."forum_origin" ~ '^https://[a-z0-9.-]+(:[0-9]+)?$')
);
--> statement-breakpoint
ALTER TABLE "discourse_user_links" ADD CONSTRAINT "discourse_user_links_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discourse_user_links_forum_account_unique" ON "discourse_user_links" USING btree ("forum_origin","discourse_user_id");