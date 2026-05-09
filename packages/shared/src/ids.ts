import { randomBytes } from "node:crypto";

const UUID_V7_VARIANT = 0b10;

export function uuidv7(now: number = Date.now()): string {
  const ms = BigInt(now);
  const rand = randomBytes(10);

  const bytes = new Uint8Array(16);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  bytes[6] = 0x70 | (rand[0]! & 0x0f);
  bytes[7] = rand[1]!;

  bytes[8] = (UUID_V7_VARIANT << 6) | (rand[2]! & 0x3f);
  for (let i = 9; i < 16; i++) bytes[i] = rand[i - 6]!;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function timestampFromUuidv7(uuid: string): number {
  const hex = uuid.replace(/-/g, "");
  return Number(BigInt("0x" + hex.slice(0, 12)));
}

export const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidv7(value: string): boolean {
  return UUID_V7_REGEX.test(value);
}

export function newId(prefix: string): string {
  return `${prefix}_${uuidv7()}`;
}
