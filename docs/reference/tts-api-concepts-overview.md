# Overview

TikTok Shop provides a comprehensive range of APIs known as the **TTS API**. These APIs allow developers to access authorized TikTok Shop data, including catalogs, orders, shipments, payments, and more.
With the TTS API, developers can create apps that extend Seller Center's existing functionality. These apps can enhance product catalog listings, streamline order fulfillment, reduce operational workload, and accelerate customer interactions.
# Key features
With the TikTok Shop API, you can:

* Set up an [authorization workflow](https://partner.tiktokshop.com/docv2/page/authorization-overview-202407) that developers initiate from the TTS App & Service Market detail page or from your own website.
* Configure [webhooks](https://partner.tiktokshop.com/docv2/page/tts-webhooks-overview) to receive notifications from TikTok Shop Open Platform.
* Test your app functionality in Sandbox or by making API calls using the [API testing tool](https://partner.tiktokshop.com/dev/api-testing-tool).

# API categories
| **No.** | **API category** | **API description** |
| --- | --- | --- |
| 1 | [Product API](https://partner.tiktokshop.com/docv2/page/products-api-overview) | The Product API is one of the most important APIs in TTS. Developers can use the Product API to access product category rules and attributes, upload product images, videos, certifications, and other files, create products, edit product information, and update inventory and prices. TikTok Shop also provides Global Product APIs for cross-border e-commerce developers. With the Global Product API, cross-border e-commerce developers can offer unified product management solutions for cross-border sellers selling across multiple regional markets. |
| 2 | [Order API](https://partner.tiktokshop.com/docv2/page/order-api-overview) | Developers can use the Order API to retrieve order information from TikTok Shop seller shops. After sellers obtain order information, they can perform order fulfillment operations as well as actions such as order cancellation and returns. |
| 3 | [Fulfillment API](https://partner.tiktokshop.com/docv2/page/fulfillment-api-overview) | Developers can use the Fulfillment API to synchronize fulfillment status for TikTok Shop orders with third-party logistics providers (3PL). They can also fulfill orders using TikTok-provided shipping label services (4PL). In addition, the Fulfilled by TikTok (FBT) service can be used, and developers can access the fulfillment status of TikTok Shop orders through the Fulfillment API. |
| 4 | [Return & Refund API](https://partner.tiktokshop.com/docv2/page/return-refund-and-cancel-api-overview) | When consumers initiate a return or refund request, developers can use the Return & Refund API to access return or refund order information and assist sellers in reviewing or rejecting requests initiated by consumers. |
| 5 | [Logistics API](https://partner.tiktokshop.com/docv2/page/logistic-api-overview) | When sellers use TikTok Shop-provided logistics services, developers can use the Logistics API to help sellers retrieve warehouse lists, global warehouse lists, subscribed delivery options, and shipping providers. |
| 6 | [Promotion API](https://partner.tiktokshop.com/docv2/page/promotion-api-overview) | Developers can use the Promotion API to assist sellers in setting up promotions, discounts, and other offers for specific products. |
| 7 | [Finance API](https://partner.tiktokshop.com/docv2/page/finance-api-overview) | Developers can use the Finance API to assist sellers in obtaining payment and settlement information for their TikTok Shop. |
| 8 | [Seller API](https://partner.tiktokshop.com/docv2/page/seller-api-overview) | The Seller API supports cross-border operations, where a single seller can establish shops in multiple regional markets. Developers can use the Seller API to retrieve the shop status of cross-border sellers and determine whether a specific cross-border market is eligible for the Global Product feature. |
| 9 | [Authorization API](https://partner.tiktokshop.com/docv2/page/get-authorized-shops-202309) | Developers can use the Authorization API to exchange authorization tokens and retrieve authorized shop information for apps. |
| 10 | [Events API](https://partner.tiktokshop.com/docv2/page/get-shop-webhooks) | Developers can use the Events API to subscribe and unsubscribe Open Platform webhooks for TikTok Shop business events. |
| 11 | Data Reconciliation API | Developers can use the Data Reconciliation API to transfer external data to Open Platform for Quality Engine reconciliation. |
| 12 | [Supply Chain API](https://partner.tiktokshop.com/docv2/page/confirm-package-shipment) | This API is for TikTok Shop certified warehouse partners. Developers can use the Supply Chain API to send package fulfillment details for orders fulfilled by certified warehouses back to TTS. |

For a complete list of available APIs, refer to the [TTS API reference docs](https://partner.tiktokshop.com/docv2/page/create-product).
# Authorization and token navigation
The TTS API uses different authorization flows depending on the data owner. The `user_type` field in token responses helps identify the authorization principal, such as seller, creator, or partner. For exact token response fields and enum values, refer to [Generate a test access token](https://partner.tiktokshop.com/docv2/page/generate-test-access-token).
Use the authorization guide that matches the data owner:
| Authorization type | Data owner | US authorization entry | ROW authorization entry | Main guide |
| --- | --- | --- | --- | --- |
| Seller authorization | Seller / shop | `https://services.us.tiktokshop.com/open/authorize` | `https://services.tiktokshop.com/open/authorize` | [Authorization overview](https://partner.tiktokshop.com/docv2/page/authorization-overview-202407) |
| Creator authorization | Creator | `https://shop.tiktok.com/alliance` | `https://shop.tiktok.com/alliance` | [Creator authorization guide](https://partner.tiktokshop.com/docv2/page/creator-authorization-guide) |
| Partner authorization | Partner | `https://partner.us.tiktokshop.com/open/authorize` | `https://partner.tiktokshop.com/open/authorize` | [Partner authorization guide](https://partner.tiktokshop.com/docv2/page/partner-authorization-guide) |
When choosing an API, also check the endpoint's entity tag and access requirements. For tag-level guidance, refer to [API entity tags](https://partner.tiktokshop.com/docv2/page/api-entity-tags). For scope-level guidance, refer to [Access scope](https://partner.tiktokshop.com/docv2/page/access-scope).
# API version
The TTS API is versioned. Some older API versions may remain accessible, but unsupported versions can stop working at any time. Developers are strongly encouraged to use the newest supported version available for the endpoint they are calling.
Do not rely on hardcoded examples to determine the latest version. On each API Reference page, use the version selector or version dropdown to confirm the newest supported version for that endpoint, then follow any migration notes or deprecation notices shown on the page.
For additional details, refer to [TTS API versioning](https://partner.tiktokshop.com/docv2/page/api-versioning).
