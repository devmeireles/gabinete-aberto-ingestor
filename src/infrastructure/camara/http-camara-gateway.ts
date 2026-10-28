import type {
  DeputadoGateway,
  DeputadoDto,
  DeputadoDetalheDto,
  DeputadoHistoricoDto,
  ListDeputadosQuery,
  Resource,
} from "@/application/ports/camara-gateway/deputados";
import type {
  DespesaGateway,
  DespesaDto,
  ListDespesasQuery,
} from "@/application/ports/camara-gateway/despesas";
import type {
  LegislaturaDto,
  LegislaturaGateway,
  ListLegislaturasQuery,
} from "@/application/ports/camara-gateway/legislaturas";
import type {
  ListPartidosQuery,
  PartidoDetalheDto,
  PartidoDto,
  PartidoGateway,
} from "@/application/ports/camara-gateway/partidos";
import type { Page } from "@/application/ports/camara-gateway/page";
import type {
  CamaraHttpClient,
  CamaraResponse,
  Link,
} from "./camara-http-client";

/** Máximo documentado pela API por requisição. */
const PAGE_SIZE: number = 100;
/** O endpoint de deputados permite até 250 itens; as próximas páginas usam links. */
const DEPUTADOS_PAGE_SIZE: number = 250;

/**
 * ADAPTER da porta CamaraGateway.
 *
 * Por quê "hasNext" via links: a API devolve links com rel "self", "next",
 * "first" e "last" (confirmado em chamada real a /legislaturas). A ausência de
 * "next" é o sinal oficial de última página; não inferimos pelo tamanho.
 */
export class HttpCamaraGateway
  implements LegislaturaGateway, PartidoGateway, DeputadoGateway, DespesaGateway
{
  constructor(private readonly http: CamaraHttpClient) {}

  async listLegislaturas(
    query: ListLegislaturasQuery,
  ): Promise<Page<LegislaturaDto>> {
    const response: CamaraResponse<LegislaturaDto[]> = await this.http.getJson(
      "legislaturas",
      {
        ...(query.id === undefined ? {} : { id: query.id }),
        pagina: query.pagina,
        itens: PAGE_SIZE,
        ordem: "DESC",
        ordenarPor: "id",
      },
    );
    return this.toPage(response, query.pagina);
  }

  async listPartidos(query: ListPartidosQuery): Promise<Page<PartidoDto>> {
    const response: CamaraResponse<PartidoDto[]> = await this.http.getJson(
      "partidos",
      {
        idLegislatura: query.idLegislatura,
        pagina: query.pagina,
        itens: PAGE_SIZE,
        ordem: "ASC",
        ordenarPor: "sigla",
      },
    );
    return this.toPage(response, query.pagina);
  }

  async getPartido(partidoId: number): Promise<{
    readonly item: PartidoDetalheDto;
    readonly requestKey: string;
    readonly rawBody: unknown;
  }> {
    const response: CamaraResponse<PartidoDetalheDto> = await this.http.getJson(
      `partidos/${partidoId}`,
    );
    return {
      item: response.envelope.dados,
      requestKey: response.requestKey,
      rawBody: response.envelope,
    };
  }

  async listDeputados(query: ListDeputadosQuery): Promise<Page<DeputadoDto>> {
    const response: CamaraResponse<DeputadoDto[]> = await this.http.getJson(
      "deputados",
      {
        idLegislatura: query.idLegislatura,
        pagina: query.pagina,
        itens: DEPUTADOS_PAGE_SIZE,
        ordem: "ASC",
        ordenarPor: "nome",
      },
    );
    return this.toPage(response, query.pagina);
  }

  async getDeputadoHistorico(
    deputadoId: number,
  ): Promise<Page<DeputadoHistoricoDto>> {
    const response: CamaraResponse<DeputadoHistoricoDto[]> =
      await this.http.getJson(`deputados/${deputadoId}/historico`);
    return this.toPage(response, 1);
  }

  async getDeputado(deputadoId: number): Promise<Resource<DeputadoDetalheDto>> {
    const response: CamaraResponse<DeputadoDetalheDto> =
      await this.http.getJson(`deputados/${deputadoId}`);
    return {
      item: response.envelope.dados,
      requestKey: response.requestKey,
      rawBody: response.envelope,
    };
  }

  async listDespesas(query: ListDespesasQuery): Promise<Page<DespesaDto>> {
    const response: CamaraResponse<DespesaDto[]> = await this.http.getJson(
      `deputados/${query.idDeputado}/despesas`,
      {
        idLegislatura: query.idLegislatura,
        ano: query.ano,
        mes: query.mes,
        pagina: query.pagina,
        itens: PAGE_SIZE,
        ordem: query.ordem ?? "DESC",
        ordenarPor: "ano",
      },
    );
    return this.toPage(response, query.pagina);
  }

  private hasNextPage(links: readonly Link[]): boolean {
    return links.some((link: Link) => link.rel === "next");
  }

  private toPage<T>(response: CamaraResponse<T[]>, page: number): Page<T> {
    return {
      items: response.envelope.dados,
      page,
      hasNext: this.hasNextPage(response.envelope.links),
      requestKey: response.requestKey,
      rawBody: response.envelope,
    };
  }
}
