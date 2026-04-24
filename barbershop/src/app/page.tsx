import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="rounded-3xl border border-border bg-card px-8 py-10 text-center shadow-sm">
        <p className="text-sm uppercase tracking-[0.28em] text-muted-foreground">
          Module 1
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Barbershop Admin
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Internal workspace for staff, customer records, and bookings.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild>
            <Link href="/login">Go to Admin Login</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
