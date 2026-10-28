CREATE TABLE "deputado_legislaturas" (
	"deputado_id" integer NOT NULL,
	"legislatura_id" integer NOT NULL,
	"sigla_partido" text,
	"partido_id" integer,
	"sigla_uf" char(2),
	"email" text,
	"row_hash" char(64) NOT NULL,
	"source_payload_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deputado_legislaturas_deputado_id_legislatura_id_pk" PRIMARY KEY("deputado_id","legislatura_id")
);
--> statement-breakpoint
CREATE TABLE "deputados" (
	"id" integer PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"uri" text NOT NULL,
	"url_foto" text,
	"row_hash" char(64) NOT NULL,
	"source_payload_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legislaturas" (
	"id" integer PRIMARY KEY NOT NULL,
	"uri" text NOT NULL,
	"data_inicio" date NOT NULL,
	"data_fim" date,
	"row_hash" char(64) NOT NULL,
	"source_payload_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partidos" (
	"id" integer PRIMARY KEY NOT NULL,
	"sigla" text NOT NULL,
	"nome" text NOT NULL,
	"uri" text NOT NULL,
	"row_hash" char(64) NOT NULL,
	"source_payload_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_key" text NOT NULL,
	"content_hash" char(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"first_fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deputado_legislaturas" ADD CONSTRAINT "deputado_legislaturas_deputado_id_deputados_id_fk" FOREIGN KEY ("deputado_id") REFERENCES "public"."deputados"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deputado_legislaturas" ADD CONSTRAINT "deputado_legislaturas_legislatura_id_legislaturas_id_fk" FOREIGN KEY ("legislatura_id") REFERENCES "public"."legislaturas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deputado_legislaturas" ADD CONSTRAINT "deputado_legislaturas_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deputados" ADD CONSTRAINT "deputados_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legislaturas" ADD CONSTRAINT "legislaturas_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deputado_leg_partido_idx" ON "deputado_legislaturas" USING btree ("partido_id");--> statement-breakpoint
CREATE INDEX "partidos_sigla_idx" ON "partidos" USING btree ("sigla");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_payloads_key_hash_uq" ON "raw_payloads" USING btree ("request_key","content_hash");