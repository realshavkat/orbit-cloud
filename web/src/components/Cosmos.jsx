import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

const F = 4.2;
const TILT = 0.38;
const RINGS = [
  { r: 1.55, inc: 0.32, node: 0.4, speed: 0.22, sats: [[0, "#ddd5ff", 3.2]] },
  { r: 2.05, inc: -0.18, node: -0.9, speed: 0.14, sats: [[2.2, "#ffffff", 2.4], [4.6, "#a58bff", 2.8]] },
  { r: 2.7, inc: 0.12, node: 1.7, speed: 0.08, sats: [[1.1, "#c9bcff", 2.6]] },
];
const LIGHT = (() => {
  const v = [-0.55, 0.6, 0.6];
  const n = Math.hypot(...v);
  return v.map(x => x / n);
})();

function layout(variant, w, h) {
  const small = w < 760;
  if (variant == "hero") return small ? { x: w * 0.5, y: h * 1.02, r: w * 0.62 } : { x: w * 0.5, y: h * 1.2, r: Math.min(w * 0.36, 520) };
  if (variant == "auth") return small ? { x: w * 0.92, y: h * 0.08, r: w * 0.32 } : { x: w * 0.25, y: h * 1.02, r: Math.min(w * 0.2, h * 0.42) };
  return small ? { x: w * 0.98, y: h * 0.04, r: w * 0.26 } : { x: w * 0.95, y: h * 0.08, r: Math.min(w, h) * 0.17, soft: true };
}

const BLOBS = [
  ["91 63 255", 0.18, 0.12, 0.62, 0.05, 0.0],
  ["46 74 210", 0.82, 0.3, 0.55, 0.035, 2.1],
  ["150 60 200", 0.55, 0.85, 0.6, 0.045, 4.2],
  ["70 40 160", 0.35, 0.55, 0.45, 0.06, 1.3],
];

const rotY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
const rotX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];

export default function Cosmos({ quiet = false }) {
  const ref = useRef(null);
  const { pathname } = useLocation();
  const variant = useRef("page");
  variant.current = pathname == "/" ? "hero" : /^\/(login|register|connect|verify|confirm-email|forgot|reset|mfa)/.test(pathname) ? "auth" : "page";

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0, clock = 0, cur = null;
    const dim = quiet ? 0.55 : 1;

    const size = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = innerWidth;
      h = innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cur = null;
      draw(0);
    };

    function draw(dt) {
      const target = layout(variant.current, w, h);
      if (!cur || still.matches) cur = { ...target };
      else {
        const k = 1 - Math.exp(-dt * 3.2);
        for (const key of ["x", "y", "r"]) cur[key] += (target[key] - cur[key]) * k;
      }
      const R = cur.r;
      const cx = cur.x;
      const cy = cur.y - scrollY * 0.18;
      const fade = Math.max(0, 1 - scrollY / (h * 1.4)) * dim * (target.soft ? 0.6 : 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const big = Math.max(w, h);
      for (const [rgb, bx, by, size, speed, phase] of BLOBS) {
        const t = clock * speed + phase;
        const x = (bx + 0.16 * Math.sin(t * 1.3) + 0.08 * Math.sin(t * 2.9)) * w;
        const y = (by + 0.14 * Math.cos(t * 1.1) + 0.06 * Math.sin(t * 2.3)) * h - scrollY * 0.05;
        const r = big * size * (0.9 + 0.1 * Math.sin(t * 1.7));
        const lg = ctx.createRadialGradient(x, y, 0, x, y, r);
        lg.addColorStop(0, `rgb(${rgb} / ${0.11 * dim})`);
        lg.addColorStop(0.45, `rgb(${rgb} / ${0.04 * dim})`);
        lg.addColorStop(1, `rgb(${rgb} / 0)`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, w, h);
      }
      if (fade <= 0) return;

      const project = p => {
        const s = F / (F - p[2]);
        return [cx + p[0] * R * s, cy - p[1] * R * s, p[2], s];
      };
      const spin = clock * 0.06;
      const camera = p => rotX(p, TILT);

      const ringPoints = RINGS.map(ring => {
        const pts = [];
        for (let i = 0; i <= 160; i++) {
          const a = (i / 160) * Math.PI * 2;
          pts.push(project(camera(rotY(rotX([Math.cos(a) * ring.r, 0, Math.sin(a) * ring.r], ring.inc), ring.node))));
        }
        return pts;
      });
      const sats = RINGS.flatMap(ring => ring.sats.map(([phase, color, size]) => {
        const at = a => project(camera(rotY(rotX([Math.cos(a) * ring.r, 0, Math.sin(a) * ring.r], ring.inc), ring.node)));
        const a = phase + clock * ring.speed;
        return { color, size, head: at(a), tail: Array.from({ length: 18 }, (_, k) => at(a - (k + 1) * 0.022)) };
      }));

      const strokeRing = front => {
        ctx.lineWidth = 1;
        for (const pts of ringPoints) {
          for (let i = 1; i < pts.length; i++) {
            const [x0, y0, z0] = pts[i - 1];
            const [x1, y1, z1] = pts[i];
            if ((z0 + z1 > 0) != front) continue;
            ctx.globalAlpha = fade * (front ? 0.22 : 0.08) * (0.7 + 0.3 * Math.abs(z0) / 3);
            ctx.strokeStyle = "#cfc4ff";
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
        }
      };
      const drawSats = front => {
        for (const s of sats) {
          if ((s.head[2] > 0) != front) continue;
          let prev = s.head;
          s.tail.forEach((p, k) => {
            ctx.globalAlpha = fade * (1 - k / s.tail.length) * (front ? 0.5 : 0.18);
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.size * prev[3] * (1 - k / s.tail.length) * 0.8;
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(p[0], p[1]);
            ctx.stroke();
            prev = p;
          });
          ctx.globalAlpha = fade * (front ? 1 : 0.35);
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(s.head[0], s.head[1], s.size * s.head[3], 0, 6.283);
          ctx.fill();
        }
      };

      strokeRing(false);
      drawSats(false);

      const limb = R * F / Math.sqrt(F * F - 1);
      const g = ctx.createRadialGradient(cx - limb * 0.42, cy - limb * 0.48, limb * 0.05, cx, cy, limb);
      g.addColorStop(0, "#1c1930");
      g.addColorStop(0.55, "#0e0d16");
      g.addColorStop(1, "#08080c");
      ctx.globalAlpha = Math.min(1, fade * 1.6);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, limb, 0, 6.283);
      ctx.fill();

      const line = (gen, n, emphasis) => {
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const local = gen(i / n);
          const world = rotY(local, spin);
          const p = camera(world);
          const q = project(p);
          if (prev && prev[2] > 0 && p[2] > 0) {
            const lit = Math.max(0, world[0] * LIGHT[0] + world[1] * LIGHT[1] + world[2] * LIGHT[2]);
            ctx.globalAlpha = fade * (0.05 + 0.2 * lit) * (0.4 + 0.6 * p[2]) * (emphasis ? 1.8 : 1);
            ctx.beginPath();
            ctx.moveTo(prev[3], prev[4]);
            ctx.lineTo(q[0], q[1]);
            ctx.stroke();
          }
          prev = [...p, q[0], q[1]];
        }
      };
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#d9d2ff";
      for (let m = 0; m < 16; m++) {
        const lon = (m / 16) * Math.PI * 2;
        line(t => {
          const lat = -Math.PI / 2 + t * Math.PI;
          return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
        }, 48, false);
      }
      for (let k = 1; k < 10; k++) {
        const lat = -Math.PI / 2 + (k / 10) * Math.PI;
        line(t => {
          const lon = t * Math.PI * 2;
          return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
        }, 72, k == 5);
      }
      ctx.globalAlpha = fade * 0.28;
      ctx.strokeStyle = "#cfc4ff";
      ctx.beginPath();
      ctx.arc(cx, cy, limb, 0, 6.283);
      ctx.stroke();

      strokeRing(true);
      drawSats(true);
      ctx.globalAlpha = 1;
    }

    const loop = now => {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      clock += dt;
      draw(dt);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (still.matches) draw(0);
      else raf = requestAnimationFrame(loop);
    };
    const onScroll = () => still.matches && draw(0);

    size();
    start();
    addEventListener("resize", size);
    addEventListener("scroll", onScroll, { passive: true });
    still.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", size);
      removeEventListener("scroll", onScroll);
      still.removeEventListener("change", start);
    };
  }, [quiet]);
  return <canvas ref={ref} className="cosmos" aria-hidden="true" />;
}
