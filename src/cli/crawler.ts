import { runDeputados } from "./deputados";
import { runLegislaturas } from "./legislaturas";

type CrawlerModule = "legislaturas" | "deputados";

async function main(): Promise<void> {
  const [moduleName, ...args] = process.argv.slice(2);
  if (moduleName !== "legislaturas" && moduleName !== "deputados") {
    throw new Error(
      "Informe o módulo: legislaturas ou deputados. Ex.: npm run crawler -- deputados --legislatura=57",
    );
  }

  const crawlerModule: CrawlerModule = moduleName;
  if (crawlerModule === "legislaturas") {
    await runLegislaturas(args);
  } else {
    await runDeputados(args);
  }
}

main().catch((error: unknown) => {
  const message: string =
    error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "crawler.failed", message }));
  process.exitCode = 1;
});
