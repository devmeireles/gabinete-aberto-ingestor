CREATE TABLE "partido_detalhes" (
	"partido_id" integer PRIMARY KEY NOT NULL,
	"status_data" text,
	"status_legislatura_id" integer,
	"situacao" text,
	"total_posse" integer,
	"total_membros" integer,
	"uri_membros" text,
	"lider_uri" text,
	"lider_nome" text,
	"lider_sigla_partido" text,
	"lider_uri_partido" text,
	"lider_uf" char(2),
	"lider_legislatura_id" integer,
	"lider_url_foto" text,
	"numero_eleitoral" text,
	"url_logo" text,
	"url_website" text,
	"url_facebook" text,
	"row_hash" char(64) NOT NULL,
	"source_payload_id" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partido_detalhes" ADD CONSTRAINT "partido_detalhes_partido_id_partidos_id_fk" FOREIGN KEY ("partido_id") REFERENCES "public"."partidos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partido_detalhes" ADD CONSTRAINT "partido_detalhes_status_legislatura_id_legislaturas_id_fk" FOREIGN KEY ("status_legislatura_id") REFERENCES "public"."legislaturas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partido_detalhes" ADD CONSTRAINT "partido_detalhes_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partido_detalhes_status_legislatura_idx" ON "partido_detalhes" USING btree ("status_legislatura_id");