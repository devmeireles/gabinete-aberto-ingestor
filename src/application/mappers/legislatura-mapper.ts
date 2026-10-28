import type { LegislaturaDto } from "@/application/ports/camara-gateway/legislaturas";
import type { Legislatura } from "@/domain/model/legislatura";
import { InvalidSourceDataError } from "@/application/errors/invalid-source-data";
import { currentDateInBrazil } from "@/shared/date";

const ISO_DATE: RegExp = /^\d{4}-\d{2}-\d{2}$/;

export function mapLegislatura(
  dto: LegislaturaDto,
  asOf: string = currentDateInBrazil(),
): Legislatura {
  if (!Number.isInteger(dto.id) || dto.id <= 0) {
    throw new InvalidSourceDataError(
      `legislatura com id inválido: ${String(dto.id)}`,
    );
  }
  if (typeof dto.uri !== "string" || dto.uri === "") {
    throw new InvalidSourceDataError(`legislatura ${dto.id} sem uri`);
  }
  if (typeof dto.dataInicio !== "string" || !ISO_DATE.test(dto.dataInicio)) {
    throw new InvalidSourceDataError(
      `legislatura ${dto.id} com dataInicio inválida`,
    );
  }
  const dataFim: string | null =
    typeof dto.dataFim === "string" && dto.dataFim !== "" ? dto.dataFim : null;
  if (dataFim !== null && !ISO_DATE.test(dataFim)) {
    throw new InvalidSourceDataError(
      `legislatura ${dto.id} com dataFim inválida`,
    );
  }
  if (dataFim !== null && dataFim < dto.dataInicio) {
    throw new InvalidSourceDataError(
      `legislatura ${dto.id} tem dataFim anterior a dataInicio`,
    );
  }
  return {
    id: dto.id,
    uri: dto.uri,
    dataInicio: dto.dataInicio,
    dataFim,
    legislaturaAtual:
      dto.dataInicio <= asOf && (dataFim === null || dataFim >= asOf),
  };
}
