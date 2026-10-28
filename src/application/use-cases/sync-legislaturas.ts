import type { Legislatura } from "@/domain/model/legislatura";
import { mapLegislatura } from "@/application/mappers/legislatura-mapper";
import type {
  LegislaturaDto,
  LegislaturaGateway,
} from "@/application/ports/camara-gateway/legislaturas";
import type { Page } from "@/application/ports/camara-gateway/page";
import type {
  LegislaturaRepository,
  UpsertResult,
} from "@/application/ports/legislatura-repository";
import type { RawPayloadStore } from "@/application/ports/raw-payload-store";

export interface SyncPageResult {
  readonly page: number;
  readonly hasNext: boolean;
  readonly fetched: number;
  readonly written: number;
  readonly unchanged: number;
}

/**
 * Sincroniza UMA página de legislaturas.
 *
 * Por quê por página: quem percorre as páginas é a função Inngest, com um
 * `step.run` por página. O retorno é pequeno e serializável (exigência do
 * Inngest para memoizar o resultado do step) e traz `hasNext` para o laço.
 *
 * Ordem importa: primeiro guarda o bruto (auditoria), depois normaliza.
 * Se a normalização falhar, o bruto já está salvo e o retry reprocessa sem
 * duplicar nada (tudo é idempotente).
 */
export class SyncLegislaturas {
  constructor(
    private readonly gateway: LegislaturaGateway,
    private readonly rawStore: RawPayloadStore,
    private readonly repository: LegislaturaRepository,
  ) {}

  async executePage(
    pagina: number,
    legislaturaId?: number,
  ): Promise<SyncPageResult> {
    const page: Page<LegislaturaDto> = await this.gateway.listLegislaturas({
      pagina,
      ...(legislaturaId === undefined ? {} : { id: legislaturaId }),
    });
    const payloadId: number = await this.rawStore.save(
      page.requestKey,
      page.rawBody,
    );
    if (
      legislaturaId !== undefined &&
      page.items.some((item) => item.id !== legislaturaId)
    ) {
      throw new Error(
        `A API retornou uma legislatura diferente de ${legislaturaId}`,
      );
    }

    const entities: Legislatura[] = page.items.map(mapLegislatura);
    const result: UpsertResult = await this.repository.upsertMany(
      entities,
      payloadId,
    );

    return {
      page: page.page,
      hasNext: page.hasNext,
      fetched: entities.length,
      written: result.written,
      unchanged: result.unchanged,
    };
  }
}
