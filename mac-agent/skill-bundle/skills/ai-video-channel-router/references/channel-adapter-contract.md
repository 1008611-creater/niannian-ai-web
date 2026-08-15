# Channel Adapter Contract

Use this contract when turning a video provider into a reusable production channel.

## Required Fields

Each adapter must define:

- `entry_path`: exact UI route or URL pattern.
- `preflight`: login state, quota/credits, model availability, network/proxy status.
- `default_params`: aspect ratio, resolution, duration, audio, model, and when each may be overridden.
- `asset_inputs`: required files, upload order, supported first/mid/tail frame behavior.
- `prompt_input`: where text goes, max length, forbidden formatting, language constraints.
- `submit`: stable selector strategy, cost shown before submit, confirmation behavior.
- `poll`: where task status appears and how to classify running/success/failed.
- `download`: history/result location, how to save, naming convention.
- `verify`: file exists, size, media probe duration/resolution/audio, hash, content QA.
- `account_marking`: when and where to mark channel usage as `1`.
- `blockers`: login, verification, quota, upload, generation, download, media probe, quality.

## Selector Policy

Prefer CDP/Playwright selectors and DOM events over coordinate clicks:

1. Use accessible text or stable class names when present.
2. Use `locator(...).click()` or direct `dispatchEvent` on Vue/React component nodes.
3. Use coordinates only as a last resort, and record why.
4. After every parameter change, read visible state back from DOM before submitting.

## Account Usage Rule

Mark a channel as used when any real provider action occurs:

- login succeeds on that provider;
- quota/credits are checked on that provider;
- a generation is submitted;
- historical provider outputs are downloaded.

Marking must be durable before rotating to the next account. If Excel is locked, write a ledger or pending-sync note and do not claim the table was updated.

## Evidence Rule

Do not report production success from page state alone. A provider result is only accepted after:

- downloaded file path exists;
- file size is non-zero and plausible;
- media probe reads expected video stream and duration;
- hash recorded;
- content QA status recorded separately from technical download success.
