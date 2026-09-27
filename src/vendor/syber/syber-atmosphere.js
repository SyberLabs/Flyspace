/* SyberLabs Design System v2 "Atlas": atmosphere engine (Plate I).
   A live Clifford attractor. Particles iterate the map in the vertex shader, blend additively into a
   float buffer that decays each frame (long exposure), then tone-map + 2-level mip bloom.
   Dependency-free ES module, raw WebGL2, 1 texel per CSS px, pauses off-screen and when hidden.

   mount(canvas, { mode, avoid, caption, reduced }) -> { supported, destroy() }
     mode     'hero' (default): 160k particles; plate beside `avoid` on wide screens, above copy on phones.
              'ambient': 40k particles, slower, 35% intensity, full-bleed (put a heavy scrim over it).
     avoid    Element whose right edge the plate stays clear of (the copy column). Hero only.
     caption  Element that receives the live "a … · b … · c … · d …" parameter line.
     reduced  true = one still exposure. Defaults to prefers-reduced-motion.
   No WebGL2 -> { supported:false } and the canvas is hidden, so the CSS nebula behind it shows.
   Hero also sets --cx, --cy, --s (px) on the canvas parent so the degree ring (RING_SVG) follows the plate. */

const KF = [[-1.4, 1.6, 1.0, 0.7], [1.7, 1.7, 0.6, 1.2], [-1.7, 1.3, -0.1, -1.21], [-1.8, -2.0, -0.5, -0.9], [1.5, -1.8, 1.6, 0.9], [-1.24, -1.25, -1.81, -1.91]];
const fmt = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(3);
export const paramLine = P => 'a ' + fmt(P[0]) + ' · b ' + fmt(P[1]) + ' · c ' + fmt(P[2]) + ' · d ' + fmt(P[3]);

export function mount(canvas, opts = {}) {
  const RM = opts.reduced != null ? !!opts.reduced : !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const gl = canvas && canvas.getContext && canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
  const off = () => { if (canvas) canvas.style.display = 'none'; return { supported: false, destroy() {} }; };
  if (!gl) return off();
  try { return run(canvas, gl, opts.mode === 'ambient', RM, opts); } catch (e) { lose(gl); return off(); }
}

function lose(gl) { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); }

function run(cv, gl, ambient, RM, opts) {
  const F = !!gl.getExtension('EXT_color_buffer_float'), N = ambient ? 40000 : 160000, DECAY = 0.9;
  const SPEED = ambient ? 0.45 : 1, GAIN = ambient ? 0.35 : 1, host = cv.parentElement, out = opts.caption, avoid = opts.avoid;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, '#version 300 es\nprecision highp float;\n' + s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const prog = (v, f) => { const p = gl.createProgram(), u = {}; gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); for (let i = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i--;) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); } return { p, u }; };
  // hue by speed along the orbit, cycling in time: deep > electric > ice > amber > magenta > violet
  const pts = prog(`in vec2 a;uniform vec4 P,U;uniform vec2 R;uniform float T;out vec3 c;
const vec3 K[7]=vec3[](vec3(.0,.22,.94),vec3(.26,.55,.96),vec3(.56,.86,.95),vec3(1.,.66,.26),vec3(1.,.22,.78),vec3(.5,.26,1.),vec3(.0,.22,.94));
void main(){vec2 p=fract(a+R)*4.-2.,q=p;for(int i=0;i<18;i++){q=p;p=vec2(sin(P.x*q.y)+P.z*cos(P.x*q.x),sin(P.y*q.x)+P.w*cos(P.y*q.y));}
float h=fract(length(p-q)*.3+T)*6.;int i=int(h);c=mix(K[i],K[i+1],fract(h));gl_Position=vec4(p*U.xy+U.zw,0.,1.);gl_PointSize=1.;}`,
    `in vec3 c;uniform float W;out vec4 o;void main(){o=vec4(c*W,1.);}`);
  const QV = `in vec2 a;out vec2 u;void main(){u=a*.5+.5;gl_Position=vec4(a,0.,1.);}`;
  const fade = prog(QV, `out vec4 o;void main(){o=vec4(0.);}`);
  const tone = prog(QV, `in vec2 u;uniform sampler2D t;uniform float E,G;out vec4 o;
vec3 B(float l){vec2 s=exp2(l)/vec2(textureSize(t,0));vec3 r=vec3(0);for(int i=-1;i<2;i++)for(int j=-1;j<2;j++)r+=textureLod(t,u+vec2(i,j)*s,l).rgb*float((2-abs(i))*(2-abs(j)));return r/16.;}
void main(){vec3 a=textureLod(t,u,0.).rgb+B(3.+G)*.8+B(5.+G)*1.1;
vec3 c=pow(1.-exp(-a*E),vec3(.9));float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.99,78.23)))*43758.5)/255.;o=vec4(vec3(.024,.02,.07)+c+n,1.);}`);
  const vao = d => { const v = gl.createVertexArray(); gl.bindVertexArray(v); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); return v; };
  const seeds = new Float32Array(N * 2); for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const vP = vao(seeds), vQ = vao(new Float32Array([-1, -1, 3, -1, -1, 3]));
  const tex = gl.createTexture(), fb = gl.createFramebuffer();
  let W = 0, H = 0, L, warm = 0, t = 0, last = 0, raf = 0, onScreen = true, lastCap = -1e9, dead = false;

  function size() {
    const w = Math.max(1, Math.round(cv.clientWidth)), h = Math.max(1, Math.round(cv.clientHeight)); // DPR <= 1
    if (w === W && h === H) return; W = cv.width = w; H = cv.height = h;
    if (ambient) L = { s: Math.max(W, H) * 1.05, x: W / 2, y: H / 2 };
    else {
      // wide: the plate lives right of the copy column, so the trace never runs under the words
      const wide = W / H > 1.1, tr = avoid ? avoid.getBoundingClientRect().right - cv.getBoundingClientRect().left : W * 0.45;
      const s = wide ? Math.min(H * 0.9, (W - tr) * 1.02) : Math.min(W * 0.88, 340);
      L = { s, x: wide ? tr + s * 0.5 : W / 2, y: wide ? H * 0.47 : 64 + s / 2 };
      if (host) { host.style.setProperty('--cx', L.x + 'px'); host.style.setProperty('--cy', L.y + 'px'); host.style.setProperty('--s', s + 'px'); }
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, F ? gl.RGBA16F : gl.RGBA8, W, H, 0, gl.RGBA, F ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); warm = 0;
  }
  // six forms, each breathing (small drift), crossfading every 17s. A crossfade, not a parameter lerp:
  // straight lerps pass through periodic windows where the orbit collapses to a few points.
  const ss = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const drift = (A, t) => A.map((v, i) => v + 0.05 * Math.sin(t * (0.23 + i * 0.07) + i * 1.7));
  const forms = t => { const k = Math.floor(t / 17), f = ss((t % 17 - 11) / 6); return [[drift(KF[k % 6], t), 1 - f], [drift(KF[(k + 1) % 6], t), f]]; };

  function frame(now) {
    raf = 0; if (dead || gl.isContextLost()) return; size();
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now; t += dt * SPEED;
    const fs = forms(t + 2), P = fs[fs[1][1] > 0.5 ? 1 : 0][0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, W, H); gl.enable(gl.BLEND);
    if (RM) gl.clear(gl.COLOR_BUFFER_BIT); // reduced motion: always one fresh exposure
    if (!RM && warm) { gl.useProgram(fade.p); gl.bindVertexArray(vQ); gl.blendColor(0, 0, 0, DECAY); gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    gl.useProgram(pts.p); gl.bindVertexArray(vP); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1f(pts.u.T, t * 0.018);
    for (const [Q, w] of fs) {
      if (w < 0.01) continue;
      const e = 1.1 + Math.max(Math.abs(Q[2]), Math.abs(Q[3]));
      gl.uniform4f(pts.u.P, Q[0], Q[1], Q[2], Q[3]); gl.uniform1f(pts.u.W, w * GAIN * (F ? 0.05 : 3 / 255) * (160000 / N));
      gl.uniform4f(pts.u.U, L.s / e / W, L.s / e / H, L.x / W * 2 - 1, 1 - L.y / H * 2);
      // first frame (and the reduced-motion still) is exposed to the density the decay converges to
      for (let i = RM || !warm ? 10 : 1; i--;) { gl.uniform2f(pts.u.R, Math.random(), Math.random()); gl.drawArrays(gl.POINTS, 0, N); }
    }
    warm++;
    gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.generateMipmap(gl.TEXTURE_2D);
    gl.useProgram(tone.p); gl.bindVertexArray(vQ); gl.uniform1f(tone.u.G, Math.log2(L.s / 850)); gl.uniform1f(tone.u.E, F ? 0.42 : 0.42 * 0.05 * 255 / 3); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (out && now - lastCap > 250) { lastCap = now; out.textContent = paramLine(P); }
    if (!RM) go();
  }
  const go = () => { if (!dead && !RM && !raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame); };
  const onVis = () => { last = 0; go(); };
  const onResize = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };
  const onLost = e => { e.preventDefault(); dead = true; if (raf) cancelAnimationFrame(raf); raf = 0; };
  document.addEventListener('visibilitychange', onVis);
  cv.addEventListener('webglcontextlost', onLost);
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; last = 0; go(); }) : null;
  if (io) io.observe(cv);
  if (RM) addEventListener('resize', onResize);
  raf = requestAnimationFrame(frame);

  let destroyed = false;
  return {
    supported: true,
    destroy() {
      if (destroyed) return; destroyed = dead = true;
      if (raf) cancelAnimationFrame(raf); raf = 0;
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('resize', onResize);
      cv.removeEventListener('webglcontextlost', onLost);
      lose(gl);
    }
  };
}

/* Engraved degree ring for the hero. Insert next to the canvas; .sy-ring follows --cx/--cy/--s. */
export const RING_SVG = '<svg class="sy-ring" viewBox="0 0 100 100" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="50" cy="50" r="49.6" stroke-width=".12"/><circle cx="50" cy="50" r="48.6" stroke-width=".3" stroke-dasharray=".12 .729"/><circle cx="50" cy="50" r="48.1" stroke-width=".9" stroke-dasharray=".12 4.077" opacity=".8"/><circle cx="50" cy="50" r="44.6" stroke-width=".1" opacity=".6"/><circle cx="50" cy="50" r="30" stroke-width=".08" stroke-dasharray=".6 1.2" opacity=".6"/><g stroke="none"><text x="50.00" y="4.50" text-anchor="middle">0°</text><text x="73.10" y="10.69" text-anchor="middle">30°</text><text x="90.01" y="27.60" text-anchor="middle">60°</text><text x="96.20" y="50.70" text-anchor="middle">90°</text><text x="9.99" y="73.80" text-anchor="middle">240°</text><text x="3.80" y="50.70" text-anchor="middle">270°</text><text x="9.99" y="27.60" text-anchor="middle">300°</text><text x="26.90" y="10.69" text-anchor="middle">330°</text></g></svg>';
