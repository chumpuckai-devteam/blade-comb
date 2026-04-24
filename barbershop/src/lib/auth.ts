import { and, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export const getCurrentAppUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return {
      authUser: null,
      appUser: null,
    };
  }

  const [appUser] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, authUser.id), isNull(users.deletedAt)))
    .limit(1);

  return {
    authUser,
    appUser: appUser ?? null,
  };
});
