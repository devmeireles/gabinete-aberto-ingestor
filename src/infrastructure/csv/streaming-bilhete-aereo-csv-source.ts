import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { parse as createParser } from "csv-parse";
import type { BilheteAereoCsvSource } from "@/application/ports/bilhete-aereo-csv-source";
import type { BilheteAereoCsv } from "@/domain/model/despesa";

const TICKET_TYPE: string = "PASSAGEM AÉREA - SIGEPA";

function required(record: Record<string, string>, field: string): string {
  const value: string | undefined = record[field];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Campo ${field} ausente no registro CSV`);
  }
  return value.trim();
}

function integerField(
  record: Record<string, string>,
  field: string,
  minimum: number,
  maximum: number = Number.MAX_SAFE_INTEGER,
): number {
  const raw: string = required(record, field);
  const value: number = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Campo ${field} inválido no CSV: ${raw}`);
  }
  return value;
}

function moneyField(record: Record<string, string>, field: string): number {
  const raw: string = required(record, field);
  const normalized: string = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const value: number = Number(normalized);
  if (
    !Number.isFinite(value) ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-7
  ) {
    throw new Error(`Valor monetário inválido no CSV (${field}): ${raw}`);
  }
  return value;
}

function mapCsvRow(
  record: Record<string, string>,
  arquivo: string,
  linha: number,
): BilheteAereoCsv | undefined {
  const tipoDespesa: string = required(record, "txtDescricao");
  if (tipoDespesa.toLocaleUpperCase("pt-BR") !== TICKET_TYPE) {
    return undefined;
  }
  const date: string = required(record, "datEmissao");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(date)) {
    throw new Error(`Data inválida no CSV, registro ${linha}: ${date}`);
  }
  const digits: string = (record["txtCNPJCPF"] ?? "").replace(/\D/g, "");
  return {
    deputadoId: integerField(record, "nuDeputadoId", 1),
    legislaturaId: integerField(record, "codLegislatura", 1),
    ano: integerField(record, "numAno", 1900),
    mes: integerField(record, "numMes", 1, 12),
    tipoDespesa,
    codTipoDocumento: integerField(record, "indTipoDocumento", 0),
    codDocumento: required(record, "ideDocumento"),
    dataDocumento: date.length === 16 ? `${date}:00` : date,
    numDocumento: required(record, "txtNumero"),
    parcela: integerField(record, "numParcela", 0),
    codLote: integerField(record, "numLote", 0),
    cnpjCpfFornecedor: /^0+$/.test(digits) ? "" : digits,
    valorDocumento: moneyField(record, "vlrDocumento"),
    passageiro: required(record, "txtPassageiro"),
    trecho: required(record, "txtTrecho"),
    arquivo,
    linha,
  };
}

export class StreamingBilheteAereoCsvSource implements BilheteAereoCsvSource {
  async *read(
    filePath: string,
    onRecordRead?: (scanned: number) => void,
  ): AsyncIterable<BilheteAereoCsv> {
    yield* this.readStream(
      basename(filePath),
      createReadStream(filePath),
      onRecordRead,
    );
  }

  async *readStream(
    fileName: string,
    content: AsyncIterable<Uint8Array>,
    onRecordRead?: (scanned: number) => void,
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
      const candidate = mapCsvRow(
        rawRecord as Record<string, string>,
        basename(fileName),
        scanned + 1,
      );
      if (candidate !== undefined) yield candidate;
    }
  }
}
