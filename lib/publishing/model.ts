/** HyperFlow-owned publishing contracts. Provider adapters must supply real read-back and concurrency guarantees. */
export class PublishingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type PublishingKind = "social" | "website";
export interface PublicationContent {
  title: string;
  text: string;
}
export interface PublishingTarget {
  id: string;
  adapter: string;
  kind: PublishingKind;
  label: string;
  resource: string;
  enabled: boolean;
  revision: number;
  configuredBy: string;
}
export interface PublicationObservation {
  id: string;
  revision: string;
  content: PublicationContent;
  url: string;
}
export interface PublishingAdapter {
  /** Must reject resources outside the connected account and granted scope. */
  inspect(target: PublishingTarget): Promise<PublicationObservation | null>;
  /** Must implement provider-side conditional writes for updates. Never retry an uncertain create. */
  publish(
    target: PublishingTarget,
    input: {
      operationId: string;
      content: PublicationContent;
      expectedRevision: string | null;
    },
  ): Promise<{ id: string }>;
  /** Read only. A null result is unverified, never permission to publish again. */
  reconcile(
    target: PublishingTarget,
    input: { operationId: string; id?: string },
  ): Promise<PublicationObservation | null>;
}
export interface Publication {
  id: string;
  projectId: string;
  createdBy: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  kind: PublishingKind;
  content: PublicationContent;
  sourceNotes: string;
  contentHash: string;
  requestHash: string;
  state:
    | "draft"
    | "awaiting_approval"
    | "approved"
    | "rejected"
    | "dispatching"
    | "uncertain"
    | "verified";
  history: Array<{
    revision: number;
    content: PublicationContent;
    contentHash: string;
    at: number;
    sourceNotes: string;
    ask?: import("../../types.js").HumanAsk;
    target?: PublishingTarget;
    baseline?: PublicationObservation | null;
  }>;
  target?: PublishingTarget;
  baseline?: PublicationObservation | null;
  ask?: import("../../types.js").HumanAsk;
  operationId?: string;
  externalId?: string;
  receipt?: PublicationObservation;
  error?: string;
}
export interface PublishingLedger {
  revision: number;
  targets: Record<string, PublishingTarget>;
  items: Record<string, Publication>;
}
export interface PublishingStore {
  read(org: string, project: string): Promise<PublishingLedger | null>;
  transact(
    org: string,
    project: string,
    update: (r: PublishingLedger | null) => PublishingLedger,
  ): Promise<PublishingLedger>;
}
export const normalizeLedger = (
  r: PublishingLedger | null,
): PublishingLedger => ({
  revision: r?.revision || 0,
  targets: r?.targets || {},
  items: Object.fromEntries(
    Object.entries(r?.items || {}).map(([id, p]) => [
      id,
      { ...p, history: p.history || [] },
    ]),
  ),
});
