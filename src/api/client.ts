import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { z } from 'zod';
import { runtimeFlags } from '@/app/runtimeFlags';
import { apiErrorSchema } from './contracts';

const DEFAULT_TIMEOUT_MS = 4000;

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';
export const API_TIMEOUT_MS: number =
  runtimeFlags.apiTimeoutMs ?? (Number(import.meta.env.VITE_API_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
});

export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'invalid-response' | 'cancelled';

/** Normalised error for everything the HTTP layer can throw. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Transient failures worth retrying automatically. */
  get retryable(): boolean {
    if (this.kind === 'timeout' || this.kind === 'network') return true;
    if (this.kind === 'http' && this.status !== undefined) return this.status >= 500 || this.status === 408 || this.status === 429;
    return false;
  }

  /** Short, user-facing description. */
  get userMessage(): string {
    switch (this.kind) {
      case 'timeout':
        return 'The server took too long to respond.';
      case 'network':
        return 'Could not reach the server. Check your connection.';
      case 'invalid-response':
        return 'The server sent an unexpected response.';
      case 'cancelled':
        return 'The request was cancelled.';
      case 'http':
        if (this.status !== undefined && this.status >= 500) return `The server is having trouble (error ${this.status}).`;
        return this.message;
    }
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isCancel(error)) return new ApiError('cancelled', 'Request cancelled');
  if (error instanceof AxiosError) {
    if (error.code === AxiosError.ECONNABORTED || error.code === AxiosError.ETIMEDOUT) {
      return new ApiError('timeout', 'Request timed out');
    }
    if (error.response) {
      const body = apiErrorSchema.safeParse(error.response.data);
      return new ApiError(
        'http',
        body.success ? body.data.error.message : `Request failed with status ${error.response.status}`,
        error.response.status,
        body.success ? body.data.error.code : undefined,
      );
    }
    return new ApiError('network', error.message || 'Network error');
  }
  return new ApiError('network', error instanceof Error ? error.message : 'Unknown error');
}

/** Performs a request and validates the JSON body against a schema. */
export async function request<T>(schema: z.ZodType<T>, config: AxiosRequestConfig): Promise<{ data: T; status: number }> {
  try {
    const response = await http.request<unknown>(config);
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) throw new ApiError('invalid-response', 'Response did not match the contract', response.status);
    return { data: parsed.data, status: response.status };
  } catch (error) {
    throw toApiError(error);
  }
}
