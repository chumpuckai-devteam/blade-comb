import { endOfDay, endOfWeek, format, startOfDay, subDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { and, count, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { appointments, barbers, customers, shops } from "@/lib/db/schema";
import {
  DEFAULT_SHOP_CLOSE_TIME,
  DEFAULT_SHOP_OPEN_TIME,
  calculateWalkInCapacityPerDay,
  nextWalkInWindowEnd,
  parseWalkInCapacityConfig,
} from "@/lib/walk-in-capacity";

function getTimezoneBounds(timezone: string) {
  const zonedNow = toZonedTime(new Date(), timezone);
  const todayStart = fromZonedTime(startOfDay(zonedNow), timezone);
  const todayEnd = fromZonedTime(endOfDay(zonedNow), timezone);
  const weekEnd = fromZonedTime(
    endOfWeek(zonedNow, { weekStartsOn: 1 }),
    timezone,
  );
  const lastThirtyDays = fromZonedTime(
    startOfDay(subDays(zonedNow, 29)),
    timezone,
  );
  return {
    todayStart,
    todayEnd,
    weekEnd,
    lastThirtyDays,
  };
}

export default async function DashboardPage() {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser || !appUser) {
    return null;
  }

  const [shop] = await db
    .select({
      timezone: shops.timezone,
      settings: shops.settings,
    })
    .from(shops)
    .where(eq(shops.id, appUser.shopId))
    .limit(1);

  const timezone = shop?.timezone ?? "America/Chicago";
  const { todayStart, todayEnd, weekEnd, lastThirtyDays } =
    getTimezoneBounds(timezone);
  const nextSevenDaysEnd = nextWalkInWindowEnd(timezone);
  const walkInCapacityConfig = parseWalkInCapacityConfig(shop?.settings);

  const [{ value: totalCustomers }] = await db
    .select({ value: count() })
    .from(customers)
    .where(and(eq(customers.shopId, appUser.shopId), isNull(customers.deletedAt)));

  const [{ value: appointmentsToday }] = await db
    .select({ value: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.shopId, appUser.shopId),
        isNull(appointments.deletedAt),
        gte(appointments.scheduledStart, todayStart),
        lte(appointments.scheduledStart, todayEnd),
        inArray(appointments.status, [
          "scheduled",
          "confirmed",
          "in_progress",
          "completed",
          "no_show",
        ]),
      ),
    );

  const [{ value: upcomingThisWeek }] = await db
    .select({ value: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.shopId, appUser.shopId),
        isNull(appointments.deletedAt),
        gte(appointments.scheduledStart, new Date()),
        lte(appointments.scheduledStart, weekEnd),
        inArray(appointments.status, ["scheduled", "confirmed", "in_progress"]),
      ),
    );

  const [{ value: noShowsLastThirtyDays }] = await db
    .select({ value: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.shopId, appUser.shopId),
        isNull(appointments.deletedAt),
        eq(appointments.status, "no_show"),
        gte(appointments.scheduledStart, lastThirtyDays),
      ),
    );

  const walkInBarberRows = await db
    .select({
      id: barbers.id,
    })
    .from(barbers)
    .where(
      and(
        eq(barbers.shopId, appUser.shopId),
        eq(barbers.isActive, true),
        eq(barbers.acceptsWalkIns, true),
        isNull(barbers.deletedAt),
      ),
    );

  const walkInBarberIds = walkInBarberRows.map((barber) => barber.id);

  const walkInAppointments =
    walkInBarberIds.length > 0
      ? await db
          .select({
            barberId: appointments.barberId,
            scheduledStart: appointments.scheduledStart,
            scheduledEnd: appointments.scheduledEnd,
          })
          .from(appointments)
          .where(
            and(
              eq(appointments.shopId, appUser.shopId),
              isNull(appointments.deletedAt),
              inArray(appointments.barberId, walkInBarberIds),
              gte(appointments.scheduledStart, todayStart),
              lte(appointments.scheduledStart, nextSevenDaysEnd),
              inArray(appointments.status, [
                "scheduled",
                "confirmed",
                "in_progress",
              ]),
            ),
          )
      : [];

  const walkInPerDay = calculateWalkInCapacityPerDay({
    timezone,
    walkInBarberIds,
    appointmentWindows: walkInAppointments,
    config: walkInCapacityConfig,
    startDate: new Date(),
  });

  const walkInTotal = walkInPerDay.reduce((sum, d) => sum + d.slots, 0);

  const walkInNote =
    walkInBarberIds.length > 0
      ? walkInCapacityConfig.hasConfiguredHours
        ? `Today reflects remaining hours from now until close. Future days use full configured availability. Based on ${walkInCapacityConfig.slotMinutes}-minute walk-in slots minus current bookings.`
        : `Today reflects remaining hours from now until close. Future days use shop hours ${DEFAULT_SHOP_OPEN_TIME}–${DEFAULT_SHOP_CLOSE_TIME}. Based on ${walkInCapacityConfig.slotMinutes}-minute walk-in slots minus current bookings.`
      : "No active barbers are currently marked as accepting walk-ins.";

  const displayName = appUser.fullName ?? authUser.email ?? "there";
  const metricCards = [
    {
      label: "Total Customers",
      value: Number(totalCustomers),
      note: "All customer records currently owned by the shop.",
    },
    {
      label: "Appointments Today",
      value: Number(appointmentsToday),
      note: "Scheduled today in the shop timezone.",
    },
    {
      label: "Upcoming This Week",
      value: Number(upcomingThisWeek),
      note: "Remaining appointments through the end of the week.",
    },
    {
      label: "No-Shows Last 30 Days",
      value: Number(noShowsLastThirtyDays),
      note: "Historical no-show count from recent activity.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
        <Card className="rounded-[2rem] border-border/70 bg-[linear-gradient(140deg,rgba(0,0,0,0.04),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.9),rgba(245,245,245,0.98))] shadow-sm">
          <CardHeader>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Shop pulse
            </p>
            <CardTitle className="mt-3 text-3xl tracking-tight">
              Welcome, {displayName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p className="max-w-xl leading-6">
              This dashboard is now reading directly from the live database. As
              customer and appointment history comes in, the cards here will
              give the owner a clean operational snapshot.
            </p>
            <div className="rounded-[1.5rem] border border-border/70 bg-background/80 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Shop timezone
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">{timezone}</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {metricCards.map((card) => (
            <Card key={card.label} className="rounded-[1.75rem] border-border/70 shadow-sm">
              <CardHeader>
                <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  {card.label}
                </p>
                <CardTitle className="mt-2 text-4xl tracking-tight">
                  {card.value}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">
                {card.note}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="rounded-[1.75rem] border-border/70 shadow-sm">
        <CardHeader>
          <div className="flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Walk-In Capacity — Next 7 Days
            </p>
            <p className="text-sm font-medium text-foreground">{walkInTotal} total slots</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {walkInPerDay.map((day, index) => (
              <Link
                key={day.dateKey}
                href={`/bookings?view=day&date=${day.dateKey}`}
                aria-label={`View bookings for ${format(day.date, "EEEE, MMMM d")}`}
                className="flex items-center justify-between rounded-xl border border-border/50 px-4 py-2.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {format(day.date, "EEEE")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(day.date, "MMM d")}
                  </span>
                  {index === 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium text-primary">
                      Today
                    </span>
                  )}
                </div>
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {day.slots}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{walkInNote}</p>
        </CardContent>
      </Card>
    </div>
  );
}
