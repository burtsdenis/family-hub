import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
  TOTP (RFC 6238) on bare node:crypto — no dependency for ~60 lines of
  HMAC arithmetic, same reasoning that picked scrypt over argon2.
  Google Authenticator defaults throughout: SHA-1, 6 digits, 30-second
  steps. SHA-1 here is an HMAC key derivation, not a signature — its
  collision weakness is irrelevant to this construction.
*/

const STEP_SECONDS = 30;
const DIGITS = 6;

// RFC 4648 base32 — what authenticator apps expect in the otpauth URI
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 — the size RFC 4226 recommends for SHA-1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP: HMAC over the big-endian counter, dynamic truncation. */
export function hotp(secretBase32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code =
    (((mac[offset]! & 0x7f) << 24) |
      (mac[offset + 1]! << 16) |
      (mac[offset + 2]! << 8) |
      mac[offset + 3]!) %
    10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

/**
 * Accepts the current 30-second step and one step to either side —
 * clock drift on the phone and the human pause between reading and
 * typing the code. One step, not more: every extra step doubles the
 * brute-force window.
 */
export function verifyTotp(secretBase32: string, code: string, now = Date.now()): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const step = Math.floor(now / 1000 / STEP_SECONDS);
  for (const delta of [0, -1, 1]) {
    const expected = hotp(secretBase32, step + delta);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return true;
  }
  return false;
}

/** The otpauth:// URI that authenticator apps read from the QR code. */
export function otpauthUri(email: string, secretBase32: string): string {
  const issuer = encodeURIComponent('Family Hub');
  return `otpauth://totp/${issuer}:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
