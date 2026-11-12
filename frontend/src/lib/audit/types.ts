/** Shapes returned by the Python API (hotelreports/server.py), plus a few UI-only types. */
export type HotelId = "harbourlight" | "pinecrest";
export type Platform = "instagram" | "facebook" | "tiktok";
export type Role = "analyst" | "reviewer";

export const PLATFORMS: Platform[] = ["instagram", "facebook", "tiktok"];
export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

export interface Hotel {
  id: HotelId;
  name: string;
  fullName: string;
  place: string;
  code: string;
  tone: "harbour" | "pine";
  /** Where this hotel's SQLite file lives on the server (shown as a label). */
  vault: string;
  image: string;
}

export interface User {
  id: string; // the server's username, e.g. anna@harbourlight
  name: string;
  role: Role;
  hotel: HotelId;
  title: string;
  room: string;
}

export interface ImportError {
  row: number | null;
  reason: string;
}

export interface ImportRecord {
  id: number;
  filename: string;
  status: string;
  rows_total: number;
  rows_ok: number;
  rows_rejected: number;
  imported_by: string;
  created_at: string;
  errors: ImportError[];
}

export interface ImportResult {
  import_id: number;
  filename: string;
  status: string;
  rows_total: number;
  rows_ok: number;
  rows_rejected: number;
  errors: ImportError[];
  date_range: { start: string; end: string } | null;
}

/** One data line of an uploaded CSV, with the server's verdict. */
export interface ManifestLine {
  line: number;
  raw: string | null;
  ok: boolean;
  reasons: string[];
}

/** What the upload panel shows: the server's verdict, joined to the raw lines when we have them. */
export interface Inspection {
  fileName: string;
  at: string;
  total: number;
  accepted: number;
  rejected: number;
  lines: ManifestLine[] | null; // null when we only have the server's record, not the file text
  errors: ImportError[];
  refused: { kind: "columns" | "wrong_hotel" | "other"; message: string } | null;
}

export interface Overview {
  client_id: HotelId;
  name: string;
  location: string;
  brand: string;
  data_range: { start: string | null; end: string | null; rows: number };
  report_counts: Record<string, number>;
  imports: number;
}

export type ReportStatus = "draft" | "pending_review" | "approved" | "rejected";

export interface ReportSummary {
  id: number;
  period_start: string;
  period_end: string;
  status: ReportStatus;
  content_hash: string;
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
}

export interface Totals {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  link_clicks: number;
  posts: number;
  website_bookings_attributed: number;
  engagements: number;
  engagement_rate: number | null;
  ctr: number | null;
  booking_conversion: number | null;
  row_count: number;
}

export interface PlatformTotals extends Totals {
  engagements_per_post: number | null;
  share_of_engagements: number | null;
  share_of_bookings: number | null;
  share_of_reach: number | null;
}

export interface Change {
  current: number | null;
  previous: number | null;
  change: number | null;
}

export interface DailyPoint {
  date: string;
  engagements: number;
  reach: number;
  link_clicks: number;
  bookings: number;
  followers: number;
}

export interface WeekPoint {
  week_start: string;
  from: string;
  to: string;
  engagements: number;
  reach: number;
  bookings: number;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface Payload {
  client_id: HotelId;
  client_name: string;
  client_location: string;
  period: { start: string; end: string; label: string };
  previous_period: { label: string; used: boolean; note: string | null };
  generated_at: string;
  generated_by: { username: string; name: string };
  summary: {
    overall: Totals;
    by_platform: Partial<Record<Platform, PlatformTotals>>;
    followers: {
      start: number;
      end: number;
      net: number;
      pct: number | null;
      by_platform: Partial<Record<Platform, { start: number; end: number; net: number; pct: number | null }>>;
    };
    best_platform: Platform | null;
    daily: DailyPoint[];
    top_day: DailyPoint | null;
    weekly: WeekPoint[];
    top_week: WeekPoint | null;
    weekday: {
      best: string | null;
      best_uplift: number | null;
      average_day: number | null;
      by_weekday: { weekday: string; days: number; avg_engagements: number | null }[];
    };
    funnel: { key: string; label: string; value: number; rate: number | null; rate_of: string | null }[];
  };
  comparison: Record<string, Change> | null;
  previous_daily: DailyPoint[] | null;
  checks: Check[];
  narrative: string[];
  insights: {
    verdict: { label: string; tone: "good" | "neutral" | "bad" | string; icon: string };
    headline: string;
    plain: Record<string, string>;
    wins: string[];
    watch_outs: string[];
    actions: string[];
    platform_roles: Partial<Record<Platform, string[]>>;
    rules_note: string;
  };
}

export interface ReportEvent {
  id: number;
  report_id: number | null;
  action: string;
  actor: string;
  comment: string | null;
  at: string;
}

export interface Report extends ReportSummary {
  payload: Payload;
  events: ReportEvent[];
}

/** GET /api/clients/{id}/imports/sample/preview: the sample file with the server's verdict per row. */
export interface SamplePreview {
  filename: string;
  columns: string[];
  rows: { line: number; ok: boolean; reason: string | null; values: Record<string, string> }[];
  rows_total: number;
  rows_ok: number;
  rows_rejected: number;
}
