'use client';

import { getAccessToken } from './api';
import { API_BASE } from './listings';

/**
 * Download an authenticated file. A plain `<a href>` cannot carry the bearer
 * token, so the bytes are fetched and handed to the browser as a blob URL.
 * The filename comes from the server's Content-Disposition when it sends one.
 */
export async function downloadAuthenticated(path: string, fallbackName: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const j = await res.json();
      message = Array.isArray(j.message) ? j.message.join('; ') : (j.message ?? message);
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
