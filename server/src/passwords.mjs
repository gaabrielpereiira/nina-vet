import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { ApiError } from './errors.mjs';

const scrypt = promisify(scryptCallback);
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const dummyHash = `scrypt$131072$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;
const format = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
// Public synthetic placeholder, never a user credential.
const dummyBcryptHash = '$2b$10$Uk5Hxv2Rvc8wcMN/Mri.veNpBF5aNsWg2Api/T/4esImZz6O7JiPi';
// All four password hashes in the inspected backup use cost 10.
// Reject other costs instead of permitting unbounded work from imported hashes.
const legacyFormat = /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/;

export function isSupportedLegacyPasswordHash(encoded) {
  return typeof encoded === 'string' && legacyFormat.test(encoded);
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 1024) {
    throw new Error('Password must contain at least 12 characters and at most 1024 bytes');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64, options);
  return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}

export function createPasswordHasher(maxConcurrent = 2) {
  let active = 0;
  return async password => {
    if (active >= maxConcurrent) throw new ApiError(429, 'AUTH_BUSY', 'Tente novamente em instantes.', 1);
    active += 1;
    try { return await hashPassword(password); }
    finally { active -= 1; }
  };
}

// Bound expensive hashing work even if an attacker cycles through email addresses.
export function createPasswordVerifier(maxConcurrent = 2) {
  let active = 0;
  return async function verify(password, encoded) {
    if (active >= maxConcurrent) throw new ApiError(429, 'AUTH_BUSY', 'Tente novamente em instantes.', 1);
    active += 1;
    try {
      const validFormat = typeof encoded === 'string' && format.test(encoded);
      const match = (validFormat ? encoded : dummyHash).match(format);
      const key = await scrypt(password, Buffer.from(match[1], 'hex'), 64, options);
      const nativeVerified = timingSafeEqual(key, Buffer.from(match[2], 'hex')) && validFormat;
      const legacyFormatValid = isSupportedLegacyPasswordHash(encoded);
      // Both computations run for native, legacy and unknown accounts. A faster
      // legacy hash must not become a shortcut for discovering registered emails.
      const legacyVerified = await bcrypt.compare(password, legacyFormatValid ? encoded : dummyBcryptHash);
      return nativeVerified || (legacyFormatValid && Buffer.byteLength(password) <= 72 && legacyVerified);
    } finally {
      active -= 1;
    }
  };
}
