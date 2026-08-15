# NianNian Redraw Runtime Pilot

This is a deployment change package, not an executed deployment. It targets the existing Tencent Seoul NianNian host and must use a separate Compose project/network from the current video workbench.

## Services

- `redraw-redis`: project-owned Redis 8 with AOF and `noeviction`.
- `redraw-worker`: one-concurrency server worker; it shares only the application data volume needed to read uploaded source assets.
- existing `app`: receives `/redraw` API traffic and enqueues `niannian-redraw-v1`.
- existing Postgres: additive `redraw_jobs`, `redraw_attempts`, `redraw_artifacts` and `redraw_job_events` tables only.

Do not connect to or reuse `sub2api-gg-redis`. Do not modify clawbot, dingmei, Mimo, Mac worker, SSH, DNS or unrelated Compose projects.

## Secret injection names

Inject through the server secret mechanism only; never commit or paste values into chat, job rows or logs:

`NIANNIAN_GPT_API_KEY`, `RUNNINGHUB_API_KEY`, `TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY`, optional `TENCENT_COS_SECURITY_TOKEN`, `TENCENT_COS_BUCKET`, `TENCENT_COS_REGION`.

For the isolated pilot, prefer a short-lived STS identity restricted to the redraw object prefix. The Worker supports the accompanying security token; do not copy a Windows or Mac long-lived COS credential to the server.

The non-secret McGrox contract is `NIANNIAN_GPT_API_BASE_URL=https://www.mcgrox.top`, `NIANNIAN_GPT_RESPONSES_PATH=/responses`, `NIANNIAN_GPT56_MODEL=gpt-5.6`, `wire_api=responses`, `store=false`.

## Preflight and rollback

1. Snapshot the current Compose files and verify the existing video workbench health.
2. Validate the new image SHA and run `docker compose config` with secrets injected but never printed.
3. Start only `redraw-redis` and `redraw-worker` in the isolated project; keep the public redraw route disabled until capability probes pass.
4. Run the non-media McGrox JSON/schema probe, then a single authorized user-owned image job.
5. Roll back by stopping only the pilot Compose project and restoring the previous app image; additive tables and historical job rows remain readable.

If Provider submission returned ambiguously, do not retry the job. After an authorized Provider-side lookup has established the existing RunningHub task ID, use the admin-session, same-origin `POST /api/admin/redraw/reconcile-provider-task` endpoint with the exact durable job ID, attempt number, transaction key and recovered task ID. A successful write binds the attempt and job atomically and dispatches that revision for resume; the response intentionally omits the Provider task ID.

Deployment, secret injection, provider probes, paid RunningHub submission and public route changes require one explicit authorization. This package alone is not evidence of deployment or `real_delivery`.
