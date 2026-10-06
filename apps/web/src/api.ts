import type { ApiError } from '@oms/core/types';

export class ApiErrorClass extends Error {
  constructor(public code: string, public message: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

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
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new ApiErrorClass('UNAUTHORIZED', 'Unauthorized');
    }

    const errorData = (await response.json()) as ApiError;
    throw new ApiErrorClass(
      errorData.error.code,
      errorData.error.message,
      errorData.error.details
    );
  }

  const data = await response.json();
  return data;
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

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}
