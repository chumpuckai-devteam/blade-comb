"use server";

import { addMinutes } from "date-fns";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getCurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import {
  appointments,
  barbers,
  customers,
  services,
  shops,
  type Barber,
  type Customer,
  type NewAppointment,
  type NewBarber,
  type NewService,
  type Service,
} from "@/lib/db/schema";
import {
  normalizeImportedAppointmentStatus,
  normalizePersonName,
  prepareAppointmentRows,
  prepareCustomerRows,
  splitClientName,
  type ImportReport,
  type PreparedAppointmentRow,
} from "@/lib/import/squire";

async function getImportContext() {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser || !appUser) {
    throw new Error("You must be signed in to import shop data.");
  }

  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.id, appUser.shopId))
    .limit(1);

  if (!shop) {
    throw new Error("Shop record not found for the current user.");
  }

  return { appUser, shop };
}

function emptyReport(): ImportReport {
  return { created: 0, updated: 0, skipped: 0, errors: [] };
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

function pushRowError(
  report: ImportReport,
  rowNumber: number,
  reason: string,
) {
  report.skipped += 1;
  report.errors.push({ row: rowNumber, reason });
}

function nameMatchesCustomer(customer: Customer, clientName: string) {
  const splitName = splitClientName(clientName);
  const targetName = normalizePersonName(splitName.firstName, splitName.lastName);
  const customerName = normalizePersonName(
    customer.firstName,
    customer.lastName ?? "",
  );

  if (!targetName) {
    return false;
  }

  if (customerName === targetName) {
    return true;
  }

  return (
    customer.firstName.toLowerCase() === splitName.firstName.toLowerCase() &&
    (splitName.lastName
      ? (customer.lastName ?? "").toLowerCase() === splitName.lastName.toLowerCase()
      : true)
  );
}

function findCustomerMatch(
  row: PreparedAppointmentRow,
  customersByPhone: Map<string, Customer[]>,
  customersByName: Map<string, Customer[]>,
) {
  if (row.clientPhone) {
    const phoneMatches = customersByPhone.get(row.clientPhone) ?? [];
    const namedPhoneMatches = phoneMatches.filter((customer) =>
      nameMatchesCustomer(customer, row.clientName),
    );

    if (namedPhoneMatches.length === 1) {
      return namedPhoneMatches[0];
    }

    if (namedPhoneMatches.length > 1) {
      return null;
    }

    if (phoneMatches.length === 1) {
      return phoneMatches[0];
    }

    return null;
  }

  const splitName = splitClientName(row.clientName);
  const normalizedName = normalizePersonName(splitName.firstName, splitName.lastName);
  const nameMatches = customersByName.get(normalizedName) ?? [];

  if (nameMatches.length === 1) {
    return nameMatches[0];
  }

  return null;
}

export async function importCustomersAction(
  formData: FormData,
): Promise<ImportReport> {
  const file = formData.get("file");

  if (!isFileLike(file)) {
    throw new Error("Please choose a CSV file to import.");
  }

  const text = await file.text();
  const { appUser } = await getImportContext();
  const { preparedRows } = prepareCustomerRows(text);

  return db.transaction(async (tx) => {
    const report = emptyReport();

    for (const row of preparedRows) {
      if (!row.valid || !row.phone) {
        pushRowError(report, row.rowNumber, row.reason ?? "Invalid customer row");
        continue;
      }

      const firstName = row.firstName || row.lastName || "Unknown";
      const lastName = row.firstName ? row.lastName : null;

      const [existingCustomer] = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.shopId, appUser.shopId),
            eq(customers.phone, row.phone),
            isNull(customers.deletedAt),
          ),
        )
        .limit(1);

      if (existingCustomer) {
        await tx
          .update(customers)
          .set({
            firstName,
            lastName,
            email: row.email ?? existingCustomer.email,
            notes: row.notes ?? existingCustomer.notes,
            source: "squire_import",
          })
          .where(eq(customers.id, existingCustomer.id));

        report.updated += 1;
        continue;
      }

      await tx.insert(customers).values({
        shopId: appUser.shopId,
        firstName,
        lastName,
        phone: row.phone,
        email: row.email,
        notes: row.notes,
        source: "squire_import",
      });

      report.created += 1;
    }

    return report;
  });
}

export async function importAppointmentsAction(
  formData: FormData,
): Promise<ImportReport> {
  const file = formData.get("file");

  if (!isFileLike(file)) {
    throw new Error("Please choose a CSV file to import.");
  }

  const text = await file.text();
  const { appUser, shop } = await getImportContext();
  const { preparedRows } = prepareAppointmentRows(text, shop.timezone);

  return db.transaction(async (tx) => {
    const report = emptyReport();

    const existingCustomers = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.shopId, appUser.shopId), isNull(customers.deletedAt)));

    const customersByPhone = new Map<string, Customer[]>();
    const customersByName = new Map<string, Customer[]>();

    for (const customer of existingCustomers) {
      if (customer.phone) {
        const phoneMatches = customersByPhone.get(customer.phone) ?? [];
        phoneMatches.push(customer);
        customersByPhone.set(customer.phone, phoneMatches);
      }

      const normalizedName = normalizePersonName(
        customer.firstName,
        customer.lastName ?? "",
      );

      if (normalizedName) {
        const nameMatches = customersByName.get(normalizedName) ?? [];
        nameMatches.push(customer);
        customersByName.set(normalizedName, nameMatches);
      }
    }

    const serviceMap = new Map<string, Service>();
    const barberMap = new Map<string, Barber>();

    const existingServices = await tx
      .select()
      .from(services)
      .where(and(eq(services.shopId, appUser.shopId), isNull(services.deletedAt)));

    const existingBarbers = await tx
      .select()
      .from(barbers)
      .where(and(eq(barbers.shopId, appUser.shopId), isNull(barbers.deletedAt)));

    for (const service of existingServices) {
      serviceMap.set(service.name.toLowerCase(), service);
    }

    for (const barber of existingBarbers) {
      barberMap.set(barber.displayName.toLowerCase(), barber);
    }

    const touchedCustomerIds = new Set<string>();

    async function getOrCreateService(serviceName: string) {
      const key = serviceName.toLowerCase();
      const existingService = serviceMap.get(key);

      if (existingService) {
        return existingService;
      }

      const placeholderService: NewService = {
        shopId: appUser.shopId,
        name: serviceName,
        description: "Placeholder service created during Squire appointment import.",
        durationMinutes: 30,
        priceCents: 0,
        isActive: false,
      };

      const [createdService] = await tx
        .insert(services)
        .values(placeholderService)
        .returning();

      serviceMap.set(key, createdService);
      return createdService;
    }

    async function getOrCreateBarber(barberName: string) {
      const key = barberName.toLowerCase();
      const existingBarber = barberMap.get(key);

      if (existingBarber) {
        return existingBarber;
      }

      const placeholderBarber: NewBarber = {
        shopId: appUser.shopId,
        displayName: barberName,
        bio: "Placeholder barber created during Squire appointment import.",
      };

      const [createdBarber] = await tx
        .insert(barbers)
        .values(placeholderBarber)
        .returning();

      barberMap.set(key, createdBarber);
      return createdBarber;
    }

    for (const row of preparedRows) {
      if (!row.valid || !row.scheduledStart) {
        pushRowError(report, row.rowNumber, row.reason ?? "Invalid appointment row");
        continue;
      }

      const customer = findCustomerMatch(row, customersByPhone, customersByName);

      if (!customer) {
        pushRowError(
          report,
          row.rowNumber,
          `Customer "${row.clientName}" could not be matched to an existing record.`,
        );
        continue;
      }

      const service = await getOrCreateService(row.serviceName);
      const barber = await getOrCreateBarber(row.barberName);
      const status = normalizeImportedAppointmentStatus(row.statusText);
      const scheduledEnd = addMinutes(
        row.scheduledStart,
        service.durationMinutes || 30,
      );

      const appointmentValues: NewAppointment = {
        shopId: appUser.shopId,
        customerId: customer.id,
        barberId: barber.id,
        serviceId: service.id,
        source: "squire_import",
        status,
        scheduledStart: row.scheduledStart,
        scheduledEnd,
        actualStart: status === "completed" ? row.scheduledStart : null,
        actualEnd: status === "completed" ? scheduledEnd : null,
        priceCents: service.priceCents,
      };

      await tx.insert(appointments).values(appointmentValues);
      touchedCustomerIds.add(customer.id);
      report.created += 1;
    }

    if (touchedCustomerIds.size > 0) {
      const importedAppointments = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.shopId, appUser.shopId),
            inArray(appointments.customerId, Array.from(touchedCustomerIds)),
            isNull(appointments.deletedAt),
          ),
        );

      const aggregates = new Map<
        string,
        {
          totalVisits: number;
          noShowCount: number;
          lastVisitAt: Date | null;
        }
      >();

      for (const appointment of importedAppointments) {
        const aggregate =
          aggregates.get(appointment.customerId) ??
          {
            totalVisits: 0,
            noShowCount: 0,
            lastVisitAt: null,
          };

        if (appointment.status === "completed") {
          aggregate.totalVisits += 1;

          const visitAt =
            appointment.actualEnd ??
            appointment.actualStart ??
            appointment.scheduledEnd ??
            appointment.scheduledStart;

          if (
            visitAt &&
            (!aggregate.lastVisitAt || visitAt > aggregate.lastVisitAt)
          ) {
            aggregate.lastVisitAt = visitAt;
          }
        }

        if (appointment.status === "no_show") {
          aggregate.noShowCount += 1;
        }

        aggregates.set(appointment.customerId, aggregate);
      }

      for (const [customerId, aggregate] of aggregates.entries()) {
        await tx
          .update(customers)
          .set({
            totalVisits: aggregate.totalVisits,
            noShowCount: aggregate.noShowCount,
            lastVisitAt: aggregate.lastVisitAt,
            requiresDeposit: aggregate.noShowCount >= 2,
          })
          .where(eq(customers.id, customerId));
      }
    }

    return report;
  });
}
