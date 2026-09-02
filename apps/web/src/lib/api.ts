const BASE = '/api/v1';

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');
let onLogout: () => void = () => {};

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem('accessToken', access);
  else localStorage.removeItem('accessToken');
  if (refresh) localStorage.setItem('refreshToken', refresh);
  else localStorage.removeItem('refreshToken');
}

export function setLogoutHandler(fn: () => void) {
  onLogout = fn;
}

export function getRefreshToken() {
  return refreshToken;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * The message to show when a mutation fails.
 *
 * The API's own wording is nearly always the more useful of the two — it knows
 * the bill was already settled, or that the claim went backwards. `fallback` is
 * for the cases where the request never reached it at all, and should say what
 * did not happen rather than "Error".
 */
export function errText(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError && error.message ? error.message : fallback;
}

/**
 * At most one refresh in flight at a time.
 *
 * The server ROTATES refresh tokens: each call to /auth/refresh revokes the
 * one it was given and issues a new one. Any page that fires more than one
 * request in parallel — which is most of them — gets more than one 401 the
 * moment the 15-minute access token expires, and without this guard each of
 * those calls `tryRefresh()` independently with the SAME (still-unrotated)
 * refreshToken. The first reaches the server and rotates it; every other
 * concurrent call then presents that now-revoked token, which the server
 * reads as token theft and revokes EVERY refresh token for the user as a
 * precaution — including the brand new one the first call just received.
 * The user is logged out mid-session despite having done nothing wrong.
 * Sharing one in-flight promise across concurrent callers is what stops
 * that: only one request ever reaches /auth/refresh per expiry.
 */
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        setTokens(data.accessToken, data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; formData?: FormData } = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  });
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return api<T>(path, options, true);
    setTokens(null, null);
    onLogout();
    throw new ApiRequestError(401, 'Session expired');
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiRequestError(res.status, payload.error ?? 'Request failed', payload.details);
  }
  return res.json() as Promise<T>;
}
