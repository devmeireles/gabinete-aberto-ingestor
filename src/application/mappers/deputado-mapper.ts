import { InvalidSourceDataError } from "@/application/errors/invalid-source-data";
import type { DeputadoDto } from "@/application/ports/camara-gateway/deputados";
import type { Deputado, DeputadoLegislatura } from "@/domain/model/deputado";

export interface MappedDeputado {
  readonly deputado: Deputado;
  readonly legislatura: DeputadoLegislatura;
}

export function mapDeputado(
  dto: DeputadoDto,
  expectedLegislaturaId: number,
): MappedDeputado {
  if (!Number.isInteger(dto.id) || dto.id <= 0) {
    throw new InvalidSourceDataError(
      `deputado com id inválido: ${String(dto.id)}`,
    );
  }
  if (dto.idLegislatura !== expectedLegislaturaId) {
    throw new InvalidSourceDataError(
      `deputado ${dto.id} veio da legislatura ${dto.idLegislatura}, esperada ${expectedLegislaturaId}`,
    );
  }
  if (typeof dto.nome !== "string" || dto.nome.trim() === "") {
    throw new InvalidSourceDataError(`deputado ${dto.id} sem nome`);
  }
  if (typeof dto.uri !== "string" || dto.uri.trim() === "") {
    throw new InvalidSourceDataError(`deputado ${dto.id} sem uri`);
  }

  const uriPartido: string | null =
    typeof dto.uriPartido === "string" && dto.uriPartido.trim() !== ""
      ? dto.uriPartido
      : null;
  const partidoId: number | null =
    uriPartido === null ? null : extractPartidoId(uriPartido, dto.id);

  return {
    deputado: {
      id: dto.id,
      nome: dto.nome,
      uri: dto.uri,
      urlFoto: optionalString(dto.urlFoto),
    },
    legislatura: {
      deputadoId: dto.id,
      legislaturaId: expectedLegislaturaId,
      siglaPartido: optionalString(dto.siglaPartido),
      partidoId,
      siglaUf: optionalString(dto.siglaUf),
      email: optionalString(dto.email),
    },
  };
}

function extractPartidoId(uri: string, deputadoId: number): number {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new InvalidSourceDataError(
      `deputado ${deputadoId} com uriPartido inválida`,
    );
  }

  const match: RegExpMatchArray | null = parsed.pathname.match(
    /\/partidos\/(\d+)\/?$/,
  );
  const id: number = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InvalidSourceDataError(
      `deputado ${deputadoId} com uriPartido sem id válido`,
    );
  }
  return id;
}

function optionalString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
