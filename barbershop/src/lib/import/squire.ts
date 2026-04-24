import { isValid, parse } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import Papa from "papaparse";

type CsvRow = Record<string, string>;

export type ImportError = {
  row: number;
  reason: string;
};

export type ImportReport = {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
};

export type ImportPreview = {
  previewRows: CsvRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  mapping: Record<string, string | null>;
  errors: ImportError[];
};

export type PreparedCustomerRow = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  valid: boolean;
  reason?: string;
};

export type PreparedAppointmentRow = {
  rowNumber: number;
  clientName: string;
  clientPhone: string | null;
  serviceName: string;
  barberName: string;
  statusText: string;
  scheduledStart: Date | null;
  valid: boolean;
  reason?: string;
};

const customerAliases = {
  firstName: ["first name", "first_name", "firstname", "client first name"],
  lastName: ["last name", "last_name", "lastname", "client last name"],
  phone: [
    "phone",
    "phone number",
    "mobile",
    "mobile phone",
    "cell",
    "client phone",
    "customer phone",
  ],
  email: ["email", "email address", "client email", "customer email"],
  notes: ["notes", "note", "client notes", "customer notes"],
};

const appointmentAliases = {
  date: ["date", "appointment date", "appt date", "start date", "day"],
  time: ["time", "appointment time", "appt time", "start time"],
  dateTime: ["date time", "datetime", "appointment datetime", "start"],
  client: ["client", "client name", "customer", "customer name", "name"],
  service: ["service", "service name", "service type"],
  barber: ["barber", "barber name", "staff", "provider", "employee"],
  status: ["status", "appointment status"],
  phone: ["phone", "client phone", "customer phone", "mobile"],
};

function normalizeHeaderKey(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value: unknown) {
  return String(value ?? "").trim();
}

function parseCsvText(text: string) {
  const result = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });

  const rows = result.data.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, cleanValue(value)]),
    ),
  );

  const headers = Object.keys(rows[0] ?? {});

  return { rows, headers };
}

function detectMapping(
  headers: string[],
  aliases: Record<string, string[]>,
): Record<string, string | null> {
  const normalizedHeaders = new Map(
    headers.map((header) => [normalizeHeaderKey(header), header]),
  );

  return Object.fromEntries(
    Object.entries(aliases).map(([field, fieldAliases]) => {
      const matchedHeader =
        fieldAliases
          .map((alias) => normalizedHeaders.get(normalizeHeaderKey(alias)))
          .find(Boolean) ?? null;

      return [field, matchedHeader];
    }),
  );
}

function getMappedValue(row: CsvRow, column: string | null) {
  if (!column) {
    return "";
  }

  return cleanValue(row[column]);
}

export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (digits.length > 11) {
    return `+${digits}`;
  }

  return null;
}

function splitFullName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return { firstName: "", lastName: "" };
  }

  const parts = normalized.split(" ");

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) ?? "",
  };
}

export function normalizePersonName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseDateTimeCandidate(value: string, formats: string[]) {
  for (const format of formats) {
    const parsed = parse(value, format, new Date());

    if (isValid(parsed)) {
      return parsed;
    }
  }

  const parsedFromNative = new Date(value);

  if (isValid(parsedFromNative)) {
    return parsedFromNative;
  }

  return null;
}

export function parseAppointmentDateTime(
  dateValue: string,
  timeValue: string,
  timezone: string,
) {
  const combinedValue = `${dateValue} ${timeValue}`.trim();

  const parsed = parseDateTimeCandidate(combinedValue, [
    "M/d/yyyy h:mm a",
    "M/d/yyyy h:mm:ss a",
    "M/d/yyyy h:mm aa",
    "M/d/yyyy H:mm",
    "M/d/yy h:mm a",
    "M/d/yy H:mm",
    "MM/dd/yyyy h:mm a",
    "MM/dd/yyyy H:mm",
    "yyyy-MM-dd H:mm",
    "yyyy-MM-dd h:mm a",
    "MMM d yyyy h:mm a",
    "MMMM d yyyy h:mm a",
  ]);

  if (!parsed) {
    return null;
  }

  return fromZonedTime(parsed, timezone);
}

export function normalizeImportedAppointmentStatus(statusText: string) {
  const normalized = statusText.toLowerCase();

  if (normalized.includes("no show") || normalized.includes("noshow")) {
    return "no_show" as const;
  }

  if (normalized.includes("cancel")) {
    return "cancelled" as const;
  }

  if (normalized.includes("progress")) {
    return "in_progress" as const;
  }

  if (normalized.includes("confirm")) {
    return "confirmed" as const;
  }

  if (normalized.includes("schedule")) {
    return "scheduled" as const;
  }

  return "completed" as const;
}

export function prepareCustomerRows(text: string) {
  const { rows, headers } = parseCsvText(text);
  const mapping = detectMapping(headers, customerAliases);

  const preparedRows: PreparedCustomerRow[] = rows.map((row, index) => {
    const firstName = getMappedValue(row, mapping.firstName);
    const lastName = getMappedValue(row, mapping.lastName);
    const phone = normalizePhone(getMappedValue(row, mapping.phone));
    const email = getMappedValue(row, mapping.email).toLowerCase() || null;
    const notes = getMappedValue(row, mapping.notes) || null;

    if (!firstName && !lastName) {
      return {
        rowNumber: index + 2,
        firstName,
        lastName,
        phone,
        email,
        notes,
        valid: false,
        reason: "Missing customer name",
      };
    }

    if (!phone) {
      return {
        rowNumber: index + 2,
        firstName,
        lastName,
        phone,
        email,
        notes,
        valid: false,
        reason: "Missing or invalid phone number",
      };
    }

    return {
      rowNumber: index + 2,
      firstName,
      lastName,
      phone,
      email,
      notes,
      valid: true,
    };
  });

  return {
    mapping,
    rows,
    preparedRows,
  };
}

export function prepareAppointmentRows(text: string, timezone: string) {
  const { rows, headers } = parseCsvText(text);
  const mapping = detectMapping(headers, appointmentAliases);

  const preparedRows: PreparedAppointmentRow[] = rows.map((row, index) => {
    const dateValue =
      getMappedValue(row, mapping.date) || getMappedValue(row, mapping.dateTime);
    const timeValue = getMappedValue(row, mapping.time);
    const clientName = getMappedValue(row, mapping.client);
    const serviceName = getMappedValue(row, mapping.service);
    const barberName = getMappedValue(row, mapping.barber);
    const statusText = getMappedValue(row, mapping.status) || "completed";
    const clientPhone = normalizePhone(getMappedValue(row, mapping.phone));
    const scheduledStart = parseAppointmentDateTime(dateValue, timeValue, timezone);

    if (!clientName) {
      return {
        rowNumber: index + 2,
        clientName,
        clientPhone,
        serviceName,
        barberName,
        statusText,
        scheduledStart,
        valid: false,
        reason: "Missing client name",
      };
    }

    if (!serviceName) {
      return {
        rowNumber: index + 2,
        clientName,
        clientPhone,
        serviceName,
        barberName,
        statusText,
        scheduledStart,
        valid: false,
        reason: "Missing service name",
      };
    }

    if (!barberName) {
      return {
        rowNumber: index + 2,
        clientName,
        clientPhone,
        serviceName,
        barberName,
        statusText,
        scheduledStart,
        valid: false,
        reason: "Missing barber name",
      };
    }

    if (!scheduledStart) {
      return {
        rowNumber: index + 2,
        clientName,
        clientPhone,
        serviceName,
        barberName,
        statusText,
        scheduledStart,
        valid: false,
        reason: "Missing or invalid appointment date/time",
      };
    }

    return {
      rowNumber: index + 2,
      clientName,
      clientPhone,
      serviceName,
      barberName,
      statusText,
      scheduledStart,
      valid: true,
    };
  });

  return {
    mapping,
    rows,
    preparedRows,
  };
}

export function previewCustomerCsv(text: string): ImportPreview {
  const { rows, mapping, preparedRows } = prepareCustomerRows(text);
  const errors = preparedRows
    .filter((row) => !row.valid)
    .slice(0, 10)
    .map((row) => ({
      row: row.rowNumber,
      reason: row.reason ?? "Invalid row",
    }));

  return {
    previewRows: rows.slice(0, 10),
    totalRows: rows.length,
    validRows: preparedRows.filter((row) => row.valid).length,
    invalidRows: preparedRows.filter((row) => !row.valid).length,
    mapping,
    errors,
  };
}

export function previewAppointmentCsv(
  text: string,
  timezone: string,
): ImportPreview {
  const { rows, mapping, preparedRows } = prepareAppointmentRows(text, timezone);
  const errors = preparedRows
    .filter((row) => !row.valid)
    .slice(0, 10)
    .map((row) => ({
      row: row.rowNumber,
      reason: row.reason ?? "Invalid row",
    }));

  return {
    previewRows: rows.slice(0, 10),
    totalRows: rows.length,
    validRows: preparedRows.filter((row) => row.valid).length,
    invalidRows: preparedRows.filter((row) => !row.valid).length,
    mapping,
    errors,
  };
}

export function splitClientName(value: string) {
  return splitFullName(value);
}
