"use client";

import { useEffect, useRef } from "react";

export function MineralFlowBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;
    const page = root.closest<HTMLElement>(".generator-page, .credits-page, .asset-library-page, .app-page, .guide-page, .landing-page, .niannian-auth");
    if (!page) return;

    const rootElement: HTMLDivElement = root;
    const videoElement: HTMLVideoElement = video;
    const pageElement: HTMLElement = page;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const precisePointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    let destroyed = false;

    function resetParallax() {
      rootElement.style.setProperty("--mineral-parallax-x", "0px");
      rootElement.style.setProperty("--mineral-parallax-y", "0px");
    }

    function handlePointerMove(event: PointerEvent) {
      if (motionQuery.matches || !precisePointerQuery.matches) {
        resetParallax();
        return;
      }
      const x = (event.clientX / window.innerWidth - 0.5) * 8;
      const y = (event.clientY / window.innerHeight - 0.5) * 8;
      rootElement.style.setProperty("--mineral-parallax-x", `${x.toFixed(2)}px`);
      rootElement.style.setProperty("--mineral-parallax-y", `${y.toFixed(2)}px`);
    }

    function fallback() {
      videoElement.pause();
      resetParallax();
      rootElement.dataset.renderer = "css-fallback";
      pageElement.classList.remove("mineral-flow-active");
    }

    async function syncPlayback() {
      if (destroyed) return;
      if (motionQuery.matches) {
        videoElement.pause();
        videoElement.currentTime = 0;
        resetParallax();
        rootElement.dataset.motion = "reduced";
        return;
      }

      rootElement.dataset.motion = "flowing";
      if (document.hidden) {
        videoElement.pause();
        return;
      }

      try {
        await videoElement.play();
        if (!destroyed) {
          rootElement.dataset.renderer = "video";
          pageElement.classList.add("mineral-flow-active");
        }
      } catch {
        fallback();
      }
    }

    function handleCanPlay() {
      void syncPlayback();
    }

    function handleVisibility() {
      void syncPlayback();
    }

    function handleMotionPreference() {
      void syncPlayback();
    }

    videoElement.addEventListener("canplay", handleCanPlay);
    videoElement.addEventListener("error", fallback);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("blur", resetParallax);
    motionQuery.addEventListener("change", handleMotionPreference);
    precisePointerQuery.addEventListener("change", resetParallax);
    if (videoElement.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) void syncPlayback();

    return () => {
      destroyed = true;
      videoElement.pause();
      videoElement.removeEventListener("canplay", handleCanPlay);
      videoElement.removeEventListener("error", fallback);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", resetParallax);
      motionQuery.removeEventListener("change", handleMotionPreference);
      precisePointerQuery.removeEventListener("change", resetParallax);
      resetParallax();
      pageElement.classList.remove("mineral-flow-active");
    };
  }, []);

  return (
    <div ref={rootRef} className="mineral-flow-background" data-renderer="loading" data-motion="flowing" aria-hidden="true">
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/media/generated/workbench-luxury-nocturne-c-rh/workbench-luxury-nocturne-c-obsidian-pearl.png"
        tabIndex={-1}
      >
        <source
          src="/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-v2.webm"
          type="video/webm"
        />
        <source
          src="/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-v2.mp4"
          type="video/mp4"
        />
      </video>
    </div>
  );
}
