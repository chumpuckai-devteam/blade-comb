import { toZonedTime } from "date-fns-tz";
import {
  DEFAULT_SHOP_CLOSE_TIME,
  DEFAULT_SHOP_OPEN_TIME,
  type WalkInCapacityConfig,
} from "@/lib/walk-in-capacity";

export const BOOKING_SLOT_INTERVAL_MINUTES = 15;

type TimeRange = {
  start: string;
  end: string;
};

type AppointmentWindow = {
  id?: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  status?: string | null;
};

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatLocalDateKey(value: Date, timezone: string) {
  const zoned = toZonedTime(value, timezone);
  const year = zoned.getFullYear();
  const month = String(zoned.getMonth() + 1).padStart(2, "0");
  const day = String(zoned.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mergeIntervals(intervals: Array<[number, number]>) {
  if (intervals.length <= 1) {
    return intervals;
  }

  const sorted = [...intervals].sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [[...sorted[0]] as [number, number]];

  for (const current of sorted.slice(1)) {
    const previous = merged[merged.length - 1];

    if (current[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], current[1]);
    } else {
      merged.push([...current] as [number, number]);
    }
  }

  return merged;
}

function rangesOverlap(
  startMinutes: number,
  endMinutes: number,
  intervals: Array<[number, number]>,
) {
  return intervals.some(([bookedStart, bookedEnd]) => {
    const overlapStart = Math.max(startMinutes, bookedStart);
    const overlapEnd = Math.min(endMinutes, bookedEnd);
    return overlapEnd > overlapStart;
  });
}

export function normalizeTimeRange(range: TimeRange) {
  const openMinutes = timeToMinutes(DEFAULT_SHOP_OPEN_TIME);
  const closeMinutes = timeToMinutes(DEFAULT_SHOP_CLOSE_TIME);
  const startMinutes = Math.max(openMinutes, timeToMinutes(range.start));
  const endMinutes = Math.min(closeMinutes, timeToMinutes(range.end));

  if (endMinutes <= startMinutes) {
    return null;
  }

  return {
    startMinutes,
    endMinutes,
  };
}

export function getBarberWorkingWindowsForDate({
  barberId,
  config,
  date,
  timezone,
}: {
  barberId: string;
  config: WalkInCapacityConfig;
  date: Date;
  timezone: string;
}) {
  const zonedDate = toZonedTime(date, timezone);
  const weekday = zonedDate.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const dateKey = formatLocalDateKey(date, timezone);

  if (config.closedDates.has(dateKey)) {
    return {
      dateKey,
      reason: "shop_closed" as const,
      windows: [] as Array<{ startMinutes: number; endMinutes: number }>,
    };
  }

  if (config.barberUnavailableDates[barberId]?.has(dateKey)) {
    return {
      dateKey,
      reason: "barber_unavailable" as const,
      windows: [] as Array<{ startMinutes: number; endMinutes: number }>,
    };
  }

  const schedule =
    config.weeklyHours.barbers[barberId]?.[weekday] ??
    config.weeklyHours.default?.[weekday] ??
    [];
  const windows = schedule
    .map((range) => normalizeTimeRange(range))
    .filter((range): range is { startMinutes: number; endMinutes: number } => Boolean(range));

  return {
    dateKey,
    reason: windows.length > 0 ? null : ("off_day" as const),
    windows,
  };
}

export function buildBookedIntervalsForDate({
  appointments,
  dateKey,
  timezone,
  excludeAppointmentId,
}: {
  appointments: AppointmentWindow[];
  dateKey: string;
  timezone: string;
  excludeAppointmentId?: string;
}) {
  const activeStatuses = new Set(["scheduled", "confirmed", "in_progress"]);

  const intervals = appointments.flatMap((appointment) => {
    if (!appointment.scheduledStart) {
      return [];
    }

    if (excludeAppointmentId && appointment.id === excludeAppointmentId) {
      return [];
    }

    if (appointment.status && !activeStatuses.has(appointment.status)) {
      return [];
    }

    const zonedStart = toZonedTime(appointment.scheduledStart, timezone);
    if (formatLocalDateKey(appointment.scheduledStart, timezone) !== dateKey) {
      return [];
    }

    const zonedEnd = toZonedTime(
      appointment.scheduledEnd ?? appointment.scheduledStart,
      timezone,
    );
    const startMinutes = zonedStart.getHours() * 60 + zonedStart.getMinutes();
    const endMinutes = zonedEnd.getHours() * 60 + zonedEnd.getMinutes();

    if (endMinutes <= startMinutes) {
      return [];
    }

    return [[startMinutes, endMinutes] as [number, number]];
  });

  return mergeIntervals(intervals);
}

export function validateAppointmentTime({
  barberId,
  config,
  date,
  timezone,
  scheduledStart,
  scheduledEnd,
  existingAppointments,
  excludeAppointmentId,
}: {
  barberId: string;
  config: WalkInCapacityConfig;
  date: Date;
  timezone: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  existingAppointments: AppointmentWindow[];
  excludeAppointmentId?: string;
}) {
  const windows = getBarberWorkingWindowsForDate({
    barberId,
    config,
    date,
    timezone,
  });

  if (windows.reason === "shop_closed") {
    return "The shop is closed on that date.";
  }

  if (windows.reason === "barber_unavailable") {
    return "That barber is marked unavailable on that date.";
  }

  const zonedStart = toZonedTime(scheduledStart, timezone);
  const zonedEnd = toZonedTime(scheduledEnd, timezone);
  const startMinutes = zonedStart.getHours() * 60 + zonedStart.getMinutes();
  const endMinutes = zonedEnd.getHours() * 60 + zonedEnd.getMinutes();

  if (
    zonedStart.getFullYear() !== zonedEnd.getFullYear() ||
    zonedStart.getMonth() !== zonedEnd.getMonth() ||
    zonedStart.getDate() !== zonedEnd.getDate()
  ) {
    return "Appointments must start and end on the same day.";
  }

  const fitsSchedule = windows.windows.some(
    (window) =>
      startMinutes >= window.startMinutes && endMinutes <= window.endMinutes,
  );

  if (!fitsSchedule) {
    return `Appointment must fall within the barber's scheduled hours between ${DEFAULT_SHOP_OPEN_TIME} and ${DEFAULT_SHOP_CLOSE_TIME}.`;
  }

  const bookedIntervals = buildBookedIntervalsForDate({
    appointments: existingAppointments,
    dateKey: windows.dateKey,
    timezone,
    excludeAppointmentId,
  });

  if (rangesOverlap(startMinutes, endMinutes, bookedIntervals)) {
    return "That time overlaps another appointment for the selected barber.";
  }

  return null;
}

export function generateBookableStartTimes({
  barberId,
  config,
  date,
  timezone,
  durationMinutes,
  existingAppointments,
  excludeAppointmentId,
}: {
  barberId: string;
  config: WalkInCapacityConfig;
  date: Date;
  timezone: string;
  durationMinutes: number;
  existingAppointments: AppointmentWindow[];
  excludeAppointmentId?: string;
}) {
  const windows = getBarberWorkingWindowsForDate({
    barberId,
    config,
    date,
    timezone,
  });

  if (windows.reason) {
    return {
      reason: windows.reason,
      times: [] as string[],
    };
  }

  const bookedIntervals = buildBookedIntervalsForDate({
    appointments: existingAppointments,
    dateKey: windows.dateKey,
    timezone,
    excludeAppointmentId,
  });

  const times: string[] = [];

  for (const window of windows.windows) {
    for (
      let startMinutes = window.startMinutes;
      startMinutes + durationMinutes <= window.endMinutes;
      startMinutes += BOOKING_SLOT_INTERVAL_MINUTES
    ) {
      const endMinutes = startMinutes + durationMinutes;

      if (!rangesOverlap(startMinutes, endMinutes, bookedIntervals)) {
        times.push(minutesToTime(startMinutes));
      }
    }
  }

  return {
    reason: null,
    times,
  };
}
