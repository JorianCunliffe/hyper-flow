export interface MeetingSegment {
  id: string;
  speakerId: string | null;
  speaker?: string;
  text: string;
  startMs?: number | null;
  endMs?: number | null;
}
export interface MeetingTopic {
  id: string;
  title: string;
  projectId: string;
  threadId?: string | null;
  segments: MeetingSegment[];
  communicationId?: string;
  recordingId?: string;
}
export interface MeetingInput {
  source: string;
  externalId: string;
  sourceVersion: string;
  title: string;
  occurredAt: string;
  expectedVersion?: number;
  allowedProjectIds?: string[];
  attendees: Array<{
    id: string;
    name: string;
    email?: string;
    phone?: string;
    personId?: string | null;
    identityStatus?: string;
    contact?: {
      id: string;
      name?: string;
      email?: string;
      phone_number?: string;
    } | null;
  }>;
  topics: MeetingTopic[];
  references?: {
    calendarEventId?: string | null;
    recordingUrl?: string | null;
    sourceUrl?: string | null;
  };
  visibility?: "project" | "private";
  duplicateDecision?: "separate" | null;
  duplicateReason?: string;
}
export interface MeetingRecord {
  id: string;
  title: string;
  recorded_at: string;
  updated_at: string;
  metadata: MeetingInput & { version: number; fingerprint: string };
  history?: Array<{
    version: number;
    source_version: string;
    created_at: string;
    actor: string;
  }>;
}
