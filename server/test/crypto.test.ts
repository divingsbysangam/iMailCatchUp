import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, FieldCipher, hashPassword, totpAt, verifyPassword, verifyTotp } from "../src/crypto.js";

describe("FieldCipher", () => {
  const cipher = new FieldCipher(randomBytes(32).toString("base64"));

  it("round-trips and uses a fresh IV each time", () => {
    const a = cipher.encrypt("hello ✉️");
    expect(cipher.decrypt(a)).toBe("hello ✉️");
    expect(cipher.encrypt("hello ✉️")).not.toBe(a);
  });

  it("rejects tampered ciphertext", () => {
    const raw = Buffer.from(cipher.encrypt("secret").slice(3), "base64");
    raw[raw.length - 1]! ^= 1;
    expect(() => cipher.decrypt(`v1:${raw.toString("base64")}`)).toThrow();
  });

  it("rejects a different key", () => {
    const other = new FieldCipher(randomBytes(32).toString("base64"));
    expect(() => other.decrypt(cipher.encrypt("x"))).toThrow();
  });
});

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("$");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("TOTP", () => {
  // RFC 6238 Appendix B (SHA-1), last 6 digits.
  const secret = Buffer.from("12345678901234567890");
  it("matches RFC 6238 vectors", () => {
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(secret, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("base32 round-trips", () => {
    const b = randomBytes(20);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });

  it("accepts ±1 step and rejects others", () => {
    const b32 = base32Encode(secret);
    const now = 1111111109 * 1000;
    expect(verifyTotp(b32, "081804", now)).toBe(Math.floor(1111111109 / 30));
    expect(verifyTotp(b32, "081804", now + 30_000)).not.toBeNull();
    expect(verifyTotp(b32, "081804", now + 120_000)).toBeNull();
    expect(verifyTotp(b32, "12345", now)).toBeNull();
  });
});
