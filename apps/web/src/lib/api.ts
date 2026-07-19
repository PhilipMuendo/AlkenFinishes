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

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  setTokens(data.accessToken, data.refreshToken);
  return true;
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
