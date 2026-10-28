import { describe, expect, it } from "vitest";
import {
  createPartidoProfileSeedEvents,
  parseSeedPartidosLegislaturaId,
} from "@/infrastructure/inngest/functions/seed-partidos.function";
import {
  parseSeedPartidoId,
  selectPartidoIds,
} from "@/infrastructure/inngest/functions/seed-perfis-partidos.function";
import { loadEnv } from "@/config/env";

describe("party seed payloads and event creation", () => {
  it("requires the event key in production", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/app",
        INNGEST_SIGNING_KEY: "signing-key",
      }),
    ).toThrow("Variável de ambiente obrigatória ausente: INNGEST_EVENT_KEY");
  });

  it("requires a positive legislature id", () => {
    expect(parseSeedPartidosLegislaturaId(57)).toBe(57);
    for (const value of [undefined, null, "57", 0, -1, 1.5]) {
      expect(() => parseSeedPartidosLegislaturaId(value)).toThrow(
        "legislaturaId como inteiro positivo",
      );
    }
  });

  it("allows all profiles or one specific party profile", () => {
    expect(parseSeedPartidoId(undefined)).toBeUndefined();
    expect(parseSeedPartidoId(37906)).toBe(37906);
    for (const value of [null, "37906", 0, -1, 1.5]) {
      expect(() => parseSeedPartidoId(value)).toThrow(
        "partidoId como inteiro positivo",
      );
    }
  });

  it("selects all registered parties in order or just the requested one", () => {
    expect(selectPartidoIds(undefined, [36898, 37906, 38011])).toEqual([
      36898, 37906, 38011,
    ]);
    expect(selectPartidoIds(37906, [])).toEqual([37906]);
    expect(() => selectPartidoIds(undefined, [])).toThrow(
      "Execute camara/partidos.seed",
    );
  });

  it("creates an individual profile event for every party", () => {
    expect(createPartidoProfileSeedEvents([37906, 37907])).toEqual([
      {
        name: "camara/partidos.perfil.seed",
        data: { partidoId: 37906 },
      },
      {
        name: "camara/partidos.perfil.seed",
        data: { partidoId: 37907 },
      },
    ]);
  });
});
