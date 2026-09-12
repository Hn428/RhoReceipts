/**
 * Envelope encryption for stored credentials.
 *
 * A Rho access token is read-only, which makes it sound harmless. It is not: it
 * grants the complete financial history of a company. Treat a leak as fatal.
 *
 * Envelope rather than direct encryption, for two reasons that matter later:
 * rotating the master key only requires re-wrapping short data keys rather than
 * re-encrypting every secret, and the wrap step is the seam where a real KMS
 * drops in without touching call sites.
 *
 * Each secret gets:
 *   - a fresh 256-bit data key (DEK), used once, for AES-256-GCM
 *   - that DEK wrapped by the master key (KEK) with its own nonce
 *   - an AAD binding the ciphertext to its context (e.g. a connection id), so a
 *     ciphertext lifted from one database row cannot be replayed into another
 */

import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

/** Generates a master key. Run once, store as ENCRYPTION_KEY, never commit. */
export const generateMasterKey = (): string =>
  randomBytes(KEY_BYTES).toString("base64");

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new EncryptionError(
      "ENCRYPTION_KEY is not set. Generate one with:\n" +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new EncryptionError(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

/**
 * Encrypts a secret, returning a single self-describing string safe to store in
 * a text column.
 *
 * `context` is authenticated but not encrypted: decryption fails unless the
 * same context is supplied, which binds the ciphertext to where it lives.
 */
export function encryptSecret(plaintext: string, context: string): string {
  if (!context) {
    throw new EncryptionError("An encryption context is required.");
  }
  const kek = masterKey();
  const dek = randomBytes(KEY_BYTES);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const wrapIv = randomBytes(IV_BYTES);
  const wrapper = createCipheriv(ALGORITHM, kek, wrapIv);
  wrapper.setAAD(Buffer.from(context, "utf8"));
  const wrappedKey = Buffer.concat([wrapper.update(dek), wrapper.final()]);
  const wrapTag = wrapper.getAuthTag();

  dek.fill(0);

  return [
    VERSION,
    wrappedKey.toString("base64"),
    wrapIv.toString("base64"),
    wrapTag.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(packed: string, context: string): string {
  const parts = packed.split(".");
  if (parts.length !== 7 || parts[0] !== VERSION) {
    throw new EncryptionError(
      "Ciphertext is malformed or was written by an unsupported version.",
    );
  }
  const [, wrappedKey, wrapIv, wrapTag, iv, tag, ciphertext] = parts.map(
    (part, index) => (index === 0 ? part : Buffer.from(part, "base64")),
  ) as [string, Buffer, Buffer, Buffer, Buffer, Buffer, Buffer];

  const kek = masterKey();
  const aad = Buffer.from(context, "utf8");

  let dek: Buffer;
  try {
    const unwrapper = createDecipheriv(ALGORITHM, kek, wrapIv);
    unwrapper.setAAD(aad);
    unwrapper.setAuthTag(wrapTag);
    dek = Buffer.concat([unwrapper.update(wrappedKey), unwrapper.final()]);
  } catch {
    throw new EncryptionError(
      "Could not unwrap the data key. The master key is wrong, the context " +
        "does not match, or the ciphertext was tampered with.",
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, dek, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new EncryptionError("Could not decrypt the secret.");
  } finally {
    dek.fill(0);
  }
}

/** Constant-time comparison, for verifying tokens without leaking timing. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** For logs and error messages. Never print a token; print this instead. */
export function redact(secret: string | null | undefined): string {
  if (!secret) return "(unset)";
  if (secret.length <= 8) return "***";
  return `${secret.slice(0, 4)}…${secret.slice(-2)} (${secret.length} chars)`;
}
