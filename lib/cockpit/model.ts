export type CockpitView =
  "today" | "decisions" | "produce" | "waiting" | "contacts" | "flows" | "all";
export interface OperatingItem {
  id: string;
  version: number;
  projectId: string;
  deliverable: string;
  owner: string;
  beneficiary: string;
  dueAt: string;
  timezone: string;
  state: string;
  needsDecision: boolean;
  reviewerUid: string;
  updatedAt: number;
  sourceChanged: boolean;
  sourceCommunicationIds: string[];
  threadId?: string;
}
export interface OperatingSnapshot {
  owner: "hyperflow";
  asOf: string;
  viewerUid: string;
  timezone: string;
  items: OperatingItem[];
  contacts: Array<{ id: string; name: string }>;
  flows: Array<{
    id: string;
    name: string;
    version: number;
    status: string;
    projectId: string;
    updatedAt: number;
  }>;
  incomplete: boolean;
  notices: string[];
}
const active = (row: OperatingItem) =>
  !["fulfilled", "cancelled", "dismissed", "candidate"].includes(row.state);
export function localDay(instant: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}
export function selectOperatingItems(
  snapshot: OperatingSnapshot,
  view: CockpitView,
  party?: string,
  now = Date.now(),
): OperatingItem[] {
  const mine = `user:${snapshot.viewerUid}`;
  const today = localDay(now, snapshot.timezone);
  return snapshot.items
    .filter((row) => {
      if (party && row.owner !== party && row.beneficiary !== party)
        return false;
      if (view === "today")
        return (
          active(row) &&
          row.owner === mine &&
          !!row.dueAt &&
          (Date.parse(row.dueAt) <= now ||
            localDay(Date.parse(row.dueAt), snapshot.timezone) === today)
        );
      if (view === "decisions")
        return row.needsDecision && row.reviewerUid === snapshot.viewerUid;
      if (view === "produce") return active(row) && row.owner === mine;
      if (view === "waiting")
        return active(row) && row.beneficiary === mine && row.owner !== mine;
      return true;
    })
    .sort(
      (a, b) =>
        (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity) ||
        a.id.localeCompare(b.id),
    );
}
export function answerOperatingQuestion(
  snapshot: OperatingSnapshot,
  question: string,
  party?: string,
) {
  const q = question.toLowerCase();
  if (
    !/due|owe|owed|promis|waiting|work|produc|deliver|decid|approv|review|commit|today|deadline|who|obligation/.test(
      q,
    )
  )
    return {
      view: "all",
      items: [],
      answer:
        "I can show due work, decisions, what you owe, what others owe you, or a contact’s obligations. Choose a view or ask about one of those.",
      incomplete: snapshot.incomplete,
      asOf: snapshot.asOf,
      notices: snapshot.notices,
    };
  if (!party) {
    const matches = snapshot.contacts.filter(
      (contact) =>
        contact.name.trim().length > 2 &&
        q.includes(contact.name.trim().toLowerCase()),
    );
    if (matches.length > 1)
      return {
        view: "contacts",
        items: [],
        answer:
          "More than one contact matches. Select the person to scope this answer.",
        incomplete: false,
        asOf: snapshot.asOf,
        notices: snapshot.notices,
      };
    if (matches.length === 1) party = `contact:${matches[0].id}`;
  }
  const view: CockpitView = /decid|approv|review/.test(q)
    ? "decisions"
    : /waiting|owed|owes|promised.*me/.test(q)
      ? "waiting"
      : /today|overdue/.test(q)
        ? "today"
        : /produce|deliver|my work|\bowe\b/.test(q)
          ? "produce"
          : "all";
  const items = party && view === "produce"
    ? selectOperatingItems(snapshot, "all", party).filter(row => active(row) && row.owner === party)
    : selectOperatingItems(snapshot, view, party);
  const label = (id: string) =>
    id === `user:${snapshot.viewerUid}`
      ? "Me"
      : snapshot.contacts.find((p) => `contact:${p.id}` === id)?.name ||
        id ||
        "not agreed";
  const lines = items
    .slice(0, 20)
    .map(
      (row) =>
        `${row.deliverable} — ${label(row.owner)} owes ${label(row.beneficiary)}, due ${row.dueAt || "not agreed"}${row.timezone ? ` (${row.timezone})` : ""}; ${row.state}. Reference ${row.id}.`,
    );
  return {
    view,
    items: items.slice(0, 20),
    answer: lines.length
      ? lines.join("\n")
      : "No matching operational records were found in the permitted scope.",
    incomplete: snapshot.incomplete || items.length > 20,
    asOf: snapshot.asOf,
    notices: snapshot.notices,
  };
}
/** Explicit relationship projection: no source text, other contacts, diary or internal review metadata. */
export function relationshipItems(
  snapshot: OperatingSnapshot,
  personId: string,
  allowedProjectIds: string[],
) {
  const party = `contact:${personId}`;
  const allowed = new Set(allowedProjectIds);
  return snapshot.items
    .filter(
      (row) =>
        allowed.has(row.projectId) &&
        active(row) &&
        (row.owner === party || row.beneficiary === party),
    )
    .map((row) => ({
      id: row.id,
      deliverable: row.deliverable,
      dueAt: row.dueAt,
      timezone: row.timezone,
      state: row.state,
      direction: row.owner === party ? "you_owe" : "owed_to_you",
    }));
}
