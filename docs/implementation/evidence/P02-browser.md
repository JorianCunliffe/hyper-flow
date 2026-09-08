# Local browser verification

8 September 2026, agent-browser, Vite on loopback port 3017, `tests/ui/thread-register.html`.

- Collapsed register rendered and requested no data until expanded.
- Expanded register displayed Alpha and Beta with project/person/status controls.
- Loaded older communications: 20 review buttons became 23; older-history control disappeared.
- Edited title to Alpha settlement reviewed; save/refetch retained it.
- Reviewed Earlier settlement note 1, chose a separate new thread, supplied a reason detail and saved. UI showed success and three threads; source count dropped from 23 to 22.
- No browser errors reported. Screenshot P02-correction.png visually inspected: readable fields and success state.

This is a synthetic component fixture, not Firebase authentication or SQL persistence. The separate P02-integration.txt verifies the HyperFlow handler/client against actual Fastify and isolated SQL.
