// Pixel snow over the header scene. Decorative only: skipped entirely for prefers-reduced-motion,
// paused while the tab is hidden. The canvas works at scene-pixel resolution (160 px across the
// scene) and is scaled up with image-rendering: pixelated.
(() => {
  const canvas = document.getElementById("snow");
  const scene = document.querySelector(".hero .scene");
  if (!canvas || !scene || !canvas.getContext) return;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ctx = canvas.getContext("2d");
  let flakes = [], raf = 0, w = 0, h = 0, last = 0;

  function size() {
    const px = scene.getBoundingClientRect().width / 160 || 1;   // CSS px per scene pixel
    w = Math.max(1, Math.round(canvas.clientWidth / px));
    h = Math.max(1, Math.round(canvas.clientHeight / px));
    canvas.width = w; canvas.height = h;
    const n = Math.round(w * h / 180);
    flakes = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h,
      v: 3 + Math.random() * 5, drift: Math.random() * 6.28 }));
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(canvas).color;
    for (const f of flakes) {
      f.y += f.v * dt;
      f.drift += dt;
      const x = Math.round(f.x + Math.sin(f.drift) * 1.5);
      if (f.y > h) { f.y = -1; f.x = Math.random() * w; }
      ctx.fillRect(x, Math.round(f.y), 1, 1);
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    stop();
    if (motion.matches || document.hidden) { ctx.clearRect(0, 0, w, h); return; }
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  // Size from layout (not at script time, when the header may not be laid out yet).
  if ("ResizeObserver" in window) new ResizeObserver(() => { size(); start(); }).observe(canvas);
  else { size(); start(); window.addEventListener("resize", () => { size(); start(); }); }
  document.addEventListener("visibilitychange", start);
  motion.addEventListener?.("change", start);
})();
