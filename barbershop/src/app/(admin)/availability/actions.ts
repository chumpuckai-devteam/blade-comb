"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentAppUser } from "@/lib/auth";
import { normalizeTimeRange } from "@/lib/booking-availability";
import { db } from "@/lib/db/client";
import { shops } from "@/lib/db/schema";
import {
  DEFAULT_SHOP_CLOSE_TIME,
  DEFAULT_SHOP_OPEN_TIME,
} from "@/lib/walk-in-capacity";

type WeeklyScheduleInput = Partial<
  Record<string, Array<{ start: string; end: string }>>
>;

function validateWeeklySchedule(schedule: WeeklyScheduleInput) {
  for (const [day, ranges] of Object.entries(schedule)) {
    if (!Array.isArray(ranges)) {
      throw new Error(`Invalid schedule for day ${day}.`);
    }

    for (const range of ranges) {
      if (!range?.start || !range?.end) {
        throw new Error(`Each active day must have a start and end time.`);
      }

      if (!normalizeTimeRange(range)) {
        throw new Error(
          `Availability must stay within shop hours ${DEFAULT_SHOP_OPEN_TIME} to ${DEFAULT_SHOP_CLOSE_TIME}.`,
        );
      }
    }
  }
}

export async function updateBarberAvailabilityAction(formData: FormData) {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser || !appUser) {
    throw new Error("You must be signed in.");
  }

  if (appUser.role !== "owner") {
    throw new Error("Only shop owners can update availability settings.");
  }

  const barberId = formData.get("barberId")?.toString();
  const scheduleJson = formData.get("schedule")?.toString();

  if (!barberId || !scheduleJson) {
    throw new Error("Barber ID and schedule are required.");
  }

  let schedule: WeeklyScheduleInput;
  try {
    schedule = JSON.parse(scheduleJson);
  } catch {
    throw new Error("Invalid schedule format.");
  }

  validateWeeklySchedule(schedule);

  // Read current settings
  const [shop] = await db
    .select({ settings: shops.settings })
    .from(shops)
    .where(eq(shops.id, appUser.shopId))
    .limit(1);

  const currentSettings = (shop?.settings ?? {}) as Record<string, unknown>;
  const walkInCapacity = (currentSettings.walkInCapacity ?? {}) as Record<string, unknown>;
  const weeklyHours = (walkInCapacity.weeklyHours ?? {}) as Record<string, unknown>;
  const barberHours = (weeklyHours.barbers ?? {}) as Record<string, unknown>;

  const updatedSettings = {
    ...currentSettings,
    walkInCapacity: {
      ...walkInCapacity,
      weeklyHours: {
        ...weeklyHours,
        barbers: {
          ...barberHours,
          [barberId]: schedule,
        },
      },
    },
  };

  await db
    .update(shops)
    .set({ settings: updatedSettings })
    .where(eq(shops.id, appUser.shopId));

  revalidatePath("/availability");
  revalidatePath("/dashboard");

  return { success: true };
}

export async function updateBarberUnavailableDatesAction(formData: FormData) {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser || !appUser) {
    throw new Error("You must be signed in.");
  }

  if (appUser.role !== "owner") {
    throw new Error("Only shop owners can update availability settings.");
  }

  const barberId = formData.get("barberId")?.toString();
  const datesJson = formData.get("dates")?.toString();

  if (!barberId || !datesJson) {
    throw new Error("Barber ID and dates are required.");
  }

  let dates: string[];
  try {
    dates = JSON.parse(datesJson);
  } catch {
    throw new Error("Invalid dates format.");
  }

  const [shop] = await db
    .select({ settings: shops.settings })
    .from(shops)
    .where(eq(shops.id, appUser.shopId))
    .limit(1);

  const currentSettings = (shop?.settings ?? {}) as Record<string, unknown>;
  const walkInCapacity = (currentSettings.walkInCapacity ?? {}) as Record<string, unknown>;
  const barberUnavailable = (walkInCapacity.barberUnavailableDates ?? {}) as Record<string, unknown>;

  const updatedSettings = {
    ...currentSettings,
    walkInCapacity: {
      ...walkInCapacity,
      barberUnavailableDates: {
        ...barberUnavailable,
        [barberId]: dates,
      },
    },
  };

  await db
    .update(shops)
    .set({ settings: updatedSettings })
    .where(eq(shops.id, appUser.shopId));

  revalidatePath("/availability");
  revalidatePath("/dashboard");

  return { success: true };
}

export async function updateShopClosedDatesAction(formData: FormData) {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser || !appUser) {
    throw new Error("You must be signed in.");
  }

  if (appUser.role !== "owner") {
    throw new Error("Only shop owners can update availability settings.");
  }

  const datesJson = formData.get("dates")?.toString();

  if (!datesJson) {
    throw new Error("Dates are required.");
  }

  let dates: string[];
  try {
    dates = JSON.parse(datesJson);
  } catch {
    throw new Error("Invalid dates format.");
  }

  const [shop] = await db
    .select({ settings: shops.settings })
    .from(shops)
    .where(eq(shops.id, appUser.shopId))
    .limit(1);

  const currentSettings = (shop?.settings ?? {}) as Record<string, unknown>;
  const walkInCapacity = (currentSettings.walkInCapacity ?? {}) as Record<string, unknown>;

  const updatedSettings = {
    ...currentSettings,
    walkInCapacity: {
      ...walkInCapacity,
      closedDates: dates,
    },
  };

  await db
    .update(shops)
    .set({ settings: updatedSettings })
    .where(eq(shops.id, appUser.shopId));

  revalidatePath("/availability");
  revalidatePath("/dashboard");

  return { success: true };
}
