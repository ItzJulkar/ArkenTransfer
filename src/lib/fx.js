/** Lighter-style ambient canvas background */

export function initFx(canvas) {
  if (!canvas) return () => {};

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let t0 = performance.now();
  let mx = 0.5;
  let my = 0.35;
  let tmx = 0.5;
  let tmy = 0.35;

  const particles = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const target = Math.min(100, Math.floor((w * h) / 18000));
    particles.length = 0;
    for (let i = 0; i < target; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.8 + Math.random() * 1.8,
        vy: -0.12 - Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function onMove(e) {
    tmx = e.clientX / w;
    tmy = e.clientY / h;
    document.documentElement.style.setProperty('--mx', `${(tmx * 100).toFixed(2)}%`);
    document.documentElement.style.setProperty('--my', `${(tmy * 100).toFixed(2)}%`);
  }

  function drawStatic() {
    resize();
    paint(0);
  }

  function paint(t) {
    ctx.clearRect(0, 0, w, h);

    // soft grid
    ctx.strokeStyle = 'rgba(110, 168, 255, 0.04)';
    ctx.lineWidth = 1;
    const step = 48;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const cx1 = w * (0.25 + 0.08 * Math.sin(t * 0.0003));
    const cy1 = h * (0.3 + 0.06 * Math.cos(t * 0.00025));
    const cx2 = w * (0.72 + 0.07 * Math.cos(t * 0.00028));
    const cy2 = h * (0.55 + 0.08 * Math.sin(t * 0.00022));
    const cx3 = mx * w;
    const cy3 = my * h;

    const cell = 14;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const d1 = Math.hypot(x - cx1, y - cy1);
        const d2 = Math.hypot(x - cx2, y - cy2);
        const d3 = Math.hypot(x - cx3, y - cy3);
        const v =
          Math.sin(d1 * 0.018 - t * 0.0011) +
          Math.sin(d2 * 0.015 + t * 0.0009) +
          Math.sin(d3 * 0.012 - t * 0.0007) * 0.65;
        const n = (v + 2.65) / 5.3;
        if (n < 0.42) continue;
        const alpha = Math.min(0.55, (n - 0.42) * 1.4);
        const r = 1.1 + n * 2.2;
        const g = Math.floor(80 + n * 120);
        const b = Math.floor(180 + n * 60);
        ctx.fillStyle = `rgba(${40 + n * 40},${g},${b},${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (n > 0.72) {
          ctx.fillStyle = `rgba(61, 255, 154, ${alpha * 0.35})`;
          ctx.beginPath();
          ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // wave strokes
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const y0 = h * (0.25 + i * 0.22);
      for (let x = 0; x <= w; x += 8) {
        const yy =
          y0 +
          Math.sin(x * 0.008 + t * 0.0012 + i) * (18 + i * 6) +
          Math.sin(x * 0.003 - t * 0.0007) * 10;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = `rgba(46, 230, 255, ${0.08 + i * 0.03})`;
      ctx.lineWidth = 1.2;
      ctx.shadowColor = 'rgba(46, 230, 255, 0.35)';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // particles
    const cursorX = mx * w;
    const cursorY = my * h;
    for (const p of particles) {
      p.y += p.vy;
      if (p.y < -10) {
        p.y = h + 10;
        p.x = Math.random() * w;
      }
      const pulse = 0.55 + 0.45 * Math.sin(t * 0.002 + p.phase);
      ctx.beginPath();
      ctx.fillStyle = `rgba(110, 168, 255, ${0.35 * pulse})`;
      ctx.shadowColor = 'rgba(46, 230, 255, 0.6)';
      ctx.shadowBlur = 8;
      ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // links near cursor
    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      const da = Math.hypot(a.x - cursorX, a.y - cursorY);
      if (da > 140) continue;
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 120) continue;
        const db = Math.hypot(b.x - cursorX, b.y - cursorY);
        if (db > 140) continue;
        const alpha = 0.12 * (1 - d / 120);
        ctx.strokeStyle = `rgba(61, 255, 154, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  function loop(now) {
    if (document.hidden) {
      raf = requestAnimationFrame(loop);
      return;
    }
    mx += (tmx - mx) * 0.04;
    my += (tmy - my) * 0.04;
    paint(now - t0);
    raf = requestAnimationFrame(loop);
  }

  function onVis() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else if (!reduce) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('visibilitychange', onVis);

  if (reduce) {
    drawStatic();
  } else {
    raf = requestAnimationFrame(loop);
  }

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', onVis);
  };
}
