# Configurable SMS and voice continuity

Settings → Agent & Connections → Conversation continuity exposes prior-communications use, a shared conversation prompt and additional SMS/voice instructions. Agent-profile saves use existing administrator checks and REST persistence. Prompts are bounded; blank values clear them. Defaults preserve prior grants, email draft-only policy and action approvals.

Both answer paths receive transient Communications evidence scoped to the caller and selected project. Source IDs, semantic thread IDs, channels, directions and timestamps remain attached. Evidence excludes private/ineligible sources, is bounded/non-exhaustive, and reports unavailable/stale/disabled history. SMS replies explicitly bind the inbound semantic thread and incoming SMS is hydrated before the durable agent job is queued. Voice retains its contact/line prompt and adds shared/channel instructions plus scoped history, without enabling unrestricted legacy history.

Validation: 590 HyperFlow unit tests, typecheck/build; new cases cover prompt save/clear/bounds, history disable/revocation, cross-channel source projection, privacy and source budgets. Phase07 cross-service acceptance now asserts real REST evidence reaches voice context and channel-specific prompts are selected. That integration requires CI because this Windows environment has no Java executable for the Firebase emulator. Live UI/provider evidence remains pending until release.

Boundaries: contact/project/line permissions stay authoritative; custom prompts cannot authorize mutations. Incoming ambiguous project/case requests must clarify. History contains only ingested, permission-eligible sources and is not an exhaustive archive.
