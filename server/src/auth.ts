import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { clientIp } from "./clientip.js";
import { randomToken, sha256, verifyPassword, verifyTotp } from "./crypto.js";
import { kvGet, kvSet } from "./db.js";

export function sessionCookieName(secure: boolean): string {
  // __Host- prefix: cookie is bound to this exact host, Secure, path=/ (no subdomain tampering).
  return secure ? "__Host-imc_session" : "imc_session";
}

const LoginBody = z.object({
  password: z.string().min(1).max(512),
  totp: z.string().regex(/^\d{6}$/),
});

export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  const { config, db } = ctx;
  const secure = config.NODE_ENV === "production";
  const cookieName = sessionCookieName(secure);
  const ttlMs = config.SESSION_TTL_HOURS * 3600 * 1000;

  const findSession = (req: FastifyRequest): string | null => {
    const token = req.cookies[cookieName];
    if (!token) return null;
    const hash = sha256(token);
    const row = db.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(hash) as
      | { expires_at: number }
      | undefined;
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return null;
    }
    return hash;
  };

  // CSRF defence in depth (cookie is also SameSite=Strict): state-changing requests must come
  // from our own origin.
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    if (req.headers.origin !== config.PUBLIC_ORIGIN) {
      return reply.code(403).send({ error: "Bad origin" });
    }
  });

  // Everything under /api requires a session except the login endpoint.
  app.addHook("preHandler", async (req, reply) => {
    const path = req.url.split("?")[0]!;
    if (!path.startsWith("/api/") || path === "/api/auth/login") return;
    const hash = findSession(req);
    if (!hash) return reply.code(401).send({ error: "Not signed in" });
  });

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const body = LoginBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "Password and 6-digit code required" });

      const pwOk = await verifyPassword(body.data.password, config.APP_PASSWORD_HASH);
      const step = verifyTotp(config.TOTP_SECRET, body.data.totp);
      const lastStep = Number(kvGet(db, "totp_last_step") ?? "0");
      // Replay protection: a code can be used once.
      const totpOk = step !== null && step > lastStep;

      if (!pwOk || !totpOk) {
        req.log.warn({ ip: clientIp(req, config) }, "failed login");
        return reply.code(401).send({ error: "Invalid credentials" });
      }
      kvSet(db, "totp_last_step", String(step));

      const token = randomToken();
      const now = Date.now();
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
      db.prepare("INSERT INTO sessions (token_hash, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)").run(
        sha256(token),
        now,
        now + ttlMs,
        (req.headers["user-agent"] ?? "").slice(0, 300),
      );
      req.log.info({ ip: clientIp(req, config) }, "login ok");
      return reply
        .setCookie(cookieName, token, {
          httpOnly: true,
          secure,
          sameSite: "strict",
          path: "/",
          maxAge: Math.floor(ttlMs / 1000),
        })
        .send({ ok: true });
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    const hash = findSession(req);
    if (hash) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    return reply.clearCookie(cookieName, { path: "/" }).send({ ok: true });
  });

  /** Sign out every device (e.g. if a phone is lost). */
  app.post("/api/auth/logout-all", async (_req, reply) => {
    db.prepare("DELETE FROM sessions").run();
    return reply.clearCookie(cookieName, { path: "/" }).send({ ok: true });
  });

  app.get("/api/auth/me", async () => ({ ok: true, email: config.ICLOUD_EMAIL }));
}

