import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM token encryption (#11).
 * Ciphertext format: `<keyId>:<iv b64>:<tag b64>:<data b64>`. `keyId` is the first 8 hex chars of
 * sha256(key), so several keys can be configured during rotation.
 */
export class TokenCipher {
  private readonly keys = new Map<string, Buffer>();
  private readonly primaryId: string;

  /** @param hexKeys 32-byte keys as 64-char hex. The first is used for encryption; all can decrypt. */
  constructor(hexKeys: string[]) {
    if (hexKeys.length === 0) throw new Error("TOKEN_ENCRYPTION_KEY is required");
    for (const hex of hexKeys) {
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
      const key = Buffer.from(hex, "hex");
      this.keys.set(keyId(key), key);
    }
    this.primaryId = keyId(Buffer.from(hexKeys[0]!, "hex"));
  }

  /** Accepts a comma-separated list, primary first. */
  static fromEnv(value: string | undefined): TokenCipher {
    return new TokenCipher((value ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  }

  encrypt(plaintext: string): string {
    const key = this.keys.get(this.primaryId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [this.primaryId, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const [id, iv, tag, data] = payload.split(":");
    const key = id ? this.keys.get(id) : undefined;
    if (!key || !iv || !tag || data === undefined) throw new Error("Unknown key or malformed ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  }
}

function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
