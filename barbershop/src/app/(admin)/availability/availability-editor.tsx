"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  updateBarberAvailabilityAction,
  updateBarberUnavailableDatesAction,
  updateShopClosedDatesAction,
} from "./actions";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TimeRange = { start: string; end: string };
type WeeklySchedule = Partial<Record<number, TimeRange[]>>;

type BarberData = {
  id: string;
  displayName: string;
  acceptsWalkIns: boolean;
  schedule: WeeklySchedule;
  unavailableDates: string[];
};

type AvailabilityEditorProps = {
  barbers: BarberData[];
  closedDates: string[];
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ------------------------------------------------------------------ */
/*  Barber schedule editor                                             */
/* ------------------------------------------------------------------ */

function BarberScheduleCard({ barber }: { barber: BarberData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [schedule, setSchedule] = useState<WeeklySchedule>(barber.schedule);
  const [unavailDates, setUnavailDates] = useState<string[]>(barber.unavailableDates);
  const [newDate, setNewDate] = useState("");

  function toggleDay(day: number) {
    setSchedule((prev) => {
      const copy = { ...prev };
      if (copy[day] && copy[day].length > 0) {
        delete copy[day];
      } else {
        copy[day] = [{ start: "10:00", end: "19:00" }];
      }
      return copy;
    });
  }

  function updateTime(day: number, field: "start" | "end", value: string) {
    setSchedule((prev) => {
      const copy = { ...prev };
      const ranges = [...(copy[day] ?? [{ start: "10:00", end: "19:00" }])];
      ranges[0] = { ...ranges[0], [field]: value };
      copy[day] = ranges;
      return copy;
    });
  }

  function addUnavailDate() {
    if (!newDate) return;
    if (unavailDates.includes(newDate)) {
      toast.error("Date already added.");
      return;
    }
    setUnavailDates((prev) => [...prev, newDate].sort());
    setNewDate("");
  }

  function removeUnavailDate(date: string) {
    setUnavailDates((prev) => prev.filter((d) => d !== date));
  }

  function saveSchedule() {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("barberId", barber.id);
        fd.set("schedule", JSON.stringify(schedule));
        await updateBarberAvailabilityAction(fd);
        toast.success(`${barber.displayName}'s schedule saved.`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save schedule.");
      }
    });
  }

  function saveUnavailDates() {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("barberId", barber.id);
        fd.set("dates", JSON.stringify(unavailDates));
        await updateBarberUnavailableDatesAction(fd);
        toast.success(`${barber.displayName}'s unavailable dates saved.`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  return (
    <Card className="rounded-2xl border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{barber.displayName}</CardTitle>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${barber.acceptsWalkIns ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
            {barber.acceptsWalkIns ? "Accepts walk-ins" : "No walk-ins"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Weekly hours */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weekly hours</p>
          <div className="space-y-2">
            {DAY_NAMES.map((name, day) => {
              const ranges = schedule[day];
              const active = ranges && ranges.length > 0;
              return (
                <div key={day} className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`w-12 shrink-0 rounded-md px-2 py-1 text-center text-xs font-medium transition ${
                      active
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {DAY_ABBR[day]}
                  </button>
                  {active ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="time"
                        min="10:00"
                        max="19:00"
                        value={ranges[0]?.start ?? "10:00"}
                        onChange={(e) => updateTime(day, "start", e.target.value)}
                        className="h-8 w-28 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input
                        type="time"
                        min="10:00"
                        max="19:00"
                        value={ranges[0]?.end ?? "19:00"}
                        onChange={(e) => updateTime(day, "end", e.target.value)}
                        className="h-8 w-28 text-sm"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Off</span>
                  )}
                </div>
              );
            })}
          </div>
          <Button
            onClick={saveSchedule}
            disabled={isPending}
            size="sm"
            className="mt-3"
          >
            {isPending ? "Saving..." : "Save schedule"}
          </Button>
        </div>

        {/* Unavailable dates */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unavailable dates</p>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="h-8 w-40 text-sm"
            />
            <Button type="button" onClick={addUnavailDate} size="sm" variant="outline">
              Add
            </Button>
          </div>
          {unavailDates.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unavailDates.map((date) => (
                <span
                  key={date}
                  className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-0.5 text-xs"
                >
                  {date}
                  <button
                    type="button"
                    onClick={() => removeUnavailDate(date)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
          <Button
            onClick={saveUnavailDates}
            disabled={isPending}
            size="sm"
            variant="outline"
            className="mt-2"
          >
            {isPending ? "Saving..." : "Save dates"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Shop closed dates editor                                           */
/* ------------------------------------------------------------------ */

function ShopClosedDatesCard({ closedDates: initial }: { closedDates: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dates, setDates] = useState<string[]>(initial);
  const [newDate, setNewDate] = useState("");

  function addDate() {
    if (!newDate) return;
    if (dates.includes(newDate)) { toast.error("Already added."); return; }
    setDates((prev) => [...prev, newDate].sort());
    setNewDate("");
  }

  function removeDate(date: string) {
    setDates((prev) => prev.filter((d) => d !== date));
  }

  function save() {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("dates", JSON.stringify(dates));
        await updateShopClosedDatesAction(fd);
        toast.success("Shop closed dates saved.");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  return (
    <Card className="rounded-2xl border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Shop closed dates</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Dates when the entire shop is closed. No walk-in capacity will be counted for these days.
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="h-8 w-40 text-sm"
          />
          <Button type="button" onClick={addDate} size="sm" variant="outline">
            Add
          </Button>
        </div>
        {dates.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {dates.map((date) => (
              <span
                key={date}
                className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-0.5 text-xs"
              >
                {date}
                <button
                  type="button"
                  onClick={() => removeDate(date)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
        <Button onClick={save} disabled={isPending} size="sm" className="mt-3">
          {isPending ? "Saving..." : "Save closed dates"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main editor                                                        */
/* ------------------------------------------------------------------ */

export function AvailabilityEditor({ barbers, closedDates }: AvailabilityEditorProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(245,245,245,0.96))] px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Availability settings
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Barber weekly hours &amp; unavailable dates
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Configure each barber&apos;s working hours per day of the week and mark specific
          dates as unavailable. This data drives the walk-in capacity card on the dashboard.
        </p>
      </div>

      <ShopClosedDatesCard closedDates={closedDates} />

      <div className="grid gap-6 lg:grid-cols-2">
        {barbers.map((barber) => (
          <BarberScheduleCard key={barber.id} barber={barber} />
        ))}
      </div>
    </div>
  );
}
