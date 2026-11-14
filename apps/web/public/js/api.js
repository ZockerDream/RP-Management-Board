let token = null;
let refreshing = null;
const listeners = { logout: [] };

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const onLogout = (fn) => listeners.logout.push(fn);
export const hasToken = () => !!token;
export const setToken = (t) => { token = t; };

async function raw(method, path, body, opts = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (opts.headers) Object.assign(headers, opts.headers);
  // cache: 'no-store': nie eine Antwort aus dem Browser-Cache zeigen, immer den aktuellen Stand holen
  return fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
}

export async function refresh() {
  refreshing ||= (async () => {
    try {
      const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return false;
      token = (await r.json()).access_token;
      return true;
    } catch { return false; } finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}

async function request(method, path, body, opts) {
  let r = await raw(method, path, body, opts);
  if (r.status === 401 && !path.startsWith('/auth/') && (await refresh())) r = await raw(method, path, body, opts);
  if (r.status === 401 && !path.startsWith('/auth/')) {
    token = null;
    listeners.logout.forEach((f) => f());
    throw new ApiError(401, 'Sitzung abgelaufen', 'unauthenticated');
  }
  if (opts?.blob) {
    if (!r.ok) throw new ApiError(r.status, 'Download fehlgeschlagen');
    return r.blob();
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new ApiError(r.status, data?.message || `Fehler ${r.status}`, data?.error);
  return data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b ?? {}, o),
  put: (p, b) => request('PUT', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b ?? {}),
  del: (p) => request('DELETE', p),
  // Datei mit Anmeldung laden, z. B. ein Foto (ein <img src="/api/…"> hätte kein Token)
  blob: (p) => request('GET', p, undefined, { blob: true }),
  async download(path, filename) {
    const blob = await request('GET', path, undefined, { blob: true });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
};
