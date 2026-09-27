import type { FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";

/** Header Cloudflare is configured (Transform Rule) to add with CLOUDFLARE_ORIGIN_SECRET. */
export const ORIGIN_AUTH_HEADER = "x-origin-auth";

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
}

/** True when the request carries the secret only our Cloudflare zone adds, i.e. it came through Cloudflare. */
export function viaCloudflare(req: FastifyRequest, config: Config): boolean {
  const secret = config.CLOUDFLARE_ORIGIN_SECRET;
  const got = header(req, ORIGIN_AUTH_HEADER);
  if (!secret || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The real client IP, from headers a client cannot forge. Used for rate limits and logs.
 *
 * Never uses X-Forwarded-For: proxies append to it, so its left-most entry is whatever the client sent.
 * 1. Via Cloudflare (secret header matches): CF-Connecting-IP, which Cloudflare always overwrites.
 * 2. Otherwise CLIENT_IP_HEADER (default X-Real-IP), which Railway's edge sets to the connecting IP.
 *    (Behind Cloudflare without the secret this is a Cloudflare edge IP, which is still not spoofable.)
 * 3. Otherwise the TCP peer address (local development).
 */
export function clientIp(req: FastifyRequest, config: Config): string {
  if (viaCloudflare(req, config)) {
    const cf = header(req, "cf-connecting-ip");
    if (cf) return cf;
  }
  if (config.CLIENT_IP_HEADER) {
    const v = header(req, config.CLIENT_IP_HEADER);
    if (v) return v;
  }
  return req.socket.remoteAddress ?? "unknown";
}
