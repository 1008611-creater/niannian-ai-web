# Post-Coding Review: Windows Mimo Post-Deploy Readback (2026-07-27)

1. **Real path checked:** `scripts/postdeploy-readonly-check.mjs --worker windows-mimo` reads only `/api/health`, public pages, and `/api/internal/windows-mimo/status`; it never calls a claim, task, Provider, or write endpoint.
2. **Changed surface:** the script preserves its historical `mac` default for RC4 and adds an explicit Windows Mimo branch with its dedicated token, endpoint, release/reference identity checks, readiness, authenticated channel, and Mimo queue checks. README documents the exact read-only invocation.
3. **Evidence:** a loopback process test returned an `ok` Windows report with `readyToClaim=true` and `authenticated=true`, used only the status endpoint, and made zero claim calls. Release tests passed `8/8`, Windows contracts passed `8/8`, Agent self-test and TypeScript check passed.
4. **Boundary:** the passing status response is a local fixture, not production. No real token, Worker state, Windows Server, Mimo login, task, media, charge, deployment, or delivery was accessed.
5. **Earliest external blocker:** the script can only read a real Windows Worker after the Windows Server has a controlled runtime connection, Agent installation, local browser session, and an environment-provided token.
