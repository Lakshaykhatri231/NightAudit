/**
 * The only code that talks to the Python server. Same origin, so the HttpOnly session cookie is sent
 * automatically. Hotel routes are /api/clients/{hotel}/...; the server answers 403 for any hotel
 * other than the signed-in user's own.
 */
import type { HotelId, ImportRecord, ImportResult, Overview, Report, ReportEvent, ReportSummary, SamplePreview } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Sends a request and returns the parsed JSON. Objects are sent as JSON; strings as-is. */
async function call<T>(method: string, path: string, body?: string | object, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers };
  if (typeof body === "string") {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...headers, "Content-Type": "application/json" };
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    // The server sends errors as {"error": "..."}.
    const message = data && typeof data === "object" && "error" in data ? String(data.error) : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

const hotelPath = (hotel: HotelId) => `/api/clients/${hotel}`;

export interface Me {
  username: string;
  name: string;
  role: "analyst" | "reviewer";
  client_id: HotelId;
}

export const api = {
  me: () => call<Me>("GET", "/api/me"),
  login: (username: string, password: string) => call<Me>("POST", "/api/login", { username, password }),
  logout: () => call<{ ok: boolean }>("POST", "/api/logout"),

  overview: (h: HotelId) => call<Overview>("GET", hotelPath(h)),
  imports: (h: HotelId) => call<ImportRecord[]>("GET", `${hotelPath(h)}/imports`),
  sampleCsvUrl: (h: HotelId) => `${hotelPath(h)}/imports/sample.csv`,
  sampleCsv: async (h: HotelId) => {
    const res = await fetch(api.sampleCsvUrl(h), { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    return res.text();
  },
  samplePreview: (h: HotelId) => call<SamplePreview>("GET", `${hotelPath(h)}/imports/sample/preview`),
  // HTTP headers must be plain ASCII, so other characters in the file name are replaced.
  uploadCsv: (h: HotelId, fileName: string, text: string) =>
    call<ImportResult>("POST", `${hotelPath(h)}/imports`, text, { "Content-Type": "text/csv", "X-Filename": fileName.replace(/[^\x20-\x7e]/g, "_") }),

  reports: (h: HotelId) => call<ReportSummary[]>("GET", `${hotelPath(h)}/reports`),
  report: (h: HotelId, id: number) => call<Report>("GET", `${hotelPath(h)}/reports/${id}`),
  compose: (h: HotelId, period_start: string, period_end: string) =>
    call<Report>("POST", `${hotelPath(h)}/reports`, { period_start, period_end }),
  transition: (h: HotelId, id: number, action: "submit" | "approve" | "reject", comment = "") =>
    call<Report>("POST", `${hotelPath(h)}/reports/${id}/${action}`, { comment }),

  audit: (h: HotelId) => call<ReportEvent[]>("GET", `${hotelPath(h)}/audit`),

  exportUrl: (h: HotelId, id: number, format: "html" | "csv" | "json") => `${hotelPath(h)}/reports/${id}/export?format=${format}`,
};
