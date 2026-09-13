import { describe, expect, it } from "vitest";

import {
  EncryptionError,
  decryptSecret,
  encryptSecret,
  generateMasterKey,
  redact,
  secretsMatch,
} from "./envelope";

const TOKEN = "rhobat_4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f";
const CONTEXT = "connection:f786e66a-c5e4-49d2-9bfa-5a4e8d4a7985";

describe("round trip", () => {
  it("recovers the original secret", () => {
    expect(decryptSecret(encryptSecret(TOKEN, CONTEXT), CONTEXT)).toBe(TOKEN);
  });

  it("handles unicode and empty strings", () => {
    for (const value of ["", "  ", "🔐 sécret ключ"]) {
      expect(decryptSecret(encryptSecret(value, CONTEXT), CONTEXT)).toBe(value);
    }
  });

  it("never emits the plaintext inside the ciphertext", () => {
    const packed = encryptSecret(TOKEN, CONTEXT);
    expect(packed).not.toContain(TOKEN);
    expect(packed).not.toContain("rhobat_");
  });

  it("produces different ciphertext each time, so repeats are not detectable", () => {
    expect(encryptSecret(TOKEN, CONTEXT)).not.toBe(encryptSecret(TOKEN, CONTEXT));
  });

  it("is shaped as a versioned, self-describing string", () => {
    const parts = encryptSecret(TOKEN, CONTEXT).split(".");
    expect(parts).toHaveLength(7);
    expect(parts[0]).toBe("v1");
  });
});

describe("context binding", () => {
  it("refuses to decrypt under a different context", () => {
    // The attack this blocks: lifting a ciphertext from one database row into
    // another to read a token that belongs to a different connection.
    const packed = encryptSecret(TOKEN, "connection:aaa");
    expect(() => decryptSecret(packed, "connection:bbb")).toThrow(EncryptionError);
  });

  it("requires a context at encryption time", () => {
    expect(() => encryptSecret(TOKEN, "")).toThrow(/context is required/);
  });
});

describe("tamper detection", () => {
  it("rejects a modified ciphertext body", () => {
    const parts = encryptSecret(TOKEN, CONTEXT).split(".");
    const body = Buffer.from(parts[6], "base64");
    body[0] ^= 0xff;
    parts[6] = body.toString("base64");
    expect(() => decryptSecret(parts.join("."), CONTEXT)).toThrow(EncryptionError);
  });

  it("rejects a swapped wrapped key", () => {
    const a = encryptSecret(TOKEN, CONTEXT).split(".");
    const b = encryptSecret(TOKEN, CONTEXT).split(".");
    a[1] = b[1];
    expect(() => decryptSecret(a.join("."), CONTEXT)).toThrow(EncryptionError);
  });

  it("rejects a malformed or unknown-version envelope", () => {
    expect(() => decryptSecret("not-an-envelope", CONTEXT)).toThrow(/malformed/);
    expect(() => decryptSecret("v9.a.b.c.d.e.f", CONTEXT)).toThrow(/malformed/);
  });

  it("fails cleanly under the wrong master key", () => {
    const packed = encryptSecret(TOKEN, CONTEXT);
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    try {
      expect(() => decryptSecret(packed, CONTEXT)).toThrow(/master key is wrong/);
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });
});

describe("master key handling", () => {
  it("generates a 32-byte base64 key", () => {
    expect(Buffer.from(generateMasterKey(), "base64")).toHaveLength(32);
  });

  it("explains itself when the key is missing", () => {
    const original = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(() => encryptSecret(TOKEN, CONTEXT)).toThrow(/ENCRYPTION_KEY is not set/);
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });

  it("rejects a key of the wrong length", () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    try {
      expect(() => encryptSecret(TOKEN, CONTEXT)).toThrow(/must decode to 32 bytes/);
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });
});

describe("helpers", () => {
  it("compares secrets without leaking length-independent timing", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
  });

  it("redacts tokens for logs", () => {
    expect(redact(TOKEN)).not.toContain("4f9a8b7c");
    expect(redact(TOKEN)).toMatch(/^rhob…/);
    expect(redact(null)).toBe("(unset)");
    expect(redact("short")).toBe("***");
  });
});
