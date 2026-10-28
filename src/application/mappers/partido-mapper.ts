import { InvalidSourceDataError } from "@/application/errors/invalid-source-data";
import type { PartidoDto } from "@/application/ports/camara-gateway/partidos";
import type { Partido, PartidoLegislatura } from "@/domain/model/partido";

export interface MappedPartido {
  readonly partido: Partido;
  readonly legislatura: PartidoLegislatura;
}

export function mapPartido(
  dto: PartidoDto,
  legislaturaId: number,
): MappedPartido {
  if (!Number.isInteger(dto.id) || dto.id <= 0) {
    throw new InvalidSourceDataError(
      `partido com id inválido: ${String(dto.id)}`,
    );
  }
  if (typeof dto.sigla !== "string" || dto.sigla.trim() === "") {
    throw new InvalidSourceDataError(`partido ${dto.id} sem sigla`);
  }
  if (typeof dto.nome !== "string" || dto.nome.trim() === "") {
    throw new InvalidSourceDataError(`partido ${dto.id} sem nome`);
  }
  if (typeof dto.uri !== "string" || dto.uri.trim() === "") {
    throw new InvalidSourceDataError(`partido ${dto.id} sem uri`);
  }

  let uri: URL;
  try {
    uri = new URL(dto.uri);
  } catch {
    throw new InvalidSourceDataError(`partido ${dto.id} com uri inválida`);
  }
  const uriId: number = Number(
    uri.pathname.match(/\/partidos\/(\d+)\/?$/)?.[1],
  );
  if (!Number.isSafeInteger(uriId) || uriId !== dto.id) {
    throw new InvalidSourceDataError(
      `partido ${dto.id} tem uri inconsistente: ${dto.uri}`,
    );
  }

  return {
    partido: {
      id: dto.id,
      sigla: dto.sigla,
      nome: dto.nome,
      uri: dto.uri,
    },
    legislatura: { partidoId: dto.id, legislaturaId },
  };
}
