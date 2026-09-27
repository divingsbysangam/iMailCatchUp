/**
 * Generates every secret the server needs. Run once: `npm run setup`
 * Prints env vars to paste into Railway (or .env for local dev). Nothing is written to disk.
 */
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import webpush from "web-push";
import { base32Encode, hashPassword } from "../crypto.js";

function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const r = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  r._writeToOutput = (s: string) => {
    if (!muted) r.output.write(s);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const password = await askHidden("Choose an app login password (min 12 chars): ");
if (password.length < 12) {
  console.error("Password too short.");
  process.exit(1);
}
const confirm = await askHidden("Repeat password: ");
if (confirm !== password) {
  console.error("Passwords do not match.");
  process.exit(1);
}

const totpSecret = base32Encode(randomBytes(20));
const vapid = webpush.generateVAPIDKeys();
const label = encodeURIComponent("iMailCatchUp");

console.log(`
# ---- Secrets: paste into Railway → Variables (never commit these) ----
APP_PASSWORD_HASH=${await hashPassword(password)}
TOTP_SECRET=${totpSecret}
DATA_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}
VAPID_PUBLIC_KEY=${vapid.publicKey}
VAPID_PRIVATE_KEY=${vapid.privateKey}
# Only if the app sits behind Cloudflare (see README → Cloudflare):
CLOUDFLARE_ORIGIN_SECRET=${randomBytes(32).toString("hex")}

# Add TOTP_SECRET to your authenticator app (Google Authenticator, Aegis, 1Password, ...):
#   "Enter a setup key" → key: ${totpSecret} (time-based)
# or open this URI with the app:
#   otpauth://totp/${label}?secret=${totpSecret}&issuer=${label}&algorithm=SHA1&digits=6&period=30
#
# Back up DATA_ENCRYPTION_KEY somewhere safe: without it, stored mail and briefs can't be decrypted.
`);
