-- Expense tables and candidate data from the annual Câmara CSV.
CREATE TABLE "bilhetes_aereos_csv" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deputado_id" integer NOT NULL,
	"legislatura_id" integer NOT NULL,
	"ano" integer NOT NULL,
	"mes" integer NOT NULL,
	"tipo_despesa" text NOT NULL,
	"cod_tipo_documento" integer NOT NULL,
	"cod_documento" text NOT NULL,
	"data_documento" timestamp NOT NULL,
	"num_documento" text NOT NULL,
	"parcela" integer NOT NULL,
	"cod_lote" integer NOT NULL,
	"cnpj_cpf_fornecedor" text NOT NULL,
	"valor_documento" numeric(14, 2) NOT NULL,
	"passageiro" text NOT NULL,
	"trecho" text NOT NULL,
	"arquivo" text NOT NULL,
	"linha" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "despesas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deputado_id" integer NOT NULL,
	"legislatura_id" integer NOT NULL,
	"ano" integer NOT NULL,
	"mes" integer NOT NULL,
	"tipo_despesa_id" bigint NOT NULL,
	"cod_documento" text NOT NULL,
	"tipo_documento" text NOT NULL,
	"cod_tipo_documento" integer NOT NULL,
	"data_documento" timestamp,
	"num_documento" text NOT NULL,
	"parcela" integer NOT NULL,
	"num_ressarcimento" text NOT NULL,
	"cod_lote" integer NOT NULL,
	"fornecedor_id" bigint NOT NULL,
	"valor_documento" numeric(14, 2) NOT NULL,
	"valor_glosa" numeric(14, 2) NOT NULL,
	"valor_liquido" numeric(14, 2) NOT NULL,
	"url_documento" text,
	"passageiro" text,
	"trecho" text,
	"bilhete_match_ambiguo" boolean DEFAULT false NOT NULL,
	"row_hash" char(64) NOT NULL,
	"source_payload_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fornecedores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"cnpj_cpf" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tipos_despesa" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_tipo_despesa_id_tipos_despesa_id_fk" FOREIGN KEY ("tipo_despesa_id") REFERENCES "public"."tipos_despesa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_fornecedor_id_fornecedores_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_source_payload_id_raw_payloads_id_fk" FOREIGN KEY ("source_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_deputado_legislatura_fk" FOREIGN KEY ("deputado_id","legislatura_id") REFERENCES "public"."deputado_legislaturas"("deputado_id","legislatura_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bilhetes_aereos_csv_identity_uq" ON "bilhetes_aereos_csv" USING btree ("deputado_id","legislatura_id","ano","mes","cod_documento","cod_tipo_documento","data_documento","num_documento","parcela","cod_lote","valor_documento","passageiro","trecho");--> statement-breakpoint
CREATE INDEX "bilhetes_aereos_csv_match_idx" ON "bilhetes_aereos_csv" USING btree ("deputado_id","legislatura_id","ano","mes","cod_documento","data_documento","num_documento");--> statement-breakpoint
CREATE UNIQUE INDEX "despesas_natural_key_uq" ON "despesas" USING btree ("deputado_id","legislatura_id","ano","mes","cod_documento","cod_lote","parcela");--> statement-breakpoint
CREATE INDEX "despesas_legislatura_periodo_idx" ON "despesas" USING btree ("legislatura_id","ano","mes");--> statement-breakpoint
CREATE INDEX "despesas_tipo_despesa_idx" ON "despesas" USING btree ("tipo_despesa_id");--> statement-breakpoint
CREATE INDEX "despesas_fornecedor_idx" ON "despesas" USING btree ("fornecedor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fornecedores_nome_cnpj_cpf_uq" ON "fornecedores" USING btree ("nome","cnpj_cpf");--> statement-breakpoint
CREATE INDEX "fornecedores_cnpj_cpf_idx" ON "fornecedores" USING btree ("cnpj_cpf");--> statement-breakpoint
CREATE UNIQUE INDEX "tipos_despesa_nome_uq" ON "tipos_despesa" USING btree ("nome");