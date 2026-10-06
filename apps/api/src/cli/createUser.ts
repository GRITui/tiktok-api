#!/usr/bin/env tsx
/**
 * CLI to create OMS users.
 * Usage: tsx apps/api/src/cli/createUser.ts --email user@example.com --password secret --role admin
 */

import { createUser, type Role } from "@oms/core";
import { createDb } from "@oms/db";
import { TokenCipher } from "@oms/core";
import { RecordingQueue } from "@oms/core";
import { TikTokClient } from "@oms/tiktok-sdk";
import { AuthApi } from "@oms/tiktok-sdk";

interface CreateUserArgs {
  email?: string;
  password?: string;
  role?: string;
  name?: string;
}

function parseArgs(): CreateUserArgs {
  const args: CreateUserArgs = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--email" && i + 1 < process.argv.length) {
      args.email = process.argv[++i];
    } else if (process.argv[i] === "--password" && i + 1 < process.argv.length) {
      args.password = process.argv[++i];
    } else if (process.argv[i] === "--role" && i + 1 < process.argv.length) {
      args.role = process.argv[++i];
    } else if (process.argv[i] === "--name" && i + 1 < process.argv.length) {
      args.name = process.argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();

  if (!args.email || !args.password) {
    console.error("Usage: tsx apps/api/src/cli/createUser.ts --email <email> --password <password> [--role <admin|ops|viewer>] [--name <name>]");
    process.exit(1);
  }

  const role = (args.role as Role) || "viewer";
  if (!["admin", "ops", "viewer"].includes(role)) {
    console.error("Invalid role. Must be one of: admin, ops, viewer");
    process.exit(1);
  }

  // Build deps from environment
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!tokenKey) {
    console.error("TOKEN_ENCRYPTION_KEY environment variable is required");
    process.exit(1);
  }

  const appKey = process.env.APP_KEY || "";
  const appSecret = process.env.APP_SECRET || "";

  const { db, close } = createDb(dbUrl);

  const deps = {
    db,
    config: {
      appKey,
      appSecret,
      serviceId: "oms",
      backfillDays: 90,
      pollOverlapMinutes: 10,
      fileStorageDir: "./var/files",
    },
    cipher: TokenCipher.fromEnv(tokenKey),
    queues: new RecordingQueue(),
    tts: new TikTokClient({ appKey, appSecret }),
    auth: new AuthApi({ appKey, appSecret }),
    now: () => new Date(),
  };

  try {
    const user = await createUser(deps, {
      email: args.email,
      password: args.password,
      role,
      name: args.name,
    });
    console.log(`User created: ${user.id} (${user.email}) [${user.role}]`);
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  } finally {
    await close();
  }
}

main();
