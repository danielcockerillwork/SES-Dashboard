import type { ConservaAppointmentRow } from "@/lib/serviceminder/types";

const headers = [
  "Org",
  "Appointment Date",
  "Service",
  "Has SES Score?",
  "Score",
  "Total",
  "Contact Lifetime Value",
  "First Appt?",
  "Contact Visits",
  "Appointment ID",
  "Appointment Link",
  "Week Number",
  "Status",
  "Service Agent",
  "Flags",
];

function escapeCsv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function conservaRowsToCsv(rows: ConservaAppointmentRow[]) {
  const lines = [headers.map(escapeCsv).join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.organizationName,
        row.appointmentDate ?? row.completedDate,
        row.serviceName,
        row.hasSesScore ? "Yes" : "No",
        row.sesScore?.displayValue ?? "",
        row.appointmentTotal,
        row.contactLifetimeValue,
        row.firstAppointment === null ? "" : row.firstAppointment ? "Yes" : "No",
        row.contactVisitCount,
        row.id,
        row.appointmentUrl,
        row.weekNumber,
        row.status,
        row.serviceAgentName,
        row.flags.join("; "),
      ]
        .map(escapeCsv)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}
