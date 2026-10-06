export class TikTokApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly requestId: string | undefined,
    readonly httpStatus: number,
    readonly path: string,
  ) {
    super(`[${code}] ${message} (path=${path}, request_id=${requestId ?? "n/a"})`);
    this.name = "TikTokApiError";
  }

  /** 429 or explicit throttle codes: back off and retry. */
  get isRateLimited(): boolean {
    return this.httpStatus === 429;
  }

  get isRetryable(): boolean {
    return this.isRateLimited || this.httpStatus >= 500;
  }
}
