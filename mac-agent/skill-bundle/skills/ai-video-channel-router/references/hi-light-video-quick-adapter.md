# Hi-light Video Quick Adapter

Use this SOP for `app.hi-light.ai` video generation in the material workshop.

## Entry Path

Preferred UI route:

```text
素材工坊 -> 视频快创
```

Known URL pattern:

```text
https://app.hi-light.ai/creation/workshop/video-generation?mode=image
```

Use `mode=image` image-to-video unless user explicitly asks text-to-video.

## Parallel CDP Seats

Hi-light can run as parallel browser seats. Use one independent Chrome user data directory per account and one CDP port per seat.

Recommended stable setup:

```text
Hilight_01  profile: <run>\browser_profiles\hilight_9401  CDP: 9401
Hilight_02  profile: <run>\browser_profiles\hilight_9402  CDP: 9402
Hilight_03  profile: <run>\browser_profiles\hilight_9403  CDP: 9403
Hilight_04  profile: <run>\browser_profiles\hilight_9404  CDP: 9404
```

Operational rule:
- Keep up to 4 accounts signed in as warm seats.
- Generate with 1 to 2 seats concurrently unless the user explicitly asks for more.
- Never mix login state, downloads, quota, task IDs, or evidence between seats.
- Record `port`, `profile`, `email`, `credit`, `task_id`, download path, and blocker for every provider action.

Quota rotation rule:
- If visible credit is lower than the chosen generation cost, do not stop on the current seat. Immediately open the next unused CDP port with a fresh `hilight_<port>` profile, choose the next account not marked `Hi-light`, attempt login, record the result, and keep rotating until a seat has enough credit or the account pool is exhausted. Do not ask the user to repeat this instruction or manually choose the next account.

## Proxy/CDP Login Preflight

If Hi-light or Google login is stuck because of proxy, IP purity, or Cliproxy source-IP rejection, route through `cliproxy-residential-ip` before continuing the Hi-light workflow.

For this workspace, the proven stable path is:

```text
Chrome/CDP -> 127.0.0.1:18888 -> local mihomo 127.0.0.1:7897 -> us2.cliproxy.io:3010 -> Hi-light
```

Use this as the default recovery seat when `9223` is occupied or the user says not to use it:

```text
CDP port: 9414
Chrome proxy: http://127.0.0.1:18888
Profile: <run>\browser_profiles\hilight_9414_chain_proxy
Download dir: C:\Users\lsb\Pictures\cdp视频
```

Preflight order:
- Start or confirm `E:\codex\aisp\aidaihuo\tools\cliproxy-chain-proxy.mjs` is listening on `127.0.0.1:18888`.
- Verify shell egress with `curl.exe -x http://127.0.0.1:18888 https://api.ipify.org?format=json`.
- Launch Chrome with `--proxy-server="http://127.0.0.1:18888"` and the dedicated profile.
- Verify egress again from the same CDP browser, not only from PowerShell.
- Then run Google OAuth and confirm Hi-light shows `视频快创` or `视频生成`, available credit, and generation controls.

Do not print Cliproxy credentials, Google passwords, tokens, cookies, or session storage. Do not claim the Excel account table was updated until the workbook change is actually verified.

If `18888` is listening but Hi-light still cannot load, check that it is the real Cliproxy chain and not a stale forward into `18080/18081`. If `cliproxy-chain-proxy.mjs` exits with `ECONNRESET`, repair the proxy script so socket `error` events close only the affected tunnel, restart it, and re-run the shell plus CDP egress checks. Do not use naked `7897` for Hi-light submission.

## Login And Registration

Default login path is Google OAuth from `使用 Google 账号登录`.

Observed flow:
1. Click `.google-login-btn` or visible text `使用 Google 账号登录`.
2. If Google account chooser appears, select the intended account.
3. Click `Continue` or `继续` on the Google consent page.
4. Reload `https://app.hi-light.ai/creation/workshop/video-generation?mode=image`.
5. Login is confirmed only when the page shows `视频快创` or `视频生成` plus `立即生成` or `历史记录`.
6. Read visible credit from the top bar, for example `视频快创 1,200`.

Important observed behavior:
- Google OAuth can complete but return to the Hi-light login modal. Classify as `oauth_returned_not_logged_in`, mark the account as used, then rotate.
- Email registration can expose Cloudflare Turnstile `请验证您是真人`. Do not try to bypass it with coordinates or repeated clicks. Classify as `login_verification_required`.
- If registration or OAuth touches Hi-light, mark account usage before trying the next account.
- Do not record passwords, codes, tokens, cookies, or session storage in logs.

## Preflight

Before upload or prompt entry:
- Confirm page contains `视频快创` or `视频生成`.
- Confirm desired tab: `图生视频`.
- Read visible star/credit count.
- Read generate button cost before submit.
- If current account has 0 or insufficient credits, do not submit. Download usable history if requested, mark account/channel, then rotate.

## Default Parameters

Set parameters before uploading assets when possible.

- Aspect ratio: default `9:16` for Douyin/Kuaishou/Xiaohongshu commerce clips.
- Resolution: default `720P`.
- Duration: choose actual shot need, cost, and continuity. Do not force 5s if shot needs more time.
- Audio: only enable when platform-native audio is part of the deliverable. For externally edited commerce videos, do not depend on it by default.

Current DOM behavior:
- Aspect/resolution options are Vue component nodes `.ratio-list-item`.
- Visible ratio label can be read from `.split-trigger__label`.
- Visible resolution label can be read from `.split-trigger--px .split-trigger__label`.
- Duration label can be read from `.duration-trigger__label`.
- Audio checkbox can be read from `input.native-audio-field__input[type="checkbox"]`.

Prefer CDP DOM events:

```javascript
document.querySelectorAll(".ratio-list-item").forEach((el) => {
  if ((el.innerText || el.textContent || "").trim() === "720P") {
    ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) =>
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    );
  }
});
```

Always read visible state back after setting:

```text
ratio == requested ratio
resolution == requested resolution
duration == chosen duration
audio == intended boolean
generate button cost visible
```

## Upload And Prompt

- 男生展示面任务先读取 `references/hi-light-male-showcase-save-workflow.md`。该流程需要过人脸/加白线时，默认使用 `http://127.0.0.1:9093/face` 的输出作为 Hi-light `首帧图`，不要手工画线。
- Upload true first frame into `首帧图`.
- Use `尾帧图` only when shot needs a locked ending frame.
- If using a material library asset, record asset name and visible ID.
- Keep prompt within the visible limit.
- Preserve the upstream approved prompt unless the user asks to revise it.
- Do not add post-production-only notes such as `可叠加字幕`.
- Do not include execution meta text such as `直接进行视频生成`.

## Submit, Poll, Download

After submit:
- Record account, visible credits, cost, mode, ratio, resolution, duration, and audio state.
- Poll `历史记录` current result area until success or failure.
- Download every successful historical newly generated video requested by the user.
- Before any CDP/browser download, set Chrome download behavior to the stable local folder `C:\Users\lsb\Pictures\cdp视频`:

```javascript
await cdp.send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: "C:\\Users\\lsb\\Pictures\\cdp视频",
  eventsEnabled: true
});
```

- Save Hi-light CDP downloads into `C:\Users\lsb\Pictures\cdp视频` by default, unless the user explicitly requests another output folder.
- If Playwright still captures a download into a `playwright-artifacts-*` temp folder with no extension, immediately copy the file into `C:\Users\lsb\Pictures\cdp视频`, add the correct `.mp4` or `.jpg` extension, and verify with media probe.
- Run media probe, hash, contact sheet, and QA reporting.

## 批量生产

一次运行超过 1 条 Hi-light 任务时，提交前必须读取 `references/hi-light-batch-production.md`。批量模式必须使用任务清单、稳定命名、固定 CDP 下载目录、媒体探测、开头帧 QA、必要时输出裁剪后的 clean 版，并更新 ledger。

做展示面视频时，读取 `references/hi-light-display-video-prompts.md` 使用可复用中文提示词模板。用户已经锁定提示词时，保留用户批准版本，不要擅自替换。

## Account Marking

When a Google account reaches Hi-light login, star-center, video quick page, history download, generation submit, account chooser, OAuth consent, or registration attempt, mark `Hi-light = 1` for that account.

Use `scripts/mark-channel-usage.ps1` when an Excel account table is available.

Expected workbook conventions:
- Email can be in a normal `账号` column.
- Or email can be the first part of a packed first column in this format:

```text
email----password----recovery
```

The script should create the `Hi-light` column if it is missing.

If workbook is open/locked, write a pending-sync blocker in the run ledger and retry after the user closes it. Do not claim the Excel table was updated until it is verified.

Also append a per-run JSONL ledger under:

```text
<run>\account_rotation\hilight_account_usage_ledger.jsonl
```

Recommended event fields:

```json
{
  "ts": "ISO-8601",
  "channel": "hi-light",
  "port": 9401,
  "profile": "hilight_9401",
  "email": "name@example.com",
  "action": "google_oauth_login",
  "status": "login_success",
  "credit": "1200",
  "sensitive_material_recorded": false
}
```

## Blocker Classification

- `login_verification_required`: Google/Cloudflare/phone/recovery challenge.
- `oauth_returned_not_logged_in`: Google OAuth completed but Hi-light still shows login modal.
- `account_chooser_reached_not_completed`: Google account chooser reached but consent was not completed.
- `quota_insufficient`: visible credits cannot cover chosen generation cost.
- `upload_failed`: file rejected or upload never appears in UI.
- `generation_failed`: provider marks result failed.
- `download_failed`: success visible but file cannot be downloaded.
- `media_probe_failed`: downloaded file unreadable or missing expected stream.
- `quality_failed`: file technically valid but fails content QA.
