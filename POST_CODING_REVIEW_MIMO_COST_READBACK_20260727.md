# Post-Coding Review: Mimo Cost Readback (2026-07-27)

- Real path checked: the Windows CDP preflight extracts only numeric visible balance and per-second pricing, and owner authorization requires a fresh readback whose balance covers the locked duration-based maximum.
- Changed surface: Windows Mimo Agent heartbeat schema, server readiness sanitization and authorization ledger, plus the owner confirmation card.
- Evidence: `npm run test:mimo-owner-authorization`, `npm run lint`, and `npm run build` passed. Browser evidence from the logged-in Mimo page showed 475 credits and 1 credit/second without uploading or generating.
- Completion boundary: this candidate is not deployed because the website and Windows Agent must be updated together; deploying only the website would intentionally disable confirmations until the old Worker sends the new billing heartbeat. No task was authorized, claimed, submitted, or charged.
