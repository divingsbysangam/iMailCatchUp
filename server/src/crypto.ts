import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

// ---------- Field encryption (AES-256-GCM) ----------

export class FieldCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes");
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
  }

  decrypt(payload: string): string {
    if (!payload.startsWith("v1:")) throw new Error("Unknown ciphertext version");
    const raw = Buffer.from(payload.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }

  encryptNullable(v: string | null | undefined): string | null {
    return v == null ? null : this.encrypt(v);
  }

  decryptNullable(v: string | null | undefined): string | null {
    return v == null ? null : this.decrypt(v);
  }
}

// ---------- Password hashing (scrypt) ----------
// Format: scrypt:N:r:p:<salt b64url>:<hash b64url>  (no "$" so it survives .env / dashboards)

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 64 };

function scryptAsync(pw: string, salt: Buffer, N: number, r: number, p: number, len: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(pw, salt, len, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLen);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scryptAsync(
    password,
    Buffer.from(saltB64, "base64url"),
    Number(n),
    Number(r),
    Number(p),
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}

// ---------- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ----------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export function currentTotpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / 30);
}

/** Returns the matching time step (for replay protection) or null. Accepts ±1 step of clock drift. */
export function verifyTotp(base32Secret: string, token: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(token)) return null;
  const secret = base32Decode(base32Secret);
  const now = currentTotpStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(token))) return step;
  }
  return null;
}

// ---------- Misc ----------

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
