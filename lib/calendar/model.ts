import { createHash } from "node:crypto";
import type { HumanAsk } from "../../types.js";
export class CalendarError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface CalendarPolicy {
  connectionId: string;
  calendarId: string;
  projectId: string;
  timezone: string;
  startHour: number;
  endHour: number;
  bufferMinutes: number;
  bookingEnabled: boolean;
  revision: number;
  configuredBy: string;
}
export interface DiaryEvent {
  id: string;
  etag: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
  attendees?: Array<{ email?: string }>;
  organizer?: { email?: string; self?: boolean };
  recurrence?: string[];
  recurringEventId?: string;
  htmlLink?: string;
  extendedProperties?: { private?: Record<string, string> };
  transparency?: string;
}
export interface CalendarChange {
  operation: "create" | "update" | "cancel";
  eventId: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timezone: string;
  etag: string;
  occurrenceOnly: boolean;
  sourceIds: string[];
}
export function publicDiaryEvent(event: DiaryEvent): DiaryEvent {
  const {
    id,
    etag,
    summary,
    description,
    start,
    end,
    status,
    recurrence,
    recurringEventId,
    htmlLink,
    transparency,
  } = event;
  return {
    id,
    etag,
    summary,
    description,
    start,
    end,
    status,
    recurrence,
    recurringEventId,
    htmlLink,
    transparency,
    attendees: event.attendees?.map((p) => ({ email: p.email })),
    organizer: event.organizer
      ? { email: event.organizer.email, self: event.organizer.self }
      : undefined,
  };
}
export interface CalendarProposal {
  id: string;
  projectId: string;
  revision: number;
  hash: string;
  policyRevision: number;
  policy: CalendarPolicy;
  change: CalendarChange;
  before?: DiaryEvent;
  ask: HumanAsk;
  createdBy: string;
  createdAt: number;
  approvedBy?: string;
  status:
    | "review"
    | "approved"
    | "rejected"
    | "running"
    | "uncertain"
    | "verified"
    | "conflict";
  receipt?: {
    eventId: string;
    observedAt: string;
    etag?: string;
    url?: string;
    status: string;
  };
  error?: string;
  context?: {
    state: "pending" | "synced" | "failed" | "superseded";
    eventId?: string;
    observedAt?: string;
    error?: string;
  };
}
export interface CalendarLedger {
  id: string;
  connectionId: string;
  calendarId: string;
  policies: Record<string, CalendarPolicy>;
  proposals: Record<string, CalendarProposal>;
  activeOperation?: string;
  observations?: Record<
    string,
    {
      eventId: string;
      projectId: string;
      observedAt: string;
      contextId: string;
      state: string;
    }
  >;
}
export const calendarKey = (_connectionId: string, calendarId: string) =>
  createHash("sha256")
    .update(JSON.stringify(["google-calendar", calendarId]))
    .digest("hex");
export const changeHash = (change: CalendarChange, policyRevision: number) =>
  createHash("sha256")
    .update(JSON.stringify({ change, policyRevision }))
    .digest("hex");
export const providerEventId = (id: string) =>
  "hf" + createHash("sha256").update(id).digest("hex");
export function validatePolicy(
  raw: any,
): Omit<CalendarPolicy, "revision" | "configuredBy"> {
  if (
    !raw ||
    !["connectionId", "calendarId", "projectId", "timezone"].every(
      (k) =>
        typeof raw[k] === "string" && raw[k].trim() && raw[k].length <= 300,
    )
  )
    throw new CalendarError(
      422,
      "Choose a connection, calendar, project and timezone",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: raw.timezone }).format(0);
  } catch {
    throw new CalendarError(422, "Choose a valid IANA timezone");
  }
  if (
    ![raw.startHour, raw.endHour, raw.bufferMinutes].every(Number.isInteger) ||
    raw.startHour < 0 ||
    raw.endHour > 24 ||
    raw.endHour <= raw.startHour ||
    raw.bufferMinutes < 0 ||
    raw.bufferMinutes > 120
  )
    throw new CalendarError(
      422,
      "Choose valid work hours and a buffer from 0 to 120 minutes",
    );
  if (typeof raw.bookingEnabled !== "boolean")
    throw new CalendarError(
      422,
      "Explicitly choose whether booking is enabled",
    );
  return {
    connectionId: raw.connectionId,
    calendarId: raw.calendarId,
    projectId: raw.projectId,
    timezone: raw.timezone,
    startHour: raw.startHour,
    endHour: raw.endHour,
    bufferMinutes: raw.bufferMinutes,
    bookingEnabled: raw.bookingEnabled,
  };
}
export function validateChange(
  raw: any,
  policy: CalendarPolicy,
): CalendarChange {
  if (!["create", "update", "cancel"].includes(raw?.operation))
    throw new CalendarError(422, "Choose create, update or cancel");
  if (raw.attendees?.length || raw.recurrence?.length || raw.series === true)
    throw new CalendarError(
      422,
      "Guest invitations and whole-series edits require a separate policy; select a personal event or a single recurring occurrence",
    );
  for (const k of ["start", "end"])
    if (
      typeof raw[k] !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(
        raw[k],
      ) ||
      !Number.isFinite(Date.parse(raw[k])) ||
      new Date(raw[k].slice(0, 10) + "T00:00:00Z")
        .toISOString()
        .slice(0, 10) !== raw[k].slice(0, 10)
    )
      throw new CalendarError(
        422,
        "Start and end must include an explicit timezone offset",
      );
  const start = Date.parse(raw.start),
    end = Date.parse(raw.end);
  if (end <= start || end - start > 24 * 3600000)
    throw new CalendarError(
      422,
      "Choose an event duration of more than zero and at most 24 hours",
    );
  if (raw.timezone !== policy.timezone)
    throw new CalendarError(422, "Use the configured calendar timezone");
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (
    !summary ||
    summary.length > 300 ||
    typeof raw.description !== "string" ||
    raw.description.length > 8000
  )
    throw new CalendarError(
      422,
      "Enter a title up to 300 characters and notes up to 8000 characters",
    );
  if (
    raw.operation !== "create" &&
    (!raw.eventId ||
      typeof raw.eventId !== "string" ||
      raw.eventId.length > 300 ||
      typeof raw.etag !== "string" ||
      !raw.etag ||
      raw.etag.length > 300)
  )
    throw new CalendarError(
      422,
      "Select an event with its current provider revision",
    );
  if (
    raw.sourceIds !== undefined &&
    (!Array.isArray(raw.sourceIds) ||
      raw.sourceIds.length > 30 ||
      raw.sourceIds.some(
        (id: any) => typeof id !== "string" || id.length > 200,
      ))
  )
    throw new CalendarError(422, "Use up to thirty source references");
  return {
    operation: raw.operation,
    eventId: raw.operation === "create" ? "" : raw.eventId,
    etag: raw.operation === "create" ? "" : raw.etag,
    summary,
    description: raw.description,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    timezone: policy.timezone,
    occurrenceOnly: raw.occurrenceOnly === true,
    sourceIds: raw.sourceIds || [],
  };
}
export function assertPersonalEvent(event: DiaryEvent, change: CalendarChange) {
  if (event.attendees?.length || event.organizer?.self === false)
    throw new CalendarError(
      422,
      "Guest or externally organized events remain proposal-only to preserve email authority",
    );
  if (event.recurrence?.length)
    throw new CalendarError(
      422,
      "Choose one expanded recurring occurrence; whole-series mutations are not enabled",
    );
  if (event.recurringEventId && !change.occurrenceOnly)
    throw new CalendarError(
      422,
      "Explicitly select only this recurring occurrence",
    );
  if (!event.start?.dateTime || !event.end?.dateTime)
    throw new CalendarError(
      422,
      "All-day events remain read-only; select a timed event",
    );
}
export function assertAvailable(
  change: CalendarChange,
  events: DiaryEvent[],
  policy: CalendarPolicy,
) {
  if (change.operation === "cancel") return;
  const start = Date.parse(change.start),
    end = Date.parse(change.end),
    buffer = policy.bufferMinutes * 60000;
  const parts = (at: number) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: policy.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(at)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value]),
    );
  const a = parts(start - buffer),
    b = parts(end + buffer - 1);
  if (
    a.year + a.month + a.day !== b.year + b.month + b.day ||
    Number(a.hour) < policy.startHour ||
    Number(b.hour) >= policy.endHour
  )
    throw new CalendarError(
      409,
      "The event and its buffers must fit within configured work hours",
    );
  for (const event of events) {
    if (
      event.id === change.eventId ||
      event.status === "cancelled" ||
      event.transparency === "transparent"
    )
      continue;
    // Provider-expanded all-day events conservatively reserve their whole dates.
    if (event.start?.date || event.end?.date)
      throw new CalendarError(
        409,
        "An all-day event overlaps this availability window",
      );
    const s = Date.parse(event.start?.dateTime || ""),
      e = Date.parse(event.end?.dateTime || "");
    if (!Number.isFinite(s) || !Number.isFinite(e))
      throw new CalendarError(
        409,
        "Availability contains an event with incomplete timing",
      );
    if (start - buffer < e && end + buffer > s)
      throw new CalendarError(
        409,
        "The requested time conflicts with an existing event or buffer",
      );
  }
}
