import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutGrid,
  PanelTop,
  Pencil,
  Scissors,
  StickyNote,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getCurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { appointments, barbers, customers, services } from "@/lib/db/schema";
import { deleteAppointmentAction, updateAppointmentAction } from "./actions";
import { NewAppointmentDialog } from "./new-appointment-dialog";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BARBER_PALETTE = [
  "#4285f4",
  "#34a853",
  "#fbbc04",
  "#ea4335",
  "#8e24aa",
  "#00acc1",
  "#ff7043",
  "#7cb342",
];
const CALENDAR_START_HOUR = 6;
const CALENDAR_END_HOUR = 22;
const HOUR_HEIGHT = 60;
const TIME_COL = 56;
const WEEK_STARTS_ON = 0 as const;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CalendarView = "day" | "week" | "month";

type SearchParams = {
  view?: CalendarView;
  date?: string;
  barberId?: string;
  status?: string;
  source?: string;
  serviceId?: string;
  appointmentId?: string;
};

type BarberOption = {
  id: string;
  userId: string | null;
  displayName: string;
  color: string | null;
};

type ServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
};

type BookingRow = {
  id: string;
  customerId: string;
  barberId: string;
  serviceId: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  status: string;
  source: string;
  priceCents: number | null;
  notes: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  barberName: string | null;
  serviceName: string | null;
};

type CalendarEvent = BookingRow & {
  start: Date;
  end: Date;
  customerName: string;
  barberColor: string;
};

type NavParams = {
  view: CalendarView;
  date: string;
  barberId?: string;
  status?: string;
  source?: string;
  serviceId?: string;
  appointmentId?: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildHref(params: Partial<NavParams>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/bookings?${query}` : "/bookings";
}

function safeAnchorDate(value?: string) {
  if (!value) return new Date();
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

function fmt12(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function fmt12Short(d: Date) {
  return fmt12(d).replace(":00", "");
}

function hourLabel(hour: number) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(
    new Date(2026, 0, 1, hour),
  );
}

function startOfViewRange(view: CalendarView, d: Date) {
  if (view === "day") return startOfDay(d);
  if (view === "week") return startOfWeek(d, { weekStartsOn: WEEK_STARTS_ON });
  return startOfWeek(startOfMonth(d), { weekStartsOn: WEEK_STARTS_ON });
}

function endOfViewRange(view: CalendarView, d: Date) {
  if (view === "day") return endOfDay(d);
  if (view === "week") return endOfWeek(d, { weekStartsOn: WEEK_STARTS_ON });
  return endOfWeek(endOfMonth(d), { weekStartsOn: WEEK_STARTS_ON });
}

function shiftDate(view: CalendarView, d: Date, dir: -1 | 1) {
  if (view === "day") return addDays(d, dir);
  if (view === "week") return addWeeks(d, dir);
  return dir === -1 ? subMonths(d, 1) : addMonths(d, 1);
}

function rangeLabel(view: CalendarView, d: Date) {
  if (view === "day") return format(d, "EEEE, MMMM d, yyyy");
  if (view === "week") {
    const ws = startOfWeek(d, { weekStartsOn: WEEK_STARTS_ON });
    const we = endOfWeek(d, { weekStartsOn: WEEK_STARTS_ON });
    return format(ws, "MMMM") === format(we, "MMMM")
      ? format(ws, "MMMM yyyy")
      : `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
  }
  return format(d, "MMMM yyyy");
}

function toEvents(rows: BookingRow[], colorMap: Map<string, string>): CalendarEvent[] {
  return rows
    .filter((r): r is BookingRow & { scheduledStart: Date } => Boolean(r.scheduledStart))
    .map((r) => {
      const start = new Date(r.scheduledStart);
      const end = r.scheduledEnd ? new Date(r.scheduledEnd) : addMinutes(start, 45);
      return {
        ...r,
        start,
        end,
        customerName:
          `${r.customerFirstName ?? ""} ${r.customerLastName ?? ""}`.trim() || "Guest",
        barberColor: colorMap.get(r.barberId) ?? BARBER_PALETTE[0],
      };
    });
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/* ------------------------------------------------------------------ */
/*  Event pill (shared)                                                */
/* ------------------------------------------------------------------ */

function EventChip({
  event,
  compact = false,
}: {
  event: CalendarEvent;
  compact?: boolean;
}) {
  return (
    <div
      className={`h-full overflow-hidden rounded-lg px-2 ${compact ? "py-0.5" : "py-1.5"}`}
      style={{ backgroundColor: event.barberColor }}
    >
      {compact ? (
        <p className="truncate text-xs font-medium text-white">
          {fmt12Short(event.start)} {event.customerName}
        </p>
      ) : (
        <>
          <p className="truncate text-xs font-semibold text-white">{event.customerName}</p>
          <p className="truncate text-[0.68rem] text-white/80">
            {event.serviceName ?? "No service"} &middot; {fmt12Short(event.start)}–{fmt12Short(event.end)}
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Week / Day time grid                                               */
/* ------------------------------------------------------------------ */

function TimeGrid({
  days,
  events,
  hrefForEvent,
}: {
  days: Date[];
  events: CalendarEvent[];
  hrefForEvent: (id: string) => string;
}) {
  const hours = Array.from(
    { length: CALENDAR_END_HOUR - CALENDAR_START_HOUR },
    (_, i) => CALENDAR_START_HOUR + i,
  );
  const dayMap = new Map<string, CalendarEvent[]>();
  for (const d of days) dayMap.set(format(d, "yyyy-MM-dd"), []);
  for (const ev of events) {
    const bucket = dayMap.get(format(ev.start, "yyyy-MM-dd"));
    if (bucket) bucket.push(ev);
  }
  const totalH = hours.length * HOUR_HEIGHT;
  const isSingle = days.length === 1;

  return (
    <div className="flex min-w-0 flex-col">
      {/* Column headers */}
      <div
        className="grid border-b"
        style={{
          gridTemplateColumns: `${TIME_COL}px repeat(${days.length}, minmax(0, 1fr))`,
          borderColor: "#dadce0",
        }}
      >
        <div />
        {days.map((day) => (
          <div key={format(day, "yyyy-MM-dd")} className="px-1 py-2 text-center">
            <p className="text-xs font-medium uppercase text-[#70757a]">{format(day, "EEE")}</p>
            <div className="mt-1 flex justify-center">
              <span
                className={`flex size-10 items-center justify-center rounded-full text-lg font-medium ${
                  isToday(day)
                    ? "bg-[#1a73e8] text-white"
                    : "text-[#3c4043]"
                }`}
              >
                {format(day, "d")}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Scrollable time body */}
      <div className="flex-1 overflow-y-auto overscroll-contain" style={{ maxHeight: "calc(100vh - 220px)" }}>
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${TIME_COL}px repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          {/* Time gutter */}
          <div className="relative" style={{ height: totalH }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 text-[0.68rem] text-[#70757a]"
                style={{ top: (hour - CALENDAR_START_HOUR) * HOUR_HEIGHT - 5 }}
              >
                {hour === CALENDAR_START_HOUR ? "" : hourLabel(hour)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayEvents = dayMap.get(format(day, "yyyy-MM-dd")) ?? [];
            return (
              <div
                key={format(day, "yyyy-MM-dd")}
                className={`relative ${!isSingle ? "border-l" : ""}`}
                style={{ height: totalH, borderColor: "#dadce0" }}
              >
                {/* Hour lines */}
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t"
                    style={{
                      top: (hour - CALENDAR_START_HOUR) * HOUR_HEIGHT,
                      borderColor: "#dadce0",
                    }}
                  />
                ))}
                {/* Half-hour dashed lines */}
                {hours.map((hour) => (
                  <div
                    key={`${hour}-half`}
                    className="absolute left-0 right-0 border-t border-dashed"
                    style={{
                      top: (hour - CALENDAR_START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2,
                      borderColor: "#ebebeb",
                    }}
                  />
                ))}

                {/* Events */}
                {dayEvents.map((ev) => {
                  const startMin = (ev.start.getHours() - CALENDAR_START_HOUR) * 60 + ev.start.getMinutes();
                  const durMin = Math.max(30, Math.round((ev.end.getTime() - ev.start.getTime()) / 60000));
                  const top = (startMin / 60) * HOUR_HEIGHT;
                  const height = Math.max((durMin / 60) * HOUR_HEIGHT, 28);
                  return (
                    <Link
                      key={ev.id}
                      href={hrefForEvent(ev.id)}
                      className="absolute left-0.5 right-0.5 z-10"
                      style={{ top, height }}
                    >
                      <EventChip event={ev} />
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Month grid                                                         */
/* ------------------------------------------------------------------ */

function MonthGrid({
  days,
  anchorDate,
  events,
  hrefForEvent,
}: {
  days: Date[];
  anchorDate: Date;
  events: CalendarEvent[];
  hrefForEvent: (id: string) => string;
}) {
  const map = new Map<string, CalendarEvent[]>();
  for (const d of days) map.set(format(d, "yyyy-MM-dd"), []);
  for (const ev of events) {
    const bucket = map.get(format(ev.start, "yyyy-MM-dd"));
    if (bucket) bucket.push(ev);
  }

  return (
    <div className="min-w-0">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b" style={{ borderColor: "#dadce0" }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
          <div
            key={label}
            className="border-r px-2 py-2.5 text-center text-xs font-medium uppercase text-[#70757a] last:border-r-0"
            style={{ borderColor: "#dadce0" }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = map.get(format(day, "yyyy-MM-dd")) ?? [];
          const visible = dayEvents.slice(0, 3);
          const more = dayEvents.length - visible.length;
          const inMonth = isSameMonth(day, anchorDate);

          return (
            <div
              key={format(day, "yyyy-MM-dd")}
              className="min-h-[120px] border-b border-r last:border-r-0"
              style={{ borderColor: "#dadce0", backgroundColor: inMonth ? "#fff" : "#f8f9fa" }}
            >
              <div className="flex justify-center py-1.5">
                <span
                  className={`flex size-7 items-center justify-center rounded-full text-xs font-medium ${
                    isToday(day)
                      ? "bg-[#1a73e8] text-white"
                      : inMonth
                        ? "text-[#3c4043]"
                        : "text-[#70757a]"
                  }`}
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="space-y-0.5 px-1 pb-1">
                {visible.map((ev) => (
                  <Link key={ev.id} href={hrefForEvent(ev.id)} className="block">
                    <EventChip event={ev} compact />
                  </Link>
                ))}
                {more > 0 && (
                  <p className="px-1 text-xs font-medium text-[#1a73e8]">
                    +{more} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mini month (sidebar)                                               */
/* ------------------------------------------------------------------ */

function MiniMonth({ anchorDate, view, barberId, status, source, serviceId }: {
  anchorDate: Date;
  view: CalendarView;
  barberId?: string;
  status?: string;
  source?: string;
  serviceId?: string;
}) {
  const monthStart = startOfMonth(anchorDate);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: WEEK_STARTS_ON }),
  });

  const prevMonth = subMonths(anchorDate, 1);
  const nextMonth = addMonths(anchorDate, 1);

  return (
    <div className="select-none">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium text-[#3c4043]">{format(anchorDate, "MMMM yyyy")}</span>
        <div className="flex gap-0.5">
          <Link
            href={buildHref({ view, date: format(prevMonth, "yyyy-MM-dd"), barberId, status, source, serviceId })}
            className="rounded-full p-1 hover:bg-[#f1f3f4]"
          >
            <ChevronLeft className="size-4 text-[#5f6368]" />
          </Link>
          <Link
            href={buildHref({ view, date: format(nextMonth, "yyyy-MM-dd"), barberId, status, source, serviceId })}
            className="rounded-full p-1 hover:bg-[#f1f3f4]"
          >
            <ChevronRight className="size-4 text-[#5f6368]" />
          </Link>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[0.65rem] font-medium text-[#70757a]">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="py-0.5">{d}</div>
        ))}
      </div>
      <div className="mt-0.5 grid grid-cols-7 text-center text-xs">
        {days.map((day) => {
          const inMonth = isSameMonth(day, anchorDate);
          const selected = isSameDay(day, anchorDate);
          return (
            <Link
              key={format(day, "yyyy-MM-dd")}
              href={buildHref({ view, date: format(day, "yyyy-MM-dd"), barberId, status, source, serviceId })}
              className={`flex size-7 items-center justify-center rounded-full text-xs transition-colors ${
                selected
                  ? "bg-[#1a73e8] font-medium text-white"
                  : isToday(day)
                    ? "font-medium text-[#1a73e8]"
                    : inMonth
                      ? "text-[#3c4043] hover:bg-[#f1f3f4]"
                      : "text-[#b0b0b0] hover:bg-[#f1f3f4]"
              }`}
            >
              {format(day, "d")}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar filters                                                    */
/* ------------------------------------------------------------------ */

function SidebarFilters({
  barbers: barberList,
  serviceOptions,
  selectedBarberId,
  selectedStatus,
  selectedSource,
  selectedServiceId,
  barberCounts,
  statusCounts,
  view,
  date,
  ownerView,
  lockedBarber,
}: {
  barbers: (BarberOption & { color: string })[];
  serviceOptions: ServiceOption[];
  selectedBarberId?: string;
  selectedStatus?: string;
  selectedSource?: string;
  selectedServiceId?: string;
  barberCounts: Map<string, number>;
  statusCounts: Map<string, number>;
  view: CalendarView;
  date: string;
  ownerView: boolean;
  lockedBarber: boolean;
}) {
  const base = { view, date };

  const statusOptions = [
    { value: "", label: "All" },
    { value: "scheduled", label: "Scheduled" },
    { value: "confirmed", label: "Confirmed" },
    { value: "in_progress", label: "In progress" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "no_show", label: "No show" },
  ];

  const sourceOptions = [
    { value: "", label: "All" },
    { value: "manual", label: "Manual" },
    { value: "online", label: "Online" },
    { value: "phone", label: "Phone" },
    { value: "walk_in", label: "Walk-in" },
    { value: "ai_agent", label: "AI Agent" },
    { value: "squire_import", label: "Import" },
  ];

  const totalEvents = Array.from(barberCounts.values()).reduce((s, c) => s + c, 0);

  return (
    <div className="space-y-5">
      {/* Barbers */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#5f6368]">Barbers</p>
        <div className="space-y-0.5">
          {!lockedBarber && (
            <Link
              href={buildHref({ ...base, status: selectedStatus, source: selectedSource, serviceId: selectedServiceId })}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${
                !selectedBarberId
                  ? "bg-[#e8f0fe] font-medium text-[#1a73e8]"
                  : "text-[#3c4043] hover:bg-[#f1f3f4]"
              }`}
            >
              <span>All barbers</span>
              <span className="text-xs text-[#5f6368]">{totalEvents}</span>
            </Link>
          )}
          {barberList.map((b) => (
            <Link
              key={b.id}
              href={buildHref({
                ...base,
                barberId: b.id,
                status: selectedStatus,
                source: selectedSource,
                serviceId: selectedServiceId,
              })}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${
                selectedBarberId === b.id
                  ? "bg-[#e8f0fe] font-medium text-[#1a73e8]"
                  : "text-[#3c4043] hover:bg-[#f1f3f4]"
              } ${lockedBarber && selectedBarberId !== b.id ? "pointer-events-none opacity-40" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                <span>{b.displayName}</span>
              </div>
              <span className="text-xs text-[#5f6368]">{barberCounts.get(b.id) ?? 0}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Status */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#5f6368]">Status</p>
        <div className="space-y-0.5">
          {statusOptions.map((opt) => {
            const count = opt.value === ""
              ? Array.from(statusCounts.values()).reduce((s, c) => s + c, 0)
              : statusCounts.get(opt.value) ?? 0;
            return (
              <Link
                key={opt.label}
                href={buildHref({
                  ...base,
                  barberId: selectedBarberId,
                  status: opt.value || undefined,
                  source: selectedSource,
                  serviceId: selectedServiceId,
                })}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${
                  (selectedStatus ?? "") === opt.value
                    ? "bg-[#e8f0fe] font-medium text-[#1a73e8]"
                    : "text-[#3c4043] hover:bg-[#f1f3f4]"
                }`}
              >
                <span>{opt.label}</span>
                <span className="text-xs text-[#5f6368]">{count}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Source */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#5f6368]">Source</p>
        <div className="space-y-0.5">
          {sourceOptions.map((opt) => (
            <Link
              key={opt.label}
              href={buildHref({
                ...base,
                barberId: selectedBarberId,
                status: selectedStatus,
                source: opt.value || undefined,
                serviceId: selectedServiceId,
              })}
              className={`block rounded-md px-2.5 py-1.5 text-sm ${
                (selectedSource ?? "") === opt.value
                  ? "bg-[#e8f0fe] font-medium text-[#1a73e8]"
                  : "text-[#3c4043] hover:bg-[#f1f3f4]"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Service */}
      {serviceOptions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#5f6368]">Service</p>
          <div className="space-y-0.5">
            <Link
              href={buildHref({
                ...base,
                barberId: selectedBarberId,
                status: selectedStatus,
                source: selectedSource,
              })}
              className={`block rounded-md px-2.5 py-1.5 text-sm ${
                !selectedServiceId
                  ? "bg-[#e8f0fe] font-medium text-[#1a73e8]"
                  : "text-[#3c4043] hover:bg-[#f1f3f4]"
              }`}
            >
              All services
            </Link>
            {serviceOptions.map((svc) => (
              <Link
                key={svc.id}
                href={buildHref({
                  ...base,
                  barberId: selectedBarberId,
                  status: selectedStatus,
                  source: selectedSource,
                  serviceId: svc.id,
                })}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm ${
                  selectedServiceId === svc.id
                    ? "bg-[#e8f0fe] font-medium text-[#1a73e8]"
                    : "text-[#3c4043] hover:bg-[#f1f3f4]"
                }`}
              >
                <span>{svc.name}</span>
                <span className="text-xs text-[#5f6368]">{formatCurrency(svc.priceCents)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Reset */}
      {(selectedBarberId || selectedStatus || selectedSource || selectedServiceId) && !lockedBarber && (
        <Link
          href={buildHref({ view, date })}
          className="block rounded-md px-2.5 py-1.5 text-center text-sm font-medium text-[#d93025] hover:bg-red-50"
        >
          Clear all filters
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function BookingsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser) redirect("/login");
  if (!appUser) return null;

  const view: CalendarView =
    params.view === "day" || params.view === "month" ? params.view : "week";
  const anchorDate = safeAnchorDate(params.date);

  /* --- data queries --- */

  const barberOptions = await db
    .select({ id: barbers.id, userId: barbers.userId, displayName: barbers.displayName, color: barbers.color })
    .from(barbers)
    .where(and(eq(barbers.shopId, appUser.shopId), isNull(barbers.deletedAt)))
    .orderBy(asc(barbers.displayOrder), asc(barbers.displayName));

  const [customerOptions, serviceOptions] = await Promise.all([
    db
      .select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName, phone: customers.phone, email: customers.email })
      .from(customers)
      .where(and(eq(customers.shopId, appUser.shopId), isNull(customers.deletedAt)))
      .orderBy(asc(customers.firstName), asc(customers.lastName)),
    db
      .select({ id: services.id, name: services.name, durationMinutes: services.durationMinutes, priceCents: services.priceCents })
      .from(services)
      .where(and(eq(services.shopId, appUser.shopId), isNull(services.deletedAt)))
      .orderBy(asc(services.displayOrder), asc(services.name)),
  ]);

  const assignedBarberId =
    appUser.role === "barber"
      ? barberOptions.find((b) => b.userId === appUser.id)?.id
      : undefined;
  const ownerView = appUser.role === "owner";
  const selectedBarberId = params.barberId ?? assignedBarberId ?? "";

  const calendarStart = startOfViewRange(view, anchorDate);
  const calendarEnd = endOfViewRange(view, anchorDate);

  const conditions = [
    eq(appointments.shopId, appUser.shopId),
    isNull(appointments.deletedAt),
    gte(appointments.scheduledStart, calendarStart),
    lte(appointments.scheduledStart, calendarEnd),
  ];
  if (selectedBarberId) conditions.push(eq(appointments.barberId, selectedBarberId));
  if (params.status) conditions.push(eq(appointments.status, params.status));
  if (params.source) conditions.push(eq(appointments.source, params.source));
  if (params.serviceId) conditions.push(eq(appointments.serviceId, params.serviceId));

  const rows = await db
    .select({
      id: appointments.id,
      customerId: appointments.customerId,
      barberId: appointments.barberId,
      serviceId: appointments.serviceId,
      scheduledStart: appointments.scheduledStart,
      scheduledEnd: appointments.scheduledEnd,
      status: appointments.status,
      source: appointments.source,
      priceCents: appointments.priceCents,
      notes: appointments.notes,
      customerFirstName: customers.firstName,
      customerLastName: customers.lastName,
      barberName: barbers.displayName,
      serviceName: services.name,
    })
    .from(appointments)
    .leftJoin(customers, eq(appointments.customerId, customers.id))
    .leftJoin(barbers, eq(appointments.barberId, barbers.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .where(and(...conditions))
    .orderBy(asc(appointments.scheduledStart), asc(appointments.createdAt));

  const colorMap = new Map(
    barberOptions.map((b, i) => [b.id, BARBER_PALETTE[i % BARBER_PALETTE.length]]),
  );
  const legendBarbers = barberOptions.map((b) => ({
    ...b,
    color: colorMap.get(b.id) ?? b.color ?? BARBER_PALETTE[0],
  }));
  const events = toEvents(rows, colorMap);

  const barberCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  for (const ev of events) {
    barberCounts.set(ev.barberId, (barberCounts.get(ev.barberId) ?? 0) + 1);
    statusCounts.set(ev.status, (statusCounts.get(ev.status) ?? 0) + 1);
  }

  const prevDate = shiftDate(view, anchorDate, -1);
  const nextDate = shiftDate(view, anchorDate, 1);

  const baseNav: Omit<NavParams, "date"> = {
    view,
    barberId: selectedBarberId || undefined,
    status: params.status,
    source: params.source,
    serviceId: params.serviceId,
  };

  const weekDays = eachDayOfInterval({
    start: startOfWeek(anchorDate, { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(anchorDate, { weekStartsOn: WEEK_STARTS_ON }),
  });
  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(anchorDate), { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: WEEK_STARTS_ON }),
  });

  const dateStr = format(anchorDate, "yyyy-MM-dd");
  const returnToHref = buildHref({ ...baseNav, date: dateStr });
  const hrefForEvent = (id: string) => buildHref({ ...baseNav, date: dateStr, appointmentId: id });
  const selectedAppointment = params.appointmentId
    ? events.find((ev) => ev.id === params.appointmentId)
    : null;

  const defaultAppointmentDate = dateStr;
  const defaultAppointmentTime = view === "day" ? "09:00" : "10:00";

  /* --- view toggle button data --- */
  const viewButtons: { id: CalendarView; icon: React.ReactNode; label: string }[] = [
    { id: "day", icon: <PanelTop className="size-4" />, label: "Day" },
    { id: "week", icon: <CalendarDays className="size-4" />, label: "Week" },
    { id: "month", icon: <LayoutGrid className="size-4" />, label: "Month" },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* ── Top toolbar ── */}
      <header className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6" style={{ borderColor: "#dadce0" }}>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={buildHref({ ...baseNav, date: format(new Date(), "yyyy-MM-dd") })}
            className="rounded-md border px-4 py-1.5 text-sm font-medium text-[#3c4043] hover:bg-[#f1f3f4]"
            style={{ borderColor: "#dadce0" }}
          >
            Today
          </Link>

          <div className="flex items-center gap-0.5">
            <Link
              href={buildHref({ ...baseNav, date: format(prevDate, "yyyy-MM-dd") })}
              className="rounded-full p-1.5 hover:bg-[#f1f3f4]"
            >
              <ChevronLeft className="size-5 text-[#5f6368]" />
            </Link>
            <Link
              href={buildHref({ ...baseNav, date: format(nextDate, "yyyy-MM-dd") })}
              className="rounded-full p-1.5 hover:bg-[#f1f3f4]"
            >
              <ChevronRight className="size-5 text-[#5f6368]" />
            </Link>
          </div>

          <h1 className="text-xl font-normal text-[#3c4043]">{rangeLabel(view, anchorDate)}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {customerOptions.length > 0 && barberOptions.length > 0 && (
            <NewAppointmentDialog
              barbers={barberOptions.map((b) => ({ id: b.id, displayName: b.displayName }))}
              customers={customerOptions}
              services={serviceOptions}
              defaultBarberId={selectedBarberId || undefined}
              defaultDate={defaultAppointmentDate}
              defaultTime={defaultAppointmentTime}
              lockBarber={Boolean(assignedBarberId)}
            />
          )}

          <div className="flex rounded-lg border" style={{ borderColor: "#dadce0" }}>
            {viewButtons.map((btn) => (
              <Link
                key={btn.id}
                href={buildHref({ ...baseNav, view: btn.id, date: dateStr })}
                className={`flex items-center gap-1.5 border-r px-3 py-1.5 text-sm last:border-r-0 ${
                  view === btn.id
                    ? "bg-[#e8f0fe] font-medium text-[#1a73e8]"
                    : "text-[#3c4043] hover:bg-[#f1f3f4]"
                }`}
                style={{ borderColor: "#dadce0" }}
              >
                {btn.icon}
                <span className="hidden sm:inline">{btn.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden w-[220px] shrink-0 border-r p-4 xl:block" style={{ borderColor: "#dadce0" }}>
          <MiniMonth
            anchorDate={anchorDate}
            view={view}
            barberId={selectedBarberId || undefined}
            status={params.status}
            source={params.source}
            serviceId={params.serviceId}
          />
          <div className="my-4 border-t" style={{ borderColor: "#dadce0" }} />
          <SidebarFilters
            barbers={legendBarbers}
            serviceOptions={serviceOptions}
            selectedBarberId={selectedBarberId || undefined}
            selectedStatus={params.status}
            selectedSource={params.source}
            selectedServiceId={params.serviceId}
            barberCounts={barberCounts}
            statusCounts={statusCounts}
            view={view}
            date={dateStr}
            ownerView={ownerView}
            lockedBarber={Boolean(assignedBarberId)}
          />
        </aside>

        {/* Calendar content */}
        <main className="min-w-0 flex-1">
          {view === "month" ? (
            <MonthGrid anchorDate={anchorDate} days={monthDays} events={events} hrefForEvent={hrefForEvent} />
          ) : view === "day" ? (
            <TimeGrid days={[anchorDate]} events={events.filter((e) => isSameDay(e.start, anchorDate))} hrefForEvent={hrefForEvent} />
          ) : (
            <TimeGrid days={weekDays} events={events} hrefForEvent={hrefForEvent} />
          )}
        </main>
      </div>

      {/* ── Appointment detail modal ── */}
      {selectedAppointment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
            {/* Header */}
            <div className="flex items-start justify-between border-b px-5 py-4" style={{ borderColor: "#dadce0" }}>
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ backgroundColor: selectedAppointment.barberColor }} />
                  <span className="text-xs font-medium uppercase text-[#5f6368]">
                    {selectedAppointment.barberName} &middot; {selectedAppointment.status.replace(/_/g, " ")}
                  </span>
                </div>
                <h2 className="mt-1.5 truncate text-xl font-normal text-[#3c4043]">
                  {selectedAppointment.customerName}
                </h2>
                <p className="mt-0.5 text-sm text-[#5f6368]">
                  {format(selectedAppointment.start, "EEEE, MMMM d")} &middot;{" "}
                  {fmt12(selectedAppointment.start)}
                  {selectedAppointment.end ? ` – ${fmt12(selectedAppointment.end)}` : ""}
                </p>
              </div>
              <Link
                href={returnToHref}
                className="rounded-full p-1.5 hover:bg-[#f1f3f4]"
              >
                <X className="size-5 text-[#5f6368]" />
              </Link>
            </div>

            {/* Detail + Edit */}
            <div className="grid gap-0 sm:grid-cols-2">
              {/* Info */}
              <div className="space-y-3 border-r p-5" style={{ borderColor: "#dadce0" }}>
                <div className="flex items-start gap-2.5">
                  <UserRound className="mt-0.5 size-4 text-[#5f6368]" />
                  <div>
                    <p className="text-xs font-medium text-[#5f6368]">Customer</p>
                    <p className="text-sm text-[#3c4043]">{selectedAppointment.customerName}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Clock3 className="mt-0.5 size-4 text-[#5f6368]" />
                  <div>
                    <p className="text-xs font-medium text-[#5f6368]">Time</p>
                    <p className="text-sm text-[#3c4043]">
                      {format(selectedAppointment.start, "EEE, MMM d")} at {fmt12(selectedAppointment.start)}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Scissors className="mt-0.5 size-4 text-[#5f6368]" />
                  <div>
                    <p className="text-xs font-medium text-[#5f6368]">Service</p>
                    <p className="text-sm text-[#3c4043]">{selectedAppointment.serviceName ?? "Not set"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <StickyNote className="mt-0.5 size-4 text-[#5f6368]" />
                  <div>
                    <p className="text-xs font-medium text-[#5f6368]">Notes</p>
                    <p className="text-sm leading-relaxed text-[#3c4043]">
                      {selectedAppointment.notes?.trim() || "No notes."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Edit */}
              <div className="p-5">
                <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-[#5f6368]">
                  <Pencil className="size-3.5" /> Edit
                </div>
                <form action={updateAppointmentAction} className="space-y-3">
                  <input name="appointmentId" type="hidden" value={selectedAppointment.id} />
                  <input name="customerId" type="hidden" value={selectedAppointment.customerId} />
                  <input name="returnTo" type="hidden" value={returnToHref} />

                  <label className="block space-y-1">
                    <span className="text-xs text-[#5f6368]">Barber</span>
                    <select className="h-9 w-full rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]" style={{ borderColor: "#dadce0" }} defaultValue={selectedAppointment.barberId} name="barberId">
                      {legendBarbers.map((b) => <option key={b.id} value={b.id}>{b.displayName}</option>)}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs text-[#5f6368]">Service</span>
                    <select className="h-9 w-full rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]" style={{ borderColor: "#dadce0" }} defaultValue={selectedAppointment.serviceId ?? undefined} name="serviceId">
                      {serviceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="text-xs text-[#5f6368]">Date</span>
                      <input className="h-9 w-full rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]" style={{ borderColor: "#dadce0" }} defaultValue={format(selectedAppointment.start, "yyyy-MM-dd")} name="appointmentDate" type="date" />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-[#5f6368]">Time</span>
                      <input className="h-9 w-full rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]" style={{ borderColor: "#dadce0" }} defaultValue={format(selectedAppointment.start, "HH:mm")} name="appointmentTime" type="time" />
                    </label>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-xs text-[#5f6368]">Status</span>
                    <select className="h-9 w-full rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]" style={{ borderColor: "#dadce0" }} defaultValue={selectedAppointment.status} name="status">
                      <option value="scheduled">Scheduled</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="no_show">No Show</option>
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs text-[#5f6368]">Notes</span>
                    <textarea className="min-h-20 w-full rounded-md border bg-white px-2.5 py-2 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]" style={{ borderColor: "#dadce0" }} defaultValue={selectedAppointment.notes ?? ""} name="notes" />
                  </label>

                  <Button className="h-9 w-full rounded-md bg-[#1a73e8] text-sm font-medium text-white hover:bg-[#1765cc]">
                    Save changes
                  </Button>
                </form>

                <form action={deleteAppointmentAction} className="mt-2">
                  <input name="appointmentId" type="hidden" value={selectedAppointment.id} />
                  <input name="customerId" type="hidden" value={selectedAppointment.customerId} />
                  <input name="returnTo" type="hidden" value={returnToHref} />
                  <Button className="h-9 w-full rounded-md border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50" variant="ghost">
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
