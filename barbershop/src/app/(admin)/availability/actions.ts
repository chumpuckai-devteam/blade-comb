"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { shops } from "@/lib/db/schema";

type WeeklyScheduleInput = Partial<
  Record<string, Array<{ start: string; end: string }>>
>;

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
