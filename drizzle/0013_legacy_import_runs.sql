CREATE TABLE "legacy_import_runs" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"slot" integer NOT NULL,
	"profile" text NOT NULL,
	"source_manifest_sha256" text NOT NULL,
	"source_descriptor_sha256" text NOT NULL,
	"configuration_sha256" text NOT NULL,
	"schema_sha256" text NOT NULL,
	"target_sha256" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"expected_rows_sha256" text NOT NULL,
	"payload" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"prepared_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"reconciliation_sha256" text,
	CONSTRAINT "legacy_import_runs_slot_unique" UNIQUE("slot"),
	CONSTRAINT "legacy_import_runs_id_v7" CHECK (substring("legacy_import_runs"."run_id"::text from 15 for 1) = '7' and substring("legacy_import_runs"."run_id"::text from 20 for 1) in ('8', '9', 'a', 'b')),
	CONSTRAINT "legacy_import_runs_singleton" CHECK ("legacy_import_runs"."slot" = 1),
	CONSTRAINT "legacy_import_runs_profile" CHECK ("legacy_import_runs"."profile" = 'magickli-legacy-import-run-v1'),
	CONSTRAINT "legacy_import_runs_source_manifest_sha256_hex" CHECK ("legacy_import_runs"."source_manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_import_runs_source_descriptor_sha256_hex" CHECK ("legacy_import_runs"."source_descriptor_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_import_runs_configuration_sha256_hex" CHECK ("legacy_import_runs"."configuration_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_import_runs_schema_sha256_hex" CHECK ("legacy_import_runs"."schema_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_import_runs_target_sha256_hex" CHECK ("legacy_import_runs"."target_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_import_runs_payload_sha256_hex" CHECK ("legacy_import_runs"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_import_runs_expected_rows_sha256_hex" CHECK ("legacy_import_runs"."expected_rows_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_import_runs_payload_bytes" CHECK (octet_length("legacy_import_runs"."payload") between 1 and 67108864),
	CONSTRAINT "legacy_import_runs_payload_hash" CHECK ("legacy_import_runs"."payload_sha256" = encode(sha256(convert_to("legacy_import_runs"."payload", 'UTF8')), 'hex')),
	CONSTRAINT "legacy_import_runs_finite_timestamps" CHECK (isfinite("legacy_import_runs"."imported_at") and isfinite("legacy_import_runs"."prepared_at")
        and ("legacy_import_runs"."completed_at" is null or isfinite("legacy_import_runs"."completed_at"))),
	CONSTRAINT "legacy_import_runs_completion" CHECK (("legacy_import_runs"."completed_at" is null and "legacy_import_runs"."reconciliation_sha256" is null)
        or ("legacy_import_runs"."completed_at" is not null and "legacy_import_runs"."reconciliation_sha256" is not null
          and "legacy_import_runs"."reconciliation_sha256" = "legacy_import_runs"."expected_rows_sha256"
          and "legacy_import_runs"."completed_at" >= "legacy_import_runs"."prepared_at"))
);
