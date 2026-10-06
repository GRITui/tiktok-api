import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch, apiPost, apiGet, ApiErrorClass, nav } from './api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API module', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('apiGet should fetch with GET method', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: 'test' }),
    });

    const result = await apiGet('/v1/orders');
    expect(result).toEqual({ data: 'test' });
    expect(mockFetch).toHaveBeenCalledWith('/v1/orders', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
  });

  it('apiPost should fetch with POST method', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await apiPost('/v1/auth/login', { email: 'test@example.com' });
    expect(result).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledWith('/v1/auth/login', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
  });

  it('should throw ApiErrorClass on 4xx/5xx responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid request',
          details: { field: 'email' },
        },
      }),
    });

    try {
      await apiGet('/v1/test');
      expect.fail('Should have thrown ApiErrorClass');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiErrorClass);
      expect((err as ApiErrorClass).code).toBe('INVALID_REQUEST');
      expect((err as ApiErrorClass).message).toBe('Invalid request');
    }
  });
});

describe('401 handling', () => {
  const unauthorized = (body: unknown) => ({ ok: false, status: 401, json: async () => body });

  beforeEach(() => {
    mockFetch.mockClear();
    window.history.pushState({}, '', '/orders');
  });

  it('does not redirect for the session probe or login call, and keeps the server message', async () => {
    const assign = vi.spyOn(nav, 'toLogin').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce(unauthorized({ error: { code: 'unauthenticated', message: 'Login required' } }));
    await expect(apiGet('/v1/me')).rejects.toMatchObject({ code: 'unauthenticated' });
    mockFetch.mockResolvedValueOnce(unauthorized({ error: { code: 'invalid_credentials', message: 'Invalid email or password' } }));
    await expect(apiPost('/v1/auth/login', {})).rejects.toMatchObject({ message: 'Invalid email or password' });
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it('redirects to /login when another request finds the session expired', async () => {
    const assign = vi.spyOn(nav, 'toLogin').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce(unauthorized({ error: { code: 'unauthenticated', message: 'Login required' } }));
    await expect(apiGet('/v1/orders')).rejects.toBeInstanceOf(ApiErrorClass);
    expect(assign).toHaveBeenCalledTimes(1);
    assign.mockRestore();
  });
});
