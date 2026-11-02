import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson } from "@/shared/canonical-hash";

describe("canonical content hashing", () => {
  it("ignores object key order at every level and preserves array order and nulls", () => {
    expect(canonicalHash({ b: { z: 1, a: null }, a: [1, 2] })).toBe(
      canonicalHash({ a: [1, 2], b: { a: null, z: 1 } }),
    );
    expect(canonicalJson({ b: undefined, a: null })).toBe('{"a":null}');
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });

  it("changes for non-key business fields and therefore cannot enforce natural-key uniqueness", () => {
    const expense = {
      deputadoId: 1,
      legislaturaId: 57,
      ano: 2025,
      mes: 5,
      codDocumento: "0",
      codLote: 0,
      parcela: 0,
      valorDocumento: 10,
      valorGlosa: 0,
      valorLiquido: 10,
      numDocumento: "doc",
      dataDocumento: null,
      nomeFornecedor: "Supplier",
      urlDocumento: null,
    };
    expect(canonicalHash(expense)).not.toBe(
      canonicalHash({ ...expense, urlDocumento: "https://example.com/doc" }),
    );
    expect(canonicalHash(expense)).not.toBe(
      canonicalHash({ ...expense, nomeFornecedor: "Different supplier" }),
    );
  });
});
