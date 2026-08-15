"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type View = "login" | "register" | "verify-register" | "reset" | "verify-reset";

const messages: Record<string, string> = {
  AUTH_CONFIGURATION_ERROR: "登录服务暂时不可用，请稍后重试",
  CSRF_INVALID: "请求校验失败，请刷新页面后重试",
  EMAIL_ALREADY_REGISTERED: "该邮箱已经注册，请直接登录",
  EMAIL_INVALID: "请输入正确的邮箱地址",
  LOGIN_INVALID: "邮箱或密码不正确",
  LOGIN_RATE_LIMITED: "尝试次数过多，请稍后再试",
  MAIL_DELIVERY_FAILED: "验证码发送失败，请稍后重试",
  OTP_CONSUMED: "验证码已经使用，请重新获取",
  OTP_EXPIRED: "验证码已过期，请重新获取",
  OTP_INVALID: "验证码不正确，请重新输入",
  OTP_RATE_LIMITED: "请求次数过多，请稍后再试",
  OTP_REQUIRED: "请先获取验证码",
  OTP_RESEND_COOLDOWN: "请稍后再重新发送验证码",
  OTP_TOO_MANY_ATTEMPTS: "验证码尝试次数过多，请重新获取",
  PASSWORD_INVALID: "密码至少 8 位，并同时包含字母和数字",
};

async function request(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "AUTH_CONFIGURATION_ERROR");
  return data;
}

export default function LoginPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  function returnPath() {
    const requested = new URLSearchParams(window.location.search).get("next") ?? "/home";
    return requested.startsWith("/") && !requested.startsWith("//") ? requested : "/home";
  }

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (data.user) router.replace(returnPath()); })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "register") setView("register");
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function changeView(next: View) {
    setView(next);
    setNotice("");
    setCode("");
    setCooldown(0);
  }

  function showError(error: unknown) {
    const key = error instanceof Error ? error.message : "";
    setNotice(messages[key] ?? "操作失败，请稍后重试");
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice("");
    try {
      if (view === "login") {
        await request("/api/auth/login", { email, password });
        router.replace(returnPath());
        router.refresh();
      } else {
        const data = await request("/api/auth/register/start", { email, password });
        setCooldown(data.cooldownSeconds ?? 60);
        changeView("verify-register");
        setCooldown(data.cooldownSeconds ?? 60);
      }
    } catch (error) {
      showError(error);
    } finally {
      setPending(false);
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice("");
    try {
      const data = await request("/api/auth/password-reset/start", { email, password });
      changeView("verify-reset");
      setCooldown(data.cooldownSeconds ?? 60);
    } catch (error) {
      showError(error);
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice("");
    const reset = view === "verify-reset";
    try {
      await request(reset ? "/api/auth/password-reset/verify" : "/api/auth/register/verify", { email, code });
      if (reset) {
        setPassword("");
        changeView("login");
        setNotice("密码已重置，请使用新密码登录");
      } else {
        router.replace(returnPath());
        router.refresh();
      }
    } catch (error) {
      showError(error);
    } finally {
      setPending(false);
    }
  }

  async function resendCode() {
    setPending(true);
    setNotice("");
    const reset = view === "verify-reset";
    try {
      const data = await request(reset ? "/api/auth/password-reset/resend" : "/api/auth/otp/resend", { email });
      setCooldown(data.cooldownSeconds ?? 60);
    } catch (error) {
      showError(error);
    } finally {
      setPending(false);
    }
  }

  if (view === "verify-register" || view === "verify-reset") {
    const reset = view === "verify-reset";
    return (
      <main className="niannian-auth">
        <section className="auth-card" aria-labelledby="verify-title">
          <div className="auth-mark" aria-hidden="true">✦</div>
          <h1 id="verify-title">{reset ? "验证重置密码" : "验证邮箱"}</h1>
          <p className="auth-subtitle">验证码已发送至 {email}</p>
          <form className="auth-form" onSubmit={verifyCode}>
            <label htmlFor="code">6 位验证码</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="请输入验证码" />
            {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
            <button className="auth-submit" disabled={pending || code.length !== 6} type="submit">{pending ? "验证中..." : reset ? "确认重置密码" : "完成注册"}</button>
          </form>
          <p className="auth-switch"><button type="button" disabled={pending || cooldown > 0} onClick={resendCode}>{cooldown > 0 ? `${cooldown} 秒后可重新发送` : "重新发送验证码"}</button></p>
          <p className="auth-switch"><button type="button" onClick={() => changeView(reset ? "reset" : "register")}>返回{reset ? "重置密码" : "注册"}</button></p>
        </section>
      </main>
    );
  }

  if (view === "reset") {
    return (
      <main className="niannian-auth">
        <section className="auth-card" aria-labelledby="reset-title">
          <div className="auth-mark" aria-hidden="true">✦</div>
          <h1 id="reset-title">重置密码</h1>
          <p className="auth-subtitle">验证码会发送到你的注册邮箱</p>
          <form className="auth-form" onSubmit={submitReset}>
            <label htmlFor="reset-email">邮箱</label>
            <input id="reset-email" autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入注册邮箱" />
            <label htmlFor="reset-password">新密码</label>
            <input id="reset-password" autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位，包含字母和数字" />
            {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
            <button className="auth-submit" disabled={pending} type="submit">{pending ? "发送中..." : "发送重置验证码"}</button>
          </form>
          <p className="auth-switch"><button type="button" onClick={() => changeView("login")}>返回登录</button></p>
        </section>
      </main>
    );
  }

  const isLogin = view === "login";
  return (
    <main className="niannian-auth">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-mark" aria-hidden="true">✦</div>
        <h1 id="auth-title">念念AI视频工作台</h1>
        <div className="auth-tabs" role="tablist" aria-label="账户操作">
          <button className={isLogin ? "active" : ""} type="button" role="tab" aria-selected={isLogin} onClick={() => changeView("login")}>登录</button>
          <button className={!isLogin ? "active" : ""} type="button" role="tab" aria-selected={!isLogin} onClick={() => changeView("register")}>注册</button>
        </div>
        <form className="auth-form" onSubmit={submitCredentials}>
          <label htmlFor="email">邮箱</label>
          <input id="email" autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入邮箱" />
          <label htmlFor="password">密码</label>
          <input id="password" autoComplete={isLogin ? "current-password" : "new-password"} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isLogin ? "请输入密码" : "至少 8 位，包含字母和数字"} />
          {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
          <button className="auth-submit" disabled={pending} type="submit">{pending ? "请稍候..." : isLogin ? "登录" : "注册并获取验证码"}</button>
        </form>
        {isLogin ? <p className="auth-forgot"><button type="button" onClick={() => changeView("reset")}>忘记密码？</button></p> : null}
        <p className="auth-switch">{isLogin ? "还没有账号？" : "已经有账号？"}<button type="button" onClick={() => changeView(isLogin ? "register" : "login")}>{isLogin ? "立即注册" : "立即登录"}</button></p>
      </section>
    </main>
  );
}
