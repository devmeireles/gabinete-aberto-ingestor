-- Party changes are stored as dated deputy-party intervals within each term.
CREATE TABLE "deputado_partido_vigencias" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deputado_id" integer NOT NULL,
	"legislatura_id" integer NOT NULL,
	"partido_id" integer,
	"data_inicio" timestamp,
	"data_fim" timestamp,
	"row_hash" char(64) NOT NULL,
	"source_payload_id" bigint,
	CONSTRAINT "deputado_partido_vigencias_data_check" CHECK ("deputado_partido_vigencias"."data_fim" IS NULL OR "deputado_partido_vigencias"."data_inicio" IS NULL OR "deputado_partido_vigencias"."data_fim" >= "deputado_partido_vigencias"."data_inicio")
);
--> statement-breakpoint
ALTER TABLE "deputado_legislaturas" DROP CONSTRAINT "deputado_legislaturas_partido_legislatura_fk";
--> statement-breakpoint
DROP INDEX "deputado_leg_partido_idx";--> statement-breakpoint
ALTER TABLE "deputado_partido_vigencias" ADD CONSTRAINT "deputado_partido_vigencias_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deputado_partido_vigencias" ADD CONSTRAINT "deputado_partido_vigencias_deputado_legislatura_fk" FOREIGN KEY ("deputado_id","legislatura_id") REFERENCES "public"."deputado_legislaturas"("deputado_id","legislatura_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deputado_partido_vigencias" ADD CONSTRAINT "deputado_partido_vigencias_partido_legislatura_fk" FOREIGN KEY ("partido_id","legislatura_id") REFERENCES "public"."partido_legislaturas"("partido_id","legislatura_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deputado_partido_vigencias_deputado_leg_idx" ON "deputado_partido_vigencias" USING btree ("deputado_id","legislatura_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deputado_partido_vigencias_deputado_leg_inicio_uq" ON "deputado_partido_vigencias" USING btree ("deputado_id","legislatura_id","data_inicio") WHERE "deputado_partido_vigencias"."data_inicio" IS NOT NULL;--> statement-breakpoint
-- Existing rows contain a party association but not the date it became valid.
INSERT INTO "deputado_partido_vigencias" (
	"deputado_id",
	"legislatura_id",
	"partido_id",
	"data_inicio",
	"data_fim",
	"row_hash",
	"source_payload_id"
)
SELECT
	"deputado_id",
	"legislatura_id",
	"partido_id",
	NULL,
	NULL,
	repeat('0', 64),
	"source_payload_id"
FROM "deputado_legislaturas"
WHERE "partido_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "deputado_legislaturas" DROP COLUMN "sigla_partido";--> statement-breakpoint
ALTER TABLE "deputado_legislaturas" DROP COLUMN "partido_id";