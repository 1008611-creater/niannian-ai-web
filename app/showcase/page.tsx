"use client";

import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { CloseIcon, PlayIcon } from "@/components/Icons";
import { showcaseItems, ShowcaseCategory, ShowcaseItem } from "@/lib/showcase";

const filters: ("全部" | ShowcaseCategory)[] = ["全部", "产品广告", "人物种草", "场景视觉"];

export default function ShowcasePage() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("全部");
  const [selected, setSelected] = useState<ShowcaseItem | null>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const visible = filter === "全部" ? showcaseItems : showcaseItems.filter((item) => item.category === filter);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [selected]);

  function open(item: ShowcaseItem) {
    setPlaybackError(false);
    setRetryKey(0);
    setSelected(item);
  }

  return <main className="app-page showcase-page">
    <SiteHeader />
    <section className="showcase-shell showcase-real-shell">
      <header className="showcase-heading"><p>REAL WORK</p><h1>真实作品</h1></header>
      <nav className="showcase-filters" aria-label="作品分类">{filters.map((item) => <button key={item} type="button" className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</nav>
      <div className="real-works-grid">{visible.map((item) => <article className="real-work-card" key={item.id}>
        <button type="button" className={`real-work-poster ratio-${item.aspectRatio.replace(":", "-")}`} onClick={() => open(item)} aria-label={`播放${item.title}`}>
          <img src={item.posterUrl} alt={`${item.title}视频封面`} loading="lazy" />
          <span><PlayIcon /></span>
        </button>
        <div className="real-work-copy"><div><span>{item.category}</span><small>{item.duration} · {item.aspectRatio}</small></div><h2>{item.title}</h2></div>
      </article>)}</div>
    </section>
    {selected ? <div className="showcase-modal-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
      <section className="showcase-video-dialog" role="dialog" aria-modal="true" aria-labelledby="showcase-video-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{selected.category} · {selected.duration} · {selected.aspectRatio}</span><h2 id="showcase-video-title">{selected.title}</h2></div><button ref={closeRef} type="button" onClick={() => setSelected(null)} aria-label="关闭视频"><CloseIcon /></button></header>
        <div className={`showcase-video-frame ratio-${selected.aspectRatio.replace(":", "-")}`}>
          {playbackError ? <div className="showcase-video-error" role="alert"><b>视频暂时无法播放</b><span>请检查网络后重试。</span><button type="button" onClick={() => { setPlaybackError(false); setRetryKey((value) => value + 1); }}>重新加载</button></div> : <video key={retryKey} src={selected.videoUrl} poster={selected.posterUrl} controls playsInline autoPlay preload="metadata" onError={() => setPlaybackError(true)} />}
        </div>
      </section>
    </div> : null}
  </main>;
}
