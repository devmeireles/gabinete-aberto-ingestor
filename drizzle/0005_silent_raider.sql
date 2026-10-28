CREATE TABLE "crawler_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"function_id" text NOT NULL,
	"run_id" text NOT NULL,
	"event_name" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error" text,
	CONSTRAINT "crawler_runs_status_check" CHECK ("crawler_runs"."status" IN ('running', 'completed', 'failed')),
	CONSTRAINT "crawler_runs_attempt_check" CHECK ("crawler_runs"."attempt" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crawler_runs_function_run_uq" ON "crawler_runs" USING btree ("function_id","run_id");--> statement-breakpoint
CREATE INDEX "crawler_runs_status_started_idx" ON "crawler_runs" USING btree ("status","started_at");