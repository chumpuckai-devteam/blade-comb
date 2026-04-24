"use server";

import { addMinutes, endOfDay, startOfDay } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentAppUser } from "@/lib/auth";
import {
  generateBookableStartTimes,
  validateAppointmentTime,
} from "@/lib/booking-availability";
import { db } from "@/lib/db/client";
import {
  appointments,
  barbers,
  customers,
  services,
  shops,
} from "@/lib/db/schema";
import { parseWalkInCapacityConfig } from "@/lib/walk-in-capacity";

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 45;

const appointmentEditorSchema = z.object({
  appointmentId: z.uuid().optional(),
  customerId: z.uuid(),
  barberId: z.uuid(),
  serviceId: z.uuid().optional(),
  appointmentDate: z.string().min(1, "Appointment date is required."),
  appointmentTime: z.string().min(1, "Appointment time is required."),
  status: z.enum([
    "scheduled",
    "confirmed",
    "in_progress",
    "completed",
    "cancelled",
    "no_show",
  ]),
  source: z.enum(["manual", "phone", "walk_in", "online", "ai_agent", "squire_import"]).optional(),
  notes: z.string().optional(),
  returnTo: z.string().optional(),
});

type ParseAppointmentOptions = {
  requireService?: boolean;
};

async function syncCustomerAppointmentStats(customerId: string, shopId: string) {
  const customerAppointments = await db
    .select({
      status: appointments.status,
      scheduledStart: appointments.scheduledStart,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.customerId, customerId),
        eq(appointments.shopId, shopId),
        isNull(appointments.deletedAt),
      ),
    );

  const completedAppointments = customerAppointments.filter(
    (appointment) => appointment.status === "completed",
  );
  const noShowCount = customerAppointments.filter(
    (appointment) => appointment.status === "no_show",
  ).length;
  const lastVisit = completedAppointments.reduce<Date | null>((latest, appointment) => {
    if (!appointment.scheduledStart) {
      return latest;
    }

    if (!latest || appointment.scheduledStart > latest) {
      return appointment.scheduledStart;
    }

    return latest;
  }, null);

  await db
    .update(customers)
    .set({
      totalVisits: completedAppointments.length,
      noShowCount,
      lastVisitAt: lastVisit,
    })
    .where(eq(customers.id, customerId));
}

async function parseAppointmentPayload(
  formData: FormData,
  { requireService = false }: ParseAppointmentOptions = {},
) {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser || !appUser) {
    throw new Error("You must be signed in to manage appointments.");
  }

  const parsed = appointmentEditorSchema.safeParse({
    appointmentId: formData.get("appointmentId") ?? undefined,
    customerId: formData.get("customerId"),
    barberId: formData.get("barberId"),
    serviceId: formData.get("serviceId")?.toString() || undefined,
    appointmentDate: formData.get("appointmentDate"),
    appointmentTime: formData.get("appointmentTime"),
    status: formData.get("status") ?? "scheduled",
    source: formData.get("source")?.toString() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
    returnTo: formData.get("returnTo")?.toString() || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid appointment details.");
  }

  const {
    appointmentId,
    customerId,
    barberId,
    serviceId,
    appointmentDate,
    appointmentTime,
    status,
    source,
    notes,
    returnTo,
  } = parsed.data;

  if (requireService && !serviceId) {
    throw new Error("Service is required.");
  }

  const [customer, barber, service, shop] = await Promise.all([
    db
      .select({
        id: customers.id,
      })
      .from(customers)
      .where(
        and(
          eq(customers.id, customerId),
          eq(customers.shopId, appUser.shopId),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1),
    db
      .select({
        id: barbers.id,
      })
      .from(barbers)
      .where(
        and(
          eq(barbers.id, barberId),
          eq(barbers.shopId, appUser.shopId),
          isNull(barbers.deletedAt),
        ),
      )
      .limit(1),
    serviceId
      ? db
          .select({
            id: services.id,
            durationMinutes: services.durationMinutes,
            priceCents: services.priceCents,
          })
          .from(services)
          .where(
            and(
              eq(services.id, serviceId),
              eq(services.shopId, appUser.shopId),
              isNull(services.deletedAt),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        timezone: shops.timezone,
        settings: shops.settings,
      })
      .from(shops)
      .where(eq(shops.id, appUser.shopId))
      .limit(1),
  ]);

  if (!customer[0]) {
    throw new Error("Selected customer was not found.");
  }

  if (!barber[0]) {
    throw new Error("Selected barber was not found.");
  }

  if (serviceId && !service[0]) {
    throw new Error("Selected service was not found.");
  }

  const timezone = shop[0]?.timezone ?? "America/Chicago";
  const config = parseWalkInCapacityConfig(shop[0]?.settings);
  const scheduledStart = fromZonedTime(
    `${appointmentDate}T${appointmentTime}:00`,
    timezone,
  );

  if (Number.isNaN(scheduledStart.valueOf())) {
    throw new Error("Appointment date or time is invalid.");
  }

  const scheduledEnd = addMinutes(
    scheduledStart,
    service[0]?.durationMinutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES,
  );
  const localDate = new Date(`${appointmentDate}T12:00:00`);
  const localDayStart = fromZonedTime(startOfDay(localDate), timezone);
  const localDayEnd = fromZonedTime(endOfDay(localDate), timezone);
  const existingAppointments = await db
    .select({
      id: appointments.id,
      scheduledStart: appointments.scheduledStart,
      scheduledEnd: appointments.scheduledEnd,
      status: appointments.status,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.shopId, appUser.shopId),
        eq(appointments.barberId, barber[0].id),
        isNull(appointments.deletedAt),
        gte(appointments.scheduledStart, localDayStart),
        lte(appointments.scheduledStart, localDayEnd),
      ),
    );

  const availabilityError = validateAppointmentTime({
    barberId: barber[0].id,
    config,
    date: localDate,
    timezone,
    scheduledStart,
    scheduledEnd,
    existingAppointments,
    excludeAppointmentId: appointmentId,
  });

  if (availabilityError) {
    throw new Error(availabilityError);
  }

  return {
    appUser,
    appointmentId,
    customerId: customer[0].id,
    barberId: barber[0].id,
    serviceId: service[0]?.id ?? null,
    scheduledStart,
    scheduledEnd,
    priceCents: service[0]?.priceCents ?? null,
    status,
    source: source ?? "manual",
    notes,
    returnTo: returnTo ?? "/bookings",
  };
}

const getBookableTimeSlotsSchema = z.object({
  barberId: z.uuid(),
  appointmentDate: z.string().min(1),
  serviceId: z.uuid().optional().nullable(),
  appointmentId: z.uuid().optional().nullable(),
});

export async function getBookableTimeSlotsAction(input: {
  barberId: string;
  appointmentDate: string;
  serviceId?: string | null;
  appointmentId?: string | null;
}) {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser || !appUser) {
    throw new Error("You must be signed in.");
  }

  const parsed = getBookableTimeSlotsSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error("Invalid booking slot request.");
  }

  const { barberId, appointmentDate, serviceId, appointmentId } = parsed.data;

  const [barber, shop, service] = await Promise.all([
    db
      .select({ id: barbers.id })
      .from(barbers)
      .where(
        and(
          eq(barbers.id, barberId),
          eq(barbers.shopId, appUser.shopId),
          isNull(barbers.deletedAt),
        ),
      )
      .limit(1),
    db
      .select({ timezone: shops.timezone, settings: shops.settings })
      .from(shops)
      .where(eq(shops.id, appUser.shopId))
      .limit(1),
    serviceId
      ? db
          .select({
            durationMinutes: services.durationMinutes,
          })
          .from(services)
          .where(
            and(
              eq(services.id, serviceId),
              eq(services.shopId, appUser.shopId),
              isNull(services.deletedAt),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  if (!barber[0]) {
    throw new Error("Selected barber was not found.");
  }

  const timezone = shop[0]?.timezone ?? "America/Chicago";
  const config = parseWalkInCapacityConfig(shop[0]?.settings);
  const durationMinutes =
    service[0]?.durationMinutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES;
  const localDate = new Date(`${appointmentDate}T12:00:00`);
  const localDayStart = fromZonedTime(startOfDay(localDate), timezone);
  const localDayEnd = fromZonedTime(endOfDay(localDate), timezone);
  const existingAppointments = await db
    .select({
      id: appointments.id,
      scheduledStart: appointments.scheduledStart,
      scheduledEnd: appointments.scheduledEnd,
      status: appointments.status,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.shopId, appUser.shopId),
        eq(appointments.barberId, barberId),
        isNull(appointments.deletedAt),
        gte(appointments.scheduledStart, localDayStart),
        lte(appointments.scheduledStart, localDayEnd),
      ),
    );

  return generateBookableStartTimes({
    barberId,
    config,
    date: localDate,
    timezone,
    durationMinutes,
    existingAppointments,
    excludeAppointmentId: appointmentId ?? undefined,
  });
}

function revalidateBookingsSurfaces() {
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
  revalidatePath("/customers");
}

export async function createAppointmentAction(formData: FormData) {
  const payload = await parseAppointmentPayload(formData);

  await db.insert(appointments).values({
    shopId: payload.appUser.shopId,
    customerId: payload.customerId,
    barberId: payload.barberId,
    serviceId: payload.serviceId,
    source: payload.source,
    status: payload.status,
    scheduledStart: payload.scheduledStart,
    scheduledEnd: payload.scheduledEnd,
    priceCents: payload.priceCents,
    notes: payload.notes,
    createdByUserId: payload.appUser.id,
  });

  await syncCustomerAppointmentStats(payload.customerId, payload.appUser.shopId);
  revalidateBookingsSurfaces();

  return { success: true };
}

export async function updateAppointmentAction(formData: FormData) {
  const payload = await parseAppointmentPayload(formData, { requireService: true });

  if (!payload.appointmentId) {
    throw new Error("Appointment id is required for updates.");
  }

  if (!payload.serviceId) {
    throw new Error("Service is required.");
  }

  const [existingAppointment] = await db
    .select({
      id: appointments.id,
      customerId: appointments.customerId,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.id, payload.appointmentId),
        eq(appointments.shopId, payload.appUser.shopId),
        isNull(appointments.deletedAt),
      ),
    )
    .limit(1);

  if (!existingAppointment) {
    throw new Error("Appointment not found.");
  }

  await db
    .update(appointments)
    .set({
      barberId: payload.barberId,
      serviceId: payload.serviceId,
      status: payload.status,
      scheduledStart: payload.scheduledStart,
      scheduledEnd: payload.scheduledEnd,
      priceCents: payload.priceCents,
      notes: payload.notes,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, payload.appointmentId));

  await syncCustomerAppointmentStats(existingAppointment.customerId, payload.appUser.shopId);
  revalidateBookingsSurfaces();
  redirect(payload.returnTo);
}

export async function deleteAppointmentAction(formData: FormData) {
  const appointmentId = formData.get("appointmentId")?.toString();
  const customerId = formData.get("customerId")?.toString();
  const returnTo = formData.get("returnTo")?.toString() || "/bookings";
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser || !appUser) {
    throw new Error("You must be signed in to manage appointments.");
  }

  if (!appointmentId || !customerId) {
    throw new Error("Appointment details are incomplete.");
  }

  await db
    .update(appointments)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.shopId, appUser.shopId),
        isNull(appointments.deletedAt),
      ),
    );

  await syncCustomerAppointmentStats(customerId, appUser.shopId);
  revalidateBookingsSurfaces();
  redirect(returnTo);
}
