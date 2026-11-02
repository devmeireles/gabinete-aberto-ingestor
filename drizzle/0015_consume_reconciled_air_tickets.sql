ALTER TABLE "bilhetes_aereos_csv" DROP CONSTRAINT "bilhetes_aereos_csv_association_status_chk";--> statement-breakpoint
ALTER TABLE "bilhetes_aereos_csv" DROP CONSTRAINT "bilhetes_aereos_csv_associated_expense_id_despesas_id_fk";
--> statement-breakpoint
DROP INDEX "bilhetes_aereos_csv_status_year_idx";--> statement-breakpoint
DROP INDEX "bilhetes_aereos_csv_associated_expense_idx";--> statement-breakpoint
CREATE INDEX "bilhetes_aereos_csv_year_idx" ON "bilhetes_aereos_csv" USING btree ("ano");--> statement-breakpoint
ALTER TABLE "bilhetes_aereos_csv" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "bilhetes_aereos_csv" DROP COLUMN "associated_expense_id";