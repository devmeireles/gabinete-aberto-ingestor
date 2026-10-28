CREATE TABLE "deputado_detalhes" (
	"deputado_id" integer PRIMARY KEY NOT NULL,
	"nome_civil" text,
	"cpf" text,
	"sexo" text,
	"url_website" text,
	"redes_sociais" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_nascimento" date,
	"data_falecimento" date,
	"uf_nascimento" char(2),
	"municipio_nascimento" text,
	"escolaridade" text,
	"status_legislatura_id" integer NOT NULL,
	"nome_eleitoral" text,
	"sigla_partido" text,
	"uri_partido" text,
	"sigla_uf" char(2),
	"url_foto" text,
	"email" text,
	"data_status" date,
	"situacao" text,
	"condicao_eleitoral" text,
	"descricao_status" text,
	"gabinete_nome" text,
	"gabinete_predio" text,
	"gabinete_sala" text,
	"gabinete_andar" text,
	"gabinete_telefone" text,
	"gabinete_email" text,
	"row_hash" char(64) NOT NULL,
	"source_payload_id" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deputado_detalhes" ADD CONSTRAINT "deputado_detalhes_deputado_id_deputados_id_fk" FOREIGN KEY ("deputado_id") REFERENCES "public"."deputados"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deputado_detalhes" ADD CONSTRAINT "deputado_detalhes_status_legislatura_id_legislaturas_id_fk" FOREIGN KEY ("status_legislatura_id") REFERENCES "public"."legislaturas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deputado_detalhes" ADD CONSTRAINT "deputado_detalhes_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deputado_detalhes_status_legislatura_idx" ON "deputado_detalhes" USING btree ("status_legislatura_id");