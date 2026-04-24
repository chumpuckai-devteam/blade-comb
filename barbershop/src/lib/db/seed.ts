import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";

function loadEnvFile(filename: string) {
  const filePath = resolve(process.cwd(), filename);

  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required before running the seed script.`);
  }

  return value;
}

async function findAuthUserByEmail(email: string) {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  let page = 1;
  const normalizedEmail = email.toLowerCase();

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw error;
    }

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === normalizedEmail,
    );

    if (match) {
      return match;
    }

    if (data.users.length < 200) {
      break;
    }

    page += 1;
  }

  return null;
}

async function main() {
  loadEnvFile(".env.local");

  const [{ db }, { shops, users }] = await Promise.all([
    import("./client"),
    import("./schema"),
  ]);

  const adminEmail = requireEnv("ADMIN_EMAIL");
  const shopName = requireEnv("SHOP_NAME");
  const shopSlug = requireEnv("SHOP_SLUG");
  const shopTimezone = requireEnv("SHOP_TIMEZONE");

  const authUser = await findAuthUserByEmail(adminEmail);

  if (!authUser) {
    throw new Error(
      `No Supabase auth user found for ${adminEmail}. Create the user in Supabase Dashboard -> Authentication -> Users first.`,
    );
  }

  let [shop] = await db.select().from(shops).where(eq(shops.slug, shopSlug)).limit(1);

  if (!shop) {
    [shop] = await db
      .insert(shops)
      .values({
        name: shopName,
        slug: shopSlug,
        timezone: shopTimezone,
      })
      .returning();
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1);

  if (!existingUser) {
    await db.insert(users).values({
      id: authUser.id,
      shopId: shop.id,
      email: authUser.email ?? adminEmail,
      fullName:
        authUser.user_metadata.full_name ??
        authUser.user_metadata.name ??
        authUser.email ??
        adminEmail,
      role: "owner",
    });
  }

  console.log(`Shop ID: ${shop.id}`);
  console.log(
    `Seed complete for ${adminEmail}. Paste this into DEFAULT_SHOP_ID: ${shop.id}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
