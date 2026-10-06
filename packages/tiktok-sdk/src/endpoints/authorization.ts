import type { TikTokClient } from "../client.js";
import type { AuthorizedShop } from "../types.js";
import { API_VERSIONS } from "../versions.js";

export class AuthorizationApi {
  constructor(private readonly client: TikTokClient) {}

  /** List shops the token is authorized for; each carries the `cipher` needed for shop-scoped calls. */
  async getAuthorizedShops(accessToken: string): Promise<AuthorizedShop[]> {
    const data = await this.client.request<{ shops?: AuthorizedShop[] }>({
      method: "GET",
      path: `/authorization/${API_VERSIONS.authorization}/shops`,
      accessToken,
    });
    return data.shops ?? [];
  }
}
