import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch, apiPost, apiGet, ApiErrorClass } from './api';

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
