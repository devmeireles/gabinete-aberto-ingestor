import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl: string | undefined =
  process.env["DATABASE_URL_DIRECT"] ?? process.env["DATABASE_URL"];

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("Defina DATABASE_URL_DIRECT ou DATABASE_URL para migrations");
}

export default defineConfig({
  schema: "./src/infrastructure/persistence/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
});
