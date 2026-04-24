"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Upload, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  previewAppointmentCsv,
  previewCustomerCsv,
  type ImportPreview,
  type ImportReport,
} from "@/lib/import/squire";
import { importAppointmentsAction, importCustomersAction } from "./actions";

type ImportWorkbenchProps = {
  timezone: string;
};

type CsvImportCardProps = {
  title: string;
  description: string;
  acceptLabel: string;
  previewParser: (text: string) => ImportPreview;
  importAction: (formData: FormData) => Promise<ImportReport>;
};

function MappingList({ mapping }: { mapping: Record<string, string | null> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {Object.entries(mapping).map(([field, column]) => (
        <div
          key={field}
          className="rounded-2xl border border-border/70 bg-muted/30 px-3 py-2"
        >
          <p className="text-[0.7rem] uppercase tracking-[0.24em] text-muted-foreground">
            {field}
          </p>
          <p className="mt-1 text-sm font-medium">
            {column ?? "Not detected"}
          </p>
        </div>
      ))}
    </div>
  );
}

function PreviewTable({ rows }: { rows: Record<string, string>[] }) {
  const headers = Object.keys(rows[0] ?? {});

  if (!headers.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
        No preview rows found in this file.
      </div>
    );
  }

  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow>
          {headers.map((header) => (
            <TableHead key={header}>{header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${index}-${Object.values(row).join("-")}`}>
            {headers.map((header) => (
              <TableCell key={`${index}-${header}`}>
                {row[header] || "—"}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ResultSummary({ report }: { report: ImportReport }) {
  return (
    <div className="space-y-3 rounded-3xl border border-emerald-200 bg-emerald-50/80 p-4">
      <div className="flex items-center gap-2 text-emerald-800">
        <CheckCircle2 className="size-4" />
        <p className="text-sm font-medium">
          {report.created} created, {report.updated} updated, {report.skipped} skipped
        </p>
      </div>

      {report.errors.length > 0 ? (
        <div className="rounded-2xl border border-emerald-200/80 bg-background px-4 py-3">
          <p className="text-sm font-medium text-foreground">Skipped rows</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {report.errors.slice(0, 10).map((error) => (
              <li key={`${error.row}-${error.reason}`}>
                Row {error.row}: {error.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CsvImportCard({
  title,
  description,
  acceptLabel,
  previewParser,
  importAction,
}: CsvImportCardProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handlePreview() {
    if (!file) {
      toast.error("Choose a CSV file first.");
      return;
    }

    const text = await file.text();
    const nextPreview = previewParser(text);
    setPreview(nextPreview);
    setReport(null);

    if (nextPreview.totalRows === 0) {
      toast.error("That CSV did not contain any importable rows.");
      return;
    }

    toast.success("Preview ready.");
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();

    const droppedFile = event.dataTransfer.files.item(0);

    if (!droppedFile) {
      return;
    }

    setFile(droppedFile);
    setPreview(null);
    setReport(null);
  }

  function handleImport() {
    if (!file) {
      toast.error("Choose a CSV file first.");
      return;
    }

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const nextReport = await importAction(formData);
        setReport(nextReport);
        toast.success("Import finished.");
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Import failed unexpectedly.";
        toast.error(message);
      }
    });
  }

  return (
    <Card className="rounded-[2rem] border-border/70 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-border/70 bg-muted/30 p-3">
            <FileSpreadsheet className="size-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-muted-foreground">
              CSV flow
            </p>
            <CardTitle className="mt-1 text-xl">{title}</CardTitle>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>

      <CardContent className="space-y-5">
        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          className="flex cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-border/80 bg-[radial-gradient(circle_at_top,_rgba(0,0,0,0.03),_transparent_55%)] px-6 py-10 text-center transition hover:border-foreground/30 hover:bg-muted/30"
        >
          <Upload className="size-5 text-muted-foreground" />
          <p className="mt-4 font-medium">{acceptLabel}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Drag and drop a CSV here, or browse from your computer.
          </p>
          <Input
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const nextFile = event.target.files?.item(0) ?? null;
              setFile(nextFile);
              setPreview(null);
              setReport(null);
            }}
          />
        </label>

        {file ? (
          <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm">
            <p className="font-medium">{file.name}</p>
            <p className="mt-1 text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB selected
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={handlePreview} disabled={!file || isPending}>
            Preview
          </Button>
          <Button onClick={handleImport} disabled={!preview || isPending}>
            {isPending ? "Importing..." : "Import"}
          </Button>
        </div>

        {isPending ? (
          <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 p-4">
            <div className="h-2 overflow-hidden rounded-full bg-border/80">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-foreground/70" />
            </div>
            <p className="text-sm text-muted-foreground">
              Importing records and refreshing the admin views...
            </p>
          </div>
        ) : null}

        {preview ? (
          <div className="space-y-4 rounded-[1.75rem] border border-border/70 bg-background/90 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  Rows detected
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  {preview.totalRows}
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  Valid rows
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  {preview.validRows}
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  Invalid rows
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  {preview.invalidRows}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Detected column mapping</p>
              <MappingList mapping={preview.mapping} />
            </div>

            {preview.errors.length > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
                <p className="text-sm font-medium text-amber-900">Preview warnings</p>
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  {preview.errors.map((error) => (
                    <li key={`${error.row}-${error.reason}`}>
                      Row {error.row}: {error.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="space-y-3">
              <p className="text-sm font-medium">First 10 parsed rows</p>
              <div className="overflow-x-auto">
                <PreviewTable rows={preview.previewRows} />
              </div>
            </div>
          </div>
        ) : null}

        {report ? <ResultSummary report={report} /> : null}
      </CardContent>
    </Card>
  );
}

export function ImportWorkbench({ timezone }: ImportWorkbenchProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-border/70 bg-[linear-gradient(135deg,rgba(0,0,0,0.04),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.75),rgba(255,255,255,0.95))] px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Squire migration
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Import historical shop data without leaving the admin.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Preview each CSV before it touches the database, verify the column
          mapping, and then bring customers plus appointment history into the
          system using the shop timezone of {timezone}.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <CsvImportCard
          title="Import Customers"
          description="Use the Squire client export to create or update customer records by shop + phone."
          acceptLabel="Drop squire-export.csv"
          previewParser={previewCustomerCsv}
          importAction={importCustomersAction}
        />
        <CsvImportCard
          title="Import Appointment History"
          description="Bring over historical appointments, create placeholder services/barbers when needed, and update customer visit stats."
          acceptLabel="Drop squire-appointments.csv"
          previewParser={(text) => previewAppointmentCsv(text, timezone)}
          importAction={importAppointmentsAction}
        />
      </div>
    </div>
  );
}
