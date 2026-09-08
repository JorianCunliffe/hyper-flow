# Phase 04 local browser acceptance — 8 September 2026

Chrome, `http://localhost:3000/tests/ui/commitments.html`. Real `CommitmentsPanel` and lifecycle model; synthetic authenticated transport and in-memory records, clearly labelled on screen. No production credentials, writes or communications.

Observed:

1. Project and party selection, manual candidate creation, and readable owner/beneficiary/deadline card.
2. Editing a saved deliverable shows the unsaved-terms warning and disables Approve current Ask.
3. Restoring saved terms and recording agreement evidence allows acceptance.
4. Submitting an undelivered report draft leaves the card `submitted` and creates a fulfillment review Ask.
5. Request revision with a delivery explanation returns it to work. Resubmitting delivery evidence and approving after review produces `fulfilled`.
6. Fulfilled form fields and mutation buttons are disabled; decision history remains available.
7. A separate incomplete candidate produces a clarification Ask. Filling beneficiary, criteria and due time and answering clarification leaves it a candidate with a separate acceptance Ask.
8. Final layout visually inspected: project/person filters, evidence lookup, selected card, review prompt, owner/beneficiary and criteria are legible. Recorded timezone appears alongside the deadline.
9. Browser error log read returned an empty list.

The browser fixture does not validate real login, server persistence, production navigation or live source retrieval. Those boundaries are covered locally by separate API/SQL/Firebase tests where applicable and require the documented production acceptance after merge. No mobile viewport acceptance claimed. Full provider delivery is outside Phase 04.
