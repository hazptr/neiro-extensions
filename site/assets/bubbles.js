// Floating bubbles that react to the pointer. Shared by the hazptr.github.io pages: the copy in
// hazptr/hazptr.github.io is the original, the Neiro sites carry copies.
//
//   Bubbles.start({ palette: ['#00897b', ...], glyphs: ['音', '♪'], density: 1 })
//
// Pointer near a bubble pushes it away, holding the pointer down pulls bubbles in, letting go
// throws them back out. Clicking a bubble pops it. Popping can play a note if sound is on.
(() => {
  const TAU = Math.PI * 2;
  const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hexToRgb(hex) {
    const v = parseInt(hex.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  class Sound {
    constructor() {
      this.enabled = localStorage.getItem('bubbles-sound') === 'on';
      this.ctx = null;
    }

    toggle() {
      this.enabled = !this.enabled;
      localStorage.setItem('bubbles-sound', this.enabled ? 'on' : 'off');
      return this.enabled;
    }

    // A short plucked note, pitched by bubble size: big bubbles sound low
    pop(radius) {
      if (!this.enabled) return;
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      const step = PENTATONIC[Math.max(0, Math.min(PENTATONIC.length - 1, Math.round(7 - radius / 14)))];
      const freq = 392 * 2 ** (step / 12);
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq * 1.5, now);
      osc.frequency.exponentialRampToValueAtTime(freq, now + 0.05);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.65);
    }
  }

  class Bubble {
    constructor(field, fromBottom) {
      this.field = field;
      this.reset(fromBottom);
    }

    reset(fromBottom) {
      const { width, height, palette, glyphs } = this.field;
      this.r = rand(14, 46) * this.field.scale;
      this.x = rand(this.r, width - this.r);
      this.y = fromBottom ? height + this.r + rand(0, 120) : rand(this.r, height - this.r);
      this.vx = rand(-0.25, 0.25);
      this.vy = rand(-0.45, -0.1);
      this.colorIndex = Math.floor(Math.random() * palette.length);
      this.color = hexToRgb(palette[this.colorIndex]);
      this.glyph = glyphs.length && Math.random() < 0.35 ? glyphs[Math.floor(Math.random() * glyphs.length)] : null;
      this.phase = rand(0, TAU);
      this.wobble = rand(0.6, 1.4);
      this.born = performance.now();
      this.alive = true;
    }

    step(dt, t) {
      const f = this.field;
      const p = f.pointer;
      // Gentle buoyancy and a slow sideways drift
      this.vy -= 0.0025 * dt;
      this.vx += Math.sin(t / 1700 + this.phase) * 0.002 * dt;

      if (p.active) {
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        const dist = Math.hypot(dx, dy) || 1;
        const reach = 170 * f.scale + this.r;
        if (p.down) {
          // Held: drift in towards the pointer, orbiting slightly
          const pull = Math.min(1, 260 / dist) * 0.05 * dt;
          this.vx -= (dx / dist) * pull - (dy / dist) * pull * 0.35;
          this.vy -= (dy / dist) * pull + (dx / dist) * pull * 0.35;
        } else if (dist < reach) {
          const push = (1 - dist / reach) ** 2 * 1.4 * dt;
          this.vx += (dx / dist) * push + p.vx * 0.02;
          this.vy += (dy / dist) * push + p.vy * 0.02;
        }
      }

      this.vx *= 0.985 ** dt;
      this.vy *= 0.985 ** dt;
      const speed = Math.hypot(this.vx, this.vy);
      const max = 9;
      if (speed > max) {
        this.vx *= max / speed;
        this.vy *= max / speed;
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // Walls bounce softly; the top wraps back to the bottom
      if (this.x < this.r) { this.x = this.r; this.vx = Math.abs(this.vx) * 0.6; }
      if (this.x > f.width - this.r) { this.x = f.width - this.r; this.vx = -Math.abs(this.vx) * 0.6; }
      if (this.y < -this.r * 2) this.reset(true);
      if (this.y > f.height + this.r * 3 && this.vy > 0) this.vy = -Math.abs(this.vy);
    }

    draw(ctx, t) {
      const age = Math.min(1, (performance.now() - this.born) / 600);
      const wob = Math.sin(t / 380 * this.wobble + this.phase) * 0.04;
      const sprite = this.field.sprite(this);
      // The sprite is drawn once per look; each frame only stamps it, squashed a little for the wobble
      const size = this.r * sprite.scale;
      const w = size * (1 + wob) * age;
      const h = size * (1 - wob) * age;
      ctx.drawImage(sprite.canvas, this.x - w / 2, this.y - h / 2, w, h);
    }
  }

  class Burst {
    constructor(bubble) {
      this.x = bubble.x;
      this.y = bubble.y;
      this.r = bubble.r;
      this.color = bubble.color;
      this.t = 0;
      this.drops = Array.from({ length: 10 + Math.round(bubble.r / 4) }, () => {
        const a = rand(0, TAU);
        const s = rand(1.5, 5);
        return { x: this.x, y: this.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(1, 3) };
      });
    }

    step(dt) {
      this.t += dt / 40;
      for (const d of this.drops) {
        d.vy += 0.08 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
      return this.t < 1;
    }

    draw(ctx) {
      const [r, g, b] = this.color;
      const k = 1 - this.t;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * (1 + this.t * 1.6), 0, TAU);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.6 * k})`;
      ctx.lineWidth = 2 * k + 0.5;
      ctx.stroke();
      ctx.fillStyle = `rgba(${r},${g},${b},${0.8 * k})`;
      for (const d of this.drops) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * k + 0.3, 0, TAU);
        ctx.fill();
      }
    }
  }

  class Field {
    constructor(opts) {
      this.palette = opts.palette;
      this.glyphs = opts.glyphs || [];
      this.density = opts.density ?? 1;
      this.sound = new Sound();
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'bubbles';
      this.canvas.setAttribute('aria-hidden', 'true');
      document.body.prepend(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false, down: false, downAt: 0 };
      this.bubbles = [];
      this.bursts = [];
      this.sprites = new Map();
      this.still = prefersReducedMotion();
      this.resize();
      addEventListener('resize', () => this.resize());
      this.listen();
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }

    resize() {
      // Soft shapes do not need full phone resolution, and every extra pixel is filled each frame
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      this.dpr = dpr;
      this.sprites?.clear();
      this.width = innerWidth;
      this.height = innerHeight;
      this.scale = Math.max(0.7, Math.min(1.3, Math.min(this.width, this.height) / 800));
      this.canvas.width = this.width * dpr;
      this.canvas.height = this.height * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round(Math.min(48, (this.width * this.height) / 42000) * this.density);
      while (this.bubbles.length < target) this.bubbles.push(new Bubble(this, false));
      this.bubbles.length = target;
    }

    listen() {
      const p = this.pointer;
      const move = (e) => {
        p.vx = e.clientX - p.x;
        p.vy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        p.active = true;
      };
      addEventListener('pointermove', move, { passive: true });
      addEventListener('pointerleave', () => { p.active = false; });
      document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) p.active = false; });
      addEventListener('pointerdown', (e) => {
        if (e.target.closest('a, button, input, [data-no-bubbles]')) return;
        move(e);
        p.down = true;
        p.downAt = performance.now();
        const hit = this.bubbles.find((b) => Math.hypot(b.x - e.clientX, b.y - e.clientY) < b.r);
        if (hit) this.pop(hit);
      });
      addEventListener('pointerup', () => {
        if (!p.down) return;
        p.down = false;
        // A long hold gathers bubbles; letting go throws them out
        const held = Math.min(1.5, (performance.now() - p.downAt) / 1000);
        if (held > 0.25) {
          for (const b of this.bubbles) {
            const dx = b.x - p.x;
            const dy = b.y - p.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist < 320) {
              const kick = (1 - dist / 320) * 9 * held;
              b.vx += (dx / dist) * kick;
              b.vy += (dy / dist) * kick;
            }
          }
        }
      });
      document.addEventListener('visibilitychange', () => {
        this.last = performance.now();
      });
    }

    pop(bubble) {
      this.bursts.push(new Burst(bubble));
      this.sound.pop(bubble.r);
      bubble.reset(true);
    }

    /**
     * A pre-rendered bubble for a colour, glyph and size step. Drawing gradients, rims and text for
     * every bubble on every frame was most of the cost of the page on phones.
     */
    sprite(bubble) {
      const step = Math.max(8, Math.round(bubble.r / 4) * 4);
      const key = `${bubble.colorIndex}|${bubble.glyph ?? ''}|${step}`;
      let sprite = this.sprites.get(key);
      if (sprite) return sprite;

      const pad = 1.12;
      const size = step * 2 * pad;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.ceil(size * this.dpr);
      const c = canvas.getContext('2d');
      c.scale(this.dpr, this.dpr);
      c.translate(size / 2, size / 2);
      const [r, g, b] = bubble.color;
      const rad = step;

      // Body: clear in the middle, coloured towards the rim, like a soap film
      const body = c.createRadialGradient(-rad * 0.25, -rad * 0.3, rad * 0.1, 0, 0, rad);
      body.addColorStop(0, `rgba(${r},${g},${b},0.04)`);
      body.addColorStop(0.7, `rgba(${r},${g},${b},0.16)`);
      body.addColorStop(1, `rgba(${r},${g},${b},0.42)`);
      c.beginPath();
      c.arc(0, 0, rad, 0, TAU);
      c.fillStyle = body;
      c.fill();

      // Iridescent rim
      const rim = c.createLinearGradient(-rad, -rad, rad, rad);
      rim.addColorStop(0, 'rgba(255,255,255,0.55)');
      rim.addColorStop(0.5, `rgba(${r},${g},${b},0.7)`);
      rim.addColorStop(1, `rgba(${255 - r},${255 - g},${255 - b},0.35)`);
      c.lineWidth = Math.max(1, rad / 22);
      c.strokeStyle = rim;
      c.stroke();

      // Specular highlight
      c.beginPath();
      c.ellipse(-rad * 0.38, -rad * 0.42, rad * 0.26, rad * 0.13, -0.6, 0, TAU);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fill();

      if (bubble.glyph) {
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.font = `700 ${Math.round(rad * 0.9)}px "M PLUS Rounded 1c", system-ui, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(bubble.glyph, 0, rad * 0.05);
      }

      // `scale` maps a bubble's radius to the drawn size, so one sprite serves a whole size step
      sprite = { canvas, scale: size / step };
      this.sprites.set(key, sprite);
      return sprite;
    }

    frame(t) {
      requestAnimationFrame((n) => this.frame(n));
      if (document.hidden) return;
      // 60fps is plenty for drifting bubbles; 120Hz phones would otherwise do twice the work
      if (t - this.last < 15) return;
      const dt = Math.min(3, (t - this.last) / 16.67);
      this.last = t;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      if (!this.still) {
        for (const b of this.bubbles) b.step(dt, t);
        this.collide();
        this.bursts = this.bursts.filter((burst) => burst.step(dt));
      }

      if (this.pointer.active && !this.still) {
        this.glow ??= this.makeGlow();
        ctx.globalAlpha = this.pointer.down ? 1 : 0.55;
        ctx.drawImage(this.glow, this.pointer.x - 140, this.pointer.y - 140, 280, 280);
        ctx.globalAlpha = 1;
      }

      for (const b of this.bubbles) b.draw(ctx, this.still ? 0 : t);
      for (const burst of this.bursts) burst.draw(ctx);
    }

    makeGlow() {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 140;
      const c = canvas.getContext('2d');
      const [r, g, b] = hexToRgb(this.palette[0]);
      const glow = c.createRadialGradient(70, 70, 0, 70, 70, 70);
      glow.addColorStop(0, `rgba(${r},${g},${b},0.22)`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      c.fillStyle = glow;
      c.fillRect(0, 0, 140, 140);
      return canvas;
    }

    // Soft collisions so bubbles nudge each other instead of overlapping
    collide() {
      const list = this.bubbles;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 > 0 && d2 < min * min) {
            const d = Math.sqrt(d2);
            const overlap = (min - d) / min;
            const nx = dx / d;
            const ny = dy / d;
            const push = overlap * 0.6;
            a.vx -= nx * push;
            a.vy -= ny * push;
            b.vx += nx * push;
            b.vy += ny * push;
          }
        }
      }
    }
  }

  window.Bubbles = {
    start(opts) {
      const field = new Field(opts);
      // Any element with data-sound-toggle switches the pop sound on and off
      for (const el of document.querySelectorAll('[data-sound-toggle]')) {
        const sync = () => {
          el.setAttribute('aria-pressed', String(field.sound.enabled));
          el.dataset.on = field.sound.enabled ? 'true' : 'false';
        };
        sync();
        el.addEventListener('click', () => {
          field.sound.toggle();
          sync();
          if (field.sound.enabled) field.sound.pop(20);
        });
      }
      return field;
    },
  };
})();
