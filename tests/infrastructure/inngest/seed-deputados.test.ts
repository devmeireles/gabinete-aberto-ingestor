import { describe, expect, it } from "vitest";
import {
  createProfileSeedEvents,
  parseSeedLegislaturaId,
} from "@/infrastructure/inngest/functions/seed-deputados.function";
import {
  parseSeedDeputadoId,
  selectDeputadoIds,
} from "@/infrastructure/inngest/functions/seed-perfis-deputados.function";

describe("deputados seed payload", () => {
  it("accepts a positive integer legislature id", () => {
    expect(parseSeedLegislaturaId(57)).toBe(57);
  });

  describe("deputado profile seed payload", () => {
    it("accepts all profiles or one specific deputy profile", () => {
      expect(parseSeedDeputadoId(undefined)).toBeUndefined();
      expect(parseSeedDeputadoId(218086)).toBe(218086);
    });

    it("rejects missing and malformed deputy ids", () => {
      for (const value of [null, "218086", 0, -1, 1.5]) {
        expect(() => parseSeedDeputadoId(value)).toThrow(
          "deputadoId como inteiro positivo",
        );
      }
    });

    it("selects all registered deputies or only the requested one", () => {
      expect(selectDeputadoIds(undefined, [100, 101, 102])).toEqual([
        100, 101, 102,
      ]);
      expect(selectDeputadoIds(218086, [])).toEqual([218086]);
      expect(() => selectDeputadoIds(undefined, [])).toThrow(
        "Execute camara/deputados.seed",
      );
    });
  });

  it("rejects missing and malformed legislature ids", () => {
    for (const value of [undefined, null, "57", 0, -1, 1.5]) {
      expect(() => parseSeedLegislaturaId(value)).toThrow(
        "legislaturaId como inteiro positivo",
      );
    }
  });

  it("creates one profile event per deputy id", () => {
    expect(createProfileSeedEvents([218086, 218087])).toEqual([
      {
        name: "camara/deputados.perfil.seed",
        data: { deputadoId: 218086 },
      },
      {
        name: "camara/deputados.perfil.seed",
        data: { deputadoId: 218087 },
      },
    ]);
  });
});
