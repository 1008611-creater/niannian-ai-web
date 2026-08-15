import Link from "next/link";

export default function NotFound() {
  return (
    <main className="system-page" id="main-content">
      <section className="system-panel" aria-labelledby="not-found-title">
        <p className="system-code">404</p>
        <h1 id="not-found-title">这个页面不存在</h1>
        <p>链接可能已失效，或该项目已被移动。你可以回到工作台继续创作。</p>
        <div className="system-actions">
          <Link className="system-primary" href="/">返回入口</Link>
        </div>
      </section>
    </main>
  );
}
