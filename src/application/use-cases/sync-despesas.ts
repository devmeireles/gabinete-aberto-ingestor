import { prepareDespesasPage } from "./prepare-despesas-page";
import type {
  DespesaDto,
  DespesaGateway,
} from "@/application/ports/camara-gateway/despesas";
import type { Page } from "@/application/ports/camara-gateway/page";
import type { DespesaRepository } from "@/application/ports/despesa-repository";
import type { RawPayloadStore } from "@/application/ports/raw-payload-store";

const MAX_PAGES_PER_MONTH: number = 500;

export interface SyncDespesasPageResult {
  readonly page: number;
  readonly hasNext: boolean;
  readonly fetched: number;
  readonly written: number;
  readonly unchanged: number;
  readonly enriched: number;
  readonly ambiguous: number;
  readonly conflicted: number;
}

export interface SyncDespesasMonthResult {
  readonly pages: number;
  readonly fetched: number;
  readonly written: number;
  readonly unchanged: number;
  readonly enriched: number;
  readonly ambiguous: number;
  readonly conflicted: number;
}

export class SyncDespesas {
  constructor(
    private readonly gateway: DespesaGateway,
    private readonly rawStore: RawPayloadStore,
    private readonly repository: DespesaRepository,
  ) {}

  async listDeputadoIds(legislaturaId: number): Promise<readonly number[]> {
    return this.repository.listDeputadoIds(legislaturaId);
  }

  async getActiveLegislaturaId(asOf: string): Promise<number> {
    return this.repository.getActiveLegislaturaId(asOf);
  }

  async executePage(
    deputadoId: number,
    legislaturaId: number,
    ano: number,
    mes: number,
    pagina: number,
  ): Promise<SyncDespesasPageResult> {
    const page: Page<DespesaDto> = await this.gateway.listDespesas({
      idDeputado: deputadoId,
      idLegislatura: legislaturaId,
      ano,
      mes,
      pagina,
      ordem: "DESC",
    });
    const sourcePayloadId: number = await this.rawStore.save(
      page.requestKey,
      page.rawBody,
    );
    const { expenses, rejectedItems } = prepareDespesasPage(
      page.items,
      deputadoId,
      legislaturaId,
      ano,
      mes,
    );
    const result = await this.repository.upsertMany(
      expenses,
      sourcePayloadId,
      rejectedItems,
    );
    return {
      page: page.page,
      hasNext: page.hasNext,
      fetched: page.items.length,
      written: result.written,
      unchanged: result.unchanged,
      enriched: result.enriched,
      ambiguous: result.ambiguous,
      conflicted: result.conflicted,
    };
  }

  async executeDeputadoMonth(
    deputadoId: number,
    legislaturaId: number,
    ano: number,
    mes: number,
  ): Promise<SyncDespesasMonthResult> {
    let pagina: number = 1;
    let fetched: number = 0;
    let written: number = 0;
    let unchanged: number = 0;
    let enriched: number = 0;
    let ambiguous: number = 0;
    let conflicted: number = 0;
    let hasNext: boolean;

    do {
      const result = await this.executePage(
        deputadoId,
        legislaturaId,
        ano,
        mes,
        pagina,
      );
      fetched += result.fetched;
      written += result.written;
      unchanged += result.unchanged;
      enriched += result.enriched;
      ambiguous += result.ambiguous;
      conflicted += result.conflicted;
      hasNext = result.hasNext;
      pagina++;
      if (hasNext && pagina > MAX_PAGES_PER_MONTH) {
        throw new Error(
          `Despesas do deputado ${deputadoId} em ${ano}-${mes} excederam ${MAX_PAGES_PER_MONTH} páginas`,
        );
      }
    } while (hasNext);

    return {
      pages: pagina - 1,
      fetched,
      written,
      unchanged,
      enriched,
      ambiguous,
      conflicted,
    };
  }
}
