import { z } from "zod";
import {
  encryptedNotePayloadSchema,
  type EncryptedNotePayload,
} from "./notes.schemas";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AAD = encoder.encode("ciphernote:v1");

export type VaultConfig = {
  version: 1;
  kdf: {
    algorithm: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  verifier: EncryptedEnvelope;
};

type EncryptedEnvelope = { version: 1; iv: string; ciphertext: string };

const vaultConfigSchema = z.object({
  version: z.literal(1),
  kdf: z.object({
    algorithm: z.literal("PBKDF2"),
    hash: z.literal("SHA-256"),
    iterations: z.number().int().min(100_000).max(2_000_000),
    salt: z.string().min(1),
  }),
  verifier: z.object({
    version: z.literal(1),
    iv: z.string().min(1),
    ciphertext: z.string().min(1),
  }),
});

export function parseVaultConfig(value: string): VaultConfig {
  return vaultConfigSchema.parse(JSON.parse(value));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function deriveVaultKey(password: string, config: VaultConfig) {
  const passwordMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: config.kdf.hash,
      iterations: config.kdf.iterations,
      salt: base64ToBytes(config.kdf.salt),
    },
    passwordMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptText(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD },
    key,
    encoder.encode(plaintext),
  );
  return {
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptText(key: CryptoKey, envelope: EncryptedEnvelope) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData: AAD },
    key,
    base64ToBytes(envelope.ciphertext),
  );
  return decoder.decode(plaintext);
}

export async function createVaultConfig(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const config: VaultConfig = {
    version: 1,
    kdf: {
      algorithm: "PBKDF2",
      hash: "SHA-256",
      iterations: 600_000,
      salt: bytesToBase64(salt),
    },
    verifier: { version: 1, iv: "", ciphertext: "" },
  };
  const key = await deriveVaultKey(password, config);
  config.verifier = await encryptText(key, "ciphernote:vault-verifier");
  return { config, key };
}

export async function verifyVaultKey(key: CryptoKey, config: VaultConfig) {
  try {
    return (
      (await decryptText(key, config.verifier)) === "ciphernote:vault-verifier"
    );
  } catch {
    return false;
  }
}

export async function encryptNote(key: CryptoKey, note: EncryptedNotePayload) {
  return JSON.stringify(await encryptText(key, JSON.stringify(note)));
}

export async function decryptNote(key: CryptoKey, value: string) {
  const envelope = JSON.parse(value) as EncryptedEnvelope;
  return encryptedNotePayloadSchema.parse(
    JSON.parse(await decryptText(key, envelope)),
  );
}

export async function encryptAttachment(key: CryptoKey, value: string) {
  return JSON.stringify(await encryptText(key, value));
}

export async function decryptAttachment(key: CryptoKey, value: string) {
  return decryptText(key, JSON.parse(value) as EncryptedEnvelope);
}
