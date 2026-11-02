import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { parse as createParser } from "csv-parse";
import type { BilheteAereoCsvSource } from "@/application/ports/bilhete-aereo-csv-source";
import type { CsvSkippedRecord } from "@/application/ports/bilhete-aereo-csv-source";
import type { BilheteAereoCsv } from "@/domain/model/despesa";

const TICKET_TYPES: ReadonlySet<string> = new Set([
  "PASSAGEM AÉREA - REEMBOLSO",
  "PASSAGEM AÉREA - RPA",
  "PASSAGEM AÉREA - SIGEPA",
  "PASSAGEM AÉREA - MISSÃO OFICIAL",
]);

const REQUIRED_COLUMNS: readonly string[] = [
  "txtDescricao",
  "ideCadastro",
  "datEmissao",
  "codLegislatura",
  "numAno",
  "numMes",
  "indTipoDocumento",
  "txtNumero",
  "numParcela",
  "numLote",
  "vlrDocumento",
];

class InvalidCsvRecordError extends Error {}

function required(
  record: Record<string, string>,
  field: string,
  line: number,
): string {
  const value: string | undefined = record[field];
  if (value === undefined || value.trim() === "") {
    throw new InvalidCsvRecordError(`Registro ${line}: campo ${field} ausente`);
  }
  return value.trim();
}

function optional(record: Record<string, string>, field: string): string {
  return (record[field] ?? "").trim();
}

function integerField(
  record: Record<string, string>,
  field: string,
  minimum: number,
  line: number,
  maximum: number = Number.MAX_SAFE_INTEGER,
): number {
  const raw: string = required(record, field, line);
  const value: number = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new InvalidCsvRecordError(
      `Registro ${line}: campo ${field} inválido: ${raw}`,
    );
  }
  return value;
}

function moneyField(
  record: Record<string, string>,
  field: string,
  line: number,
): number {
  const raw: string = required(record, field, line);
  const normalized: string = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const value: number = Number(normalized);
  if (
    !Number.isFinite(value) ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-7
  ) {
    throw new InvalidCsvRecordError(
      `Registro ${line}: valor monetário inválido em ${field}: ${raw}`,
    );
  }
  return value;
}

function mapCsvRow(
  record: Record<string, string>,
  arquivo: string,
  linha: number,
): BilheteAereoCsv | undefined {
  const tipoDespesa: string = optional(record, "txtDescricao");
  if (!TICKET_TYPES.has(tipoDespesa.toLocaleUpperCase("pt-BR"))) {
    return undefined;
  }
  // ideCadastro is the API deputy ID. nuDeputadoId belongs to the CEAP system.
  // Leadership/other non-deputy records cannot reconcile with deputy expenses.
  if (optional(record, "ideCadastro") === "") return undefined;
  const date: string = required(record, "datEmissao", linha);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(date)) {
    throw new InvalidCsvRecordError(
      `Registro ${linha}: data inválida: ${date}`,
    );
  }
  const digits: string = (record["txtCNPJCPF"] ?? "").replace(/\D/g, "");
  return {
    deputadoId: integerField(record, "ideCadastro", 1, linha),
    ...(optional(record, "nuDeputadoId") === ""
      ? {}
      : { ceapDeputadoId: integerField(record, "nuDeputadoId", 1, linha) }),
    legislaturaId: integerField(record, "codLegislatura", 1, linha),
    ano: integerField(record, "numAno", 1900, linha),
    mes: integerField(record, "numMes", 1, linha, 12),
    tipoDespesa,
    codTipoDocumento: integerField(record, "indTipoDocumento", 0, linha),
    // Retain missing source IDs without inventing an identifier. Such tickets
    // cannot match a normalized expense, which always has a document code.
    codDocumento: optional(record, "ideDocumento"),
    dataDocumento: date.length === 16 ? `${date}:00` : date,
    numDocumento: required(record, "txtNumero", linha),
    parcela: integerField(record, "numParcela", 0, linha),
    codLote: integerField(record, "numLote", 0, linha),
    cnpjCpfFornecedor: /^0+$/.test(digits) ? "" : digits,
    valorDocumento: moneyField(record, "vlrDocumento", linha),
    passageiro: optional(record, "txtPassageiro"),
    trecho: optional(record, "txtTrecho"),
    arquivo,
    linha,
  };
}

export class StreamingBilheteAereoCsvSource implements BilheteAereoCsvSource {
  async *read(
    filePath: string,
    onRecordRead?: (scanned: number) => void,
    onRecordSkipped?: (record: CsvSkippedRecord) => void,
  ): AsyncIterable<BilheteAereoCsv> {
    yield* this.readStream(
      basename(filePath),
      createReadStream(filePath),
      onRecordRead,
      onRecordSkipped,
    );
  }

  async *readStream(
    fileName: string,
    content: AsyncIterable<Uint8Array>,
    onRecordRead?: (scanned: number) => void,
    onRecordSkipped?: (record: CsvSkippedRecord) => void,
  ): AsyncIterable<BilheteAereoCsv> {
    const parser = createParser({
      bom: true,
      columns: true,
      delimiter: ";",
      skip_empty_lines: true,
    });
    const stream = Readable.from(content);
    stream.on("error", (error: Error) => parser.destroy(error));
    const input = stream.pipe(parser);
    let scanned: number = 0;
    for await (const rawRecord of input) {
      scanned++;
      onRecordRead?.(scanned);
      const record = rawRecord as Record<string, string>;
      if (scanned === 1) {
        const missingColumns = REQUIRED_COLUMNS.filter(
          (column) => !(column in record),
        );
        if (missingColumns.length > 0) {
          throw new Error(
            `Cabeçalho CSV sem colunas obrigatórias: ${missingColumns.join(", ")}`,
          );
        }
      }
      const line = scanned + 1;
      try {
        const candidate = mapCsvRow(record, basename(fileName), line);
        if (candidate !== undefined) yield candidate;
      } catch (error) {
        if (!(error instanceof InvalidCsvRecordError)) throw error;
        onRecordSkipped?.({ line, reason: error.message });
      }
    }
  }
}
