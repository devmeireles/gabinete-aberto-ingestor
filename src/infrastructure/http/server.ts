import express, { type Express, type Request, type Response } from "express";
import { serve } from "inngest/express";
import { inngest } from "@/infrastructure/inngest/client";

type InngestFunctions = NonNullable<Parameters<typeof serve>[0]["functions"]>;

/**
 * ADAPTER HTTP. Duas responsabilidades:
 *  - /healthz: liveness para o Cloud Run (não consulta o banco de propósito:
 *    um banco lento não deve fazer o Cloud Run matar o container);
 *  - /api/inngest: onde o Inngest Cloud chama as funções. Cada chamada é
 *    validada pela signing key.
 */
export function createApp(functions: InngestFunctions): Express {
  const app: Express = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_req: Request, res: Response): void => {
    res.status(200).json({ status: "ok" });
  });

  // Obrigatório para o adapter do Inngest ler o corpo JSON dos POSTs.
  app.use(express.json({ limit: "4mb" }));
  app.use("/api/inngest", serve({ client: inngest, functions }));

  return app;
}
