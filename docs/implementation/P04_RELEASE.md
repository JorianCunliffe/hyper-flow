# Phase 04 production release and correction

User authorized release and repeated implementation/test/release cycles through Phase 12 on 8 September 2026. This authorizes code delivery; it does not invent calendar invitation, public publication or external-party business approval grants.

PR 5 merged at `b8425fdc83cb479ada91412c8f6cbb43cd61ee2d`. Production deployment `dpl_DChrkM1TsrmETRydamPsaa2aPyer` is READY and its alias is `hyper-flow5.vercel.app`. Main CI `34224156716` passed. The release rerun passed 475 tests and three SQL/HTTP integration tests. Raw outputs: `evidence/P04-release-tests.txt`, `evidence/P04-release-integration.txt`.

## Live finding and repair

The authenticated CEO browser opened Obligations and created the clearly labelled `P04 release acceptance — verify the obligations review journey` record in the existing `communications test` project, with self as owner and beneficiary and no outbound action. A fresh authenticated page recovered it, proving production persistence. Its first approval reported `Obligation not found`; an approval from the earlier page then succeeded. No duplicate acceptance is claimed from that sequence.

The transaction wrapper treated a cold SDK's initial null cache as an absent record. It now holds a value listener through the atomic transaction, validates each retry and releases the listener afterward. It never constructs an absent update record. This follows the [Firebase transaction/cache contract](https://firebase.google.com/docs/database/admin/save-data#saving_transactional_data).

The emulator test now uses the same database namespace for Admin and security-rule clients. It seeds a record through a separate client before the cold transaction, verifies acceptance, tests absence without creation, and proves direct-client denial for a seeded organization owner. The prior test used different namespaces for its rule client; its former owner-seeding claim was insufficient. The corrected test passed: `evidence/P04-cold-transaction.txt`.

Correction deployment and the rest of the live lifecycle are still pending at this record's initial commit. Phase 05 implementation waits for this repair gate. No messages, calls, calendar invitations or public posts were emitted by this release test.
