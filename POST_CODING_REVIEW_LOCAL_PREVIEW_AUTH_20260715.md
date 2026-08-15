# 本地 3032 登录校验失败修复审查

## 请求与正确路径

用户需要在 `http://127.0.0.1:3032` 登录本地 V2 工作台。正确路径是：本地 preview 必须以实际访问 Origin 启动；production preview 必须读取一套不会被并行 `next dev` 重写的完整构建；同源请求通过，外部 Origin 继续被 CSRF 拒绝；修复只作用于本地启动，不降低生产校验。

## 根因

1. `.env.local` 固定为 `APP_ORIGIN=http://localhost:3026`，但浏览器从 `http://127.0.0.1:3032` 提交登录，`validRequestOrigin` 因精确 Origin 不一致返回 `CSRF_INVALID`。
2. 同一仓库还有 `next dev` 使用默认 `.next`；`3032` 的 `next start` 也读取 `.next`。开发服务器更新构建清单后，`3032` 的 `/api/health` 和 `/api/auth/login` 退化为 404，因此单纯重启并不能稳定修好。

## 实际变更

- `next.config.mjs`：增加 `distDir: process.env.NEXT_DIST_DIR || ".next"`，默认生产构建行为不变。
- `package.json`：增加 `build:preview3032`，使用独立 `.next-preview-3032`；增强 `start:preview3032`，固定同一独立目录、`APP_ORIGIN=http://127.0.0.1:3032`、本地非 Secure cookie 和本地邮件模式。
- `tsconfig.json`：Next.js 构建器自动加入 `.next-preview-3032/types/**/*.ts`，使类型检查覆盖独立 preview 的生成类型。
- `.next-preview-3032/`：本地构建产物，不属于生产部署包。

没有修改 `validRequestOrigin` 的生产安全逻辑，没有接受通配 Origin，没有改数据库、用户、密码、会话、生产配置或 `sd2.cauai.fun`。

## 端到端验证

- `npm run build:preview3032`：通过，34 个路由。
- `npm run start:preview3032`：真实启动并监听 3032。
- `GET /api/health`：HTTP 200，RC2 版本读回正常。
- 同源 `Origin: http://127.0.0.1:3032` 对 `/api/auth/login` 发送空 payload：进入登录校验并返回 `LOGIN_INVALID / HTTP 400`，证明不再被 CSRF 提前拒绝；空 payload 不触发真实账户登录。
- 外部 `Origin: http://evil.example`：仍返回 `CSRF_INVALID / HTTP 403`，证明 CSRF 防护没有放宽。
- 并行访问仍在运行的 3027 开发服务前后，`.next-preview-3032/routes-manifest.json` SHA256 都为 `EAE0FF9BD0D04DE1D98C0122B1265EAA91B50280479BBF0FD826F0F925590017`；3032 健康仍为 200，证明构建目录隔离有效。
- `npm run lint`：通过。

## 停得过早检查

- 只改 `APP_ORIGIN` 后曾出现 API 404；没有把第一次 400/403 测试误报为持久修复。
- 继续追查到共享 `.next` 被并行开发服务重写，并以独立 distDir 解决。
- 最终证据同时覆盖路由存在、同源通过、异源拒绝和并行开发服务不污染四个条件。

## 未验证与边界

- 没有使用或输出用户密码；没有代替用户完成真实账户登录。
- 没有部署生产；生产依然使用自己的 Compose 构建、Origin 和 CSRF 规则。
- 本地浏览器需要刷新当前登录页或再次点击登录，才能从已经修复的 3032 服务取得结果。

## 结论

状态：`local_preview_auth_origin_and_build_isolation_verified`。本地请求校验失败与共享构建目录导致的重复 404 已同时修复，生产安全边界未改变。
