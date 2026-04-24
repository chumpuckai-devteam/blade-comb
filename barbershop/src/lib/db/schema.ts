import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  phone: text("phone"),
  address: text("address"),
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
});

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;

export const users = pgTable(
  "users",
  {
    // This id is intended to mirror supabase auth.users.id for each provisioned user.
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    email: text("email").notNull().unique(),
    fullName: text("full_name"),
    role: text("role").notNull(),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    check(
      "users_role_check",
      sql`${table.role} in ('owner', 'barber', 'staff')`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const barbers = pgTable("barbers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id),
  userId: uuid("user_id").references(() => users.id),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  color: text("color").default("#3b82f6"),
  isActive: boolean("is_active").notNull().default(true),
  acceptsWalkIns: boolean("accepts_walk_ins").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
});

export type Barber = typeof barbers.$inferSelect;
export type NewBarber = typeof barbers.$inferInsert;

export const services = pgTable("services", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id),
  name: text("name").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull(),
  priceCents: integer("price_cents").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  requiresDeposit: boolean("requires_deposit").notNull().default(false),
  depositCents: integer("deposit_cents"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
});

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;

export const barberServices = pgTable(
  "barber_services",
  {
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    priceCentsOverride: integer("price_cents_override"),
    durationMinutesOverride: integer("duration_minutes_override"),
  },
  (table) => [primaryKey({ columns: [table.barberId, table.serviceId] })],
);

export type BarberService = typeof barberServices.$inferSelect;
export type NewBarberService = typeof barberServices.$inferInsert;

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    phone: text("phone"),
    email: text("email"),
    preferredBarberId: uuid("preferred_barber_id").references(() => barbers.id),
    notes: text("notes"),
    tags: text("tags").array().default(sql`'{}'::text[]`),
    noShowCount: integer("no_show_count").notNull().default(0),
    totalVisits: integer("total_visits").notNull().default(0),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true, mode: "date" }),
    requiresDeposit: boolean("requires_deposit").notNull().default(false),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    check(
      "customers_source_check",
      sql`${table.source} in ('manual', 'squire_import', 'online', 'walk_in')`,
    ),
    uniqueIndex("customers_shop_phone_unique")
      .on(table.shopId, table.phone)
      .where(sql`${table.phone} is not null and ${table.deletedAt} is null`),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id),
    serviceId: uuid("service_id").references(() => services.id),
    source: text("source").notNull(),
    status: text("status").notNull().default("scheduled"),
    scheduledStart: timestamp("scheduled_start", {
      withTimezone: true,
      mode: "date",
    }),
    scheduledEnd: timestamp("scheduled_end", {
      withTimezone: true,
      mode: "date",
    }),
    actualStart: timestamp("actual_start", {
      withTimezone: true,
      mode: "date",
    }),
    actualEnd: timestamp("actual_end", { withTimezone: true, mode: "date" }),
    priceCents: integer("price_cents"),
    depositPaidCents: integer("deposit_paid_cents").default(0),
    notes: text("notes"),
    cancellationReason: text("cancellation_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    confirmationSentAt: timestamp("confirmation_sent_at", {
      withTimezone: true,
      mode: "date",
    }),
    reminderSentAt: timestamp("reminder_sent_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    check(
      "appointments_source_check",
      sql`${table.source} in ('online', 'phone', 'walk_in', 'manual', 'ai_agent', 'squire_import')`,
    ),
    check(
      "appointments_status_check",
      sql`${table.status} in ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')`,
    ),
    index("appointments_shop_scheduled_start_idx").on(
      table.shopId,
      table.scheduledStart,
    ),
    index("appointments_barber_scheduled_start_idx").on(
      table.barberId,
      table.scheduledStart,
    ),
    index("appointments_customer_created_at_idx").on(
      table.customerId,
      table.createdAt.desc(),
    ),
    index("appointments_shop_status_idx").on(table.shopId, table.status),
  ],
);

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;

export const appointmentEvents = pgTable(
  "appointment_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "appointment_events_actor_type_check",
      sql`${table.actorType} in ('user', 'customer', 'ai_agent', 'system')`,
    ),
    index("appointment_events_appointment_created_at_idx").on(
      table.appointmentId,
      table.createdAt.desc(),
    ),
  ],
);

export type AppointmentEvent = typeof appointmentEvents.$inferSelect;
export type NewAppointmentEvent = typeof appointmentEvents.$inferInsert;
