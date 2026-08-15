"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type AssetRole = "character" | "product" | "scene";
type LibraryAsset = { id: string; role: AssetRole; name: string; mimeType: string; byteSize: number; hidden: boolean; previewUrl: string; createdAt: string };
type RoleFilter = "all" | AssetRole;

const roleNames: Record<AssetRole, string> = { character: "人物图", product: "关键资产图", scene: "场景图" };

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function AssetsPage() {
  const router = useRouter();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [uploadRole, setUploadRole] = useState<AssetRole>("character");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!data.user) {
          router.replace("/login?next=/assets");
          return null;
        }
        return fetch("/library/assets", { cache: "no-store" });
      })
      .then(async (response) => response?.ok ? response.json() : { assets: [] })
      .then((payload) => setAssets(Array.isArray(payload?.assets) ? payload.assets : []))
      .catch(() => setMessage("素材库暂时无法读取，请稍后重试。"))
      .finally(() => setLoading(false));
  }, [router]);

  const visibleAssets = useMemo(() => assets.filter((asset) => (showHidden ? asset.hidden : !asset.hidden) && (roleFilter === "all" || asset.role === roleFilter)), [assets, roleFilter, showHidden]);

  async function uploadAsset(file: File) {
    setUploading(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("role", uploadRole);
      form.set("file", file);
      const response = await fetch("/library/assets", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.asset?.id) throw new Error(payload.error || "ASSET_UPLOAD_FAILED");
      const uploaded = payload.asset as Omit<LibraryAsset, "hidden" | "previewUrl" | "createdAt">;
      setAssets((current) => [{ ...uploaded, hidden: false, previewUrl: `/media/assets/${encodeURIComponent(uploaded.id)}`, createdAt: new Date().toISOString() }, ...current]);
      setShowHidden(false);
      setRoleFilter(uploadRole);
      setMessage(`已添加：${file.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? `上传失败：${error.message}` : "素材上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function setHidden(asset: LibraryAsset, hidden: boolean) {
    try {
      const response = await fetch("/library/assets", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: asset.id, hidden }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "ASSET_VISIBILITY_FAILED");
      setAssets((current) => current.map((entry) => entry.id === asset.id ? { ...entry, hidden } : entry));
      setMessage(hidden ? `已隐藏：${asset.name}` : `已恢复：${asset.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? `更新失败：${error.message}` : "素材库更新失败");
    }
  }

  function useInWorkbench(asset: LibraryAsset) {
    window.localStorage.setItem("niannian-library-selected-asset", asset.id);
    router.push("/home");
  }

  return <main className="asset-library-page">
    <SiteHeader />
    <section className="asset-library-shell">
      <header className="asset-library-heading">
        <div><p>NIANNIAN AI STUDIO</p><h1>素材库</h1></div>
        <div className="asset-library-heading-actions">
          <label className="asset-upload-button">
            {uploading ? "正在上传" : "上传素材"}
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAsset(file); }} />
          </label>
          <Link href="/home">返回工作台</Link>
        </div>
      </header>
      <div className="asset-library-toolbar">
        <div className="asset-library-filters">
          <button type="button" className={!showHidden && roleFilter === "all" ? "active" : ""} onClick={() => { setShowHidden(false); setRoleFilter("all"); }}>全部</button>
          <button type="button" className={!showHidden && roleFilter === "character" ? "active" : ""} onClick={() => { setShowHidden(false); setRoleFilter("character"); setUploadRole("character"); }}>人物</button>
          <button type="button" className={!showHidden && roleFilter === "scene" ? "active" : ""} onClick={() => { setShowHidden(false); setRoleFilter("scene"); setUploadRole("scene"); }}>场景</button>
          <button type="button" className={!showHidden && roleFilter === "product" ? "active" : ""} onClick={() => { setShowHidden(false); setRoleFilter("product"); setUploadRole("product"); }}>关键道具</button>
          <button type="button" className={showHidden ? "active" : ""} onClick={() => setShowHidden(true)}>已隐藏 {assets.filter((asset) => asset.hidden).length}</button>
        </div>
        {message ? <span role="status">{message}</span> : null}
      </div>
      {loading ? <div className="asset-library-empty">正在读取素材库…</div> : visibleAssets.length ? <div className="asset-library-grid">
        {visibleAssets.map((asset) => <article className="asset-library-card" key={asset.id}>
          <img src={asset.previewUrl} alt={asset.name} />
          <div className="asset-library-card-body"><span>{roleNames[asset.role]}</span><b title={asset.name}>{asset.name}</b><small>{formatFileSize(asset.byteSize)} · {new Date(asset.createdAt).toLocaleDateString("zh-CN")}</small></div>
          <footer>{!asset.hidden ? <button type="button" className="asset-use-button" onClick={() => useInWorkbench(asset)}>用于制作</button> : null}<button type="button" onClick={() => { void setHidden(asset, !asset.hidden); }}>{asset.hidden ? "恢复" : "隐藏"}</button></footer>
        </article>)}
      </div> : <div className="asset-library-empty"><b>{showHidden ? "没有已隐藏素材" : roleFilter === "all" ? "还没有可用素材" : `还没有${roleNames[roleFilter]}素材`}</b><span>{showHidden ? "" : "点击右上角上传素材，或从工作台上传。"}</span>{!showHidden ? <label className="asset-empty-upload">选择图片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAsset(file); }} /></label> : null}</div>}
    </section>
  </main>;
}
