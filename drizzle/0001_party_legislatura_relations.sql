CREATE TABLE "partido_legislaturas" (
	"partido_id" integer NOT NULL,
	"legislatura_id" integer NOT NULL,
	"row_hash" char(64) NOT NULL,
	"source_payload_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partido_legislaturas_partido_id_legislatura_id_pk" PRIMARY KEY("partido_id","legislatura_id")
);
--> statement-breakpoint
INSERT INTO "partido_legislaturas" ("partido_id", "legislatura_id", "row_hash", "source_payload_id", "updated_at")
SELECT
	"deputado_legislaturas"."partido_id",
	"deputado_legislaturas"."legislatura_id",
	-- Placeholder replaced by the canonical application hash on the next sync.
	repeat('0', 64),
	min("deputado_legislaturas"."source_payload_id"),
	min("deputado_legislaturas"."updated_at")
FROM "deputado_legislaturas"
INNER JOIN "partidos" ON "partidos"."id" = "deputado_legislaturas"."partido_id"
INNER JOIN "legislaturas" ON "legislaturas"."id" = "deputado_legislaturas"."legislatura_id"
WHERE "deputado_legislaturas"."partido_id" IS NOT NULL
GROUP BY "deputado_legislaturas"."partido_id", "deputado_legislaturas"."legislatura_id";
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "deputado_legislaturas"
		LEFT JOIN "partido_legislaturas"
			ON "partido_legislaturas"."partido_id" = "deputado_legislaturas"."partido_id"
			AND "partido_legislaturas"."legislatura_id" = "deputado_legislaturas"."legislatura_id"
		WHERE "deputado_legislaturas"."partido_id" IS NOT NULL
			AND "partido_legislaturas"."partido_id" IS NULL
	) THEN
		RAISE EXCEPTION 'Existing deputy-party links reference a party or legislature that is not stored; repair these rows before applying the migration';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "partido_legislaturas" ADD CONSTRAINT "partido_legislaturas_partido_id_partidos_id_fk" FOREIGN KEY ("partido_id") REFERENCES "public"."partidos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partido_legislaturas" ADD CONSTRAINT "partido_legislaturas_legislatura_id_legislaturas_id_fk" FOREIGN KEY ("legislatura_id") REFERENCES "public"."legislaturas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partido_legislaturas" ADD CONSTRAINT "partido_legislaturas_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deputado_legislaturas" ADD CONSTRAINT "deputado_legislaturas_partido_legislatura_fk" FOREIGN KEY ("partido_id","legislatura_id") REFERENCES "public"."partido_legislaturas"("partido_id","legislatura_id") ON DELETE no action ON UPDATE no action;