# Barbershop Admin

Module 1 of the barbershop admin and booking system. This app now owns the shop's customer data, imported appointment history, staff auth, and the internal admin workspace that later modules will build on.

## Local development

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables:

```bash
cp .env.local.example .env.local
```

3. Push the database schema:

```bash
npm run db:push
```

4. Seed the first shop and owner account after creating the Supabase auth user:

```bash
npm run db:seed
```

5. Start the dev server:

```bash
npm run dev
```

## Import workflow

1. Sign in to the admin at `/login`.
2. Open `/import`.
3. Preview the customer CSV first, then run the import.
4. Preview the appointment history CSV next, then run the import.
5. Review `/customers`, `/bookings`, and `/dashboard` to confirm the imported data looks right.

## Where CSVs should live

Keep the Squire exports handy when you run imports:

- `/Users/samirpatel/agency/blade-comb/barbershop/squire-export.csv`
- `/Users/samirpatel/agency/blade-comb/barbershop/squire-appointments.csv`

You can also choose the files directly from anywhere on your machine using the import UI.

## Module status

Module 1 is complete locally once auth, customer import, appointment import, and the admin browse views are working for your shop data.

The next module is the walk-in queue. It will build on this foundation without requiring a schema rewrite.
