"use server";

import { eq, isNull, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";

const createCustomerSchema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email address.").optional().or(z.literal("")),
});

export async function createCustomerAction(formData: FormData) {
  const { authUser, appUser } = await getCurrentAppUser();

  if (!authUser || !appUser) {
    throw new Error("You must be signed in to add customers.");
  }

  const parsed = createCustomerSchema.safeParse({
    firstName: formData.get("firstName")?.toString().trim(),
    lastName: formData.get("lastName")?.toString().trim() || undefined,
    phone: formData.get("phone")?.toString().trim() || undefined,
    email: formData.get("email")?.toString().trim() || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid customer details.");
  }

  const { firstName, lastName, phone, email } = parsed.data;

  // Check for duplicate phone within the shop
  if (phone) {
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.shopId, appUser.shopId),
          eq(customers.phone, phone),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      throw new Error(`A customer with phone ${phone} already exists.`);
    }
  }

  const [newCustomer] = await db
    .insert(customers)
    .values({
      shopId: appUser.shopId,
      firstName,
      lastName: lastName || null,
      phone: phone || null,
      email: email || null,
      source: "manual",
    })
    .returning({
      id: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      phone: customers.phone,
      email: customers.email,
    });

  revalidatePath("/customers");
  revalidatePath("/bookings");

  return newCustomer;
}
