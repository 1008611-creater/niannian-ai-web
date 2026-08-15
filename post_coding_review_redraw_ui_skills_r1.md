# Post-Coding Review: Redraw UI Skills Pilot r1

## Requested outcome

Improve the existing `/redraw` user path for task cancellation safety, state announcements, and local visual consistency without changing the task APIs or production deployment.

## Correct operating path

The authenticated page loads the existing task list, lets the user upload assets and create a job, polls job states every five seconds, exposes accepted results for preview/download, and allows cancellation only from cancellable states. The UI change keeps that path intact: cancellation now passes through an accessible confirmation dialog, while only a small status node is live rather than the complete task list.

## Changed files

- `app/redraw/page.tsx`: cancellation dialog state, focus trap, Escape handling, focus restoration, status-change announcements, localized reference-file picker.
- `app/globals.css`: dialog, status announcement, file-picker, focus, and existing-token visual treatment.

## Verification

- `npm run lint` passed after the production build completed (the commands must not run concurrently because `next build` recreates `.next/types`).
- `npm run build` passed with the `/redraw` route generated successfully.
- `node --test scripts/redraw-runtime.test.mjs` passed all 22 tests.
- Playwright mock-state screenshots were captured at `1440x900` and `390x844`.
- Both viewports reported no horizontal overflow.
- Both viewports showed the `alertdialog` after activating “取消任务”.
- The screenshots use intercepted, non-sensitive auth and task GET responses only; no real task was created, cancelled, uploaded, or charged.

## Real Local Interaction Follow-up

- A local preview at `http://127.0.0.1:3034` was started with `REDRAW_QUEUE_MODE=disabled`. This is a local-only queue transport mode: it persists normal jobs but does not dispatch Redis work or start a provider worker.
- A temporary local account completed the normal registration, OTP verification, authenticated session, page reload, and `/api/redraw/jobs` read path. Account data, OTP values, and cookie values were not recorded.
- The browser uploaded a real local image and a real local reference image. A non-image selection produced the expected client-side validation message.
- A real task was created and persisted in the local queue. It was cancelled through the new dialog. `Escape` closed the dialog without an API cancellation, focus returned to the triggering button, confirmation cancelled the task once, and a page reload retained the cancelled state.
- Desktop `1440x900` and mobile `390x844` checks both reported equal document `scrollWidth` and `clientWidth`, so neither view had horizontal overflow.
- The initial local configuration correctly failed closed with `REDRAW_QUEUE_DISPATCH_FAILED` because it had neither `REDRAW_REDIS_URL` nor a running Redis service. That failure remains visible as an honest failed-state fixture. The local-only disabled queue mode was used only to verify safe UI interaction without invoking a provider.

## Limitations

- The local development server's CSP blocked Next webpack eval, so visual checks used the production build on local port `3034`.
- A final manual screen-reader pass remains outstanding.
- Completed preview and download were not exercised with a real accepted artifact. The protected delivery route requires a real completed job backed by the configured object store. Creating or fabricating one would either invoke an unapproved provider or misrepresent a source file as a generated result, so it is correctly excluded from this local-only run.
- The local disabled queue mode proves safe creation/cancellation interaction, not Redis dispatch or provider execution. Production-candidate approval still requires a staging environment with Redis, a deliberately prepared completed test artifact, and provider authorization scoped to that test.
- No online deployment was performed.
