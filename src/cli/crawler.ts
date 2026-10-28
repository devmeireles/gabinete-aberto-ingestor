import { runDeputados } from "./deputados";
import { runDespesas } from "./despesas";
import { runLegislaturas } from "./legislaturas";

type CrawlerModule = "legislaturas" | "deputados" | "despesas";

async function main(): Promise<void> {
  const [moduleName, ...args] = process.argv.slice(2);
  if (
    moduleName !== "legislaturas" &&
    moduleName !== "deputados" &&
    moduleName !== "despesas"
  ) {
    throw new Error(
      "Informe o módulo: legislaturas, deputados ou despesas. Ex.: npm run crawler -- despesas --legislatura=57 --deputado=220593",
    );
  }

  const crawlerModule: CrawlerModule = moduleName;
  if (crawlerModule === "legislaturas") {
    await runLegislaturas(args);
  } else if (crawlerModule === "deputados") {
    await runDeputados(args);
  } else {
    await runDespesas(args);
  }
}

main().catch((error: unknown) => {
  const message: string =
    error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "crawler.failed", message }));
  process.exitCode = 1;
});
