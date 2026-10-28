import { InvalidSourceDataError } from "@/application/errors/invalid-source-data";
import type { DeputadoDetalheDto } from "@/application/ports/camara-gateway/deputados";
import type { DeputadoDetalhe } from "@/domain/model/deputado";

function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new InvalidSourceDataError(`${field} deve ser texto ou nulo`);
  }
  const normalized: string = value.trim();
  return normalized === "" ? null : normalized;
}

function requiredText(value: unknown, field: string): string {
  const text: string | null = nullableText(value, field);
  if (text === null) {
    throw new InvalidSourceDataError(`${field} é obrigatório`);
  }
  return text;
}

function nullableDate(value: unknown, field: string): string | null {
  const date: string | null = nullableText(value, field);
  if (date === null) return null;
  const parsedDate: Date = new Date(`${date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new InvalidSourceDataError(
      `${field} contém uma data inválida: ${date}`,
    );
  }
  return date;
}

export function mapDeputadoDetalhe(
  dto: DeputadoDetalheDto,
  expectedDeputadoId: number,
): DeputadoDetalhe {
  if (
    dto === null ||
    typeof dto !== "object" ||
    dto.ultimoStatus === null ||
    typeof dto.ultimoStatus !== "object"
  ) {
    throw new InvalidSourceDataError(
      `resposta de detalhe inválida para o deputado ${expectedDeputadoId}`,
    );
  }
  if (dto.id !== expectedDeputadoId || dto.ultimoStatus.id !== dto.id) {
    throw new InvalidSourceDataError(
      `detalhe retornado não corresponde ao deputado ${expectedDeputadoId}`,
    );
  }
  if (
    !Number.isInteger(dto.ultimoStatus.idLegislatura) ||
    dto.ultimoStatus.idLegislatura <= 0
  ) {
    throw new InvalidSourceDataError(
      `deputado ${dto.id} sem legislatura válida em ultimoStatus`,
    );
  }
  if (!Array.isArray(dto.redeSocial)) {
    throw new InvalidSourceDataError(
      `redeSocial inválida para o deputado ${dto.id}`,
    );
  }

  const gabinete = dto.ultimoStatus.gabinete;
  return {
    deputadoId: dto.id,
    nomeCivil: nullableText(dto.nomeCivil, "nomeCivil"),
    cpf: nullableText(dto.cpf, "cpf"),
    sexo: nullableText(dto.sexo, "sexo"),
    urlWebsite: nullableText(dto.urlWebsite, "urlWebsite"),
    redesSociais: dto.redeSocial.map((social, index) => {
      if (typeof social !== "string" || social.trim() === "") {
        throw new InvalidSourceDataError(
          `redeSocial[${index}] inválida para o deputado ${dto.id}`,
        );
      }
      return social.trim();
    }),
    dataNascimento: nullableDate(dto.dataNascimento, "dataNascimento"),
    dataFalecimento: nullableDate(dto.dataFalecimento, "dataFalecimento"),
    ufNascimento: nullableText(dto.ufNascimento, "ufNascimento"),
    municipioNascimento: nullableText(
      dto.municipioNascimento,
      "municipioNascimento",
    ),
    escolaridade: nullableText(dto.escolaridade, "escolaridade"),
    statusLegislaturaId: dto.ultimoStatus.idLegislatura,
    statusNome: nullableText(dto.ultimoStatus.nome, "ultimoStatus.nome"),
    statusUri: requiredText(dto.ultimoStatus.uri, "ultimoStatus.uri"),
    nomeEleitoral: nullableText(
      dto.ultimoStatus.nomeEleitoral,
      "nomeEleitoral",
    ),
    siglaPartido: nullableText(dto.ultimoStatus.siglaPartido, "siglaPartido"),
    uriPartido: nullableText(dto.ultimoStatus.uriPartido, "uriPartido"),
    siglaUf: nullableText(dto.ultimoStatus.siglaUf, "siglaUf"),
    urlFoto: nullableText(dto.ultimoStatus.urlFoto, "urlFoto"),
    email: nullableText(dto.ultimoStatus.email, "email"),
    dataStatus: nullableDate(dto.ultimoStatus.data, "ultimoStatus.data"),
    situacao: nullableText(dto.ultimoStatus.situacao, "situacao"),
    condicaoEleitoral: nullableText(
      dto.ultimoStatus.condicaoEleitoral,
      "condicaoEleitoral",
    ),
    descricaoStatus: nullableText(
      dto.ultimoStatus.descricaoStatus,
      "descricaoStatus",
    ),
    gabinete: {
      nome: nullableText(gabinete?.nome, "gabinete.nome"),
      predio: nullableText(gabinete?.predio, "gabinete.predio"),
      sala: nullableText(gabinete?.sala, "gabinete.sala"),
      andar: nullableText(gabinete?.andar, "gabinete.andar"),
      telefone: nullableText(gabinete?.telefone, "gabinete.telefone"),
      email: nullableText(gabinete?.email, "gabinete.email"),
    },
  };
}
