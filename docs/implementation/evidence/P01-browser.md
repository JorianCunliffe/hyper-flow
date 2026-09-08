# Phase 01 browser evidence

8 September 2026. Agent-browser Chromium; Vite local fixture `/tests/ui/email-authority.html`.

- Loaded account policy: Draft only.
- Selected Allow authorized sending, saved, received success and effective Authorized sending.
- Loaded again: saved selection returned by fixture API.
- Opened `?member`, selected sending and attempted save: Organization administrator required; effective mode remained Draft only.
- Inspected screenshot `P01-email-policy-member.png`. Native labels, controls and status are readable. The fixture omits application styling and substitutes the API. It proves component interaction/error handling, not actual authenticated API persistence or full Settings layout.
- Server enforcement is separately covered by the unit/HTTP tests. No live communications.
