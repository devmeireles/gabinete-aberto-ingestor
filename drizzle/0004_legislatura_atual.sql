ALTER TABLE "legislaturas" ADD COLUMN "legislatura_atual" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "legislaturas"
SET "legislatura_atual" =
  "data_inicio" <= (timezone('America/Sao_Paulo', now()))::date
  AND (
    "data_fim" IS NULL
    OR "data_fim" >= (timezone('America/Sao_Paulo', now()))::date
  );