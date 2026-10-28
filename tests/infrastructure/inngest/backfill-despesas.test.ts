import { describe, expect, it } from "vitest";
import {
  createDespesasBackfillJobs,
  parseDespesasBackfillRequest,
} from "@/infrastructure/inngest/functions/backfill-despesas.function";

describe("despesas Inngest backfill", () => {
  it("requires a legislature and inclusive month range", () => {
    expect(
      parseDespesasBackfillRequest({
        legislaturaId: 57,
        desde: "2025-01",
        ate: "2025-12",
      }),
    ).toEqual({
      legislaturaId: 57,
      desde: { ano: 2025, mes: 1 },
      ate: { ano: 2025, mes: 12 },
    });
  });

  it("rejects malformed, reversed, and overlong ranges", () => {
    expect(() =>
      parseDespesasBackfillRequest({
        legislaturaId: 57,
        desde: "2025-13",
        ate: "2025-12",
      }),
    ).toThrow("desde contém ano ou mês inválido");
    expect(() =>
      parseDespesasBackfillRequest({
        legislaturaId: 57,
        desde: "2025-02",
        ate: "2025-01",
      }),
    ).toThrow("desde deve ser anterior ou igual a ate");
    expect(() =>
      parseDespesasBackfillRequest({
        legislaturaId: 57,
        desde: "2024-01",
        ate: "2025-01",
      }),
    ).toThrow("no máximo 12 meses");
  });

  it("creates one idempotently identified job per deputy and month", () => {
    const request = parseDespesasBackfillRequest({
      legislaturaId: 57,
      desde: "2025-12",
      ate: "2026-01",
    });
    expect(createDespesasBackfillJobs(request, [10, 20], "run-1")).toEqual([
      {
        legislaturaId: 57,
        deputadoId: 10,
        ano: 2025,
        mes: 12,
        eventId: "despesas-backfill-run-1-10-2025-12",
      },
      {
        legislaturaId: 57,
        deputadoId: 10,
        ano: 2026,
        mes: 1,
        eventId: "despesas-backfill-run-1-10-2026-1",
      },
      {
        legislaturaId: 57,
        deputadoId: 20,
        ano: 2025,
        mes: 12,
        eventId: "despesas-backfill-run-1-20-2025-12",
      },
      {
        legislaturaId: 57,
        deputadoId: 20,
        ano: 2026,
        mes: 1,
        eventId: "despesas-backfill-run-1-20-2026-1",
      },
    ]);
  });
});
