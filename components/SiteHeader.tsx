"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { MenuIcon } from "./Icons";
import { MineralFlowBackground } from "./MineralFlowBackground";

const navItems = [
  { href: "/ziyu", label: "紫域模型" },
  { href: "/projects", label: "项目" },
  { href: "/tasks", label: "任务" },
  { href: "/credits", label: "积分" },
  { href: "/assets", label: "素材库" },
  { href: "/showcase", label: "真实作品" },
];

export function SiteHeader({ showBack = false }: { showBack?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; isAdmin?: boolean } | null>();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data: { user: { email: string; isAdmin?: boolean } | null }) => {
        setUser(data.user);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    setUser(null);
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="site-header">
      <MineralFlowBackground />
      <div className="header-inner">
        {showBack ? (
          <button className="back-button" type="button" onClick={() => history.back()}>
            ↤ 返回
          </button>
        ) : null}
        <Link href={user ? "/home" : "/"} className="brand-link" aria-label="念念AI视频工作台首页">
          <Logo withName />
        </Link>
        <nav className={mobileOpen ? "main-nav nav-open" : "main-nav"} aria-label="主导航">
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              {user.isAdmin ? <Link className="enterprise-link" href="/admin">管理后台</Link> : null}
              <span className="header-account" title={user.email}>
                {user.email}
              </span>
              <button className="pill-button" type="button" onClick={logout}>
                退出
              </button>
            </>
          ) : user === null ? (
            <>
              <Link className="pill-button" href="/login?mode=register">
                注 册
              </Link>
              <Link className="pill-button" href="/login">
                登 录
              </Link>
            </>
          ) : (
            <span className="header-account header-account-loading">正在验证</span>
          )}
        </div>
        <button
          className="mobile-toggle"
          type="button"
          aria-label="打开菜单"
          onClick={() => setMobileOpen((value) => !value)}
        >
          <MenuIcon />
        </button>
      </div>
    </header>
  );
}


