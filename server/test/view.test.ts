import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { randomToken, sha256 } from "../src/crypto.js";
import { openDb } from "../src/db.js";
import { allowedUrl, isPublicAddress, publicLookup } from "../src/imageproxy.js";
import { attachmentList, contentDisposition, downloadType, parseMessage, safeFilename } from "../src/view.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function mime(): Buffer {
  const b64 = (buf: Buffer) => buf.toString("base64");
  return Buffer.from(
    [
      "From: Shop <news@shop.example>",
      "To: me@icloud.com",
      "Subject: Your order",
      "Message-ID: <abc@shop.example>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="MIX"',
      "",
      "--MIX",
      'Content-Type: multipart/related; boundary="REL"',
      "",
      "--REL",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<html><head><style>.x{color:red}</style></head><body><img src="cid:logo@shop"><p class="x">Hi</p></body></html>',
      "--REL",
      "Content-Type: image/png",
      "Content-ID: <logo@shop>",
      "Content-Transfer-Encoding: base64",
      "",
      b64(PNG),
      "--REL--",
      "--MIX",
      'Content-Type: application/pdf; name="invoice.pdf"',
      'Content-Disposition: attachment; filename="invoice.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(Buffer.from("%PDF-1.4 fake")),
      "--MIX--",
      "",
    ].join("\r\n"),
  );
}

describe("parseMessage", () => {
  it("inlines embedded images and lists real attachments", async () => {
    const view = await parseMessage(mime());
    expect(view.html).toContain(`src="data:image/png;base64,${PNG.toString("base64")}"`);
    expect(view.html).not.toContain("cid:");
    expect(view.html).toContain("<style>"); // head styles are kept; the client sanitises
    expect(attachmentList(view)).toEqual([{ index: 0, filename: "invoice.pdf", contentType: "application/pdf", size: 13 }]);
  });
});

describe("download helpers", () => {
  it("cleans filenames and falls back to a generic name", () => {
    expect(safeFilename('../../etc/"passwd"', "text/plain", 0)).toBe("etcpasswd");
    expect(safeFilename(undefined, "image/jpeg", 2)).toBe("attachment-3.jpeg");
    expect(safeFilename("...", undefined, 0)).toBe("attachment-1");
  });

  it("never serves active content types", () => {
    expect(downloadType("application/pdf")).toBe("application/pdf");
    expect(downloadType("text/html")).toBe("application/octet-stream");
    expect(downloadType("image/svg+xml")).toBe("application/octet-stream");
    expect(downloadType(undefined)).toBe("application/octet-stream");
  });

  it("encodes non-ASCII filenames", () => {
    expect(contentDisposition("Rechnung März.pdf")).toBe(
      `attachment; filename="Rechnung M_rz.pdf"; filename*=UTF-8''Rechnung%20M%C3%A4rz.pdf`,
    );
  });
});

describe("image proxy guards", () => {
  it("classifies addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])
      expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["8.8.8.8", "17.253.144.10", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("accepts only public http(s) URLs on default ports", () => {
    expect(allowedUrl("https://cdn.shop.example/logo.png")).not.toBeNull();
    for (const u of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://localhost/x.png",
      "http://127.0.0.1/x.png",
      "http://[::1]/x.png",
      "http://169.254.169.254/latest/meta-data",
      "https://cdn.shop.example:8443/x.png",
      "https://user:pw@cdn.shop.example/x.png",
      "http://intranet/x.png",
    ])
      expect(allowedUrl(u), u).toBeNull();
  });

  it("only connects to public addresses, whatever DNS says", async () => {
    const answer = (addrs: string[]) => (_h: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) =>
      cb(null, addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
    const run = (addrs: string[]) =>
      new Promise<{ err: NodeJS.ErrnoException | null; address: string }>((resolve) =>
        publicLookup(answer(addrs))("img.example", { family: 0 }, (err, address) => resolve({ err, address: address as string })),
      );
    expect((await run(["127.0.0.1"])).err?.code).toBe("EBLOCKED");
    expect((await run(["10.0.0.5", "fd00::2"])).err?.code).toBe("EBLOCKED");
    expect(await run(["10.0.0.5", "93.184.216.34"])).toEqual({ err: null, address: "93.184.216.34" });
  });
});

const ORIGIN = "https://brief.example.com";
const vapid = webpush.generateVAPIDKeys();
const apps: { close: () => Promise<unknown> }[] = [];
afterAll(() => Promise.all(apps.map((a) => a.close())));

describe("routes", () => {
  it("serves the stored copy when iCloud can't be reached, and guards the proxy", async () => {
    const config = loadConfig({
      PUBLIC_ORIGIN: ORIGIN, ICLOUD_EMAIL: "me@icloud.com", ICLOUD_APP_PASSWORD: "x", OPENAI_API_KEY: "x",
      APP_PASSWORD_HASH: "scrypt:x", TOTP_SECRET: "A".repeat(32), DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:a@b.c",
      NODE_ENV: "test", IMAP_HOST: "127.0.0.1", IMAP_PORT: "1",
    });
    const db = openDb(":memory:");
    const { app } = await buildApp({ config, db, logger: false });
    apps.push(app);
    const token = randomToken();
    db.prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)").run(sha256(token), Date.now(), Date.now() + 3600e3);
    const id = Number(
      db.prepare("INSERT INTO messages (mailbox, uid_validity, uid, date, synced_at) VALUES ('INBOX', '7', 1, ?, ?)").run(Date.now(), Date.now())
        .lastInsertRowid,
    );
    const cookie = `imc_session=${token}`;

    const detail = await app.inject({ url: `/api/messages/${id}`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id, attachments: [] });

    expect((await app.inject({ url: "/api/img?u=https%3A%2F%2Fx.example%2Fa.png" })).statusCode).toBe(401);
    const blocked = await app.inject({ url: `/api/img?u=${encodeURIComponent("http://169.254.169.254/")}`, headers: { cookie } });
    expect(blocked.statusCode).toBe(400);

    const dl = await app.inject({ url: `/api/messages/${id}/attachments/0`, headers: { cookie } });
    expect(dl.statusCode).toBe(502); // iCloud unreachable in tests
  });
});
