// Floating bubbles that react to the pointer. Shared by the hazptr.github.io pages: the copy in
// hazptr/hazptr.github.io is the original, the Neiro sites carry copies.
//
//   Bubbles.start({ palette: ['#00897b', ...], glyphs: ['音', '♪'], density: 1 })
//
// Pointer near a bubble pushes it away, holding the pointer down pulls bubbles in, letting go
// throws them back out. Clicking a bubble pops it. Popping can play a note if sound is on.
//
// Drawn with WebGL2 when available: one opaque canvas renders the colour fields, grain, pointer
// glow and every bubble on the GPU, so the page composites a single animated layer. Without
// WebGL2 it falls back to a 2D canvas over the CSS background.
(() => {
  const TAU = Math.PI * 2;
  const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hexToRgb(hex) {
    const v = parseInt(hex.trim().replace('#', ''), 16);
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
      this.glyphIndex = glyphs.length && Math.random() < 0.35 ? Math.floor(Math.random() * glyphs.length) : -1;
      this.glyph = this.glyphIndex >= 0 ? glyphs[this.glyphIndex] : null;
      this.phase = rand(0, TAU);
      this.wobble = rand(0.6, 1.4);
      this.born = performance.now();
    }

    // How far grown in (0..1) and the squash of the wobble, shared by both renderers
    shape(t) {
      const age = Math.min(1, (performance.now() - this.born) / 600);
      const wob = Math.sin(t / 380 * this.wobble + this.phase) * 0.04;
      return { age, sx: (1 + wob) * age, sy: (1 - wob) * age };
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
  }

  // ---------------------------------------------------------------------------------------------
  // WebGL2 renderer

  // Shared by both passes: the drifting colour fields, so bubbles can refract exactly what is behind them
  const FIELD_GLSL = `
    uniform vec2 uRes;
    uniform float uTime;
    uniform vec3 uBg, uA, uB;

    // q is the position as a fraction of the screen; sizes scale with the screen's area, so blobs
    // stay round and in proportion on portrait phones and wide monitors alike
    float blob(vec2 q, vec2 c, float r) {
      vec2 d = (q - c) * uRes;
      float rp = r * sqrt(uRes.x * uRes.y);
      return exp(-dot(d, d) / (rp * rp));
    }

    vec3 field(vec2 p) {
      vec2 q = p / uRes;
      float t = uTime;
      vec3 col = uBg;
      col += uA * 0.24 * blob(q, vec2(0.12 + 0.05 * sin(t * 0.21), 0.16 + 0.04 * cos(t * 0.17)), 0.30);
      col += uB * 0.18 * blob(q, vec2(0.88 + 0.04 * cos(t * 0.15), 0.30 + 0.05 * sin(t * 0.19)), 0.26);
      col += uA * 0.13 * blob(q, vec2(0.50 + 0.06 * sin(t * 0.12), 0.98 + 0.03 * cos(t * 0.23)), 0.34);
      col += uB * 0.07 * blob(q, vec2(0.28 + 0.08 * cos(t * 0.09), 0.62 + 0.06 * sin(t * 0.11)), 0.24);
      col += uA * 0.06 * blob(q, vec2(0.76 + 0.07 * sin(t * 0.08), 0.76 + 0.05 * cos(t * 0.13)), 0.22);
      return col;
    }
  `;

  const BG_VERT = `#version 300 es
    void main() {
      // One triangle that covers the screen
      vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

  const BG_FRAG = `#version 300 es
    precision highp float;
    ${FIELD_GLSL}
    uniform float uDpr;
    uniform vec3 uPointer;
    out vec4 o;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
      vec3 col = field(p);
      vec2 d = p - uPointer.xy;
      col += uA * 0.22 * uPointer.z * exp(-dot(d, d) / 4900.0);
      // Grain, so the gradients do not band
      col += (hash(floor(gl_FragCoord.xy)) - 0.5) * 0.035;
      o = vec4(col, 1.0);
    }`;

  // Per instance: centre and radius, squash, kind and opacity, colour, glyph and a random phase
  const DOT_VERT = `#version 300 es
    in vec2 aCorner;
    in vec4 aPos;    // x, y, radius, glyph index (-1 for none)
    in vec4 aShape;  // squash x, squash y, kind (0 bubble, 1 ring, 2 droplet), opacity
    in vec4 aColor;  // rgb, phase
    uniform vec2 uRes;
    out vec2 vUv;
    out vec2 vPx;
    out vec3 vColor;
    out float vGlyph;
    out float vKind;
    out float vAlpha;
    out float vPhase;
    out float vR;

    void main() {
      float pad = aShape.z > 0.5 ? 1.3 : 1.12;
      vUv = aCorner * pad;
      vec2 px = aPos.xy + vUv * aPos.z * aShape.xy;
      vPx = px;
      vColor = aColor.rgb;
      vGlyph = aPos.w;
      vKind = aShape.z;
      vAlpha = aShape.w;
      vPhase = aColor.a;
      vR = aPos.z;
      vec2 clip = px / uRes * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    }`;

  const DOT_FRAG = `#version 300 es
    precision highp float;
    ${FIELD_GLSL}
    uniform sampler2D uGlyphs;
    uniform vec2 uGlyphGrid;
    in vec2 vUv;
    in vec2 vPx;
    in vec3 vColor;
    in float vGlyph;
    in float vKind;
    in float vAlpha;
    in float vPhase;
    in float vR;
    out vec4 o;

    void main() {
      float d = length(vUv);
      float aa = max(fwidth(d), 0.002) * 1.2;

      if (vKind > 1.5) {
        // Droplet from a pop
        float m = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
        o = vec4(vColor, m * vAlpha);
        return;
      }
      if (vKind > 0.5) {
        // Expanding ring from a pop
        float w = 0.06 + 0.04 * vAlpha;
        float m = 1.0 - smoothstep(w - aa, w + aa, abs(d - 1.0));
        o = vec4(vColor, m * 0.65 * vAlpha);
        return;
      }

      float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
      if (mask <= 0.0) discard;

      // Thin film: the colour comes from the film's thickness, which thins towards the middle and
      // swirls slowly
      float ang = atan(vUv.y, vUv.x);
      float thick = 0.45 + 0.55 * d * d + 0.07 * sin(ang * 3.0 + uTime * 0.7 + vPhase) + 0.05 * sin(ang * 5.0 - uTime * 0.4);
      vec3 film = 0.5 + 0.5 * cos(6.2831 * (thick * 1.7 + vec3(0.0, 0.33, 0.67)));
      float fres = pow(d, 3.0);

      // What is behind the bubble, bent inwards like a lens
      vec2 bent = vPx - vUv * vR * 0.28 * (1.0 - d * d);
      vec3 behind = field(bent);

      // Mostly clear with a light tint, colour gathering towards the rim where the film is seen edge on
      vec3 col = behind * 1.04;
      col = mix(col, vColor, 0.12 + fres * 0.6);
      col += film * (0.14 + 0.75 * fres) * mix(vec3(1.0), vColor, 0.35);
      // A crisp rim line
      float rim = smoothstep(0.84, 0.96, d) * (1.0 - smoothstep(0.96, 1.0, d));
      col += (vColor * 0.6 + 0.4) * rim * 0.55;

      // Highlight, fixed to the top left like a light above
      vec2 h = vUv - vec2(-0.38, -0.42);
      h = mat2(0.825, 0.565, -0.565, 0.825) * h;
      float spec = 1.0 - smoothstep(0.7, 1.0, length(h / vec2(0.27, 0.13)));
      col += vec3(spec * 0.7);
      // A second, softer reflection on the opposite side
      float spec2 = 1.0 - smoothstep(0.5, 1.0, length((vUv - vec2(0.42, 0.5)) / vec2(0.22, 0.09)));
      col += vec3(spec2 * 0.18);

      if (vGlyph >= 0.0) {
        vec2 cell = vec2(mod(vGlyph, uGlyphGrid.x), floor(vGlyph / uGlyphGrid.x));
        vec2 guv = vUv / 1.12 * 0.5 + 0.5;
        float g = texture(uGlyphs, (cell + guv) / uGlyphGrid).a;
        col = mix(col, vec3(1.0), g * 0.55);
      }

      float alpha = mask * (0.58 + 0.38 * fres) * vAlpha;
      o = vec4(col, alpha);
    }`;

  const FLOATS_PER_DOT = 12;

  class GLRenderer {
    static create(field) {
      const gl = field.canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: 'low-power',
      });
      if (!gl) return null;
      try {
        return new GLRenderer(field, gl);
      } catch (e) {
        console.warn('Bubbles: WebGL setup failed, using 2D', e);
        return null;
      }
    }

    constructor(field, gl) {
      this.field = field;
      this.gl = gl;
      this.bgProgram = this.program(BG_VERT, BG_FRAG);
      this.dotProgram = this.program(DOT_VERT, DOT_FRAG);
      this.bgUniforms = this.uniforms(this.bgProgram, ['uRes', 'uTime', 'uBg', 'uA', 'uB', 'uDpr', 'uPointer']);
      this.dotUniforms = this.uniforms(this.dotProgram, ['uRes', 'uTime', 'uBg', 'uA', 'uB', 'uGlyphs', 'uGlyphGrid']);

      const style = getComputedStyle(document.documentElement);
      const cssColor = (name, fallback) => (style.getPropertyValue(name).trim() || fallback);
      this.bg = hexToRgb(cssColor('--bg', '#07090f')).map((v) => v / 255);
      this.accent = hexToRgb(cssColor('--accent', field.palette[0])).map((v) => v / 255);
      this.accent2 = hexToRgb(cssColor('--accent-2', field.palette[1] ?? field.palette[0])).map((v) => v / 255);

      // Instanced quad
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const corner = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, corner);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const aCorner = gl.getAttribLocation(this.dotProgram, 'aCorner');
      gl.enableVertexAttribArray(aCorner);
      gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

      this.instances = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      this.capacity = 0;
      const stride = FLOATS_PER_DOT * 4;
      ['aPos', 'aShape', 'aColor'].forEach((name, i) => {
        const loc = gl.getAttribLocation(this.dotProgram, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, i * 16);
        gl.vertexAttribDivisor(loc, 1);
      });
      gl.bindVertexArray(null);
      this.emptyVao = gl.createVertexArray();

      this.glyphGrid = this.buildGlyphAtlas();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      document.documentElement.classList.add('bubbles-gl');
    }

    program(vsSource, fsSource) {
      const gl = this.gl;
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      return program;
    }

    uniforms(program, names) {
      return Object.fromEntries(names.map((n) => [n, this.gl.getUniformLocation(program, n)]));
    }

    // The glyphs are drawn once with the 2D API into a texture the bubble shader samples
    buildGlyphAtlas() {
      const gl = this.gl;
      const glyphs = this.field.glyphs;
      const cols = 4;
      const rows = Math.max(1, Math.ceil(glyphs.length / cols));
      const cell = 128;
      const canvas = document.createElement('canvas');
      canvas.width = cols * cell;
      canvas.height = rows * cell;
      const c = canvas.getContext('2d');
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${Math.round(cell * 0.45)}px "M PLUS Rounded 1c", system-ui, sans-serif`;
      glyphs.forEach((g, i) => {
        c.fillText(g, (i % cols + 0.5) * cell, (Math.floor(i / cols) + 0.52) * cell);
      });
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.glyphTexture = tex;
      return [cols, rows];
    }

    resize() {
      const { canvas, width, height, dpr } = this.field;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      this.gl.viewport(0, 0, canvas.width, canvas.height);
    }

    draw(t) {
      const gl = this.gl;
      const f = this.field;
      const time = t / 1000;

      // Background pass
      gl.useProgram(this.bgProgram);
      const bu = this.bgUniforms;
      gl.uniform2f(bu.uRes, f.width, f.height);
      gl.uniform1f(bu.uTime, time);
      gl.uniform3fv(bu.uBg, this.bg);
      gl.uniform3fv(bu.uA, this.accent);
      gl.uniform3fv(bu.uB, this.accent2);
      gl.uniform1f(bu.uDpr, f.dpr);
      const p = f.pointer;
      gl.uniform3f(bu.uPointer, p.x, p.y, p.active && !f.still ? (p.down ? 1 : 0.55) : 0);
      gl.bindVertexArray(this.emptyVao);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND);

      // Bubbles, rings and droplets
      const count = f.bubbles.length + f.bursts.reduce((n, b) => n + 1 + b.drops.length, 0);
      if (count === 0) return;
      if (count > this.capacity) {
        this.capacity = Math.ceil(count * 1.5) + 16;
        this.data = new Float32Array(this.capacity * FLOATS_PER_DOT);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
        gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      }
      const data = this.data;
      let i = 0;
      const put = (x, y, r, glyph, sx, sy, kind, alpha, color, phase) => {
        data.set([x, y, r, glyph, sx, sy, kind, alpha, color[0] / 255, color[1] / 255, color[2] / 255, phase], i);
        i += FLOATS_PER_DOT;
      };
      for (const b of f.bubbles) {
        const s = b.shape(f.still ? 0 : t);
        put(b.x, b.y, b.r, b.glyphIndex, s.sx, s.sy, 0, 1, b.color, b.phase);
      }
      for (const burst of f.bursts) {
        const k = 1 - burst.t;
        put(burst.x, burst.y, burst.r * (1 + burst.t * 1.6), -1, 1, 1, 1, k, burst.color, 0);
        for (const d of burst.drops) put(d.x, d.y, d.r * k + 0.3, -1, 1, 1, 2, 0.8 * k, burst.color, 0);
      }

      gl.useProgram(this.dotProgram);
      const du = this.dotUniforms;
      gl.uniform2f(du.uRes, f.width, f.height);
      gl.uniform1f(du.uTime, time);
      gl.uniform3fv(du.uBg, this.bg);
      gl.uniform3fv(du.uA, this.accent);
      gl.uniform3fv(du.uB, this.accent2);
      gl.uniform2f(du.uGlyphGrid, this.glyphGrid[0], this.glyphGrid[1]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.glyphTexture);
      gl.uniform1i(du.uGlyphs, 0);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, i);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    }

    destroy() {
      document.documentElement.classList.remove('bubbles-gl');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // 2D canvas renderer, for browsers without WebGL2

  class CanvasRenderer {
    constructor(field) {
      this.field = field;
      this.ctx = field.canvas.getContext('2d');
      this.sprites = new Map();
    }

    resize() {
      const { canvas, width, height, dpr } = this.field;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.sprites.clear();
    }

    /**
     * A pre-rendered bubble for a colour, glyph and size step. Drawing gradients, rims and text for
     * every bubble on every frame was most of the cost of the page on phones.
     */
    sprite(bubble) {
      const dpr = this.field.dpr;
      const step = Math.max(8, Math.round(bubble.r / 4) * 4);
      const key = `${bubble.colorIndex}|${bubble.glyph ?? ''}|${step}`;
      let sprite = this.sprites.get(key);
      if (sprite) return sprite;

      const pad = 1.12;
      const size = step * 2 * pad;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.ceil(size * dpr);
      const c = canvas.getContext('2d');
      c.scale(dpr, dpr);
      c.translate(size / 2, size / 2);
      const [r, g, b] = bubble.color;
      const rad = step;

      const body = c.createRadialGradient(-rad * 0.25, -rad * 0.3, rad * 0.1, 0, 0, rad);
      body.addColorStop(0, `rgba(${r},${g},${b},0.04)`);
      body.addColorStop(0.7, `rgba(${r},${g},${b},0.16)`);
      body.addColorStop(1, `rgba(${r},${g},${b},0.42)`);
      c.beginPath();
      c.arc(0, 0, rad, 0, TAU);
      c.fillStyle = body;
      c.fill();

      const rim = c.createLinearGradient(-rad, -rad, rad, rad);
      rim.addColorStop(0, 'rgba(255,255,255,0.55)');
      rim.addColorStop(0.5, `rgba(${r},${g},${b},0.7)`);
      rim.addColorStop(1, `rgba(${255 - r},${255 - g},${255 - b},0.35)`);
      c.lineWidth = Math.max(1, rad / 22);
      c.strokeStyle = rim;
      c.stroke();

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

    glow() {
      if (this.glowCanvas) return this.glowCanvas;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 140;
      const c = canvas.getContext('2d');
      const [r, g, b] = hexToRgb(this.field.palette[0]);
      const glow = c.createRadialGradient(70, 70, 0, 70, 70, 70);
      glow.addColorStop(0, `rgba(${r},${g},${b},0.22)`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      c.fillStyle = glow;
      c.fillRect(0, 0, 140, 140);
      this.glowCanvas = canvas;
      return canvas;
    }

    draw(t) {
      const f = this.field;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, f.width, f.height);

      if (f.pointer.active && !f.still) {
        ctx.globalAlpha = f.pointer.down ? 1 : 0.55;
        ctx.drawImage(this.glow(), f.pointer.x - 140, f.pointer.y - 140, 280, 280);
        ctx.globalAlpha = 1;
      }

      for (const b of f.bubbles) {
        const s = b.shape(f.still ? 0 : t);
        const sprite = this.sprite(b);
        const size = b.r * sprite.scale;
        const w = size * s.sx;
        const h = size * s.sy;
        ctx.drawImage(sprite.canvas, b.x - w / 2, b.y - h / 2, w, h);
      }

      for (const burst of f.bursts) {
        const [r, g, b] = burst.color;
        const k = 1 - burst.t;
        ctx.beginPath();
        ctx.arc(burst.x, burst.y, burst.r * (1 + burst.t * 1.6), 0, TAU);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.6 * k})`;
        ctx.lineWidth = 2 * k + 0.5;
        ctx.stroke();
        ctx.fillStyle = `rgba(${r},${g},${b},${0.8 * k})`;
        for (const d of burst.drops) {
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r * k + 0.3, 0, TAU);
          ctx.fill();
        }
      }
    }

    destroy() {}
  }

  // ---------------------------------------------------------------------------------------------

  class Field {
    constructor(opts) {
      this.palette = opts.palette;
      this.glyphs = (opts.glyphs || []).slice(0, 8);
      this.density = opts.density ?? 1;
      this.sound = new Sound();
      this.pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false, down: false, downAt: 0 };
      this.bubbles = [];
      this.bursts = [];
      this.still = prefersReducedMotion();
      this.mount(!opts.forceCanvas);
      addEventListener('resize', () => this.resize());
      this.listen();
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }

    mount(tryGl) {
      this.canvas?.remove();
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'bubbles';
      this.canvas.setAttribute('aria-hidden', 'true');
      document.body.prepend(this.canvas);
      this.renderer = (tryGl && GLRenderer.create(this)) || new CanvasRenderer(this);
      this.canvas.addEventListener('webglcontextlost', (e) => {
        // The GPU dropped the context (driver reset, memory pressure): carry on in 2D
        e.preventDefault();
        this.renderer.destroy();
        this.mount(false);
        this.resize();
      });
      this.resize();
    }

    resize() {
      // Soft shapes do not need full phone resolution, and every extra pixel is filled each frame
      this.dpr = Math.min(1.5, devicePixelRatio || 1);
      this.width = innerWidth;
      this.height = innerHeight;
      this.scale = Math.max(0.7, Math.min(1.3, Math.min(this.width, this.height) / 800));
      this.renderer.resize();
      const target = Math.round(Math.min(48, (this.width * this.height) / 42000) * this.density);
      while (this.bubbles.length < target) this.bubbles.push(new Bubble(this, false));
      this.bubbles.length = target;
      this.dirty = true;
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

    frame(t) {
      requestAnimationFrame((n) => this.frame(n));
      if (document.hidden) return;
      // 60fps is plenty for drifting bubbles; 120Hz phones would otherwise do twice the work
      if (t - this.last < 15) return;
      const dt = Math.min(3, (t - this.last) / 16.67);
      this.last = t;

      if (this.still) {
        // Reduced motion: draw once, then only again after a resize
        if (!this.dirty) return;
        this.dirty = false;
        this.renderer.draw(0);
        return;
      }

      for (const b of this.bubbles) b.step(dt, t);
      this.collide();
      this.bursts = this.bursts.filter((burst) => burst.step(dt));
      this.renderer.draw(t);
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
      // ?bubbles=2d forces the fallback renderer, for comparing the two
      const forceCanvas = new URLSearchParams(location.search).get('bubbles') === '2d';
      const field = new Field({ ...opts, forceCanvas });
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
