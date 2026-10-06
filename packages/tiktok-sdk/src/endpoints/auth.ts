import { TikTokApiError } from "../errors.js";
import type { ApiEnvelope, Region, TokenResponse } from "../types.js";

const AUTHORIZE_URLS: Record<Region, string> = {
  US: "https://services.us.tiktokshop.com/open/authorize",
  ROW: "https://services.tiktokshop.com/open/authorize",
};

/** Seller authorization link. The seller is redirected back to the app's callback with `code` and `state`. */
export function buildSellerAuthorizeUrl(opts: { region: Region; serviceId: string; state: string }): string {
  const url = new URL(AUTHORIZE_URLS[opts.region]);
  url.searchParams.set("service_id", opts.serviceId);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export class AuthApi {
  constructor(
    private readonly opts: {
      appKey: string;
      appSecret: string;
      authBaseUrl?: string;
      fetch?: typeof fetch;
    },
  ) {}

  /** Exchange the `code` from the authorization callback for tokens. */
  getAccessToken(authCode: string): Promise<TokenResponse> {
    return this.call({ auth_code: authCode, grant_type: "authorized_code" }, "/api/v2/token/get");
  }

  refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    return this.call({ refresh_token: refreshToken, grant_type: "refresh_token" }, "/api/v2/token/refresh");
  }

  private async call(params: Record<string, string>, path: string): Promise<TokenResponse> {
    const url = new URL(path, this.opts.authBaseUrl ?? "https://auth.tiktok-shops.com");
    url.searchParams.set("app_key", this.opts.appKey);
    url.searchParams.set("app_secret", this.opts.appSecret);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await (this.opts.fetch ?? fetch)(url);
    const env = (await res.json()) as ApiEnvelope<TokenResponse>;
    if (env.code !== 0 || !env.data) {
      throw new TikTokApiError(env.message, env.code, env.request_id, res.status, path);
    }
    return env.data;
  }
}
