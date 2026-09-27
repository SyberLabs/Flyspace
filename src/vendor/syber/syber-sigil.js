/* SyberLabs Design System v2 "Atlas": sigils.
   A de Jong attractor seeded by hash(name) (FNV-1a -> mulberry32), filtered for structured shapes,
   log-density rendered in one accent; dense cores burn toward white. Same name -> same mark everywhere.
   Names are trimmed and lower-cased, so "RISE" and "rise" give the same mark.

   params(name)                          -> { P:[a,b,c,d], box:[cx,cy,size], caption }
   draw(canvas, name, { color, animate }) -> { P, caption, cancel() }
     color    '#rrggbb' | '#rgb' | 'rgb(r,g,b)'. Default: the canvas's --sy-accent (or --a), else vellum.
     animate  draw in over ~16 frames (default true). Off under prefers-reduced-motion.
   drawAll(root = document)  draws every canvas[data-sigil] (name = data-sigil, color = data-color or
                             --sy-accent) when it scrolls into view. Returns { disconnect() }. */

const fmt = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(3);
const line = P => 'a ' + fmt(P[0]) + ' · b ' + fmt(P[1]) + ' · c ' + fmt(P[2]) + ' · d ' + fmt(P[3]);
const reducedMotion = () => !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

function prng(a) { return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const dj = (P, n, f) => { let x = 0.1, y = 0.1; for (let i = 0; i < n + 100; i++) { const nx = Math.sin(P[0] * y) - Math.cos(P[1] * x); y = Math.sin(P[2] * x) - Math.cos(P[3] * y); x = nx; if (i >= 100) f(x, y); } };
const cache = new Map();

export function params(name) {
  const seed = String(name == null ? '' : name).trim().toLowerCase();
  if (cache.has(seed)) return cache.get(seed);
  let h = 2166136261; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const r = prng(h >>> 0);
  let res = { P: [1.641, 1.902, 0.316, 1.525], box: [0, 0, 4] };
  for (let k = 0; k < 800; k++) {
    const P = [0, 0, 0, 0].map(() => +(r() * 6 - 3).toFixed(3)), xs = [], ys = [];
    dj(P, 8000, (x, y) => { xs.push(x); ys.push(y); });
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, hh = Math.max(...ys) - y0;
    if (Math.min(w, hh) < 0.3 || w / hh > 1.7 || hh / w > 1.7) continue;
    const g = new Float32Array(1024); xs.forEach((x, i) => g[((x - x0) / w * 31.99 | 0) + ((ys[i] - y0) / hh * 31.99 | 0) * 32]++);
    let n = 0, m = 0, v = 0; g.forEach(c => { if (c) { n++; m += c; v += c * c; } });
    const mean = m / n, cvar = Math.sqrt(v / n - mean * mean) / mean, fill = n / 1024;
    // keep structured forms: reject collapsed orbits, dust, and shapeless fog
    if (fill > 0.3 && fill < 0.8 && cvar > 0.7 && cvar < 2) { res = { P, box: [x0 + w / 2, y0 + hh / 2, Math.max(w, hh)] }; break; }
  }
  res.caption = line(res.P);
  cache.set(seed, res);
  return res;
}

function rgb(c) {
  c = String(c || '').trim();
  let m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map(h => parseInt(h + h, 16));
  m = c.match(/^#([0-9a-f]{6})/i);
  if (m) return m[1].match(/\w\w/g).map(h => parseInt(h, 16));
  m = c.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

export function draw(canvas, name, opts = {}) {
  const { P, box, caption } = params(name);
  const cs = getComputedStyle(canvas);
  const col = rgb(opts.color) || rgb(cs.getPropertyValue('--sy-accent')) || rgb(cs.getPropertyValue('--a')) || [238, 240, 255];
  const S = Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2)) || 240;
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(S, S), d = img.data, hist = new Float32Array(S * S);
  const animate = opts.animate !== false && !reducedMotion();
  const TOTAL = S * S * 4, STEP = animate ? TOTAL / 16 : TOTAL, k = S * 0.82 / box[2], ox = S / 2 - box[0] * k, oy = S / 2 - box[1] * k;
  let done = 0, max = 1, x = 0.1, y = 0.1, raf = 0;
  (function chunk() {
    raf = 0;
    for (let i = 0; i < STEP; i++) {
      const nx = Math.sin(P[0] * y) - Math.cos(P[1] * x); y = Math.sin(P[2] * x) - Math.cos(P[3] * y); x = nx;
      const j = ((ox + x * k) | 0) + ((oy + y * k) | 0) * S; if (++hist[j] > max) max = hist[j];
    }
    done += STEP;
    const L = Math.log(1 + max * 0.5);
    for (let j = 0; j < hist.length; j++) {
      if (!hist[j]) continue;
      const v = Math.min(1, Math.log(1 + hist[j]) / L), w = v * v * v * 0.9, q = j * 4; // dense cores burn toward white
      d[q] = col[0] + (255 - col[0]) * w; d[q + 1] = col[1] + (255 - col[1]) * w; d[q + 2] = col[2] + (255 - col[2]) * w; d[q + 3] = 255 * Math.min(1, 1.25 * Math.pow(v, 0.6));
    }
    ctx.putImageData(img, 0, 0);
    if (done < TOTAL) raf = requestAnimationFrame(chunk);
  })();
  return { P, caption, cancel() { if (raf) cancelAnimationFrame(raf); raf = 0; } };
}

export function drawAll(root = document) {
  const list = [...root.querySelectorAll('canvas[data-sigil]')];
  const one = c => {
    const r = draw(c, c.dataset.sigil, { color: c.dataset.color, animate: c.dataset.animate !== 'false' });
    const cap = c.dataset.captionFor && document.getElementById(c.dataset.captionFor);
    if (cap) cap.textContent = r.caption;
  };
  if (!('IntersectionObserver' in window)) { list.forEach(one); return { disconnect() {} }; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); one(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
  list.forEach(c => io.observe(c));
  return { disconnect: () => io.disconnect() };
}
