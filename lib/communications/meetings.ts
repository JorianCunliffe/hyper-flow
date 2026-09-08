import { HttpCommunicationsClient } from "./client.js";
import { CommunicationsApiError } from "./errors.js";
import { listTenantProjects } from "../serverStore.js";
import type { MeetingInput, MeetingRecord } from "./meetingTypes.js";
export class MeetingRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { status: string },
  ) {
    super(message);
  }
}
export async function handleMeetingRequest(
  request: { method?: string; query?: Record<string, any>; body?: any },
  member: { orgId: string; uid: string },
  dependencies: {
    client?: Pick<
      HttpCommunicationsClient,
      "listMeetings" | "getMeeting" | "findMeeting" | "importMeeting"
    >;
    projects?: typeof listTenantProjects;
  } = {},
) {
  const client = dependencies.client || new HttpCommunicationsClient();
  const projects = await (dependencies.projects || listTenantProjects)(
    member.orgId,
  );
  const allowed = new Set(projects.map((p) => String(p.id)));
  const permitted = (row: MeetingRecord) =>
    row.metadata.visibility !== "private" &&
    Array.isArray(row.metadata.topics) &&
    row.metadata.topics.length > 0 &&
    row.metadata.topics.every((t) => allowed.has(t.projectId));
  const assertPermitted = (row: MeetingRecord) => {
    if (!permitted(row))
      throw new MeetingRequestError(
        403,
        "Meeting is outside your permitted project evidence.",
      );
  };
  try {
    if (request.method === "GET") {
      if (request.query?.id) {
        const row = await client.getMeeting(
          member.orgId,
          String(request.query.id),
        );
        assertPermitted(row);
        return { item: row };
      }
      const offset = Number(request.query?.offset || 0);
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new MeetingRequestError(400, "Invalid meeting cursor");
      const page = await client.listMeetings(member.orgId, offset);
      return { ...page, data: page.data.filter(permitted) };
    }
    if (request.method !== "POST")
      throw new MeetingRequestError(405, "Method not allowed");
    const body = request.body || {};
    if (body.visibility === "private")
      throw new MeetingRequestError(
        403,
        "Private meeting uploads require a separate source grant.",
      );
    if (
      !Array.isArray(body.topics) ||
      !body.topics.length ||
      body.topics.some((t: any) => !allowed.has(t?.projectId))
    )
      throw new MeetingRequestError(
        403,
        "Choose an accessible project for every meeting topic.",
      );
    const source = typeof body.source === "string" ? body.source.trim() : "";
    const externalId =
      typeof body.externalId === "string" ? body.externalId.trim() : "";
    if (source.length > 80 || externalId.length > 200)
      throw new MeetingRequestError(
        400,
        "Source or meeting reference is too long.",
      );
    if (!source || !externalId)
      throw new MeetingRequestError(
        400,
        "Source and meeting reference are required.",
      );
    const existing = await client.findMeeting(member.orgId, source, externalId);
    if (existing) assertPermitted(existing);
    const input: MeetingInput = {
      source,
      externalId,
      sourceVersion: body.sourceVersion,
      title: body.title,
      occurredAt: body.occurredAt,
      allowedProjectIds: [...allowed],
      expectedVersion: body.expectedVersion,
      attendees: body.attendees,
      topics: body.topics,
      references: body.references,
      visibility: "project",
      duplicateDecision: body.duplicateDecision,
      duplicateReason: body.duplicateReason,
    };
    const receipt = await client.importMeeting(member.orgId, input, member.uid);
    const item = await client.getMeeting(member.orgId, receipt.id);
    assertPermitted(item);
    return { item, receipt };
  } catch (error) {
    if (error instanceof CommunicationsApiError) {
      const raw = error.responseBody as any;
      throw new MeetingRequestError(
        error.status || 503,
        raw?.error || error.message,
        raw?.details?.status === "needs_duplicate_review"
          ? { status: "needs_duplicate_review" }
          : undefined,
      );
    }
    throw error;
  }
}
