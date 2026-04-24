"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Plus, Search, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createCustomerAction } from "../customers/actions";
import { createAppointmentAction } from "./actions";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CustomerOption = {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

type BarberOption = {
  id: string;
  displayName: string;
};

type ServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
};

type NewAppointmentDialogProps = {
  customers: CustomerOption[];
  barbers: BarberOption[];
  services: ServiceOption[];
  defaultDate: string;
  defaultTime: string;
  defaultBarberId?: string;
  lockBarber?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function fullName(c: CustomerOption) {
  return `${c.firstName} ${c.lastName ?? ""}`.trim();
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "phone", label: "Phone" },
  { value: "walk_in", label: "Walk-in" },
  { value: "online", label: "Online" },
] as const;

/* ------------------------------------------------------------------ */
/*  Date selects                                                       */
/* ------------------------------------------------------------------ */

function DateSelects({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [y, m, d] = value.split("-");
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const daysInMonth = new Date(year, month, 0).getDate();

  const update = (ny: number, nm: number, nd: number) => {
    const max = new Date(ny, nm, 0).getDate();
    const cd = Math.min(nd, max);
    onChange(`${ny}-${String(nm).padStart(2, "0")}-${String(cd).padStart(2, "0")}`);
  };

  const currentYear = new Date().getFullYear();
  const selectCls =
    "h-9 rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]";

  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
      <select
        className={selectCls}
        value={month}
        onChange={(e) => update(year, Number(e.target.value), day)}
        style={{ borderColor: "#dadce0" }}
      >
        {MONTH_LABELS.map((label, i) => (
          <option key={label} value={i + 1}>{label}</option>
        ))}
      </select>
      <select
        className={`${selectCls} w-14`}
        value={day}
        onChange={(e) => update(year, month, Number(e.target.value))}
        style={{ borderColor: "#dadce0" }}
      >
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select
        className={`${selectCls} w-[4.5rem]`}
        value={year}
        onChange={(e) => update(Number(e.target.value), month, day)}
        style={{ borderColor: "#dadce0" }}
      >
        {Array.from({ length: 5 }, (_, i) => currentYear - 1 + i).map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dialog                                                             */
/* ------------------------------------------------------------------ */

export function NewAppointmentDialog({
  customers,
  barbers,
  services,
  defaultDate,
  defaultTime,
  defaultBarberId,
  lockBarber = false,
}: NewAppointmentDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedBarberId, setSelectedBarberId] = useState(defaultBarberId ?? "");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedSource, setSelectedSource] = useState("manual");
  const [appointmentDate, setAppointmentDate] = useState(defaultDate);
  const [appointmentTime, setAppointmentTime] = useState(defaultTime);
  const [notes, setNotes] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [isAddingCustomer, startAddCustomer] = useTransition();
  const [localCustomers, setLocalCustomers] = useState<CustomerOption[]>(customers);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return localCustomers.slice(0, 12);
    return localCustomers
      .filter((c) =>
        [fullName(c), c.phone ?? "", c.email ?? ""].join(" ").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [localCustomers, query]);

  const selectedCustomer = localCustomers.find((c) => c.id === selectedCustomerId) ?? null;

  function reset() {
    setQuery("");
    setSelectedCustomerId("");
    setSelectedBarberId(defaultBarberId ?? "");
    setSelectedServiceId("");
    setSelectedSource("manual");
    setAppointmentDate(defaultDate);
    setAppointmentTime(defaultTime);
    setNotes("");
    setShowNewCustomer(false);
    setLocalCustomers(customers);
  }

  function handleAddCustomer(formData: FormData) {
    startAddCustomer(async () => {
      try {
        const newCustomer = await createCustomerAction(formData);
        setLocalCustomers((prev) => [newCustomer, ...prev]);
        setSelectedCustomerId(newCustomer.id);
        setShowNewCustomer(false);
        toast.success(`${newCustomer.firstName} added.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not add customer.");
      }
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function handleSubmit(formData: FormData) {
    if (!selectedCustomerId) { toast.error("Select a customer."); return; }
    if (!selectedBarberId) { toast.error("Choose a barber."); return; }

    formData.set("customerId", selectedCustomerId);
    formData.set("barberId", selectedBarberId);
    if (selectedServiceId) formData.set("serviceId", selectedServiceId);
    formData.set("appointmentDate", appointmentDate);
    formData.set("appointmentTime", appointmentTime);
    formData.set("status", "scheduled");
    formData.set("source", selectedSource);
    formData.set("notes", notes);

    startTransition(async () => {
      try {
        await createAppointmentAction(formData);
        toast.success("Appointment created.");
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not create appointment.");
      }
    });
  }

  const canSubmit = selectedCustomerId && selectedBarberId && appointmentDate && appointmentTime;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-[#3c4043] shadow-md ring-1 ring-black/5 transition hover:shadow-lg"
        >
          <Plus className="size-5 text-[#1a73e8]" />
          New appointment
        </button>
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="left-1/2 top-1/2 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-none min-w-0 -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border-0 bg-white p-0 text-[#3c4043] shadow-2xl ring-1 ring-black/5 sm:max-w-none sm:w-[min(92vw,900px)]"
      >
        {/* Header */}
        <DialogHeader className="flex flex-row items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "#dadce0" }}>
          <DialogTitle className="text-lg font-normal text-[#3c4043]">
            New appointment
          </DialogTitle>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full p-1 hover:bg-[#f1f3f4]"
          >
            <X className="size-5 text-[#5f6368]" />
          </button>
        </DialogHeader>

        <form action={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 sm:flex-row">
            {/* Left: customer search or new customer form */}
            <div className="flex min-h-0 flex-1 flex-col">
              {showNewCustomer ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-[#3c4043]">New customer</p>
                    <button
                      type="button"
                      onClick={() => setShowNewCustomer(false)}
                      className="text-xs font-medium text-[#1a73e8] hover:underline"
                    >
                      Back to search
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-xs text-[#5f6368]">First name *</span>
                      <Input
                        name="newFirstName"
                        required
                        placeholder="Jane"
                        className="h-9 rounded-md border bg-white text-sm"
                        style={{ borderColor: "#dadce0" }}
                        id="new-cust-first"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-[#5f6368]">Last name</span>
                      <Input
                        name="newLastName"
                        placeholder="Doe"
                        className="h-9 rounded-md border bg-white text-sm"
                        style={{ borderColor: "#dadce0" }}
                      />
                    </label>
                  </div>
                  <label className="block space-y-1">
                    <span className="text-xs text-[#5f6368]">Phone</span>
                    <Input
                      name="newPhone"
                      type="tel"
                      placeholder="+1 555-123-4567"
                      className="h-9 rounded-md border bg-white text-sm"
                      style={{ borderColor: "#dadce0" }}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-[#5f6368]">Email</span>
                    <Input
                      name="newEmail"
                      type="email"
                      placeholder="jane@example.com"
                      className="h-9 rounded-md border bg-white text-sm"
                      style={{ borderColor: "#dadce0" }}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={isAddingCustomer}
                    onClick={() => {
                      const form = document.getElementById("new-cust-first")?.closest("div")?.parentElement;
                      if (!form) return;
                      const fd = new FormData();
                      const first = (form.querySelector("[name=newFirstName]") as HTMLInputElement)?.value.trim();
                      if (!first) { toast.error("First name is required."); return; }
                      fd.set("firstName", first);
                      fd.set("lastName", (form.querySelector("[name=newLastName]") as HTMLInputElement)?.value.trim() ?? "");
                      fd.set("phone", (form.querySelector("[name=newPhone]") as HTMLInputElement)?.value.trim() ?? "");
                      fd.set("email", (form.querySelector("[name=newEmail]") as HTMLInputElement)?.value.trim() ?? "");
                      handleAddCustomer(fd);
                    }}
                    className="h-9 w-full rounded-md bg-[#1a73e8] text-sm font-medium text-white hover:bg-[#1765cc]"
                  >
                    {isAddingCustomer ? "Adding..." : "Add & select customer"}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#5f6368]" />
                      <Input
                        className="h-10 rounded-lg border bg-white pl-9 text-sm text-[#3c4043] shadow-none outline-none placeholder:text-[#9aa0a6] focus-visible:border-[#1a73e8] focus-visible:ring-1 focus-visible:ring-[#1a73e8]"
                        style={{ borderColor: "#dadce0" }}
                        placeholder="Search customers..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowNewCustomer(true)}
                      className="flex shrink-0 items-center gap-1 rounded-lg border px-3 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe]"
                      style={{ borderColor: "#dadce0" }}
                    >
                      <Plus className="size-4" />
                      <span className="hidden sm:inline">New</span>
                    </button>
                  </div>

                  <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
                    <div className="space-y-1">
                      {filtered.length > 0 ? (
                        filtered.map((c) => {
                          const active = c.id === selectedCustomerId;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setSelectedCustomerId(c.id)}
                              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                                active
                                  ? "bg-[#e8f0fe] text-[#1a73e8]"
                                  : "text-[#3c4043] hover:bg-[#f1f3f4]"
                              }`}
                            >
                              <div className={`flex size-8 items-center justify-center rounded-full text-xs font-medium text-white ${active ? "bg-[#1a73e8]" : "bg-[#5f6368]"}`}>
                                {c.firstName[0]}{c.lastName?.[0] ?? ""}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={`truncate font-medium ${active ? "text-[#1a73e8]" : ""}`}>
                                  {fullName(c)}
                                </p>
                                <p className="truncate text-xs text-[#5f6368]">
                                  {c.phone ?? c.email ?? "No contact info"}
                                </p>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-3 py-6 text-center">
                          <p className="text-sm text-[#5f6368]">No matching customers found.</p>
                          <button
                            type="button"
                            onClick={() => setShowNewCustomer(true)}
                            className="mt-2 text-sm font-medium text-[#1a73e8] hover:underline"
                          >
                            Add a new customer
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Right: details */}
            <div className="w-full shrink-0 space-y-4 sm:w-[260px]">
              {/* Selected customer */}
              <div className="rounded-lg border p-3" style={{ borderColor: "#dadce0" }}>
                <div className="flex items-center gap-2.5">
                  <div className={`flex size-8 items-center justify-center rounded-full text-xs font-medium text-white ${selectedCustomer ? "bg-[#1a73e8]" : "bg-[#dadce0]"}`}>
                    {selectedCustomer ? `${selectedCustomer.firstName[0]}${selectedCustomer.lastName?.[0] ?? ""}` : <UserRound className="size-4 text-[#5f6368]" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-[#5f6368]">Customer</p>
                    <p className="truncate text-sm font-medium">
                      {selectedCustomer ? fullName(selectedCustomer) : "Select a customer"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="text-xs font-medium text-[#5f6368]">Date</label>
                <div className="mt-1">
                  <DateSelects value={appointmentDate} onChange={setAppointmentDate} />
                </div>
              </div>

              {/* Time */}
              <div>
                <label htmlFor="appt-time" className="text-xs font-medium text-[#5f6368]">Start time</label>
                <input
                  id="appt-time"
                  type="time"
                  className="mt-1 h-9 w-full rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  style={{ borderColor: "#dadce0" }}
                  min="10:00"
                  max="19:00"
                  value={appointmentTime}
                  onChange={(e) => setAppointmentTime(e.target.value)}
                />
              </div>

              {/* Barber */}
              <div>
                <label htmlFor="appt-barber" className="text-xs font-medium text-[#5f6368]">Barber</label>
                <select
                  id="appt-barber"
                  className="mt-1 h-9 w-full rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  style={{ borderColor: "#dadce0" }}
                  value={selectedBarberId}
                  onChange={(e) => setSelectedBarberId(e.target.value)}
                  disabled={lockBarber}
                >
                  <option value="">Select barber</option>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>{b.displayName}</option>
                  ))}
                </select>
              </div>

              {/* Service */}
              <div>
                <label htmlFor="appt-service" className="text-xs font-medium text-[#5f6368]">Service</label>
                <select
                  id="appt-service"
                  className="mt-1 h-9 w-full rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  style={{ borderColor: "#dadce0" }}
                  value={selectedServiceId}
                  onChange={(e) => setSelectedServiceId(e.target.value)}
                >
                  <option value="">None (add later)</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.priceCents)}</option>
                  ))}
                </select>
              </div>

              {/* Source */}
              <div>
                <label htmlFor="appt-source" className="text-xs font-medium text-[#5f6368]">Source</label>
                <select
                  id="appt-source"
                  className="mt-1 h-9 w-full rounded-md border bg-white px-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  style={{ borderColor: "#dadce0" }}
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                >
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="appt-notes" className="text-xs font-medium text-[#5f6368]">Notes</label>
                <textarea
                  id="appt-notes"
                  className="mt-1 min-h-16 w-full rounded-md border bg-white px-2.5 py-2 text-sm text-[#3c4043] outline-none placeholder:text-[#9aa0a6] focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  style={{ borderColor: "#dadce0" }}
                  placeholder="Optional notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-5 py-3" style={{ borderColor: "#dadce0" }}>
            <div className="hidden items-center gap-1.5 text-xs text-[#5f6368] sm:flex">
              <Clock3 className="size-3.5" />
              {appointmentDate} at {appointmentTime || "--:--"}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-4 py-2 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe]"
              >
                Cancel
              </button>
              <Button
                className="h-9 rounded-md bg-[#1a73e8] px-5 text-sm font-medium text-white hover:bg-[#1765cc] disabled:opacity-40"
                disabled={isPending || !canSubmit}
                type="submit"
              >
                {isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
