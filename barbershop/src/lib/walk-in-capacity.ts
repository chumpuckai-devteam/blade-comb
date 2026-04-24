import { addDays, addMinutes, endOfDay, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export const DEFAULT_WALK_IN_SLOT_MINUTES = 30;
export const DEFAULT_WALK_IN_HOURS_PER_DAY = 8;
export const DEFAULT_WALK_IN_LOOKAHEAD_DAYS = 7;
export const DEFAULT_SHOP_OPEN_TIME = "10:00";
export const DEFAULT_SHOP_CLOSE_TIME = "19:00";

type TimeRange = {
  start: string;
  end: string;
};

type WeeklySchedule = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, TimeRange[]>>;

type WalkInCapacitySettings = {
  slotMinutes?: number;
  weeklyHours?: {
    default?: WeeklySchedule;
    barbers?: Record<string, WeeklySchedule>;
  };
  closedDates?: string[];
  barberUnavailableDates?: Record<string, string[]>;
};

export type WalkInCapacityConfig = {
  slotMinutes: number;
  weeklyHours: {
    default: WeeklySchedule | null;
    barbers: Record<string, WeeklySchedule>;
  };
  closedDates: Set<string>;
  barberUnavailableDates: Record<string, Set<string>>;
  hasConfiguredHours: boolean;
};

export type WalkInAppointmentWindow = {
  barberId: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
};

export function parseWalkInCapacityConfig(settings: unknown): WalkInCapacityConfig {
  const source =
    settings && typeof settings === "object"
      ? (settings as { walkInCapacity?: WalkInCapacitySettings }).walkInCapacity
      : undefined;

  const slotMinutes =
    typeof source?.slotMinutes === "number" && source.slotMinutes > 0
      ? source.slotMinutes
      : DEFAULT_WALK_IN_SLOT_MINUTES;

  const defaultWeeklyHours = normalizeWeeklySchedule(source?.weeklyHours?.default);
  const barberHoursEntries = Object.entries(source?.weeklyHours?.barbers ?? {}).map(
    ([barberId, weeklyHours]) => [barberId, normalizeWeeklySchedule(weeklyHours)] as const,
  );
  const barberWeeklyHours = Object.fromEntries(
    barberHoursEntries.filter(([, weeklyHours]) => weeklyHours),
  ) as Record<string, WeeklySchedule>;
  const hasConfiguredHours =
    Boolean(defaultWeeklyHours) || barberHoursEntries.some(([, value]) => value);

  return {
    slotMinutes,
    weeklyHours: {
      default: defaultWeeklyHours ?? buildDefaultWeeklySchedule(),
      barbers: barberWeeklyHours,
    },
    closedDates: new Set(
      Array.isArray(source?.closedDates)
        ? source.closedDates.filter((value): value is string => typeof value === "string")
        : [],
    ),
    barberUnavailableDates: Object.fromEntries(
      Object.entries(source?.barberUnavailableDates ?? {}).map(([barberId, dates]) => [
        barberId,
        new Set(
          Array.isArray(dates)
            ? dates.filter((value): value is string => typeof value === "string")
            : [],
        ),
      ]),
    ),
    hasConfiguredHours,
  };
}

export function estimateWalkInCapacityFromDefaults({
  walkInBarberCount,
  appointmentWindows,
  slotMinutes,
  lookaheadDays = DEFAULT_WALK_IN_LOOKAHEAD_DAYS,
}: {
  walkInBarberCount: number;
  appointmentWindows: Array<Pick<WalkInAppointmentWindow, "scheduledStart" | "scheduledEnd">>;
  slotMinutes: number;
  lookaheadDays?: number;
}) {
  const totalWalkInMinutes =
    walkInBarberCount * lookaheadDays * DEFAULT_WALK_IN_HOURS_PER_DAY * 60;

  const bookedWalkInMinutes = appointmentWindows.reduce((sum, appointment) => {
    if (!appointment.scheduledStart) {
      return sum;
    }

    const durationMinutes = Math.max(
      slotMinutes,
      Math.round(
        ((appointment.scheduledEnd ??
          addMinutes(appointment.scheduledStart, slotMinutes)).getTime() -
          appointment.scheduledStart.getTime()) /
          60000,
      ),
    );

    return sum + durationMinutes;
  }, 0);

  return Math.max(0, Math.floor((totalWalkInMinutes - bookedWalkInMinutes) / slotMinutes));
}

export function calculateWalkInCapacityFromAvailability({
  timezone,
  walkInBarberIds,
  appointmentWindows,
  config,
  startDate = new Date(),
  lookaheadDays = DEFAULT_WALK_IN_LOOKAHEAD_DAYS,
}: {
  timezone: string;
  walkInBarberIds: string[];
  appointmentWindows: WalkInAppointmentWindow[];
  config: WalkInCapacityConfig;
  startDate?: Date;
  lookaheadDays?: number;
}) {
  const zonedStart = startOfDay(toZonedTime(startDate, timezone));
  const bookedIntervals = new Map<string, Array<[number, number]>>();

  for (const appointment of appointmentWindows) {
    if (!appointment.scheduledStart) {
      continue;
    }

    const zonedStartTime = toZonedTime(appointment.scheduledStart, timezone);
    const zonedEndTime = toZonedTime(
      appointment.scheduledEnd ?? addMinutes(appointment.scheduledStart, config.slotMinutes),
      timezone,
    );
    const localDateKey = formatDateKey(zonedStartTime);
    const key = `${appointment.barberId}:${localDateKey}`;
    const startMinutes = zonedStartTime.getHours() * 60 + zonedStartTime.getMinutes();
    const endMinutes = Math.max(
      startMinutes + config.slotMinutes,
      zonedEndTime.getHours() * 60 + zonedEndTime.getMinutes(),
    );
    const intervals = bookedIntervals.get(key) ?? [];

    intervals.push([startMinutes, endMinutes]);
    bookedIntervals.set(key, intervals);
  }

  let totalSlots = 0;

  for (let index = 0; index < lookaheadDays; index += 1) {
    const zonedDay = addDays(zonedStart, index);
    const weekday = zonedDay.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const dateKey = formatDateKey(zonedDay);

    if (config.closedDates.has(dateKey)) {
      continue;
    }

    for (const barberId of walkInBarberIds) {
      if (config.barberUnavailableDates[barberId]?.has(dateKey)) {
        continue;
      }

      const schedule =
        config.weeklyHours.barbers[barberId]?.[weekday] ??
        config.weeklyHours.default?.[weekday] ??
        [];

      if (!schedule.length) {
        continue;
      }

      const intervals = mergeIntervals(bookedIntervals.get(`${barberId}:${dateKey}`) ?? []);
      let barberMinutes = 0;

      for (const range of schedule) {
        const startMinutes = timeToMinutes(range.start);
        const endMinutes = timeToMinutes(range.end);

        if (endMinutes <= startMinutes) {
          continue;
        }

        barberMinutes += subtractBookedMinutes({
          startMinutes,
          endMinutes,
          bookedIntervals: intervals,
        });
      }

      totalSlots += Math.floor(barberMinutes / config.slotMinutes);
    }
  }

  return Math.max(0, totalSlots);
}

function normalizeWeeklySchedule(value: unknown): WeeklySchedule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const schedule = Object.entries(value).reduce<WeeklySchedule>((acc, [day, ranges]) => {
    const dayNumber = Number(day) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

    if (!Number.isInteger(dayNumber) || dayNumber < 0 || dayNumber > 6) {
      return acc;
    }

    const normalizedRanges = Array.isArray(ranges)
      ? ranges.filter(isTimeRange)
      : [];

    if (normalizedRanges.length > 0) {
      acc[dayNumber] = normalizedRanges;
    }

    return acc;
  }, {});

  return Object.keys(schedule).length > 0 ? schedule : null;
}

function isTimeRange(value: unknown): value is TimeRange {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeRange = value as Partial<TimeRange>;
  return typeof maybeRange.start === "string" && typeof maybeRange.end === "string";
}

function buildDefaultWeeklySchedule(): WeeklySchedule {
  return {
    0: [{ start: DEFAULT_SHOP_OPEN_TIME, end: DEFAULT_SHOP_CLOSE_TIME }],
    1: [{ start: DEFAULT_SHOP_OPEN_TIME, end: DEFAULT_SHOP_CLOSE_TIME }],
    2: [{ start: DEFAULT_SHOP_OPEN_TIME, end: DEFAULT_SHOP_CLOSE_TIME }],
    3: [{ start: DEFAULT_SHOP_OPEN_TIME, end: DEFAULT_SHOP_CLOSE_TIME }],
    4: [{ start: DEFAULT_SHOP_OPEN_TIME, end: DEFAULT_SHOP_CLOSE_TIME }],
    5: [{ start: DEFAULT_SHOP_OPEN_TIME, end: DEFAULT_SHOP_CLOSE_TIME }],
    6: [{ start: DEFAULT_SHOP_OPEN_TIME, end: DEFAULT_SHOP_CLOSE_TIME }],
  };
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function mergeIntervals(intervals: Array<[number, number]>) {
  if (intervals.length <= 1) {
    return intervals;
  }

  const sorted = [...intervals].sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [sorted[0]];

  for (const current of sorted.slice(1)) {
    const previous = merged[merged.length - 1];

    if (current[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], current[1]);
      continue;
    }

    merged.push([...current] as [number, number]);
  }

  return merged;
}

function subtractBookedMinutes({
  startMinutes,
  endMinutes,
  bookedIntervals,
}: {
  startMinutes: number;
  endMinutes: number;
  bookedIntervals: Array<[number, number]>;
}) {
  let remainingMinutes = endMinutes - startMinutes;

  for (const [bookedStart, bookedEnd] of bookedIntervals) {
    const overlapStart = Math.max(startMinutes, bookedStart);
    const overlapEnd = Math.min(endMinutes, bookedEnd);

    if (overlapEnd > overlapStart) {
      remainingMinutes -= overlapEnd - overlapStart;
    }
  }

  return Math.max(0, remainingMinutes);
}

function formatDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateWalkInCapacityPerDay({
  timezone,
  walkInBarberIds,
  appointmentWindows,
  config,
  startDate = new Date(),
  lookaheadDays = DEFAULT_WALK_IN_LOOKAHEAD_DAYS,
}: {
  timezone: string;
  walkInBarberIds: string[];
  appointmentWindows: WalkInAppointmentWindow[];
  config: WalkInCapacityConfig;
  startDate?: Date;
  lookaheadDays?: number;
}): Array<{ date: Date; dateKey: string; slots: number }> {
  const zonedStart = startOfDay(toZonedTime(startDate, timezone));
  const bookedIntervals = new Map<string, Array<[number, number]>>();

  for (const appointment of appointmentWindows) {
    if (!appointment.scheduledStart) continue;

    const zonedStartTime = toZonedTime(appointment.scheduledStart, timezone);
    const zonedEndTime = toZonedTime(
      appointment.scheduledEnd ?? addMinutes(appointment.scheduledStart, config.slotMinutes),
      timezone,
    );
    const localDateKey = formatDateKey(zonedStartTime);
    const key = `${appointment.barberId}:${localDateKey}`;
    const startMinutes = zonedStartTime.getHours() * 60 + zonedStartTime.getMinutes();
    const endMinutes = Math.max(
      startMinutes + config.slotMinutes,
      zonedEndTime.getHours() * 60 + zonedEndTime.getMinutes(),
    );
    const intervals = bookedIntervals.get(key) ?? [];
    intervals.push([startMinutes, endMinutes]);
    bookedIntervals.set(key, intervals);
  }

  const results: Array<{ date: Date; dateKey: string; slots: number }> = [];

  for (let index = 0; index < lookaheadDays; index += 1) {
    const zonedDay = addDays(zonedStart, index);
    const weekday = zonedDay.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const dateKey = formatDateKey(zonedDay);
    let daySlots = 0;

    if (!config.closedDates.has(dateKey)) {
      for (const barberId of walkInBarberIds) {
        if (config.barberUnavailableDates[barberId]?.has(dateKey)) continue;

        const schedule =
          config.weeklyHours.barbers[barberId]?.[weekday] ??
          config.weeklyHours.default?.[weekday] ??
          [];

        if (!schedule.length) continue;

        const intervals = mergeIntervals(bookedIntervals.get(`${barberId}:${dateKey}`) ?? []);
        let barberMinutes = 0;

        for (const range of schedule) {
          const startMinutes = timeToMinutes(range.start);
          const endMinutes = timeToMinutes(range.end);
          if (endMinutes <= startMinutes) continue;

          barberMinutes += subtractBookedMinutes({
            startMinutes,
            endMinutes,
            bookedIntervals: intervals,
          });
        }

        daySlots += Math.floor(barberMinutes / config.slotMinutes);
      }
    }

    results.push({
      date: zonedDay,
      dateKey,
      slots: Math.max(0, daySlots),
    });
  }

  return results;
}

export function nextWalkInWindowEnd(timezone: string, from = new Date()) {
  const zonedNow = toZonedTime(from, timezone);
  return fromZonedTime(
    endOfDay(addDays(zonedNow, DEFAULT_WALK_IN_LOOKAHEAD_DAYS - 1)),
    timezone,
  );
}
