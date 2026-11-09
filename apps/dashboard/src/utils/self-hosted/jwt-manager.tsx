const JWT_STORAGE_KEY = 'self-hosted-jwt';

export function getJwtToken(): string | null {
  return localStorage.getItem(JWT_STORAGE_KEY);
}

/** Djinn: часть JWT — base64url в UTF-8, а `atob` ждёт base64: кириллица в имени роняла всю панель. */
export function decodeJwtPayload<T = Record<string, any>>(token: string): T {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

  return JSON.parse(new TextDecoder().decode(bytes));
}

export function isJwtValid(token: string | null): boolean {
  if (!token) return false;

  try {
    const payload = decodeJwtPayload(token);
    const expirationTime = payload.exp * 1000; // Convert to milliseconds
    return Date.now() < expirationTime;
  } catch (error) {
    return false;
  }
}
