import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config.js";
import type { FieldCipher } from "./crypto.js";
import type { DB } from "./db.js";

/** Shared dependencies passed to every module (keeps things testable, no globals). */
export interface AppContext {
  config: Config;
  db: DB;
  cipher: FieldCipher;
  log: FastifyBaseLogger;
}
