import { describe, expect, it } from "vitest";
import { TokenCipher } from "../crypto.js";

const k1 = "11".repeat(32);
const k2 = "22".repeat(32);

describe("TokenCipher", () => {
  it("round-trips and uses random IVs", () => {
    const c = new TokenCipher([k1]);
    const a = c.encrypt("secret-token");
    expect(c.decrypt(a)).toBe("secret-token");
    expect(c.encrypt("secret-token")).not.toBe(a);
  });

  it("decrypts with an older key after rotation", () => {
    const old = new TokenCipher([k1]).encrypt("t");
    expect(new TokenCipher([k2, k1]).decrypt(old)).toBe("t");
  });

  it("rejects tampering and bad keys", () => {
    const c = new TokenCipher([k1]);
    const [id, iv, tag, data] = c.encrypt("t").split(":");
    expect(() => c.decrypt([id, iv, tag, Buffer.from("x").toString("base64") + data].join(":"))).toThrow();
    expect(() => new TokenCipher(["abc"])).toThrow();
    expect(() => TokenCipher.fromEnv("")).toThrow();
  });
});
