"use client";

import { useDeferredValue, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createCustomerAction } from "./actions";

type CustomerRow = {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tags: string[] | null;
  totalVisits: number;
  lastVisitAt: Date | null;
  noShowCount: number;
};

type AppointmentHistoryRow = {
  id: string;
  customerId: string;
  scheduledStart: Date | null;
  status: string;
  source: string;
  priceCents: number | null;
  serviceName: string | null;
  barberName: string | null;
};

type CustomerBrowserProps = {
  customers: CustomerRow[];
  appointmentHistory: AppointmentHistoryRow[];
};

function formatDateTime(value: Date | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCurrency(cents: number | null) {
  if (cents === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function fullName(customer: CustomerRow) {
  return `${customer.firstName} ${customer.lastName ?? ""}`.trim();
}

export function CustomerBrowser({
  customers,
  appointmentHistory,
}: CustomerBrowserProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [isPending, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);

  const historyByCustomer = new Map<string, AppointmentHistoryRow[]>();

  for (const appointment of appointmentHistory) {
    const rows = historyByCustomer.get(appointment.customerId) ?? [];
    rows.push(appointment);
    historyByCustomer.set(appointment.customerId, rows);
  }

  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredCustomers = normalizedQuery
    ? customers.filter((customer) => {
        const haystack = [
          fullName(customer),
          customer.phone ?? "",
          customer.email ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      })
    : customers;

  const selectedCustomer =
    customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedCustomerHistory = selectedCustomer
    ? historyByCustomer.get(selectedCustomer.id) ?? []
    : [];

  function handleAddCustomer(formData: FormData) {
    startTransition(async () => {
      try {
        await createCustomerAction(formData);
        toast.success("Customer added.");
        setShowAddDialog(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not add customer.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(245,245,245,0.96))] px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Customer ledger
        </p>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Searchable customer records with visit history.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Filter by name, phone, or email. Select any row to inspect notes,
              tags, and imported appointments in one place.
            </p>
          </div>
          <div className="flex w-full max-w-sm items-center gap-2">
            <Input
              className="flex-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, phone, or email"
            />
            <Button
              onClick={() => setShowAddDialog(true)}
              className="shrink-0"
            >
              <Plus className="size-4" />
              Add customer
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-border/70 bg-background shadow-sm">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4 sm:px-6">
          <div>
            <p className="text-sm font-medium">Customers</p>
            <p className="text-sm text-muted-foreground">
              {filteredCustomers.length} matching records
            </p>
          </div>
        </div>

        <div className="overflow-x-auto px-5 py-4 sm:px-6">
          <Table className="min-w-[920px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Total Visits</TableHead>
                <TableHead>Last Visit</TableHead>
                <TableHead>No-Shows</TableHead>
                <TableHead>Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCustomers.map((customer) => (
                <TableRow
                  key={customer.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedCustomerId(customer.id)}
                >
                  <TableCell className="font-medium">{fullName(customer)}</TableCell>
                  <TableCell>{customer.phone ?? "—"}</TableCell>
                  <TableCell>{customer.email ?? "—"}</TableCell>
                  <TableCell>{customer.totalVisits}</TableCell>
                  <TableCell>{formatDateTime(customer.lastVisitAt)}</TableCell>
                  <TableCell>{customer.noShowCount}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {(customer.tags ?? []).length > 0 ? (
                        (customer.tags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-border/70 px-2 py-1 text-xs"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Add customer dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add new customer</DialogTitle>
            <DialogDescription>
              Enter the customer&apos;s details. Only first name is required.
            </DialogDescription>
          </DialogHeader>
          <form action={handleAddCustomer} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">First name *</span>
                <Input name="firstName" required placeholder="Jane" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Last name</span>
                <Input name="lastName" placeholder="Doe" />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Phone</span>
              <Input name="phone" type="tel" placeholder="+1 555-123-4567" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Email</span>
              <Input name="email" type="email" placeholder="jane@example.com" />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Adding..." : "Add customer"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Customer detail dialog */}
      <Dialog
        open={Boolean(selectedCustomer)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedCustomerId(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto rounded-[2rem] p-0">
          {selectedCustomer ? (
            <div className="space-y-6 p-5 sm:p-6">
              <DialogHeader>
                <DialogTitle className="text-2xl">
                  {fullName(selectedCustomer)}
                </DialogTitle>
                <DialogDescription>
                  Full customer detail with imported appointment history.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    Phone
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {selectedCustomer.phone ?? "—"}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    Email
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {selectedCustomer.email ?? "—"}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    Total visits
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {selectedCustomer.totalVisits}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    No-shows
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {selectedCustomer.noShowCount}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.1fr_1.9fr]">
                <div className="space-y-4 rounded-[1.5rem] border border-border/70 bg-background p-4">
                  <div>
                    <p className="text-sm font-medium">Notes</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {selectedCustomer.notes || "No private notes recorded yet."}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm font-medium">Tags</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(selectedCustomer.tags ?? []).length > 0 ? (
                        (selectedCustomer.tags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-border/70 px-2 py-1 text-xs"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">No tags yet.</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-border/70 bg-background p-4">
                  <p className="text-sm font-medium">Appointment history</p>
                  {selectedCustomerHistory.length > 0 ? (
                    <div className="mt-3 overflow-x-auto">
                      <Table className="min-w-[620px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date / Time</TableHead>
                            <TableHead>Service</TableHead>
                            <TableHead>Barber</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Price</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedCustomerHistory.map((appointment) => (
                            <TableRow key={appointment.id}>
                              <TableCell>
                                {formatDateTime(appointment.scheduledStart)}
                              </TableCell>
                              <TableCell>{appointment.serviceName ?? "—"}</TableCell>
                              <TableCell>{appointment.barberName ?? "—"}</TableCell>
                              <TableCell>{appointment.status}</TableCell>
                              <TableCell>{appointment.source}</TableCell>
                              <TableCell>
                                {formatCurrency(appointment.priceCents)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No appointment history has been imported for this customer yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
