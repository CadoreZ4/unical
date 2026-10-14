import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// 飞书 access/refresh token 落库前加密。AES-256-GCM：机密性 + 完整性。
// 密钥取 ENCRYPTION_KEY；未设置时仅在非生产环境用固定开发兜底（并告警），生产必须配置。

const ALGO = "aes-256-gcm";
const PREFIX = "v1"; // 密文版本，便于将来换算法
const DEV_FALLBACK = "unical-dev-only-do-not-use-in-production";

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("生产环境必须配置 ENCRYPTION_KEY");
    }
    if (!(globalThis as any).__unical_enc_warned__) {
      console.warn(
        "[security] 未设置 ENCRYPTION_KEY，使用开发兜底密钥；重启后已加密的飞书 token 将无法解密，生产环境务必配置。"
      );
      (globalThis as any).__unical_enc_warned__ = true;
    }
  }
  // scrypt 把任意长度口令派生为 32 字节密钥；盐固定即可（这不是口令哈希，用途是对称密钥派生）
  return scryptSync(secret || DEV_FALLBACK, "unical-token-at-rest", 32);
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("无法识别的密文格式");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
