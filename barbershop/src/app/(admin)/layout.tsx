import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCurrentAppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "./admin-nav";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/check-in", label: "Check-In" },
  { href: "/customers", label: "Customers" },
  { href: "/bookings", label: "Bookings" },
  { href: "/availability", label: "Availability" },
  { href: "/import", label: "Import" },
];

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { authUser, appUser } = await getCurrentAppUser();

  async function signOut() {
    "use server";

    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  if (!authUser) {
    redirect("/login");
  }

  if (!appUser) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-12">
        <Card className="w-full max-w-lg rounded-3xl p-8 shadow-sm">
          <p className="text-sm uppercase tracking-[0.28em] text-muted-foreground">
            Account setup
          </p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Account not provisioned. Contact the shop owner.
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Your authentication account exists, but there is no matching staff
            record in the app database yet.
          </p>
          <form action={signOut} className="mt-6">
            <Button variant="outline" type="submit">
              Sign Out
            </Button>
          </form>
        </Card>
      </main>
    );
  }

  const displayName = appUser.fullName ?? authUser.email ?? "Staff member";

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-4 px-4 py-4 md:gap-6 md:px-6 md:py-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="flex h-fit flex-col border-border/70 bg-background/95 p-4 shadow-sm xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between xl:block">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                Barbershop
              </p>
              <h2 className="mt-2 text-xl font-semibold">Admin</h2>
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 sm:min-w-[240px] xl:mt-8 xl:min-w-0">
              <p className="text-sm font-medium">{displayName}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                {appUser.role}
              </p>
            </div>
          </div>

          <AdminNav items={navItems} />

          <form action={signOut} className="mt-5 xl:mt-auto xl:pt-6">
            <Button className="w-full justify-start gap-2" variant="outline" type="submit">
              <LogOut className="size-4" />
              Sign Out
            </Button>
          </form>
        </Card>

        <div className="min-w-0 space-y-6">
          <header className="rounded-3xl border border-border/70 bg-background px-5 py-5 shadow-sm md:px-6">
            <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
              Module 1 foundation
            </p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
              Admin workspace
            </h1>
          </header>

          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}
