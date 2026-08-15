"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Application page failed to render", error);
  }, [error]);

  return (
    <main className="system-page" id="main-content">
      <section className="system-panel" aria-labelledby="system-error-title">
        <p className="system-code">服务提示</p>
        <h1 id="system-error-title">页面暂时无法加载</h1>
        <p>你的素材和任务没有被删除。请重新加载；若问题持续出现，请稍后再试。</p>
        <div className="system-actions">
          <button className="system-primary" type="button" onClick={reset}>重新加载</button>
          <Link className="system-secondary" href="/">返回入口</Link>
        </div>
      </section>
    </main>
  );
}
