ALTER TABLE "deputado_detalhes" DROP CONSTRAINT "deputado_detalhes_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
ALTER TABLE "deputado_legislaturas" DROP CONSTRAINT "deputado_legislaturas_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
ALTER TABLE "deputado_partido_vigencias" DROP CONSTRAINT "deputado_partido_vigencias_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
ALTER TABLE "deputados" DROP CONSTRAINT "deputados_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
ALTER TABLE "despesa_conflicts" DROP CONSTRAINT "despesa_conflicts_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
ALTER TABLE "despesas" DROP CONSTRAINT "despesas_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
ALTER TABLE "legislaturas" DROP CONSTRAINT "legislaturas_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
ALTER TABLE "partido_detalhes" DROP CONSTRAINT "partido_detalhes_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
ALTER TABLE "partido_legislaturas" DROP CONSTRAINT "partido_legislaturas_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
ALTER TABLE "partidos" DROP CONSTRAINT "partidos_source_payload_id_raw_payloads_id_fk";--> statement-breakpoint
DELETE FROM "despesa_conflicts" AS dupe USING "despesa_conflicts" AS keep WHERE dupe."natural_key" = keep."natural_key" AND dupe."row_hash" = keep."row_hash" AND dupe."payload" = keep."payload" AND dupe."reason" = keep."reason" AND dupe."id" > keep."id";--> statement-breakpoint
DROP INDEX "despesa_conflicts_source_hash_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "despesa_conflicts_natural_key_hash_uq" ON "despesa_conflicts" USING btree ("natural_key","row_hash");--> statement-breakpoint
ALTER TABLE "deputado_detalhes" DROP COLUMN "source_payload_id";--> statement-breakpoint
ALTER TABLE "deputado_legislaturas" DROP COLUMN "source_payload_id";--> statement-breakpoint
ALTER TABLE "deputado_partido_vigencias" DROP COLUMN "source_payload_id";--> statement-breakpoint
ALTER TABLE "deputados" DROP COLUMN "source_payload_id";--> statement-breakpoint
ALTER TABLE "despesa_conflicts" DROP COLUMN "source_payload_id";--> statement-breakpoint
ALTER TABLE "despesas" DROP COLUMN "source_payload_id";--> statement-breakpoint
ALTER TABLE "legislaturas" DROP COLUMN "source_payload_id";--> statement-breakpoint
ALTER TABLE "partido_detalhes" DROP COLUMN "source_payload_id";--> statement-breakpoint
ALTER TABLE "partido_legislaturas" DROP COLUMN "source_payload_id";--> statement-breakpoint
ALTER TABLE "partidos" DROP COLUMN "source_payload_id";--> statement-breakpoint
DROP TABLE "raw_payloads";
