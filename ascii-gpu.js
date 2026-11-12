/*
 * ascii-gpu.js — WebGL2 instanced ASCII renderer.
 *
 * Each visible cell becomes one textured quad sampled from a glyph atlas.
 * The CPU only packs a small instance buffer; rasterization, texture sampling
 * and scanline shading run on the GPU. This replaces tens of thousands of
 * Canvas2D fillText() calls per frame.
 */
(function (global) {
  "use strict";

  const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in float aChar;
layout(location = 2) in vec3 aColor;
uniform vec2 uResolution;
uniform vec2 uTile;
uniform vec2 uInset;
uniform float uCharCount;
out vec2 vUv;
out vec3 vColor;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 offset = (corner - 0.5) * uTile;
  vec2 pixel = aPos + offset;
  vec2 clip = (pixel / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUv = vec2((aChar + mix(uInset.x, 1.0 - uInset.x, corner.x)) / uCharCount,
             mix(uInset.y, 1.0 - uInset.y, corner.y));
  vColor = aColor;
}`;

  const FRAG_SRC = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
in vec2 vUv;
in vec3 vColor;
out vec4 outColor;
void main() {
  float alpha = texture(uAtlas, vUv).a;
  outColor = vec4(vColor, alpha);
}`;

  const SCAN_VERT_SRC = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

  const SCAN_FRAG_SRC = `#version 300 es
precision mediump float;
uniform float uHeight;
uniform float uStep;
uniform float uThickness;
uniform float uAlpha;
out vec4 outColor;
void main() {
  float y = uHeight - gl_FragCoord.y;
  float offset = mod(y, uStep);
  outColor = vec4(0.0, 0.0, 0.0, offset < uThickness ? uAlpha : 0.0);
}`;

  const FLOATS_PER_INSTANCE = 6;
  const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "shader compile failed";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function program(gl, vertSource, fragSource) {
    const vert = compile(gl, gl.VERTEX_SHADER, vertSource);
    const frag = compile(gl, gl.FRAGMENT_SHADER, fragSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(prog) || "program link failed";
      gl.deleteProgram(prog);
      throw new Error(message);
    }
    return prog;
  }

  function parseHex(value, fallback) {
    const text = String(value || "").trim();
    let match = /^#([0-9a-f]{6})$/i.exec(text);
    if (match) {
      const n = parseInt(match[1], 16);
      return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
    }
    match = /^#([0-9a-f]{3})$/i.exec(text);
    if (match) {
      const n = parseInt(match[1], 16);
      return { r: ((n >> 8) & 15) / 15, g: ((n >> 4) & 15) / 15, b: (n & 15) / 15 };
    }
    return fallback;
  }

  function makeLut(settings, count) {
    const lut = new Uint16Array(1024);
    const contrast = 1 + (Number(settings.contrast) || 0) / 100;
    const brightness = (Number(settings.brightness) || 0) / 100;
    const invert = Boolean(settings.invert);
    for (let i = 0; i < 1024; i += 1) {
      let value = i / 1023;
      value = (value - 0.5) * contrast + 0.5 + brightness;
      if (invert) value = 1 - value;
      value = Math.max(0, Math.min(1, value));
      lut[i] = Math.min(count - 1, Math.floor(value * count));
    }
    return lut;
  }

  class AsciiGPURenderer {
    constructor(canvas) {
      if (!canvas) throw new Error("缺少渲染画布");
      this.canvas = canvas;
      const gl = canvas.getContext("webgl2", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
      if (!gl) throw new Error("当前浏览器不支持 WebGL2");
      this.gl = gl;
      this.failed = false;
      this.atlasKey = "";
      this.atlasTexture = null;
      this.atlasWidth = 0;
      this.atlasHeight = 0;
      this.tileW = 1;
      this.tileH = 1;
      this.charCount = 1;
      this.instanceCapacity = 0;
      this.instanceData = new Float32Array(0);
      this.lutKey = "";
      this.lut = null;
      this._configured = false;

      this.program = program(gl, VERT_SRC, FRAG_SRC);
      this.loc = {
        resolution: gl.getUniformLocation(this.program, "uResolution"),
        tile: gl.getUniformLocation(this.program, "uTile"),
        inset: gl.getUniformLocation(this.program, "uInset"),
        charCount: gl.getUniformLocation(this.program, "uCharCount"),
        atlas: gl.getUniformLocation(this.program, "uAtlas"),
      };

      this.scanProgram = program(gl, SCAN_VERT_SRC, SCAN_FRAG_SRC);
      this.scanLoc = {
        height: gl.getUniformLocation(this.scanProgram, "uHeight"),
        step: gl.getUniformLocation(this.scanProgram, "uStep"),
        thickness: gl.getUniformLocation(this.scanProgram, "uThickness"),
        alpha: gl.getUniformLocation(this.scanProgram, "uAlpha"),
      };

      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.emptyVao = gl.createVertexArray();

      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, BYTES_PER_INSTANCE, 8);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, BYTES_PER_INSTANCE, 12);
      gl.vertexAttribDivisor(2, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this._onLost = (event) => {
        event.preventDefault();
        this.failed = true;
      };
      canvas.addEventListener("webglcontextlost", this._onLost, false);
    }

    get width() {
      return this.canvas.width || 1;
    }

    get height() {
      return this.canvas.height || 1;
    }

    _ensureCapacity(count) {
      if (count <= this.instanceCapacity) return;
      const capacity = Math.max(1024, 1 << Math.ceil(Math.log2(count)));
      this.instanceCapacity = capacity;
      this.instanceData = new Float32Array(capacity * FLOATS_PER_INSTANCE);
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, capacity * BYTES_PER_INSTANCE, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    _ensureAtlas(ramp, fontCss, fontSize) {
      const key = `${fontCss}|${fontSize.toFixed(3)}|${ramp.join("")}`;
      if (key === this.atlasKey && this.atlasTexture) return;
      const gl = this.gl;
      const charCount = Math.max(1, ramp.length);

      const measureCanvas = document.createElement("canvas");
      const measure = measureCanvas.getContext("2d");
      measure.font = `${fontSize}px ${fontCss}`;
      let maxWidth = 1;
      const widths = new Array(charCount);
      for (let i = 0; i < charCount; i += 1) {
        const w = measure.measureText(ramp[i] || " ").width;
        widths[i] = w;
        if (w > maxWidth) maxWidth = w;
      }

      const tileW = Math.max(2, Math.ceil(maxWidth) + 2);
      const tileH = Math.max(2, Math.ceil(fontSize * 1.35) + 2);
      const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
      if (tileW * charCount > maxTexture) {
        throw new Error(`字符集过大，GPU 图集超出 ${maxTexture}px 限制`);
      }

      const atlas = document.createElement("canvas");
      atlas.width = tileW * charCount;
      atlas.height = tileH;
      const ctx = atlas.getContext("2d");
      ctx.clearRect(0, 0, atlas.width, atlas.height);
      ctx.font = `${fontSize}px ${fontCss}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < charCount; i += 1) {
        const char = ramp[i];
        if (!char || char === " " || char === "\u3000") continue;
        ctx.fillText(char, i * tileW + tileW / 2, tileH / 2);
      }

      if (!this.atlasTexture) this.atlasTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.atlasKey = key;
      this.atlasWidth = atlas.width;
      this.atlasHeight = atlas.height;
      this.tileW = tileW;
      this.tileH = tileH;
      this.charCount = charCount;
    }

    _ensureLut(settings, ramp) {
      const key = `${ramp.length}|${settings.contrast}|${settings.brightness}|${settings.invert ? 1 : 0}`;
      if (key === this.lutKey && this.lut) return;
      this.lut = makeLut(settings, ramp.length);
      this.lutKey = key;
    }

    render(data, cols, rows, settings, ramp) {
      if (this.failed) throw new Error("WebGL 上下文已丢失");
      const gl = this.gl;
      const width = this.width;
      const height = this.height;
      const count = Math.max(1, ramp.length);
      const cellW = width / cols;
      const cellH = height / rows;
      const fontSize = Math.max(1, cellH * 0.96);
      const fontCss = settings._fontCss || "monospace";

      this._ensureAtlas(ramp, fontCss, fontSize);
      this._ensureLut(settings, ramp);

      const bg = parseHex(settings.bg, { r: 0.03, g: 0.04, b: 0.03 });
      const fg = parseHex(settings.fg, { r: 1, g: 1, b: 1 });
      const mono = settings.colorMode !== "source";
      const lut = this.lut;

      this._ensureCapacity(cols * rows);
      const instance = this.instanceData;
      let offset = 0;
      let visible = 0;

      for (let y = 0; y < rows; y += 1) {
        const cy = y * cellH + cellH / 2;
        for (let x = 0; x < cols; x += 1) {
          const p = (y * cols + x) * 4;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const lutIndex = Math.min(1023, ((lum * (1023 / 255)) + 0.5) | 0);
          const charIndex = lut[lutIndex];
          const char = ramp[charIndex];
          if (!char || char === " " || char === "\u3000") continue;
          instance[offset] = x * cellW + cellW / 2;
          instance[offset + 1] = cy;
          instance[offset + 2] = charIndex;
          if (mono) {
            instance[offset + 3] = fg.r;
            instance[offset + 4] = fg.g;
            instance[offset + 5] = fg.b;
          } else {
            instance[offset + 3] = r / 255;
            instance[offset + 4] = g / 255;
            instance[offset + 5] = b / 255;
          }
          offset += FLOATS_PER_INSTANCE;
          visible += 1;
        }
      }

      gl.viewport(0, 0, width, height);
      gl.clearColor(bg.r, bg.g, bg.b, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (visible > 0) {
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, instance.subarray(0, offset));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
        gl.uniform1i(this.loc.atlas, 0);
        gl.uniform2f(this.loc.resolution, width, height);
        gl.uniform2f(this.loc.tile, this.tileW, this.tileH);
        gl.uniform2f(this.loc.inset, 0.5 / this.tileW, 0.5 / this.tileH);
        gl.uniform1f(this.loc.charCount, this.charCount);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, visible);
      }

      if (settings.scanline) {
        const step = Math.max(2, Math.round(height / 300));
        const thickness = Math.max(1, step * 0.25);
        gl.useProgram(this.scanProgram);
        gl.bindVertexArray(this.emptyVao);
        gl.uniform1f(this.scanLoc.height, height);
        gl.uniform1f(this.scanLoc.step, step);
        gl.uniform1f(this.scanLoc.thickness, thickness);
        gl.uniform1f(this.scanLoc.alpha, 0.16);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(null);
      return visible;
    }

    dispose() {
      try {
        this.canvas.removeEventListener("webglcontextlost", this._onLost, false);
      } catch (_) {}
      const gl = this.gl;
      if (!gl) return;
      try {
        if (this.atlasTexture) gl.deleteTexture(this.atlasTexture);
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.emptyVao) gl.deleteVertexArray(this.emptyVao);
        if (this.program) gl.deleteProgram(this.program);
        if (this.scanProgram) gl.deleteProgram(this.scanProgram);
      } catch (_) {}
      this.failed = true;
    }
  }

  AsciiGPURenderer.isSupported = function () {
    if (AsciiGPURenderer._supported !== undefined) return AsciiGPURenderer._supported;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2");
      AsciiGPURenderer._supported = Boolean(gl);
    } catch (_) {
      AsciiGPURenderer._supported = false;
    }
    return AsciiGPURenderer._supported;
  };

  global.AsciiGPURenderer = AsciiGPURenderer;
})(window);
