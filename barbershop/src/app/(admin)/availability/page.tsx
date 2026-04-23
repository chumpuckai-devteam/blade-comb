import { and, asc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { barbers, shops } from "@/lib/db/schema";
import { parseWalkInCapacityConfig } from "@/lib/walk-in-capacity";
import { AvailabilityEditor } from "./availability-editor";

export default async function AvailabilityPage() {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser) {
    redirect("/login");
  }

  if (!appUser) {
    return null;
  }

  const [shop] = await db
    .select({ settings: shops.settings })
    .from(shops)
    .where(eq(shops.id, appUser.shopId))
    .limit(1);

  const config = parseWalkInCapacityConfig(shop?.settings);

  const barberRows = await db
    .select({
      id: barbers.id,
      displayName: barbers.displayName,
      acceptsWalkIns: barbers.acceptsWalkIns,
    })
    .from(barbers)
    .where(
      and(
        eq(barbers.shopId, appUser.shopId),
        eq(barbers.isActive, true),
        isNull(barbers.deletedAt),
      ),
    )
    .orderBy(asc(barbers.displayOrder), asc(barbers.displayName));

  const barberData = barberRows.map((barber) => ({
    id: barber.id,
    displayName: barber.displayName,
    acceptsWalkIns: barber.acceptsWalkIns,
    schedule: config.weeklyHours.barbers[barber.id] ?? {},
    unavailableDates: Array.from(config.barberUnavailableDates[barber.id] ?? []),
  }));

  const closedDates = Array.from(config.closedDates);

  return (
    <AvailabilityEditor barbers={barberData} closedDates={closedDates} />
  );
}
