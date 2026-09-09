# Operational checks

Account operations provides a manual **Run operational checks** action for owners and administrators. Select Routine check, Support review or Incident review. Every inspection records the authenticated actor and reason in the existing tenant audit before reading diagnostics. There is no impersonation or separate support backdoor.

REST: `GET /api/operations?view=diagnostics&reason=routine_check`. Scoped API credentials additionally require `operations:read`. The standalone client exposes `diagnostics(reason)`. Both hosted and Express deployments use the same implementation.

The response inspects at most 100 records each for agent jobs, external action receipts, schedules and files, in ID order. An extra row indicates partial coverage. It returns allowlisted counts, file bytes in the sample, unfinished file-operation count, and observation time. It does not return message bodies, file names/content, private meeting context, upload session URIs, credentials or raw provider errors.

Scheduler freshness describes the existing daily ticker with a 26-hour review threshold, not an execution SLA. Communications availability checks its authenticated mailbox registry, not message delivery. Usage counts admitted HyperFlow API-client requests for the UTC day; browser activity and provider charges are excluded. Partial, unavailable and unknown observations remain explicit. Access is refused if the audit cannot be persisted.

Audits retain the most recent 1,000 existing tenant-control entries; this is not an immutable long-term compliance archive. There is no automated retention or cost estimate in this view.
