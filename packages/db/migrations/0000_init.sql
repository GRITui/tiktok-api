CREATE TYPE "public"."order_status" AS ENUM('UNPAID', 'ON_HOLD', 'AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING', 'AWAITING_COLLECTION', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'ops', 'viewer');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor" text NOT NULL,
	"shop_id" text,
	"action" text NOT NULL,
	"target_id" text,
	"request" jsonb,
	"response" jsonb,
	"tts_request_id" text,
	"ok" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_name" text NOT NULL,
	"seller_base_region" text NOT NULL,
	"region" text DEFAULT 'ROW' NOT NULL,
	"user_type" integer NOT NULL,
	"access_token_enc" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"refresh_token_expires_at" timestamp with time zone NOT NULL,
	"granted_scopes" jsonb,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_options" (
	"shop_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_options_shop_id_warehouse_id_id_pk" PRIMARY KEY("shop_id","warehouse_id","id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target_id" text NOT NULL,
	"status" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_items" (
	"job_id" uuid NOT NULL,
	"target_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"response" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_items_job_id_target_id_pk" PRIMARY KEY("job_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"shop_id" text,
	"params" jsonb,
	"total" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"region" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"seller_sku" text,
	"product_name" text NOT NULL,
	"sku_name" text,
	"sale_price" numeric(14, 2) NOT NULL,
	"display_status" text,
	"package_id" text
);
--> statement-breakpoint
CREATE TABLE "order_packages" (
	"order_id" text NOT NULL,
	"package_id" text NOT NULL,
	CONSTRAINT "order_packages_order_id_package_id_pk" PRIMARY KEY("order_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"status" "order_status" NOT NULL,
	"currency" text NOT NULL,
	"total_amount" numeric(14, 2),
	"buyer_user_id" text,
	"buyer_message" text,
	"recipient" jsonb,
	"recipient_hash" text,
	"fulfillment_type" text,
	"shipping_type" text,
	"delivery_option_id" text,
	"delivery_option_name" text,
	"warehouse_id" text,
	"is_cod" boolean DEFAULT false,
	"rts_sla_at" timestamp with time zone,
	"tts_created_at" timestamp with time zone NOT NULL,
	"tts_updated_at" bigint NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "package_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"package_id" text NOT NULL,
	"status" text NOT NULL,
	"tts_updated_at" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_line_items" (
	"package_id" text NOT NULL,
	"line_item_id" text NOT NULL,
	CONSTRAINT "package_line_items_package_id_line_item_id_pk" PRIMARY KEY("package_id","line_item_id")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"status" text,
	"shipping_type" text,
	"delivery_option_id" text,
	"warehouse_id" text,
	"handover_method" text,
	"pickup_slot_start" bigint,
	"pickup_slot_end" bigint,
	"tracking_number" text,
	"shipping_provider_id" text,
	"shipping_provider" text,
	"label_url" text,
	"label_fetched_at" timestamp with time zone,
	"shipped_recipient_hash" text,
	"shipped_at" timestamp with time zone,
	"tts_updated_at" bigint,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_providers" (
	"shop_id" text NOT NULL,
	"delivery_option_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_providers_shop_id_delivery_option_id_id_pk" PRIMARY KEY("shop_id","delivery_option_id","id")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"cipher" text NOT NULL,
	"code" text,
	"seller_type" text,
	"authorization_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"backfill_status" text DEFAULT 'pending' NOT NULL,
	"backfill_cursor" bigint,
	"backfill_from" bigint,
	"webhooks_subscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"shop_id" text NOT NULL,
	"stream" text NOT NULL,
	"update_time_ge" bigint NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "sync_cursors_shop_id_stream_pk" PRIMARY KEY("shop_id","stream")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"password_hash" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"shop_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"default_handover_method" text,
	"address" jsonb,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_shop_id_id_pk" PRIMARY KEY("shop_id","id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"notification_id" text NOT NULL,
	"type" integer NOT NULL,
	"shop_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "delivery_options" ADD CONSTRAINT "delivery_options_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_packages" ADD CONSTRAINT "order_packages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_packages" ADD CONSTRAINT "order_packages_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_events" ADD CONSTRAINT "package_events_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_line_items" ADD CONSTRAINT "package_line_items_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_line_items" ADD CONSTRAINT "package_line_items_line_item_id_order_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."order_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_providers" ADD CONSTRAINT "shipping_providers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_authorization_id_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."authorizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "line_items_order_idx" ON "order_line_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "line_items_sku_idx" ON "order_line_items" USING btree ("seller_sku");--> statement-breakpoint
CREATE INDEX "order_packages_pkg_idx" ON "order_packages" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "orders_shop_status_idx" ON "orders" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "orders_shop_created_idx" ON "orders" USING btree ("shop_id","tts_created_at");--> statement-breakpoint
CREATE INDEX "orders_status_sla_idx" ON "orders" USING btree ("status","rts_sla_at");--> statement-breakpoint
CREATE INDEX "package_events_pkg_idx" ON "package_events" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "packages_shop_status_idx" ON "packages" USING btree ("shop_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_notification_uq" ON "webhook_events" USING btree ("notification_id");