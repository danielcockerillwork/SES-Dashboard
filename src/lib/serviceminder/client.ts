import { firstArray, isRecord, numberField, stringField, type RawRecord } from "@/lib/serviceminder/field-access";
import type { AppointmentQueryParams, PagedResponse, ServiceMinderClientOptions } from "@/lib/serviceminder/types";

export class ServiceMinderApiError extends Error {
  resultCode: number | null;
  endpoint: string;
  payload: RawRecord | null;
  statusCode: number | null;

  constructor(
    message: string,
    endpoint: string,
    resultCode: number | null,
    payload: RawRecord | null = null,
    statusCode: number | null = null,
  ) {
    super(message);
    this.name = "ServiceMinderApiError";
    this.endpoint = endpoint;
    this.resultCode = resultCode;
    this.payload = payload;
    this.statusCode = statusCode;
  }
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 522, 523, 524]);

function endpointUrl(baseUrl: string, endpoint: string) {
  return `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
}

function asRecord(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function isTransientError(error: unknown) {
  return error instanceof ServiceMinderApiError && error.statusCode !== null && TRANSIENT_HTTP_STATUSES.has(error.statusCode);
}

export class ServiceMinderClient {
  private baseUrl: string;
  private apiKey: string;
  private fetcher: typeof fetch;
  private retryAttempts: number;
  private retryDelayMs: number;

  constructor(options: ServiceMinderClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.retryAttempts = options.retryAttempts ?? positiveIntegerEnv("SERVICEMINDER_RETRY_ATTEMPTS", 2);
    this.retryDelayMs = options.retryDelayMs ?? positiveIntegerEnv("SERVICEMINDER_RETRY_DELAY_MS", 350);
  }

  async post<T extends RawRecord = RawRecord>(endpoint: string, payload: RawRecord = {}): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
      try {
        return await this.postOnce<T>(endpoint, payload);
      } catch (error) {
        lastError = error;
        if (!isTransientError(error) || attempt >= this.retryAttempts) break;
        await sleep(this.retryDelayMs * 2 ** attempt);
      }
    }

    throw lastError;
  }

  private async postOnce<T extends RawRecord = RawRecord>(endpoint: string, payload: RawRecord = {}): Promise<T> {
    const response = await this.fetcher(endpointUrl(this.baseUrl, endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        ...payload,
        ApiKey: this.apiKey,
      }),
      cache: "no-store",
    });

    const text = await response.text();
    let parsed: RawRecord;
    let parsedJson = true;
    try {
      parsed = asRecord(text ? JSON.parse(text) : {});
    } catch {
      parsedJson = false;
      parsed = { body: text };
    }

    if (!response.ok) {
      const message = parsedJson ? parsed.Message ?? response.statusText : response.statusText || "non-JSON response";
      throw new ServiceMinderApiError(
        `ServiceMinder HTTP ${response.status}: ${String(message || "<none>")}`,
        endpoint,
        numberField(parsed, ["ResultCode"]),
        parsed,
        response.status,
      );
    }

    if (!parsedJson) {
      throw new ServiceMinderApiError(
        `ServiceMinder returned non-JSON response with status ${response.status}.`,
        endpoint,
        null,
        { body: text },
      );
    }

    const resultCode = numberField(parsed, ["ResultCode"]);
    if (resultCode !== null && resultCode !== 0) {
      throw new ServiceMinderApiError(
        String(parsed.Message ?? `ServiceMinder returned ResultCode ${resultCode}.`),
        endpoint,
        resultCode,
        parsed,
      );
    }

    return parsed as T;
  }

  async echo() {
    return this.post("test/echo");
  }

  async serviceAgents() {
    return this.post("serviceagents/all", { IncludeInactive: false });
  }

  async services() {
    return this.post("services/all", { IncludeInactive: false });
  }

  async organizations() {
    return this.post("organizations/query", {
      PublicName: "",
      InternalName: "",
      LocationId: "",
      PostalCode: "",
      IncludeInactive: false,
    });
  }

  async organizationDetails(organizationId: string | number) {
    const id = typeof organizationId === "number" ? organizationId : Number(organizationId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return this.post("organizations/details", { OrganizationId: id });
  }

  async locateContact(contactId: string | number): Promise<RawRecord | null> {
    const id = typeof contactId === "number" ? contactId : Number(contactId);
    if (!Number.isInteger(id) || id <= 0) return null;

    const response = await this.post("contacts/locate", {
      IdSearch: id,
      NameSearch: "",
      PhoneSearch: "",
      EmailSearch: "",
      AddressSearch: "",
      DigitalTrackingIdSearch: "",
      ReturnPmtOnFile: false,
      DistributeLead: false,
      Skip: 0,
      Limit: 1,
    });
    const matches = firstArray(response, ["Matches"]).filter(isRecord);
    return matches.find((match) => stringField(match, ["Id", "ContactId"]) === String(id)) ?? matches[0] ?? null;
  }

  async queryAppointments(params: AppointmentQueryParams): Promise<PagedResponse<RawRecord>> {
    const contactId = Number(params.contactId);
    return this.queryPaged(
      "appointments/query",
      "Appointments",
      {
        FromDate: params.fromDate,
        ThroughDate: params.throughDate,
        UpdatedFrom: params.updatedFrom,
        UpdatedThrough: params.updatedThrough,
        ...(Number.isInteger(contactId) && contactId > 0 ? { ContactId: contactId } : {}),
        IncludeContact: params.includeContact ?? true,
        IncludeCompleted: params.includeCompleted ?? true,
      },
      params.take,
      params.maxRecords,
    );
  }

  private async queryPaged(
    endpoint: string,
    collectionKey: string,
    basePayload: RawRecord,
    take = positiveIntegerEnv("SERVICEMINDER_PAGE_SIZE", 50),
    maxRecords = Number(process.env.SERVICEMINDER_MAX_RECORDS ?? 5000),
  ): Promise<PagedResponse<RawRecord>> {
    const items: RawRecord[] = [];
    const rawResponses: RawRecord[] = [];
    let warning: string | null = null;
    let totalCount: number | null = null;
    let skip = 0;

    while (items.length < maxRecords) {
      let response: RawRecord;
      try {
        response = await this.post(endpoint, {
          ...basePayload,
          Skip: skip,
          Take: take,
        });
      } catch (error) {
        if (items.length > 0 && isTransientError(error)) {
          warning = `${(error as Error).message} Returned ${items.length} live rows before ServiceMinder timed out. Narrow the date range or retry to complete the report.`;
          break;
        }
        throw error;
      }

      rawResponses.push(response);
      totalCount = numberField(response, ["Count", "TotalCount"]) ?? totalCount;

      const page = firstArray(response, [collectionKey]).filter(isRecord);
      items.push(...page);

      if (page.length < take) break;
      skip += take;
      if (totalCount !== null && items.length >= totalCount) break;
    }

    return {
      items: items.slice(0, maxRecords),
      rawResponses,
      totalCount,
      warning,
    };
  }
}
