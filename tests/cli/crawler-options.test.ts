import { describe, expect, it } from "vitest";
import { parseBilhetesCsvOptions } from "@/cli/bilhetes-csv";
import { parseDespesaOptions } from "@/cli/despesas";
import { parseCrawlerOptions } from "@/cli/legislaturas";

describe("crawler CLI command separation", () => {
  it("accepts the CSV file only on the dedicated bilhetes-csv command", () => {
    expect(
      parseBilhetesCsvOptions(["--arquivo=assets/Ano-2025.csv", "--persist"]),
    ).toEqual({ filePath: "assets/Ano-2025.csv", persist: true });
    expect(
      parseBilhetesCsvOptions(["--arquivo", "assets/Ano-2025.csv"]),
    ).toEqual({ filePath: "assets/Ano-2025.csv", persist: false });
    expect(() =>
      parseDespesaOptions([
        "--legislatura=57",
        "--deputado=218086",
        "--csv=assets/Ano-2025.csv",
      ]),
    ).toThrow();
  });

  it("rejects conflicting CSV modes", () => {
    expect(() =>
      parseBilhetesCsvOptions([
        "--arquivo=assets/Ano-2025.csv",
        "--persist",
        "--dry-run",
      ]),
    ).toThrow("Escolha apenas um modo");
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
