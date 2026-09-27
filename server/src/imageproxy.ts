import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Private image proxy for email images (like Apple's Mail Privacy Protection): the server fetches the
 * image, so senders never see the reader's IP address, location or browser.
 *
 * It fetches URLs taken from untrusted email, so it is locked down against SSRF: http(s) on the standard
 * ports only, every hop's DNS answer must be a public address (checked inside the socket's own lookup,
 * so a DNS rebind can't slip in between check and connect), a few redirects at most, image types only,
 * a size cap and a timeout.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

// Separate lists: a BlockList also matches IPv4 addresses against IPv4-mapped IPv6 rules like ::ffff:0:0/96.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked4.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked6.addSubnet(net, prefix, "ipv6");

/** True for addresses on the public internet; false for private, loopback, link-local, etc. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked4.check(ip, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !blocked6.check(ip, "ipv6");
  }
  return false;
}

/** Only absolute http(s) URLs on the default ports, without credentials. */
export function allowedUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) return null;
  if (!host.includes(".") && !isIP(host)) return null; // "localhost", intranet names
  return url;
}

type Resolver = (
  hostname: string,
  options: { all: true; family: number },
  callback: (err: NodeJS.ErrnoException | null, addresses: { address: string; family: number }[]) => void,
) => void;

/** A socket lookup that only ever returns a public address. Exported for tests. */
export const publicLookup = (resolve: Resolver = dnsLookup as unknown as Resolver): LookupFunction => (hostname, options, callback) => {
  const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : (options.family ?? 0);
  resolve(hostname, { all: true, family }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const ok = addresses.find((a) => isPublicAddress(a.address));
    if (!ok) return callback(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }), "", 4);
    if (options.all) return (callback as unknown as (e: null, a: typeof addresses) => void)(null, [ok]);
    callback(null, ok.address, ok.family);
  });
};

export interface ProxiedImage {
  contentType: string;
  body: Buffer;
}

export class ImageProxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const IMAGE_TYPE = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/;

export async function fetchImage(raw: string, redirects = 0): Promise<ProxiedImage> {
  const url = allowedUrl(raw);
  if (!url) throw new ImageProxyError("URL not allowed", 400);
  const mod = url.protocol === "https:" ? https : http;

  return new Promise<ProxiedImage>((resolve, reject) => {
    const req = mod.get(
      url,
      {
        lookup: publicLookup(),
        timeout: TIMEOUT_MS,
        headers: {
          // A plain browser-like request: no cookies, no referrer, nothing about the reader.
          "User-Agent": "Mozilla/5.0 (compatible; SurfaceImageProxy/1.0)",
          Accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new ImageProxyError("Too many redirects", 502));
          return resolve(fetchImage(new URL(res.headers.location, url).toString(), redirects + 1));
        }
        if (status !== 200) {
          res.resume();
          return reject(new ImageProxyError(`Upstream ${status}`, 502));
        }
        const type = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        if (!IMAGE_TYPE.test(type)) {
          res.resume();
          return reject(new ImageProxyError("Not an image", 415));
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_BYTES) {
          res.destroy();
          return reject(new ImageProxyError("Too large", 413));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            reject(new ImageProxyError("Too large", 413));
          } else chunks.push(chunk);
        });
        res.on("end", () => resolve({ contentType: type, body: Buffer.concat(chunks) }));
        res.on("error", (err) => reject(new ImageProxyError(err.message, 502)));
      },
    );
    // `timeout` above covers an idle socket; this caps the whole transfer (a slow drip can't hold it open).
    const deadline = setTimeout(() => req.destroy(new ImageProxyError("Timed out", 504)), TIMEOUT_MS);
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(new ImageProxyError("Timed out", 504)));
    req.on("error", (err) =>
      reject(err instanceof ImageProxyError ? err : new ImageProxyError((err as NodeJS.ErrnoException).code === "EBLOCKED" ? "URL not allowed" : err.message, (err as NodeJS.ErrnoException).code === "EBLOCKED" ? 400 : 502)),
    );
  });
}
