import type { RawRecord } from "@/lib/serviceminder/field-access";

export type { RawRecord };

export type ServiceMinderClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetcher?: typeof fetch;
  retryAttempts?: number;
  retryDelayMs?: number;
};

export type AppointmentQueryParams = {
  fromDate: string;
  throughDate: string;
  updatedFrom?: string;
  updatedThrough?: string;
  contactId?: string | number;
  includeContact?: boolean;
  includeCompleted?: boolean;
  take?: number;
  maxRecords?: number;
};

export type PagedResponse<T extends RawRecord> = {
  items: T[];
  rawResponses: RawRecord[];
  totalCount: number | null;
  warning: string | null;
};

export type CustomFieldValueType = "blank" | "number" | "boolean" | "date" | "text" | "array" | "object";

export type CustomFieldValue = {
  name: string;
  normalizedName: string;
  value: unknown;
  displayValue: string;
  valueType: CustomFieldValueType;
  numericValue: number | null;
  scoreLike: boolean;
  sourcePath: string;
  rawKey: string | null;
};

export type ConservaAppointmentRow = {
  id: string | null;
  appointmentUrl: string | null;
  appointmentDate: string | null;
  completedDate: string | null;
  isCompleted: boolean;
  status: string | null;
  customerName: string | null;
  contactId: string | null;
  serviceName: string | null;
  serviceId: string | null;
  serviceAgentName: string | null;
  serviceAgentId: string | null;
  organizationName: string | null;
  organizationId: string | null;
  locationName: string | null;
  appointmentTotal: number | null;
  contactLifetimeValue: number | null;
  appointmentNotes: string | null;
  firstAppointment: boolean | null;
  contactVisitCount: number | null;
  weekNumber: number | null;
  sesScore: CustomFieldValue | null;
  hasSesScore: boolean;
  customFields: CustomFieldValue[];
  customFieldNames: string[];
  scoreValues: CustomFieldValue[];
  flags: string[];
  raw: RawRecord;
};

export type CustomFieldScoreSummary = {
  name: string;
  normalizedName: string;
  count: number;
  missingCount: number;
  coverageRate: number;
  valueTypes: Record<string, number>;
  scoreLike: boolean;
  numericCount: number;
  average: number | null;
  min: number | null;
  max: number | null;
  topValues: Array<{ value: string; count: number }>;
  examples: string[];
};

export type ScoreTrendPoint = {
  period: string;
  fieldName: string;
  average: number | null;
  count: number;
};

export type ConservaReportSummary = {
  completedAppointments: number;
  appointmentsWithSesScore: number;
  sesScoreCoverageRate: number;
  missingSesScore: number;
  averageSesScore: number | null;
  minSesScore: number | null;
  maxSesScore: number | null;
  firstAppointments: number;
  firstAppointmentsWithSesScore: number;
  firstAppointmentSesScoreCoverageRate: number;
  totalAppointmentValue: number;
  appointmentsWithCustomFields: number;
  customFieldCoverageRate: number;
  selectedFieldCoverageRate: number | null;
  selectedFieldMissing: number | null;
  scoreFieldCount: number;
  averageScore: number | null;
  missingAnyCustomField: number;
};

export type ConservaReportFilters = {
  from: string;
  through: string;
  serviceAgentId?: string | null;
  serviceAgentName?: string | null;
  serviceType?: string | null;
  serviceTypes?: string[];
  organization?: string | null;
  customField?: string | null;
  missingSelectedField?: boolean;
  missingSesScore?: boolean;
  minScore?: number | null;
  maxScore?: number | null;
  search?: string | null;
};

export type ConservaReportResult = {
  source: "live" | "mock" | "cache";
  warning: string | null;
  rows: ConservaAppointmentRow[];
  summary: ConservaReportSummary;
  fieldSummaries: CustomFieldScoreSummary[];
  scoreTrends: ScoreTrendPoint[];
  rawPayloads: RawRecord[];
};
