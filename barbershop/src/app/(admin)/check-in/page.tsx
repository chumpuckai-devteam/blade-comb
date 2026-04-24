import { endOfDay, format, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { appointments, barbers, customers, services, shops } from "@/lib/db/schema";
import {
  calculateWalkInCapacityPerDay,
  parseWalkInCapacityConfig,
} from "@/lib/walk-in-capacity";
import { updateAppointmentStatusAction } from "../bookings/actions";
import { NewAppointmentDialog } from "../bookings/new-appointment-dialog";

type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

const STATUS_ORDER: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "in_progress",
  "completed",
  "no_show",
  "cancelled",
];

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  in_progress: "Checked In",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

const STATUS_BADGE_CLASSES: Record<AppointmentStatus, string> = {
  scheduled: "bg-slate-100 text-slate-700",
  confirmed: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-neutral-200 text-neutral-600",
  no_show: "bg-red-100 text-red-700",
};

const STATUS_BUTTON_ACTIVE: Record<AppointmentStatus, string> = {
  scheduled: "bg-slate-600 text-white border-slate-600",
  confirmed: "bg-blue-600 text-white border-blue-600",
  in_progress: "bg-amber-500 text-white border-amber-500",
  completed: "bg-emerald-600 text-white border-emerald-600",
  cancelled: "bg-neutral-600 text-white border-neutral-600",
  no_show: "bg-red-600 text-white border-red-600",
};

function fmt12(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function nearestQuarterHour(date: Date) {
  const minutes = date.getMinutes();
  const rounded = Math.ceil(minutes / 15) * 15;
  if (rounded === 60) {
    const bumped = new Date(date);
    bumped.setHours(bumped.getHours() + 1);
    bumped.setMinutes(0, 0, 0);
    return bumped;
  }
  const out = new Date(date);
  out.setMinutes(rounded, 0, 0);
  return out;
}

export default async function CheckInPage() {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser) redirect("/login");
  if (!appUser) return null;

  const [shop] = await db
    .select({ timezone: shops.timezone, settings: shops.settings })
    .from(shops)
    .where(eq(shops.id, appUser.shopId))
    .limit(1);
  const timezone = shop?.timezone ?? "America/Chicago";
  const walkInCapacityConfig = parseWalkInCapacityConfig(shop?.settings);

  const zonedNow = toZonedTime(new Date(), timezone);
  const todayStart = fromZonedTime(startOfDay(zonedNow), timezone);
  const todayEnd = fromZonedTime(endOfDay(zonedNow), timezone);

  const [barberOptions, customerOptions, serviceOptions] = await Promise.all([
    db
      .select({
        id: barbers.id,
        displayName: barbers.displayName,
      })
      .from(barbers)
      .where(
        and(
          eq(barbers.shopId, appUser.shopId),
          eq(barbers.isActive, true),
          isNull(barbers.deletedAt),
        ),
      )
      .orderBy(asc(barbers.displayOrder), asc(barbers.displayName)),
    db
      .select({
        id: customers.id,
        firstName: customers.firstName,
        lastName: customers.lastName,
        phone: customers.phone,
        email: customers.email,
      })
      .from(customers)
      .where(and(eq(customers.shopId, appUser.shopId), isNull(customers.deletedAt)))
      .orderBy(asc(customers.firstName), asc(customers.lastName)),
    db
      .select({
        id: services.id,
        name: services.name,
        durationMinutes: services.durationMinutes,
        priceCents: services.priceCents,
      })
      .from(services)
      .where(and(eq(services.shopId, appUser.shopId), isNull(services.deletedAt)))
      .orderBy(asc(services.displayOrder), asc(services.name)),
  ]);

  const walkInBarberRows = await db
    .select({ id: barbers.id })
    .from(barbers)
    .where(
      and(
        eq(barbers.shopId, appUser.shopId),
        eq(barbers.isActive, true),
        eq(barbers.acceptsWalkIns, true),
        isNull(barbers.deletedAt),
      ),
    );
  const walkInBarberIds = walkInBarberRows.map((b) => b.id);

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
              lte(appointments.scheduledStart, todayEnd),
              inArray(appointments.status, [
                "scheduled",
                "confirmed",
                "in_progress",
              ]),
            ),
          )
      : [];

  const [walkInToday] = calculateWalkInCapacityPerDay({
    timezone,
    walkInBarberIds,
    appointmentWindows: walkInAppointments,
    config: walkInCapacityConfig,
    startDate: new Date(),
    lookaheadDays: 1,
  });
  const walkInSlotsRemaining = walkInToday?.slots ?? 0;

  const rows = await db
    .select({
      id: appointments.id,
      customerId: appointments.customerId,
      barberId: appointments.barberId,
      scheduledStart: appointments.scheduledStart,
      scheduledEnd: appointments.scheduledEnd,
      status: appointments.status,
      source: appointments.source,
      notes: appointments.notes,
      customerFirstName: customers.firstName,
      customerLastName: customers.lastName,
      customerPhone: customers.phone,
      barberName: barbers.displayName,
      serviceName: services.name,
    })
    .from(appointments)
    .leftJoin(customers, eq(appointments.customerId, customers.id))
    .leftJoin(barbers, eq(appointments.barberId, barbers.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .where(
      and(
        eq(appointments.shopId, appUser.shopId),
        isNull(appointments.deletedAt),
        gte(appointments.scheduledStart, todayStart),
        lte(appointments.scheduledStart, todayEnd),
      ),
    )
    .orderBy(asc(appointments.scheduledStart), asc(appointments.createdAt));

  const statusCounts: Record<AppointmentStatus, number> = {
    scheduled: 0,
    confirmed: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
    no_show: 0,
  };
  for (const r of rows) {
    const status = r.status as AppointmentStatus;
    if (status in statusCounts) statusCounts[status] += 1;
  }

  const walkInDefaultDate = format(zonedNow, "yyyy-MM-dd");
  const walkInDefaultTime = format(nearestQuarterHour(zonedNow), "HH:mm");

  const summaryCards = [
    { label: "Upcoming", value: statusCounts.scheduled + statusCounts.confirmed },
    { label: "Checked In", value: statusCounts.in_progress },
    { label: "Completed", value: statusCounts.completed },
    { label: "No Show / Cancelled", value: statusCounts.no_show + statusCounts.cancelled },
  ];

  const walkInsFull = walkInBarberIds.length === 0 || walkInSlotsRemaining === 0;
  const walkInHint =
    walkInBarberIds.length === 0
      ? "No barbers are currently set to accept walk-ins."
      : walkInSlotsRemaining === 0
        ? "No walk-in slots remaining today."
        : `Based on remaining hours across ${walkInBarberIds.length} walk-in ${walkInBarberIds.length === 1 ? "barber" : "barbers"} and ${walkInCapacityConfig.slotMinutes}-minute slots.`;

  return (
    <div className="space-y-6">
      <Card className="rounded-[1.75rem] border-border/70 shadow-sm">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Front desk
            </p>
            <CardTitle className="mt-2 text-2xl tracking-tight">
              Check-In &mdash; {format(zonedNow, "EEEE, MMMM d")}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Today&rsquo;s appointments in {timezone}. Tap a status to update it, or add a walk-in to push it onto the calendar.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <NewAppointmentDialog
              customers={customerOptions}
              barbers={barberOptions}
              services={serviceOptions}
              defaultDate={walkInDefaultDate}
              defaultTime={walkInDefaultTime}
              defaultSource="walk_in"
              defaultStatus="in_progress"
              triggerLabel="Add walk-in"
              triggerClassName="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-md transition hover:opacity-95"
            />
            <div
              className={`inline-flex items-center justify-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                walkInsFull
                  ? "bg-red-100 text-red-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {walkInsFull
                ? "Walk-ins full today"
                : `${walkInSlotsRemaining} walk-in slot${walkInSlotsRemaining === 1 ? "" : "s"} left today`}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((c) => (
              <div
                key={c.label}
                className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3"
              >
                <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  {c.label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</p>
              </div>
            ))}
          </div>
          <div
            className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
              walkInsFull
                ? "border-red-200 bg-red-50/70"
                : "border-emerald-200 bg-emerald-50/60"
            }`}
          >
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Walk-in capacity today
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {walkInSlotsRemaining}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  slot{walkInSlotsRemaining === 1 ? "" : "s"} remaining
                </span>
              </p>
            </div>
            <p className="max-w-sm text-xs leading-5 text-muted-foreground sm:text-right">
              {walkInHint}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[1.75rem] border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Today&rsquo;s queue</CardTitle>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "No appointments scheduled for today."
              : `${rows.length} appointment${rows.length === 1 ? "" : "s"} on the books.`}
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing yet. Add a walk-in or head to Bookings to schedule the day.
            </p>
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => {
                const status = row.status as AppointmentStatus;
                const start = row.scheduledStart
                  ? toZonedTime(row.scheduledStart, timezone)
                  : null;
                const end = row.scheduledEnd
                  ? toZonedTime(row.scheduledEnd, timezone)
                  : null;
                const customerName =
                  `${row.customerFirstName ?? ""} ${row.customerLastName ?? ""}`.trim() ||
                  "Guest";
                const isClosed = status === "completed" || status === "cancelled" || status === "no_show";
                const sourceBadge =
                  row.source === "walk_in" ? (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-violet-700">
                      Walk-in
                    </span>
                  ) : null;

                return (
                  <li
                    key={row.id}
                    className={`rounded-2xl border border-border/60 p-4 transition ${
                      isClosed ? "bg-muted/20 opacity-80" : "bg-background"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-semibold tabular-nums">
                            {start ? fmt12(start) : "--:--"}
                          </span>
                          {end ? (
                            <span className="text-xs text-muted-foreground">
                              &ndash; {fmt12(end)}
                            </span>
                          ) : null}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider ${STATUS_BADGE_CLASSES[status] ?? STATUS_BADGE_CLASSES.scheduled}`}
                          >
                            {STATUS_LABELS[status] ?? status}
                          </span>
                          {sourceBadge}
                        </div>
                        <p className="mt-1 truncate text-base font-medium">
                          {customerName}
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {row.barberName ?? "Unassigned"}
                          {row.serviceName ? ` · ${row.serviceName}` : ""}
                          {row.customerPhone ? ` · ${row.customerPhone}` : ""}
                        </p>
                        {row.notes?.trim() ? (
                          <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            {row.notes}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {STATUS_ORDER.map((option) => {
                        const active = option === status;
                        const baseCls =
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition";
                        const cls = active
                          ? `${baseCls} ${STATUS_BUTTON_ACTIVE[option]} cursor-default`
                          : `${baseCls} border-border/60 bg-background text-foreground hover:bg-muted`;
                        if (active) {
                          return (
                            <span key={option} className={cls} aria-current="true">
                              {STATUS_LABELS[option]}
                            </span>
                          );
                        }
                        return (
                          <form key={option} action={updateAppointmentStatusAction}>
                            <input type="hidden" name="appointmentId" value={row.id} />
                            <input type="hidden" name="status" value={option} />
                            <button type="submit" className={cls}>
                              {STATUS_LABELS[option]}
                            </button>
                          </form>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
