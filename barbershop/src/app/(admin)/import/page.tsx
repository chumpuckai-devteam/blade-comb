import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { shops } from "@/lib/db/schema";
import { ImportWorkbench } from "./import-workbench";

export default async function ImportPage() {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser) {
    redirect("/login");
  }

  if (!appUser) {
    return null;
  }

  const [shop] = await db
    .select({
      timezone: shops.timezone,
    })
    .from(shops)
    .where(eq(shops.id, appUser.shopId))
    .limit(1);

  return <ImportWorkbench timezone={shop?.timezone ?? "America/Chicago"} />;
}
