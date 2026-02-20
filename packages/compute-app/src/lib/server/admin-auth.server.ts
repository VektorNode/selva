import { createHmac, randomBytes } from 'crypto';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

interface SessionData {
  token: string;
  timestamp: number;
}

/**
 * Creates an HMAC signature for the session token
 */
function signToken(token: string): string {
  const adminSecret = env.ADMIN_SECRET;
  if (!adminSecret) {
    throw new Error('ADMIN_SECRET not configured');
  }
  return createHmac('sha256', adminSecret).update(token).digest('hex');
}

/**
 * Verifies the session cookie and returns true if valid
 */
export function verifySession(cookies: Cookies): boolean {
  const sessionValue = cookies.get(SESSION_COOKIE_NAME);
  if (!sessionValue) {
    return false;
  }

  try {
    const sessionData: SessionData = JSON.parse(sessionValue);
    const expectedSignature = signToken(sessionData.token);

    // Verify signature matches
    const adminSecret = env.ADMIN_SECRET;
    if (!adminSecret) return false;

    const actualSignature = createHmac('sha256', adminSecret)
      .update(sessionData.token)
      .digest('hex');

    if (actualSignature !== expectedSignature) {
      return false;
    }

    // Check if session hasn't expired
    const now = Date.now();
    const age = (now - sessionData.timestamp) / 1000;

    return age < SESSION_MAX_AGE;
  } catch {
    return false;
  }
}

/**
 * Creates a new session cookie after successful authentication
 */
export function createSession(cookies: Cookies): void {
  const token = randomBytes(32).toString('hex');

  const sessionData: SessionData = {
    token: token,
    timestamp: Date.now()
  };

  cookies.set(SESSION_COOKIE_NAME, JSON.stringify(sessionData), {
    path: '/admin',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE
  });
}

/**
 * Destroys the session cookie
 */
export function destroySession(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE_NAME, {
    path: '/admin'
  });
}

/**
 * Verifies the provided password against the environment variable
 */
export function verifyPassword(password: string): boolean {
  const adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD not set in environment');
    return false;
  }
  return password === adminPassword;
}
