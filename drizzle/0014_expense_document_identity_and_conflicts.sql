CREATE TABLE "despesa_conflicts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_payload_id" bigint NOT NULL,
	"natural_key" text NOT NULL,
	"row_hash" char(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "despesas_natural_key_uq";--> statement-breakpoint
ALTER TABLE "despesa_conflicts" ADD CONSTRAINT "despesa_conflicts_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "despesa_conflicts_source_hash_uq" ON "despesa_conflicts" USING btree ("source_payload_id","row_hash");--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_natural_key_uq" UNIQUE NULLS NOT DISTINCT("deputado_id","legislatura_id","ano","mes","cod_documento","cod_lote","parcela","valor_documento","valor_glosa","valor_liquido","num_documento","data_documento");