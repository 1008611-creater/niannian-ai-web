# 工作台矿物流动背景 V2 强制代码审查

## 请求与正确路径

请求是把已认可的黑曜石背景升级为更清晰、更有材质厚度、持续流动但不增加客户设备实时计算负担的本地候选。正确路径是：冻结体验与性能合同；以认可 PNG 为唯一源；通过可重复的周期性 WebGL 流场和法线折射离线渲染；编码成严格 18 秒的 VP9/H.264；网站仍只运行一个 HTML5 视频；保留 PNG、MP4、减少动态和错误回退；验证媒体、桌面、移动、交互和参考合同；不提前部署生产。

## 实际变更

- `MINERAL_FLOW_V2_EXPERIENCE_CONTRACT.md`
- `scripts/render-mineral-flow-v2.mjs`
- `package.json`：新增 `render:mineral-v2`
- `components/MineralFlowBackground.tsx`
- `app/globals.css`
- `PROJECT_MANIFEST.json`
- `public/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-v2.webm`
- `public/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-v2.mp4`
- `output/mineral-flow-v2/manifest.json` 与证据截图/联系表

没有修改生产服务器、数据库、任务、积分、Mac Worker、video-worker、Mimo、DNS 或 Nginx。

## 生成链路审查

- 入口为 `npm run render:mineral-v2`，实际调用 `scripts/render-mineral-flow-v2.mjs`。
- 渲染器锁定 1920×1200、30fps、18 秒、540 帧，时间依赖全部来自周期相位；离线页面用 WebGL2 计算局部 curl flow、法线、冷紫珍珠反射和低饱和古铜反光。
- 首次执行暴露了缺失 Playwright 浏览器的问题；已改为优先使用本机 Chrome/Edge，不新增浏览器安装依赖。
- 第二次执行暴露了大 data URL 页面加载超时；已改为 Playwright route 提供源 PNG，并增加 CORS、页面错误和 promise 错误读回。
- 捕获完成后才调用 ffmpeg 生成两个交付格式；只有两个编码完成、文件 SHA/大小写入 manifest 后才输出 `stage=complete`，不存在“捕获完成即误报最终完成”的停得过早问题。
- 捕获日志已移除 base64 正文，只保留 MIME、大小、帧数、耗时和路径。
- 最终编码提高到 VP9 CRF 30 和 H.264 CRF 20，避免 1920×1200 暗部因过度压缩产生色带，同时仍低于 3.5MB/5MB 预算。

## 媒体证据

- WebM：VP9、yuv420p、1920×1200、30fps、18.000 秒、840853 bytes；完整解码通过；SHA256 `6C67C5DEE20991BA1DF392DD3DDCA68C58A698A59BC8369622A5E348D1322DF1`。
- MP4：H.264、yuv420p、1920×1200、30fps、18.000 秒、540 帧、2311662 bytes；完整解码通过；SHA256 `B8A078EBB3B32A64CF6A030C01C140A88FB18006AB33E2B833FFE7E17A5E3262`。
- SSIM：0/180=`0.985448`，0/360=`0.985766`，0/539=`0.990834`。中段发生变化，循环相邻帧保持连续。
- 本地 HTTP 对两种媒体均返回 200、正确 MIME、Content-Length 和 `Accept-Ranges: bytes`。

## 运行时与交互审查

- `MineralFlowBackground` 运行时没有 Canvas、WebGL 或 shader；主路径仍为 WebM → MP4 → PNG。
- 页面隐藏时暂停、恢复时继续；视频失败时移除活动类并回到 PNG/CSS；减少动态时暂停、归零、隐藏视频并清除视差。
- 桌面精确指针仅改变 CSS transform，最大约 ±4px；移动端与减少动态禁用视差；卸载时移除 pointer、blur、visibility 和 media-query 监听。
- 背景继续 `pointer-events:none`、`aria-hidden=true`、`tabIndex=-1`，不进入焦点或遮挡表单。
- 生产参考合同未被收窄：视频参考 input 未禁用，七种意图完整。

## 自动与浏览器验证

- `node --check scripts/render-mineral-flow-v2.mjs`：通过。
- `PROJECT_MANIFEST.json` JSON 解析：通过。
- `npm run lint`：通过。
- `npm run build`：通过，34 个路由。
- 本地健康接口：HTTP 200。
- 桌面：实际加载 1920×1200 V2 WebM；18 秒循环、播放时间前进、三栏透明样式完整、无横向溢出。
- 桌面视差：靠近右上约 `3.22px/-3.13px`，回中心归零。
- 390×844：视频继续播放，视差禁用，`scrollWidth=clientWidth`；全页截图受固定视频合成影响得到黑色证据，已改用真实可见首屏截图，DOM 与首屏截图均证明 UI 正常，不把失败截图当成通过证据。
- 背景运行期间“保存草稿”按钮可点击并返回成功文案。
- 浏览器控制台：0 warning / 0 error。

## 未验证与边界

- 本轮没有部署到 `sd2.cauai.fun`；生产仍使用 V1 媒体。
- 最终高质量重新编码发生在浏览器验收之后；图像内容、分辨率、时长和 URL 未变，最终文件已通过 ffprobe、完整解码、SSIM 和本地 HTTP 验证，但没有在本轮再次创建浏览器会话重新读取最终编码的 ETag。
- 减少动态和媒体错误回退本轮采用代码路径审查；没有修改操作系统偏好或故意破坏媒体请求进行第二次动态演练。V1 同一生命周期机制此前已经过浏览器演练，但不能替代对 V2 新文件的生产验证。
- 没有运行 Lighthouse 或 axe；本次没有改变语义结构和焦点顺序，生产部署前仍应执行最终响应式、减少动态、媒体回退和缓存读回。
- 没有创建视频任务、上传素材、提交 provider、扣积分或产生第三方费用。

## 结论

状态：`local_candidate_verified_not_deployed`。V2 已形成真实可运行的本地候选和可重复生成链路；媒体、代码、浏览器与交互证据足以进入部署候选审查，但尚不能表述为生产更新完成。
