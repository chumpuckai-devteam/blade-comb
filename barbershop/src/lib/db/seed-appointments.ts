import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addDays,
  addMinutes,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { and, eq, gte, isNull, lt } from "drizzle-orm";

const SEED_NOTE = "Auto-seeded demo";
const SEED_CUSTOMER_TAG = "auto-seed";

const SEED_CUSTOMERS: Array<{
  firstName: string;
  lastName: string;
  phone: string;
}> = [
  { firstName: "Marcus", lastName: "Johnson", phone: "+17205550101" },
  { firstName: "Sofia", lastName: "Nguyen", phone: "+17205550102" },
  { firstName: "Jamal", lastName: "Henderson", phone: "+17205550103" },
  { firstName: "Liam", lastName: "Rodriguez", phone: "+17205550104" },
  { firstName: "Olivia", lastName: "Chen", phone: "+17205550105" },
  { firstName: "Dominic", lastName: "Garcia", phone: "+17205550106" },
  { firstName: "Ethan", lastName: "Williams", phone: "+17205550107" },
  { firstName: "Aisha", lastName: "Patel", phone: "+17205550108" },
  { firstName: "Carlos", lastName: "Mendez", phone: "+17205550109" },
  { firstName: "Maya", lastName: "Thompson", phone: "+17205550110" },
  { firstName: "Brayden", lastName: "Lee", phone: "+17205550111" },
  { firstName: "Isabella", lastName: "Martinez", phone: "+17205550112" },
  { firstName: "Derrick", lastName: "Brooks", phone: "+17205550113" },
  { firstName: "Aaron", lastName: "Kim", phone: "+17205550114" },
  { firstName: "Zachary", lastName: "Cooper", phone: "+17205550115" },
  { firstName: "Elena", lastName: "Vargas", phone: "+17205550116" },
  { firstName: "Trevor", lastName: "Adams", phone: "+17205550117" },
  { firstName: "Nathan", lastName: "Park", phone: "+17205550118" },
  { firstName: "Connor", lastName: "O'Brien", phone: "+17205550119" },
  { firstName: "Xavier", lastName: "Reed", phone: "+17205550120" },
  { firstName: "Noah", lastName: "Davis", phone: "+17205550121" },
  { firstName: "Lucas", lastName: "Bennett", phone: "+17205550122" },
  { firstName: "Mason", lastName: "Wright", phone: "+17205550123" },
  { firstName: "Ava", lastName: "Foster", phone: "+17205550124" },
  { firstName: "Logan", lastName: "Pierce", phone: "+17205550125" },
];

function loadEnvFile(filename: string) {
  const filePath = resolve(process.cwd(), filename);
  if (!existsSync(filePath)) return;
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sepIdx = trimmed.indexOf("=");
    if (sepIdx === -1) continue;
    const key = trimmed.slice(0, sepIdx).trim();
    const value = trimmed.slice(sepIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  loadEnvFile(".env.local");

  const [{ db }, schema, walkInModule] = await Promise.all([
    import("./client"),
    import("./schema"),
    import("../walk-in-capacity"),
  ]);
  const { appointments, barbers, customers, services, shops } = schema;
  const { parseWalkInCapacityConfig } = walkInModule;

  const shopSlug = process.env.SHOP_SLUG;
  const shopRows = shopSlug
    ? await db.select().from(shops).where(eq(shops.slug, shopSlug)).limit(1)
    : await db.select().from(shops).limit(2);
  if (shopRows.length === 0) {
    throw new Error(
      shopSlug
        ? `No shop found with slug "${shopSlug}".`
        : "No shops found in database.",
    );
  }
  if (shopRows.length > 1) {
    throw new Error(
      "Multiple shops found. Set SHOP_SLUG in .env.local to pick one.",
    );
  }
  const shop = shopRows[0];
  const tz = shop.timezone;
  const config = parseWalkInCapacityConfig(shop.settings);

  const barberRows = await db
    .select()
    .from(barbers)
    .where(and(eq(barbers.shopId, shop.id), isNull(barbers.deletedAt)));
  const activeBarbers = barberRows.filter((b) => b.isActive);
  if (activeBarbers.length === 0) {
    throw new Error("No active barbers for this shop.");
  }

  const serviceRows = await db
    .select()
    .from(services)
    .where(and(eq(services.shopId, shop.id), isNull(services.deletedAt)));
  const activeServices = serviceRows;
  if (activeServices.length === 0) {
    throw new Error("No services for this shop.");
  }

  /* ---------------- Upsert customers ---------------- */

  const existingCustomers = await db
    .select()
    .from(customers)
    .where(and(eq(customers.shopId, shop.id), isNull(customers.deletedAt)));
  const existingByPhone = new Map(
    existingCustomers.filter((c) => c.phone).map((c) => [c.phone!, c]),
  );

  const toInsertCustomers = SEED_CUSTOMERS.filter(
    (c) => !existingByPhone.has(c.phone),
  ).map((c) => ({
    shopId: shop.id,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    source: "manual" as const,
    tags: [SEED_CUSTOMER_TAG],
  }));

  if (toInsertCustomers.length > 0) {
    await db.insert(customers).values(toInsertCustomers);
    console.log(`Inserted ${toInsertCustomers.length} new customers.`);
  }

  const allCustomers = await db
    .select()
    .from(customers)
    .where(and(eq(customers.shopId, shop.id), isNull(customers.deletedAt)));

  const seedCustomerPhones = new Set(SEED_CUSTOMERS.map((c) => c.phone));
  const seedCustomerPool = allCustomers.filter(
    (c) => c.phone && seedCustomerPhones.has(c.phone),
  );
  const customerPool = seedCustomerPool.length > 0 ? seedCustomerPool : allCustomers;

  /* ---------------- Compute next-week window ---------------- */

  const zonedNow = toZonedTime(new Date(), tz);
  const nextMondayZoned = startOfWeek(addDays(zonedNow, 7), { weekStartsOn: 1 });
  const daysToSeed = 7;
  const weekStartUtc = fromZonedTime(startOfDay(nextMondayZoned), tz);
  const weekEndUtc = fromZonedTime(
    startOfDay(addDays(nextMondayZoned, daysToSeed)),
    tz,
  );

  /* ---------------- Clear prior seeded rows in window ---------------- */

  const removed = await db
    .delete(appointments)
    .where(
      and(
        eq(appointments.shopId, shop.id),
        eq(appointments.notes, SEED_NOTE),
        gte(appointments.scheduledStart, weekStartUtc),
        lt(appointments.scheduledStart, weekEndUtc),
      ),
    )
    .returning({ id: appointments.id });
  if (removed.length > 0) {
    console.log(`Cleared ${removed.length} prior seeded appointments in window.`);
  }

  /* ---------------- Generate appointments ---------------- */

  const rng = mulberry32(
    0xbade1 ^ nextMondayZoned.getFullYear() * 100 + nextMondayZoned.getMonth() * 10 + nextMondayZoned.getDate(),
  );

  // Busy-ness per weekday (0=Sun ... 6=Sat). Higher = more bookings.
  const dayDensity: Record<number, number> = {
    0: 0.3,
    1: 0.5,
    2: 0.9,
    3: 0.55,
    4: 0.95,
    5: 0.85,
    6: 0.8,
  };

  // Time-of-day weight (10am=10 ... 18=6pm). Afternoons much busier.
  function hourWeight(hour: number): number {
    if (hour < 12) return 0.35;
    if (hour < 15) return 0.7;
    if (hour < 18) return 1.2;
    return 0.6;
  }

  const kidsServiceIdx = activeServices.findIndex((s) =>
    /kid/i.test(s.name),
  );

  function pickService(hour: number) {
    const weights = activeServices.map((_, i) => {
      if (i === kidsServiceIdx) return hour >= 15 ? 2.6 : 0.4;
      return 1;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return activeServices[i];
    }
    return activeServices[0];
  }

  function pickStatus() {
    const r = rng();
    if (r < 0.6) return "scheduled";
    if (r < 0.9) return "confirmed";
    return "scheduled";
  }

  type PendingAppt = typeof appointments.$inferInsert;
  const pending: PendingAppt[] = [];

  for (let dayIdx = 0; dayIdx < daysToSeed; dayIdx++) {
    const zonedDay = addDays(nextMondayZoned, dayIdx);
    const weekday = zonedDay.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    if (config.closedDates.has(formatDateKey(zonedDay))) continue;

    // Shared jitter per day so both barbers land on the same rough count.
    const dayJitter = 0.85 + rng() * 0.35;

    for (const barber of activeBarbers) {
      if (config.barberUnavailableDates[barber.id]?.has(formatDateKey(zonedDay))) continue;

      const schedule =
        config.weeklyHours.barbers[barber.id]?.[weekday] ??
        config.weeklyHours.default?.[weekday] ??
        [];
      if (!schedule.length) continue;

      // Build 30-min slots across all ranges.
      type Slot = { hour: number; minute: number; taken: boolean };
      const slots: Slot[] = [];
      for (const range of schedule) {
        const [sh, sm] = range.start.split(":").map(Number);
        const [eh, em] = range.end.split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        for (let t = startMin; t + 30 <= endMin; t += 30) {
          slots.push({ hour: Math.floor(t / 60), minute: t % 60, taken: false });
        }
      }
      if (!slots.length) continue;

      const density = dayDensity[weekday] ?? 0.5;
      // At max density, roughly half the barber's slots get booked.
      const targetBookings = Math.max(
        0,
        Math.round(slots.length * density * 0.45 * dayJitter),
      );

      let placed = 0;
      let attempts = 0;
      const maxAttempts = targetBookings * 8 + 20;

      while (placed < targetBookings && attempts < maxAttempts) {
        attempts++;
        const weights = slots.map((s) => (s.taken ? 0 : hourWeight(s.hour)));
        const total = weights.reduce((a, b) => a + b, 0);
        if (total === 0) break;

        let r = rng() * total;
        let pickedIdx = -1;
        for (let i = 0; i < weights.length; i++) {
          r -= weights[i];
          if (r <= 0) {
            pickedIdx = i;
            break;
          }
        }
        if (pickedIdx === -1) continue;

        const slot = slots[pickedIdx];
        const service = pickService(slot.hour);
        const duration = service.durationMinutes;
        const neededSlots = Math.max(1, Math.ceil(duration / 30));

        let canFit = true;
        for (let k = 0; k < neededSlots; k++) {
          if (pickedIdx + k >= slots.length || slots[pickedIdx + k].taken) {
            canFit = false;
            break;
          }
        }
        if (!canFit) continue;

        for (let k = 0; k < neededSlots; k++) {
          slots[pickedIdx + k].taken = true;
        }

        const customer =
          customerPool[Math.floor(rng() * customerPool.length)] ?? allCustomers[0];
        if (!customer) throw new Error("No customers available for seeding.");

        const zonedStart = new Date(zonedDay);
        zonedStart.setHours(slot.hour, slot.minute, 0, 0);
        const zonedEnd = addMinutes(zonedStart, duration);

        pending.push({
          shopId: shop.id,
          customerId: customer.id,
          barberId: barber.id,
          serviceId: service.id,
          source: "manual",
          status: pickStatus(),
          scheduledStart: fromZonedTime(zonedStart, tz),
          scheduledEnd: fromZonedTime(zonedEnd, tz),
          priceCents: service.priceCents,
          notes: SEED_NOTE,
        });
        placed++;
      }
    }
  }

  /* ---------------- Insert ---------------- */

  const BATCH = 100;
  for (let i = 0; i < pending.length; i += BATCH) {
    await db.insert(appointments).values(pending.slice(i, i + BATCH));
  }

  // Summary by day
  const byDay = new Map<string, number>();
  for (const a of pending) {
    const key = formatDateKey(toZonedTime(a.scheduledStart!, tz));
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  console.log(`\nInserted ${pending.length} appointments across the next week:`);
  for (const [k, v] of [...byDay.entries()].sort()) {
    console.log(`  ${k}: ${v}`);
  }
}

function formatDateKey(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
