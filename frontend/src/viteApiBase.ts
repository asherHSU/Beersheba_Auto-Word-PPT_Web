/**
 * API 基底路徑。
 * - 開發：`npm run dev` 一律走同源 `/api`，由 Vite proxy 轉到後端 3000（勿依賴 .env 直連 127.0.0.1:3000，否則會與 5173 不同源或 POST 失敗）。
 * - 正式：空字串走 `/api`（Docker nginx 同源）；若 .env 指本機 3000 但頁面在 8080 等，改走 `/api`。
 */
function pointsToLocalhostPort3000(raw: string): boolean {
  const base = raw.replace(/\/+$/, '').replace(/\/api\/?$/, '');
  try {
    const u = new URL(base.startsWith('http') ? base : `http://${base}`);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    const host = u.hostname.toLowerCase();
    return (host === 'localhost' || host === '127.0.0.1') && port === '3000';
  } catch {
    return false;
  }
}

export function viteApiBase(): string {
  if (import.meta.env.DEV) {
    return '/api';
  }

  const raw = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '/api';

  const withApi = raw.endsWith('/api') ? raw : `${raw}/api`;

  if (typeof window !== 'undefined' && pointsToLocalhostPort3000(raw)) {
    const viewPort =
      window.location.port ||
      (window.location.protocol === 'https:' ? '443' : '80');
    if (viewPort !== '3000') {
      return '/api';
    }
  }

  return withApi;
}

/** 例如 apiUrl('/login') → '/api/login'（或帶完整 API 網址時接上） */
export function apiUrl(path: string): string {
  const base = viteApiBase().replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}
