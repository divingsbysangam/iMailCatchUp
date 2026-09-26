import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { startScheduler } from "./scheduler.js";

const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL("../../web/dist", import.meta.url));

const { app, ctx } = await buildApp({ config, db, webRoot });
const stopScheduler = startScheduler(ctx);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  stopScheduler();
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
