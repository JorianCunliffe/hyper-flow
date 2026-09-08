import { googleAccessToken } from "../integrations/googleWorkspace.js";
import { listWorkspaceConnectionRefs } from "../serverStore.js";
import {
  CalendarError,
  type CalendarChange,
  type DiaryEvent,
} from "./model.js";
export const CALENDAR_READ_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];
export const CALENDAR_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export class GoogleCalendar {
  constructor(
    private orgId: string,
    private connectionId: string,
    private deps: {
      token?: typeof googleAccessToken;
      connections?: typeof listWorkspaceConnectionRefs;
      fetch?: typeof fetch;
    } = {},
  ) {}
  private async request<T>(
    path: string,
    init: RequestInit = {},
    write = false,
  ): Promise<T> {
    const connection = (
      await (this.deps.connections || listWorkspaceConnectionRefs)(this.orgId)
    ).find((c) => c.id === this.connectionId && c.state === "connected");
    const scopes = connection?.scopes || [];
    if (
      !connection ||
      !(
        scopes.includes("https://www.googleapis.com/auth/calendar") ||
        (write
          ? scopes.includes(CALENDAR_WRITE_SCOPE)
          : scopes.includes(CALENDAR_WRITE_SCOPE) ||
            scopes.includes(CALENDAR_READ_SCOPES[1]))
      )
    )
      throw new CalendarError(
        403,
        `Reconnect this Google account with calendar ${write ? "write" : "read"} access`,
      );
    const token = await (this.deps.token || googleAccessToken)(
      this.orgId,
      this.connectionId,
    );
    const response = await (this.deps.fetch || fetch)(
      `https://www.googleapis.com/calendar/v3/${path}`,
      {
        ...init,
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
    );
    if (!response.ok)
      throw new CalendarError(
        response.status,
        `Google Calendar returned ${response.status}; refresh or reconcile before retrying a write`,
      );
    return (response.status === 204 ? {} : await response.json()) as T;
  }
  async calendars() {
    let pageToken = "";
    const items: Array<{
      id: string;
      summary: string;
      accessRole: string;
      timeZone?: string;
    }> = [];
    for (let page = 0; page < 5; page++) {
      const result: any = await this.request(
        `users/me/calendarList?${new URLSearchParams({ maxResults: "100", ...(pageToken ? { pageToken } : {}) })}`,
      );
      items.push(...(result.items || []));
      pageToken = result.nextPageToken || "";
      if (!pageToken) return items;
    }
    throw new CalendarError(
      422,
      "Calendar list exceeds the supported 500 calendars",
    );
  }
  async events(calendarId: string, start: string, end: string) {
    let pageToken = "";
    const items: DiaryEvent[] = [];
    for (let page = 0; page < 10; page++) {
      const result: any = await this.request(
        `calendars/${encodeURIComponent(calendarId)}/events?${new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: "true", showDeleted: "false", maxResults: "250", ...(pageToken ? { pageToken } : {}) })}`,
      );
      items.push(...(result.items || []));
      pageToken = result.nextPageToken || "";
      if (!pageToken) return items;
    }
    throw new CalendarError(
      409,
      "Availability is incomplete; the event page limit was reached",
    );
  }
  get(calendarId: string, eventId: string) {
    return this.request<DiaryEvent>(
      `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  }
  async write(
    calendarId: string,
    change: CalendarChange,
    eventId: string,
    hash: string,
  ) {
    const path = `calendars/${encodeURIComponent(calendarId)}/events${change.operation === "create" ? "" : "/" + encodeURIComponent(eventId)}?sendUpdates=none`;
    const existing =
      change.operation === "update"
        ? await this.get(calendarId, eventId)
        : null;
    if (existing && existing.etag !== change.etag)
      throw new CalendarError(412, "Calendar event changed before update");
    const body = {
      ...(change.operation === "create" ? { id: eventId } : {}),
      summary: change.summary,
      description: change.description,
      start: { dateTime: change.start, timeZone: change.timezone },
      end: { dateTime: change.end, timeZone: change.timezone },
      extendedProperties: {
        private: {
          ...existing?.extendedProperties?.private,
          hyperflowOperation: hash,
        },
      },
      ...(change.operation === "create"
        ? {
            visibility: "private",
            guestsCanInviteOthers: false,
            reminders: { useDefault: false },
          }
        : {}),
    };
    return this.request<DiaryEvent>(
      path,
      {
        method:
          change.operation === "create"
            ? "POST"
            : change.operation === "update"
              ? "PATCH"
              : "DELETE",
        ...(change.operation !== "create"
          ? { headers: { "If-Match": change.etag } }
          : {}),
        ...(change.operation !== "cancel"
          ? { body: JSON.stringify(body) }
          : {}),
      },
      true,
    );
  }
}
