import { describe, expect, it, vi } from "vitest";
import { PrepareDeputadosPage } from "@/application/use-cases/prepare-deputados-page";
import type { DeputadoGateway } from "@/application/ports/camara-gateway/deputados";
import type { Page } from "@/application/ports/camara-gateway/page";

const deputado = {
  id: 100,
  idLegislatura: 57,
  nome: "Deputado Teste",
  siglaPartido: "ABC",
  siglaUf: "DF",
  uri: "https://dadosabertos.camara.leg.br/api/v2/deputados/100",
  uriPartido: "https://dadosabertos.camara.leg.br/api/v2/partidos/10",
  urlFoto: "https://example.test/100.jpg",
  email: null,
};

function page<T>(items: readonly T[], requestKey: string): Page<T> {
  return {
    items,
    page: 1,
    hasNext: false,
    requestKey,
    rawBody: { dados: items, links: [] },
  };
}

describe("PrepareDeputadosPage history progress", () => {
  it("reports history request totals and completed records", async () => {
    const gateway: DeputadoGateway = {
      listDeputados: vi.fn(async () => page([deputado], "/deputados")),
      getDeputadoHistorico: vi.fn(async () =>
        page([], "/deputados/100/historico"),
      ),
    };
    const onProgress = vi.fn();

    await new PrepareDeputadosPage(gateway).execute(
      57,
      1,
      new Map(),
      new Set(),
      onProgress,
    );

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      stage: "started",
      completed: 0,
      total: 1,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      stage: "completed",
      completed: 1,
      total: 1,
      deputadoId: 100,
    });
  });

  it("reports the failing deputy and rethrows history errors", async () => {
    const historyError = new Error("API indisponível");
    const gateway: DeputadoGateway = {
      listDeputados: vi.fn(async () => page([deputado], "/deputados")),
      getDeputadoHistorico: vi.fn(async () => {
        throw historyError;
      }),
    };
    const onProgress = vi.fn();

    await expect(
      new PrepareDeputadosPage(gateway).execute(
        57,
        1,
        new Map(),
        new Set(),
        onProgress,
      ),
    ).rejects.toBe(historyError);

    expect(onProgress).toHaveBeenLastCalledWith({
      stage: "failed",
      completed: 0,
      total: 1,
      deputadoId: 100,
      error: historyError,
    });
  });
});
