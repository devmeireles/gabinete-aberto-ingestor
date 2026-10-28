import type { DespesaDto } from "@/application/ports/camara-gateway/despesas";
import type { Despesa } from "@/domain/model/despesa";

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Campo obrigatório inválido na despesa: ${field}`);
  }
  return value.trim();
}

function requireInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Campo inteiro inválido na despesa: ${field}`);
  }
  return value;
}

function requireMoney(value: number, field: string): number {
  if (
    !Number.isFinite(value) ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-7
  ) {
    throw new Error(`Campo monetário inválido na despesa: ${field}`);
  }
  return value;
}

function normalizeTaxId(value: string): string {
  const digits: string = value.replace(/\D/g, "");
  return /^0+$/.test(digits) ? "" : digits;
}

export function mapDespesa(
  dto: DespesaDto,
  deputadoId: number,
  legislaturaId: number,
): Despesa {
  if (
    dto.dataDocumento !== null &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dto.dataDocumento)
  ) {
    throw new Error(
      `Data inválida na despesa ${dto.codDocumento}: ${dto.dataDocumento}`,
    );
  }
  return {
    deputadoId: requireInteger(deputadoId, "deputadoId", 1),
    legislaturaId: requireInteger(legislaturaId, "legislaturaId", 1),
    ano: requireInteger(dto.ano, "ano", 1900),
    mes: requireInteger(dto.mes, "mes", 1, 12),
    tipoDespesa: requireText(dto.tipoDespesa, "tipoDespesa"),
    codDocumento: requireText(dto.codDocumento, "codDocumento"),
    tipoDocumento: dto.tipoDocumento.trim(),
    codTipoDocumento: requireInteger(
      dto.codTipoDocumento,
      "codTipoDocumento",
      0,
    ),
    dataDocumento: dto.dataDocumento,
    numDocumento: dto.numDocumento.trim(),
    parcela: requireInteger(dto.parcela, "parcela", 0),
    numRessarcimento: dto.numRessarcimento.trim(),
    codLote: requireInteger(dto.codLote, "codLote", 0),
    nomeFornecedor: requireText(dto.nomeFornecedor, "nomeFornecedor"),
    cnpjCpfFornecedor: normalizeTaxId(dto.cnpjCpfFornecedor),
    valorDocumento: requireMoney(dto.valorDocumento, "valorDocumento"),
    valorGlosa: requireMoney(dto.valorGlosa, "valorGlosa"),
    valorLiquido: requireMoney(dto.valorLiquido, "valorLiquido"),
    urlDocumento: dto.urlDocumento,
  };
}
