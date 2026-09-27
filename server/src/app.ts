import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { registerAuth } from "./auth.js";
import { clientIp, viaCloudflare } from "./clientip.js";
import type { Config } from "./config.js";
import { FieldCipher } from "./crypto.js";
import type { DB } from "./db.js";
import type { AppContext } from "./context.js";
import { configurePush } from "./push.js";
import { registerRoutes } from "./routes.js";

export async function buildApp(opts: {
  config: Config;
  db: DB;
  webRoot?: string;
  logger?: boolean;
}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { config, db } = opts;
  const app = Fastify({
    logger: opts.logger ?? true,
    // Not trustProxy: X-Forwarded-For is client-controlled. The client IP comes from clientIp().
    trustProxy: false,
    bodyLimit: 64 * 1024,
  });
  const ctx: AppContext = { config, db, cipher: new FieldCipher(config.DATA_ENCRYPTION_KEY), log: app.log };
  configurePush(ctx);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Email HTML uses inline styles. Scripts stay blocked.
        styleSrc: ["'self'", "'unsafe-inline'"],
        // No remote images: blocks tracking pixels in emails (iframes with srcdoc inherit this policy).
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null,
      },
    },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  if (config.REQUIRE_CLOUDFLARE) {
    // Origin lock: only Cloudflare knows the secret, so direct hits on the Railway address are refused
    // (keeps Cloudflare's country/WAF rules from being bypassed). Railway's health check is exempt.
    app.addHook("onRequest", async (req, reply) => {
      if (req.url === "/healthz" || viaCloudflare(req, config)) return;
      return reply.code(403).send({ error: "Forbidden" });
    });
  }
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => clientIp(req, config),
  });

  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/") && !reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
  });

  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ ok: true }));

  registerAuth(app, ctx);
  registerRoutes(app, ctx);

  if (opts.webRoot && existsSync(opts.webRoot)) {
    await app.register(fastifyStatic, {
      root: opts.webRoot,
      setHeaders(res, path) {
        // Service worker + HTML must always revalidate so updates roll out; hashed assets can be cached.
        if (path.endsWith("sw.js") || path.endsWith(".html") || path.endsWith(".webmanifest")) {
          res.header("Cache-Control", "no-cache");
        } else if (path.includes("/assets/")) {
          res.header("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    });
  }

  return { app, ctx };
}
