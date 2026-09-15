import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSingleton } from '../globals';
import {
  hashPassword,
  LoginBodySchema,
  LOGIN_LIMITS,
  PASSWORD_MIN_LENGTH,
  RegisterBodySchema,
  SCRYPT_PARAMS,
  takeAttempt,
  verifyPassword,
} from './password';

afterEach(() => {
  resetSingleton('loginLimiter');
  resetSingleton('signupLimiter');
  resetSingleton('appMetrics');
  vi.unstubAllEnvs();
});

describe('password hashing', () => {
  it('verifies what it hashed and nothing else', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(stored, 'correct horse battery stapl')).toBe(false);
    expect(await verifyPassword(stored, '')).toBe(false);
  });

  it('salts every hash and writes its parameters beside it', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    const parts = a.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(parts.slice(1, 4).map(Number)).toEqual([
      SCRYPT_PARAMS.N,
      SCRYPT_PARAMS.r,
      SCRYPT_PARAMS.p,
    ]);
    expect(Buffer.from(parts[4], 'base64url')).toHaveLength(SCRYPT_PARAMS.saltBytes);
    expect(Buffer.from(parts[5], 'base64url')).toHaveLength(SCRYPT_PARAMS.keyLength);
  });

  it('still verifies a hash made with other parameters', async () => {
    // As if written by an older or a heavier build: the string says how.
    const stored = await hashPassword('a passphrase');
    const [, , r, p, salt, hash] = stored.split('$');
    expect(
      await verifyPassword(['scrypt', SCRYPT_PARAMS.N, r, p, salt, hash].join('$'), 'a passphrase'),
    ).toBe(true);
  });

  it('treats a column with junk in it as a wrong password, never a throw', async () => {
    for (const junk of ['', 'plaintext', 'scrypt$x$y$z$a$b', 'bcrypt$10$abc', 'scrypt$1$1$1$$']) {
      expect(await verifyPassword(junk, 'anything')).toBe(false);
    }
  });
});

describe('what the form may send', () => {
  it('lower-cases and trims the e-mail, and asks for a real one', () => {
    expect(
      LoginBodySchema.parse({ email: '  Ada@Example.com ', password: 'x'.repeat(10) }),
    ).toEqual({
      email: 'ada@example.com',
      password: 'x'.repeat(10),
    });
    expect(LoginBodySchema.safeParse({ email: 'ada', password: 'x'.repeat(10) }).success).toBe(
      false,
    );
    expect(
      LoginBodySchema.safeParse({ email: 'ada@example', password: 'x'.repeat(10) }).success,
    ).toBe(false);
  });

  it('holds the password to its length and nothing else', () => {
    const email = 'ada@example.com';
    expect(
      LoginBodySchema.safeParse({ email, password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) }).success,
    ).toBe(false);
    expect(
      LoginBodySchema.safeParse({ email, password: 'x'.repeat(PASSWORD_MIN_LENGTH) }).success,
    ).toBe(true);
    expect(LoginBodySchema.safeParse({ email, password: 'x'.repeat(201) }).success).toBe(false);
    // No composition rules: a sentence is a fine password.
    expect(LoginBodySchema.safeParse({ email, password: 'una frase larga y fácil' }).success).toBe(
      true,
    );
  });

  it('wants a name to create an account', () => {
    const body = { email: 'ada@example.com', password: 'x'.repeat(10) };
    expect(RegisterBodySchema.safeParse(body).success).toBe(false);
    expect(RegisterBodySchema.safeParse({ ...body, name: '  ' }).success).toBe(false);
    expect(RegisterBodySchema.parse({ ...body, name: ' Ada ' }).name).toBe('Ada');
  });
});

describe('attempts', () => {
  it('lets a burst through and then answers 429 with Retry-After', () => {
    for (let i = 0; i < LOGIN_LIMITS.capacity; i++) takeAttempt('login', 'ip:1.2.3.4');
    let thrown: unknown;
    try {
      takeAttempt('login', 'ip:1.2.3.4');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 429, code: 'rate_limited' });
    expect(
      Number((thrown as { headers: Record<string, string> }).headers['Retry-After']),
    ).toBeGreaterThan(0);
    // Another address, or the sign-up bucket, is not affected.
    expect(() => takeAttempt('login', 'ip:5.6.7.8')).not.toThrow();
    expect(() => takeAttempt('signup', 'ip:1.2.3.4')).not.toThrow();
  });
});
