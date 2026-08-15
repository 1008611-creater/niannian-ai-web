"use client";

import { FormEvent, useState } from "react";

type Mode = "login" | "register";

export function AuthModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const [submitted, setSubmitted] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
  }

  const isLogin = mode === "login";
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`auth-modal ${isLogin ? "auth-login" : "auth-register"}`}
        role="dialog"
        aria-modal="true"
        aria-label={isLogin ? "账号密码登录" : "注册账户"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">×</button>
        <h2>{isLogin ? "账号密码登录" : "注册账户"}</h2>
        {submitted ? (
          <div className="demo-success">
            <span className="success-orb">✓</span>
            <h3>前端流程已打通</h3>
            <p>账号、短信和验证码服务等待你提供技术方案后接入。</p>
            <button className="gradient-button" type="button" onClick={onClose}>进入体验</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            {!isLogin ? <Field label="用户名" placeholder="请输入用户名" required /> : null}
            {!isLogin ? <Field label="企业名称（选填）" placeholder="请输入企业名称" /> : null}
            <Field label={isLogin ? "用户名/手机号" : "手机号"} placeholder={isLogin ? "请输入用户名/手机号" : "请输入手机号"} required />
            <Field label="密码" placeholder="请输入密码" type="password" required />
            {!isLogin ? <Field label="确认密码" placeholder="请再次输入密码" type="password" required /> : null}
            <div className="field-group">
              <label htmlFor={`${mode}-code`}><span>*</span>{isLogin ? "验证码" : "短信验证码"}</label>
              <div className="inline-field">
                <input id={`${mode}-code`} placeholder={`请输入${isLogin ? "验证码" : "短信验证码"}`} required />
                <button type="button" className="code-button">{isLogin ? "获取图形验证码" : "获取验证码"}</button>
              </div>
            </div>
            {isLogin ? (
              <p className="agreement">点击「登录」即代表同意 <a href="#">《用户协议》</a> <a href="#">《隐私政策》</a> <a href="#">《内容合规规范》</a></p>
            ) : null}
            <button className="gradient-button auth-submit" type="submit">{isLogin ? "登 录" : "注 册"}</button>
          </form>
        )}
      </section>
    </div>
  );
}

function Field({ label, placeholder, type = "text", required = false }: { label: string; placeholder: string; type?: string; required?: boolean }) {
  const id = label.replaceAll(/[^\w\u4e00-\u9fa5]/g, "-");
  return (
    <div className="field-group">
      <label htmlFor={id}>{required ? <span>*</span> : null}{label}</label>
      <input id={id} type={type} placeholder={placeholder} required={required} />
    </div>
  );
}
