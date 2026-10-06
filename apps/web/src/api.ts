import type { ApiError } from '@oms/core/types';

export class ApiErrorClass extends Error {
  constructor(public code: string, public message: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Indirection so tests can observe redirects (jsdom cannot navigate). */
export const nav = {
  toLogin: () => {
    window.location.href = '/login';
  },
  /** Full page load (re-runs the app shell's session check). */
  go: (path: string) => {
    window.location.assign(path);
  },
};

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as ApiError | null;
    if (response.status === 401) {
      // Session expired: send the user to the login page. Skip the session probe and the login call
      // itself (and the login page), otherwise /login reloads forever and bad-password errors are lost.
      const isAuthCall = path.startsWith('/v1/me') || path.startsWith('/v1/auth/');
      if (typeof window !== 'undefined' && !isAuthCall && window.location.pathname !== '/login') {
        nav.toLogin();
      }
      throw new ApiErrorClass(errorData?.error.code ?? 'unauthenticated', errorData?.error.message ?? 'Unauthorized');
    }
    if (!errorData) throw new ApiErrorClass('http_' + response.status, response.statusText || 'Request failed');

    throw new ApiErrorClass(
      errorData.error.code,
      errorData.error.message,
      errorData.error.details
    );
  }

  // 204 No Content (e.g. PUT /handover) and other empty bodies.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' });
}

export async function apiPost<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
}

export async function apiPut<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}
