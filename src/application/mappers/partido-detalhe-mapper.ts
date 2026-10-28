import { InvalidSourceDataError } from "@/application/errors/invalid-source-data";
import type { PartidoDetalheDto } from "@/application/ports/camara-gateway/partidos";
import type { PartidoDetalhe } from "@/domain/model/partido";

function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new InvalidSourceDataError(`${field} deve ser texto ou nulo`);
  }
  const normalized: string = value.trim();
  return normalized === "" ? null : normalized;
}

function nullableInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InvalidSourceDataError(`${field} contém um inteiro inválido`);
  }
  return parsed;
}

function nullableLegislaturaId(value: unknown): number | null {
  const id: number | null = nullableInteger(value, "status.idLegislatura");
  if (id === 0) {
    throw new InvalidSourceDataError(
      "status.idLegislatura deve ser um inteiro positivo",
    );
  }
  return id;
}

export function mapPartidoDetalhe(
  dto: PartidoDetalheDto,
  expectedPartidoId: number,
): PartidoDetalhe {
  if (
    dto === null ||
    typeof dto !== "object" ||
    dto.id !== expectedPartidoId ||
    (dto.status !== null &&
      dto.status !== undefined &&
      typeof dto.status !== "object")
  ) {
    throw new InvalidSourceDataError(
      `detalhe retornado não corresponde ao partido ${expectedPartidoId}`,
    );
  }
  const status = dto.status;
  const lider = status?.lider;

  return {
    partidoId: dto.id,
    statusData: nullableText(status?.data, "status.data"),
    statusLegislaturaId: nullableLegislaturaId(status?.idLegislatura),
    situacao: nullableText(status?.situacao, "status.situacao"),
    totalPosse: nullableInteger(status?.totalPosse, "status.totalPosse"),
    totalMembros: nullableInteger(status?.totalMembros, "status.totalMembros"),
    uriMembros: nullableText(status?.uriMembros, "status.uriMembros"),
    lider: {
      uri: nullableText(lider?.uri, "status.lider.uri"),
      nome: nullableText(lider?.nome, "status.lider.nome"),
      siglaPartido: nullableText(
        lider?.siglaPartido,
        "status.lider.siglaPartido",
      ),
      uriPartido: nullableText(lider?.uriPartido, "status.lider.uriPartido"),
      uf: nullableText(lider?.uf, "status.lider.uf"),
      legislaturaId: nullableInteger(
        lider?.idLegislatura,
        "status.lider.idLegislatura",
      ),
      urlFoto: nullableText(lider?.urlFoto, "status.lider.urlFoto"),
    },
    numeroEleitoral:
      dto.numeroEleitoral === null || dto.numeroEleitoral === undefined
        ? null
        : String(dto.numeroEleitoral),
    urlLogo: nullableText(dto.urlLogo, "urlLogo"),
    urlWebSite: nullableText(dto.urlWebSite, "urlWebSite"),
    urlFacebook: nullableText(dto.urlFacebook, "urlFacebook"),
  };
}
