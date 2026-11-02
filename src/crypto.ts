import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Encrypts secrets at rest with AES-256-GCM. On Umbrel the key is derived from
 * APP_SEED, which umbrelOS gives each app and keeps outside the app's data
 * folder. Outside Umbrel a random key file is created in the data folder.
 */
export class SecretBox {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error("SecretBox key must be 32 bytes");
    this.#key = key;
  }

  static fromEnvironment(dataDir: string, appSeed = process.env.APP_SEED): SecretBox {
    if (appSeed && appSeed.length >= 16) {
      return new SecretBox(createHash("sha256").update(`rainmaker-secrets:${appSeed}`).digest());
    }
    const keyFile = join(dataDir, "secret.key");
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
    return new SecretBox(Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64"));
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, body] = sealed.split(":");
    if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("Unrecognized secret format");
    const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  }
}

/** Replaces every secret value in `text` with a fixed mask. Short values are skipped to avoid mangling output. */
export function maskSecrets(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const value of secrets) {
    if (!value || value.length < 6) continue;
    out = out.split(value).join("••••••");
  }
  return out;
}
