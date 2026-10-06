import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LoginPage } from './Login';
import * as api from '../api';

vi.mock('../api');
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

const mockApiPost = vi.mocked(api.apiPost);

describe('LoginPage', () => {
  beforeEach(() => {
    mockApiPost.mockClear();
  });

  it('should render login form', () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('should submit login form with email and password', async () => {
    mockApiPost.mockResolvedValueOnce({
      id: 'user123',
      email: 'test@example.com',
      name: 'Test User',
      role: 'ops',
    });

    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const submitButton = screen.getByText('Login');

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/v1/auth/login', {
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });

  it('should display error message on login failure', async () => {
    const error = new Error('Invalid credentials');
    error.name = 'ApiError';
    (error as any).code = 'INVALID_CREDENTIALS';
    (error as any).message = 'Invalid credentials';

    mockApiPost.mockRejectedValueOnce(error);

    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const submitButton = screen.getByText('Login');

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('should disable form while logging in', async () => {
    let resolveLogin: any;
    mockApiPost.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );

    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const submitButton = screen.getByText('Login');

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(emailInput).toBeDisabled();
      expect(passwordInput).toBeDisabled();
      expect(submitButton).toBeDisabled();
      expect(screen.getByText('Logging in...')).toBeInTheDocument();
    });

    resolveLogin({
      id: 'user123',
      email: 'test@example.com',
      name: 'Test User',
      role: 'ops',
    });
  });
});
