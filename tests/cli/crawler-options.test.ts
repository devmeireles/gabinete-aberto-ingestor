import { describe, expect, it } from "vitest";
import { parseDespesaOptions } from "@/cli/despesas";
import { parseCrawlerOptions } from "@/cli/legislaturas";

describe("crawler CLI command separation", () => {
  it("does not accept CSV imports through the despesas command", () => {
    expect(() =>
      parseDespesaOptions([
        "--legislatura=57",
        "--deputado=218086",
        "--csv=assets/Ano-2025.csv",
      ]),
    ).toThrow();
  });

  it("keeps legislatura persistence exclusive to the Inngest seed", () => {
    expect(() => parseCrawlerOptions(["--persist"])).toThrow(
      "camara/legislaturas.seed",
    );
    expect(parseCrawlerOptions(["--legislatura=57", "--pages=1"])).toEqual({
      legislaturaId: 57,
      pageLimit: 1,
    });
  });
});
