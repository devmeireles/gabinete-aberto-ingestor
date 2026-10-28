import type { Page } from "./page";

export interface LegislaturaDto {
  readonly id: number;
  readonly uri: string;
  readonly dataInicio: string;
  readonly dataFim: string;
}

export interface ListLegislaturasQuery {
  readonly pagina: number;
  readonly id?: number;
}

export interface LegislaturaGateway {
  listLegislaturas(query: ListLegislaturasQuery): Promise<Page<LegislaturaDto>>;
}
