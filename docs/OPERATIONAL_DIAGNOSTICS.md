# Operational checks

Account operations provides a manual **Run operational checks** action for owners and administrators. Select Routine check, Support review or Incident review. Every inspection records the authenticated actor and reason in the existing tenant audit before reading diagnostics. There is no impersonation or separate support backdoor.

REST: `GET /api/operations?view=diagnostics&reason=routine_check`. Scoped API credentials additionally require `operations:read`. The standalone client exposes `diagnostics(reason)`. Both hosted and Express deployments use the same implementation.

The response inspects at most 100 records each for agent jobs, external action receipts, schedules and files, in ID order. An extra row indicates partial coverage. It returns allowlisted counts, file bytes in the sample, unfinished file-operation count, and observation time. It does not return message bodies, file names/content, private meeting context, upload session URIs, credentials or raw provider errors.

Scheduler freshness describes the existing daily ticker with a 26-hour review threshold, not an execution SLA. Communications availability checks its authenticated mailbox registry, not message delivery. Usage counts admitted HyperFlow API-client requests for the UTC day; browser activity and provider charges are excluded. Partial, unavailable and unknown observations remain explicit. Access is refused if the audit cannot be persisted.

Audits retain the most recent 1,000 existing tenant-control entries; this is not an immutable long-term compliance archive. There is no automated retention or cost estimate in this view.

## Production verification — 9 September 2026

Released through PR23 as `e4b6596502a49efd921391673bc1a079d09fe995` (deployment `dpl_F6rpJeLYGohyANhBisYzpNKmVNBm`). Live REST checks returned 403 for a non-admin and 422 without a reason; two owners received only their own tenant summaries. The test audit ID `860e10d5-912d-462f-b749-f4ba0ebe40ee` was found in its tenant's administration history. Communications was correctly unavailable for the deliberately unconfigured fixture tenant.

The CEO browser inspection recorded audit `61d4bb1f-bd96-4107-bbbc-d8a1b61900a9`: scheduler recent, account active, zero unfinished files, Communications mailbox registry available. Agent-job coverage was explicitly partial at 100 records. The same inspection appeared in Administration history. These are observations at the recorded time, not ongoing health guarantees.
