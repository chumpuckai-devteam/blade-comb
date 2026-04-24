import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { appointments, barbers, customers, services } from "@/lib/db/schema";
import { CustomerBrowser } from "./customer-browser";

export default async function CustomersPage() {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser) {
    redirect("/login");
  }

  if (!appUser) {
    return null;
  }

  const customerRows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.shopId, appUser.shopId), isNull(customers.deletedAt)))
    .orderBy(desc(customers.lastVisitAt), desc(customers.createdAt));

  const customerIds = customerRows.map((customer) => customer.id);

  const appointmentHistory =
    customerIds.length > 0
      ? await db
          .select({
            id: appointments.id,
            customerId: appointments.customerId,
            scheduledStart: appointments.scheduledStart,
            status: appointments.status,
            source: appointments.source,
            priceCents: appointments.priceCents,
            serviceName: services.name,
            barberName: barbers.displayName,
          })
          .from(appointments)
          .leftJoin(services, eq(appointments.serviceId, services.id))
          .leftJoin(barbers, eq(appointments.barberId, barbers.id))
          .where(
            and(
              eq(appointments.shopId, appUser.shopId),
              inArray(appointments.customerId, customerIds),
              isNull(appointments.deletedAt),
            ),
          )
          .orderBy(desc(appointments.scheduledStart), desc(appointments.createdAt))
      : [];

  return (
    <CustomerBrowser
      customers={customerRows}
      appointmentHistory={appointmentHistory}
    />
  );
}
