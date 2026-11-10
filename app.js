(() => {
  "use strict";

  /* ============================================================
     Utilities
     ============================================================ */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const formatSecondsInput = (seconds) => {
    if (!Number.isFinite(seconds)) return "0.0";
    return (Math.round(seconds * 10) / 10).toFixed(1);
  };

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
  };

  const padNumber = (value, length) => String(value).padStart(length, "0");

  const timestamp = () => {
    const d = new Date();
    return `${d.getFullYear()}${padNumber(d.getMonth() + 1, 2)}${padNumber(d.getDate(), 2)}-${padNumber(d.getHours(), 2)}${padNumber(d.getMinutes(), 2)}${padNumber(d.getSeconds(), 2)}`;
  };

  const safeBaseName = (name) => {
    const base = String(name || "字符画")
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    return base || "字符画";
  };

  const debounce = (fn, wait = 250) => {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), wait);
    };
  };

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const waitPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));

  /* ============================================================
     Constants
     ============================================================ */

  const STORAGE_KEY = "hwz-ascii-studio-settings-v1";
  const PREFS_KEY = "hwz-ascii-studio-prefs-v1";
  const DEMO_SRC = "assets/demo.mp4";
  const IS_FILE_PROTOCOL = window.location.protocol === "file:";

  const CHARSETS = {
    classic: " .:-=+*#%@",
    detailed: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
    minimal: " .:+#@",
    blocks: " ░▒▓█",
    cjk: " 一二十丁木本未末禾米采森",
    numbers: " 0123456789",
    custom: "",
  };

  const CHARSET_LABELS = {
    classic: "经典 · 10 阶",
    detailed: "细腻 · 70 阶",
    minimal: "极简 · 5 阶",
    blocks: "色块 · 5 阶",
    cjk: "汉字 · 13 阶",
    numbers: "数字 · 10 阶",
    custom: "自定义字符",
  };

  const FONTS = {
    mono: {
      label: "等宽 Mono",
      css: '"Cascadia Mono", "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", "Courier New", monospace',
    },
    serif: {
      label: "宋体 Serif",
      css: '"Songti SC", SimSun, "Noto Serif CJK SC", "STSong", serif',
    },
    sans: {
      label: "黑体 Sans",
      css: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Heiti SC", sans-serif',
    },
  };

  const DEFAULT_SETTINGS = Object.freeze({
    cols: 100,
    charset: "classic",
    customChars: "",
    colorMode: "mono",
    fg: "#dcff9a",
    bg: "#080a08",
    brightness: 0,
    contrast: 4,
    invert: false,
    font: "mono",
    scanline: true,
    outputRes: 2560,
  });

  const PRESETS = {
    classic: {
      cols: 100,
      charset: "classic",
      colorMode: "mono",
      fg: "#dcff9a",
      bg: "#080a08",
      brightness: 0,
      contrast: 4,
      invert: false,
      font: "mono",
      scanline: true,
    },
    minimal: {
      cols: 74,
      charset: "minimal",
      colorMode: "mono",
      fg: "#f2f6ec",
      bg: "#050605",
      brightness: 4,
      contrast: 0,
      invert: false,
      font: "mono",
      scanline: false,
    },
    color: {
      cols: 132,
      charset: "detailed",
      colorMode: "source",
      fg: "#dcff9a",
      bg: "#000000",
      brightness: 4,
      contrast: 8,
      invert: false,
      font: "mono",
      scanline: false,
    },
    blocks: {
      cols: 108,
      charset: "blocks",
      colorMode: "source",
      fg: "#dcff9a",
      bg: "#040504",
      brightness: 8,
      contrast: 10,
      invert: false,
      font: "mono",
      scanline: false,
    },
    cjk: {
      cols: 76,
      charset: "cjk",
      colorMode: "mono",
      fg: "#f0e3c4",
      bg: "#0b0906",
      brightness: 0,
      contrast: 2,
      invert: false,
      font: "serif",
      scanline: true,
    },
  };

  const MAX_EXPORT_FRAMES = { zip: 2400, html: 1200 };

  /* ============================================================
     State and DOM
     ============================================================ */

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    activePreset: "classic",
    grid: { cols: 100, rows: 34 },
    charAspect: 0.6,
    videoAspect: 16 / 9,
    hasVideo: false,
    ready: false,
    loading: false,
    needsRender: true,
    autoplayPending: false,
    objectUrl: null,
    currentName: "",
    videoWidth: 0,
    videoHeight: 0,
    volume: 0.8,
    muted: false,
    loop: true,
    speed: 1,
    scrubbing: false,
    exporting: false,
    exportAbort: false,
    dialogKind: null,
    dialogBusy: false,
    recording: false,
    recordRecorder: null,
    recordStream: null,
    recordChunks: [],
    recordCanvas: null,
    recordCtx: null,
    recordTimer: 0,
    recordStart: 0,
    recordTotal: 0,
    recordEndedHandler: null,
    recordMime: "video/webm",
    audioReady: false,
    audioCtx: null,
    audioSource: null,
    audioGain: null,
    audioDest: null,
    loadToken: 0,
    durationProbe: false,
    sampleTaintWarned: false,
    lastPreviewAt: 0,
    lastIdleAt: 0,
    lastRecordAt: 0,
  };

  const el = {
    canvas: null,
    stageArea: null,
    stageFrame: null,
    video: null,
    emptyState: null,
    loadingState: null,
    fileChip: null,
    gridSize: null,
    statusPill: null,
    statusText: null,
    peekWrap: null,
    peekBtn: null,
    recordHud: null,
    recordTime: null,
    stopRecordBtn: null,
    playBtn: null,
    currentTime: null,
    totalTime: null,
    seek: null,
    bufferBar: null,
    playedBar: null,
    muteBtn: null,
    volume: null,
    speed: null,
    loopBtn: null,
    fullscreenBtn: null,
    copyBtn: null,
    exportBtn: null,
    exportMenu: null,
    fileInput: null,
    openBtn: null,
    emptyOpen: null,
    emptyDemo: null,
    demoBtn: null,
    resetBtn: null,
    density: null,
    densityOut: null,
    charset: null,
    customChars: null,
    charsetPreview: null,
    colorMode: null,
    colorRow: null,
    fgPill: null,
    fgColor: null,
    bgColor: null,
    fgHex: null,
    bgHex: null,
    brightness: null,
    brightnessOut: null,
    contrast: null,
    contrastOut: null,
    font: null,
    invert: null,
    scanline: null,
    outputRes: null,
    dialog: null,
    dialogTitle: null,
    dialogKicker: null,
    dialogClose: null,
    frameFields: null,
    recordFields: null,
    exportStart: null,
    exportEnd: null,
    exportFps: null,
    recordCurrentHint: null,
    recordQuality: null,
    recordAudio: null,
    exportSummary: null,
    dialogNote: null,
    exportProgress: null,
    progressLabel: null,
    progressValue: null,
    progressBar: null,
    progressDetail: null,
    dialogCancel: null,
    dialogStart: null,
    dialogStartText: null,
    toastStack: null,
  };

  function cacheDom() {
    el.canvas = $("#canvas");
    el.stageArea = $("#stageArea");
    el.stageFrame = $("#stageFrame");
    el.video = $("#video");
    el.emptyState = $("#emptyState");
    el.loadingState = $("#loadingState");
    el.fileChip = $("#fileChip");
    el.gridSize = $("#gridSize");
    el.statusPill = $("#statusPill");
    el.statusText = $("#statusText");
    el.peekWrap = $("#peekWrap");
    el.peekBtn = $("#peekBtn");
    el.recordHud = $("#recordHud");
    el.recordTime = $("#recordTime");
    el.stopRecordBtn = $("#stopRecordBtn");
    el.playBtn = $("#playBtn");
    el.currentTime = $("#currentTime");
    el.totalTime = $("#totalTime");
    el.seek = $("#seek");
    el.bufferBar = $("#bufferBar");
    el.playedBar = $("#playedBar");
    el.muteBtn = $("#muteBtn");
    el.volume = $("#volume");
    el.speed = $("#speed");
    el.loopBtn = $("#loopBtn");
    el.fullscreenBtn = $("#fullscreenBtn");
    el.copyBtn = $("#copyBtn");
    el.exportBtn = $("#exportBtn");
    el.exportMenu = $("#exportMenu");
    el.fileInput = $("#fileInput");
    el.openBtn = $("#openBtn");
    el.emptyOpen = $("#emptyOpen");
    el.emptyDemo = $("#emptyDemo");
    el.demoBtn = $("#demoBtn");
    el.resetBtn = $("#resetBtn");
    el.density = $("#density");
    el.densityOut = $("#densityOut");
    el.charset = $("#charset");
    el.customChars = $("#customChars");
    el.charsetPreview = $("#charsetPreview");
    el.colorMode = $("#colorMode");
    el.colorRow = $("#colorRow");
    el.fgPill = $("#fgPill");
    el.fgColor = $("#fgColor");
    el.bgColor = $("#bgColor");
    el.fgHex = $("#fgHex");
    el.bgHex = $("#bgHex");
    el.brightness = $("#brightness");
    el.brightnessOut = $("#brightnessOut");
    el.contrast = $("#contrast");
    el.contrastOut = $("#contrastOut");
    el.font = $("#font");
    el.invert = $("#invert");
    el.scanline = $("#scanline");
    el.outputRes = $("#outputRes");
    el.dialog = $("#exportDialog");
    el.dialogTitle = $("#dialogTitle");
    el.dialogKicker = $("#dialogKicker");
    el.dialogClose = $("#dialogClose");
    el.frameFields = $("#frameFields");
    el.recordFields = $("#recordFields");
    el.exportStart = $("#exportStart");
    el.exportEnd = $("#exportEnd");
    el.exportFps = $("#exportFps");
    el.recordCurrentHint = $("#recordCurrentHint");
    el.recordQuality = $("#recordQuality");
    el.recordAudio = $("#recordAudio");
    el.exportSummary = $("#exportSummary");
    el.dialogNote = $("#dialogNote");
    el.exportProgress = $("#exportProgress");
    el.progressLabel = $("#progressLabel");
    el.progressValue = $("#progressValue");
    el.progressBar = $("#progressBar");
    el.progressDetail = $("#progressDetail");
    el.dialogCancel = $("#dialogCancel");
    el.dialogStart = $("#dialogStart");
    el.dialogStartText = $("#dialogStartText");
    el.toastStack = $("#toastStack");
  }

  /* ============================================================
     Toasts
     ============================================================ */

  function showToast(message, type = "success") {
    if (!el.toastStack) return;
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " is-error" : ""}`;
    toast.innerHTML = `<svg class="icon"><use href="#i-${type === "error" ? "close" : "check"}"></use></svg><span></span>`;
    $("span", toast).textContent = message;
    el.toastStack.appendChild(toast);
    while (el.toastStack.children.length > 4) {
      el.toastStack.firstElementChild.remove();
    }
    window.setTimeout(() => {
      toast.classList.add("is-out");
      window.setTimeout(() => toast.remove(), 220);
    }, type === "error" ? 4600 : 3200);
  }

  /* ============================================================
     Persistence
     ============================================================ */

  const isHexColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ""));

  function sanitizeSettings(raw) {
    const next = { ...DEFAULT_SETTINGS };
    if (!raw || typeof raw !== "object") return next;

    if (Number.isFinite(Number(raw.cols))) next.cols = clamp(Math.round(Number(raw.cols)), 40, 220);
    if (Object.prototype.hasOwnProperty.call(CHARSETS, raw.charset)) next.charset = raw.charset;
    if (typeof raw.customChars === "string") next.customChars = raw.customChars.replace(/[\r\n\t]/g, "").slice(0, 80);
    if (raw.colorMode === "source" || raw.colorMode === "mono") next.colorMode = raw.colorMode;
    if (isHexColor(raw.fg)) next.fg = raw.fg;
    if (isHexColor(raw.bg)) next.bg = raw.bg;
    if (Number.isFinite(Number(raw.brightness))) next.brightness = clamp(Math.round(Number(raw.brightness)), -50, 50);
    if (Number.isFinite(Number(raw.contrast))) next.contrast = clamp(Math.round(Number(raw.contrast)), -50, 50);
    if (typeof raw.invert === "boolean") next.invert = raw.invert;
    if (Object.prototype.hasOwnProperty.call(FONTS, raw.font)) next.font = raw.font;
    if (typeof raw.scanline === "boolean") next.scanline = raw.scanline;
    if ([1920, 2560, 3840].includes(Number(raw.outputRes))) next.outputRes = Number(raw.outputRes);
    return next;
  }

  function loadPersisted() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && saved.settings) {
        state.settings = sanitizeSettings(saved.settings);
        if (saved.activePreset && PRESETS[saved.activePreset]) state.activePreset = saved.activePreset;
      }
    } catch (_) {
      state.settings = { ...DEFAULT_SETTINGS };
    }

    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (prefs && typeof prefs === "object") {
        if (Number.isFinite(Number(prefs.volume))) state.volume = clamp(Number(prefs.volume), 0, 1);
        if (typeof prefs.muted === "boolean") state.muted = prefs.muted;
        if (typeof prefs.loop === "boolean") state.loop = prefs.loop;
        if ([0.5, 0.75, 1, 1.5, 2].includes(Number(prefs.speed))) state.speed = Number(prefs.speed);
      }
    } catch (_) {
      /* Ignore malformed preferences. */
    }
  }

  const saveSettingsSoon = debounce(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        settings: state.settings,
        activePreset: state.activePreset,
      }));
    } catch (_) {
      /* Storage may be unavailable in private mode. */
    }
  }, 220);

  const savePrefsSoon = debounce(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        volume: state.volume,
        muted: state.muted,
        loop: state.loop,
        speed: state.speed,
      }));
    } catch (_) {
      /* Storage may be unavailable in private mode. */
    }
  }, 220);

  /* ============================================================
     Character ramp and grid
     ============================================================ */

  let rampKey = "";
  let rampCache = [" "];

  function getRamp() {
    const raw = state.settings.charset === "custom"
      ? state.settings.customChars
      : (CHARSETS[state.settings.charset] || CHARSETS.classic);
    const safeRaw = state.settings.charset === "custom" && !raw ? CHARSETS.classic : raw;
    const key = `${state.settings.charset}|${safeRaw}`;
    if (key !== rampKey) {
      const chars = Array.from(safeRaw);
      rampCache = chars.length ? chars : [" "];
      rampKey = key;
    }
    return rampCache;
  }

  let measureCanvas = null;
  let aspectKey = "";

  function updateCharAspect() {
    const ramp = getRamp();
    const key = `${state.settings.font}|${ramp.join("")}`;
    if (key === aspectKey) return;
    aspectKey = key;

    if (!measureCanvas) measureCanvas = document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    const fontCss = FONTS[state.settings.font]?.css || FONTS.mono.css;
    ctx.font = `100px ${fontCss}`;
    const samples = ramp.filter((char) => char !== " " && char !== "\u3000").slice(0, 48);
    if (!samples.length) {
      state.charAspect = 0.6;
      return;
    }
    const widths = samples.map((char) => ctx.measureText(char).width).sort((a, b) => a - b);
    const median = widths[Math.floor(widths.length / 2)] / 100;
    state.charAspect = clamp(median || 0.6, 0.38, 1.06);
  }

  function updateGrid() {
    state.videoAspect = state.hasVideo && state.videoWidth > 0
      ? state.videoWidth / state.videoHeight
      : 16 / 9;
    const cols = state.settings.cols;
    let rows = Math.round((cols * state.charAspect) / state.videoAspect);
    rows = clamp(rows, 6, 260);
    state.grid = { cols, rows };
    el.gridSize.textContent = `${cols} × ${rows}`;
  }

  function refreshGeometry() {
    updateCharAspect();
    updateGrid();
    state.needsRender = true;
  }

  /* ============================================================
     Settings UI
     ============================================================ */

  function setRangeFill(input) {
    if (!input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value || 0);
    const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${clamp(percent, 0, 100)}%`);
  }

  function updateCharsetPreview() {
    const ramp = getRamp().join("");
    if (state.settings.charset === "custom" && !state.settings.customChars) {
      el.charsetPreview.textContent = "输入字符后，实时预览密度阶梯…";
      el.charsetPreview.style.opacity = "0.55";
    } else {
      el.charsetPreview.textContent = ramp || " ";
      el.charsetPreview.style.opacity = "1";
    }
    el.charsetPreview.title = ramp;
  }

  function syncControls() {
    const s = state.settings;

    el.density.value = String(s.cols);
    el.densityOut.textContent = `${s.cols} 列`;

    el.charset.value = s.charset;
    el.customChars.hidden = s.charset !== "custom";
    el.customChars.value = s.customChars;
    updateCharsetPreview();

    $$("#colorMode button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.value === s.colorMode);
    });
    el.colorRow.classList.toggle("is-source", s.colorMode === "source");
    el.fgColor.disabled = s.colorMode === "source";
    el.fgColor.value = s.fg;
    el.bgColor.value = s.bg;
    el.fgHex.textContent = s.fg.toUpperCase();
    el.bgHex.textContent = s.bg.toUpperCase();

    el.brightness.value = String(s.brightness);
    el.contrast.value = String(s.contrast);
    el.brightnessOut.textContent = s.brightness > 0 ? `+${s.brightness}` : String(s.brightness);
    el.contrastOut.textContent = s.contrast > 0 ? `+${s.contrast}` : String(s.contrast);

    el.font.value = s.font;
    el.invert.checked = s.invert;
    el.scanline.checked = s.scanline;
    el.outputRes.value = String(s.outputRes);

    $$(".preset").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.preset === state.activePreset);
    });

    [el.density, el.brightness, el.contrast, el.volume].forEach(setRangeFill);
  }

  function applyVisualChange() {
    refreshGeometry();
    state.needsRender = true;
    if (!state.hasVideo) drawIdle(performance.now());
  }

  function commitSettings(patch, { preset = null, silent = false } = {}) {
    Object.assign(state.settings, patch);
    state.activePreset = preset;
    syncControls();
    applyVisualChange();
    saveSettingsSoon();
    if (!silent) {
      /* Individual settings changes stay quiet; the preview is the feedback. */
    }
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    Object.assign(state.settings, preset);
    state.activePreset = name;
    syncControls();
    applyVisualChange();
    saveSettingsSoon();
    showToast(`已应用「${$(`[data-preset="${name}"] .preset-name`)?.textContent || name}」风格`);
  }

  function resetSettings() {
    state.settings = { ...DEFAULT_SETTINGS };
    state.activePreset = "classic";
    syncControls();
    applyVisualChange();
    saveSettingsSoon();
    showToast("已恢复默认画面设置");
  }

  function updatePrefsUI() {
    el.volume.value = String(state.volume);
    setRangeFill(el.volume);
    el.speed.value = String(state.speed);
    el.loopBtn.classList.toggle("is-active", state.loop);
    el.loopBtn.setAttribute("aria-pressed", String(state.loop));
    el.muteBtn.parentElement.classList.toggle("is-muted", state.muted);
    el.muteBtn.setAttribute("aria-label", state.muted ? "取消静音" : "静音");
    el.muteBtn.title = state.muted ? "取消静音" : "静音";
    applyVolume();
  }

  /* ============================================================
     Audio and playback
     ============================================================ */

  function applyVolume() {
    if (state.audioReady && state.audioGain) {
      const target = state.muted ? 0 : state.volume;
      state.audioGain.gain.setTargetAtTime(target, state.audioCtx.currentTime, 0.015);
    } else if (el.video) {
      el.video.volume = state.volume;
      el.video.muted = state.muted;
    }
  }

  async function ensureAudioGraph() {
    if (state.audioReady && state.audioCtx) {
      if (state.audioCtx.state === "suspended") {
        try { await state.audioCtx.resume(); } catch (_) { /* Keep the graph connected. */ }
      }
      return true;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    try {
      state.audioCtx = new AudioContextClass();
      state.audioSource = state.audioCtx.createMediaElementSource(el.video);
      state.audioGain = state.audioCtx.createGain();
      state.audioDest = state.audioCtx.createMediaStreamDestination();
      state.audioSource.connect(state.audioGain);
      state.audioGain.connect(state.audioCtx.destination);
      state.audioSource.connect(state.audioDest);
      state.audioReady = true;
      el.video.volume = 1;
      el.video.muted = false;
      applyVolume();
      if (state.audioCtx.state === "suspended") {
        await state.audioCtx.resume();
      }
      return true;
    } catch (error) {
      console.warn("Audio graph unavailable:", error);
      state.audioReady = false;
      return false;
    }
  }

  function syncPlayState() {
    const playing = state.hasVideo && !el.video.paused && !el.video.ended;
    el.playBtn.classList.toggle("is-playing", playing);
    el.playBtn.setAttribute("aria-label", playing ? "暂停" : "播放");

    let label = "待机";
    if (state.loading) label = "读取中";
    else if (!state.hasVideo) label = "待机";
    else if (state.recording) label = "录制中";
    else if (playing) label = "实时转换";
    else if (el.video.ended) label = "播放结束";
    else label = "已暂停";

    el.statusText.textContent = label;
    el.statusPill.classList.toggle("is-live", playing || state.recording);
  }

  async function playVideo() {
    if (!state.ready || state.exporting) return;
    if (el.video.ended || (Number.isFinite(el.video.duration) && el.video.currentTime >= el.video.duration - 0.02)) {
      el.video.currentTime = 0;
    }
    try {
      await el.video.play();
    } catch (error) {
      if (error && error.name === "NotAllowedError") {
        showToast("浏览器拦截了播放，请再点一次播放按钮", "error");
      } else if (error && error.name !== "AbortError") {
        showToast("无法播放这段视频，请尝试 MP4 或 WebM 格式", "error");
      }
    }
  }

  function togglePlay() {
    if (!state.hasVideo) return;
    if (el.video.paused || el.video.ended) playVideo();
    else el.video.pause();
  }

  function updateTimeline() {
    if (!state.hasVideo) {
      el.currentTime.textContent = "0:00";
      el.totalTime.textContent = "0:00";
      el.seek.value = "0";
      el.playedBar.style.width = "0%";
      el.bufferBar.style.width = "0%";
      return;
    }

    const duration = Number.isFinite(el.video.duration) ? el.video.duration : 0;
    const current = Number.isFinite(el.video.currentTime) ? el.video.currentTime : 0;
    el.totalTime.textContent = formatTime(duration);
    el.currentTime.textContent = formatTime(current);
    el.seek.max = String(duration || 1);
    if (!state.scrubbing) el.seek.value = String(current);
    const played = duration > 0 ? clamp((current / duration) * 100, 0, 100) : 0;
    el.playedBar.style.width = `${played}%`;

    let bufferedEnd = 0;
    if (el.video.buffered && el.video.buffered.length) {
      try {
        bufferedEnd = el.video.buffered.end(el.video.buffered.length - 1);
      } catch (_) {
        bufferedEnd = 0;
      }
    }
    const buffered = duration > 0 ? clamp((bufferedEnd / duration) * 100, 0, 100) : 0;
    el.bufferBar.style.width = `${buffered}%`;
  }

  function setControlsEnabled(enabled) {
    state.ready = Boolean(enabled && state.hasVideo);
    el.playBtn.disabled = !state.ready;
    el.seek.disabled = !state.ready;
    el.speed.disabled = !state.ready;
    el.copyBtn.disabled = !state.ready;
    el.muteBtn.disabled = !state.ready;
    el.volume.disabled = !state.ready;
    el.exportBtn.disabled = !state.ready || state.recording;
    el.peekWrap.hidden = !state.ready;
    if (!state.ready) {
      el.video.pause();
    }
    syncPlayState();
  }

  /* ============================================================
     Video loading
     ============================================================ */

  function resetVideoView() {
    state.hasVideo = false;
    state.ready = false;
    state.loading = false;
    el.stageFrame.classList.remove("has-video");
    el.fileChip.hidden = true;
    el.loadingState.hidden = true;
    el.peekWrap.hidden = true;
    setControlsEnabled(false);
    updateTimeline();
    syncPlayState();
  }

  async function probeDuration() {
    if (state.durationProbe) return 0;
    if (Number.isFinite(el.video.duration) && el.video.duration > 0) return el.video.duration;

    state.durationProbe = true;
    state.loading = true;
    syncPlayState();
    const wasPlaying = !el.video.paused && !el.video.ended;
    const oldTime = Number.isFinite(el.video.currentTime) ? el.video.currentTime : 0;
    el.video.pause();

    await new Promise((resolve) => {
      let finished = false;
      let timer = 0;
      let settleTimer = 0;
      const onDuration = () => {
        if (Number.isFinite(el.video.duration) && el.video.duration > 0) {
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(finish, 160);
        }
      };
      const cleanup = () => {
        el.video.removeEventListener("durationchange", onDuration);
        window.clearTimeout(timer);
        window.clearTimeout(settleTimer);
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve();
      };
      el.video.addEventListener("durationchange", onDuration);
      timer = window.setTimeout(finish, 3200);
      try {
        el.video.currentTime = 1e9;
      } catch (_) {
        finish();
      }
    });

    state.durationProbe = false;
    state.loading = false;
    const duration = Number.isFinite(el.video.duration) && el.video.duration > 0 ? el.video.duration : 0;
    if (duration > 0) {
      try {
        el.video.currentTime = clamp(oldTime, 0, Math.max(0, duration - 0.05));
      } catch (_) {
        /* Ignore. */
      }
    } else {
      showToast("这段视频没有时长信息，导出与进度可能受限", "error");
    }
    updateTimeline();
    syncPlayState();
    if (wasPlaying) playVideo();
    return duration;
  }

  function beginLoad(src, label, { demo = false } = {}) {
    if (state.recording) {
      showToast("请先停止录制，再导入新视频", "error");
      return;
    }
    if (state.exporting) return;

    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }

    const token = ++state.loadToken;
    state.currentName = label;
    state.loading = true;
    state.hasVideo = false;
    state.ready = false;
    state.autoplayPending = true;
    state.sampleTaintWarned = false;
    state.objectUrl = demo ? null : src;
    resetSampleCanvas();

    el.video.pause();
    el.stageFrame.classList.remove("has-video");
    el.fileChip.hidden = true;
    el.peekWrap.hidden = true;
    el.loadingState.hidden = false;
    setControlsEnabled(false);
    updateTimeline();

    const onMetadata = () => {
      if (token !== state.loadToken) return;
      el.video.removeEventListener("error", onError);
      state.loading = false;
      state.hasVideo = true;
      state.videoWidth = el.video.videoWidth;
      state.videoHeight = el.video.videoHeight;
      state.videoAspect = state.videoWidth / state.videoHeight || 16 / 9;
      el.video.loop = state.loop;
      el.video.playbackRate = state.speed;
      el.stageFrame.classList.add("has-video");
      el.fileChip.hidden = false;
      el.fileChip.textContent = label;
      el.fileChip.title = label;
      el.loadingState.hidden = false;
      setControlsEnabled(true);
      refreshGeometry();
      layoutCanvas();
      updateTimeline();
      syncPlayState();
      applyVolume();

      const autoplay = state.autoplayPending;
      state.autoplayPending = false;
      const startPlayback = () => {
        if (token !== state.loadToken) return;
        playVideo();
      };
      const durationKnown = Number.isFinite(el.video.duration) && el.video.duration > 0;
      const durationLabel = durationKnown ? ` · ${formatTime(el.video.duration)}` : "";
      showToast(`已载入 · ${state.videoWidth} × ${state.videoHeight}${durationLabel}`);

      if (!durationKnown) {
        probeDuration().then(() => {
          if (token !== state.loadToken) return;
          updateTimeline();
          if (autoplay) startPlayback();
        });
      } else if (autoplay) {
        window.setTimeout(startPlayback, 90);
      }
    };

    const onError = () => {
      if (token !== state.loadToken) return;
      el.video.removeEventListener("loadedmetadata", onMetadata);
      const code = el.video.error?.code;
      let reason = "无法解码这段视频";
      if (code === 4) reason = "浏览器不支持这个视频格式或编码";
      else if (code === 3) reason = "视频解码失败，文件可能已损坏";
      else if (code === 2) reason = "读取视频时发生错误";
      resetVideoView();
      showToast(`${reason}，请尝试 MP4（H.264）或 WebM 格式`, "error");
    };

    el.video.addEventListener("loadedmetadata", onMetadata, { once: true });
    el.video.addEventListener("error", onError, { once: true });

    try {
      el.video.removeAttribute("src");
      el.video.load();
      el.video.src = src;
      el.video.load();
    } catch (_) {
      onError();
    }
  }

  function loadFile(file) {
    if (!file) return;
    const name = file.name || "未命名视频";
    const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv|ogg|mkv)$/i.test(name);
    if (!isVideo) {
      showToast("请选择视频文件（MP4 / WebM / MOV）", "error");
      return;
    }
    if (!file.size) {
      showToast("这个视频文件是空的", "error");
      return;
    }
    const url = URL.createObjectURL(file);
    beginLoad(url, name);
  }

  function loadDemo() {
    if (state.recording) {
      showToast("请先停止录制，再载入示例", "error");
      return;
    }
    if (IS_FILE_PROTOCOL) {
      showToast("示例需要本地服务：请双击「启动字符画工坊.bat」打开工具", "error");
      return;
    }
    beginLoad(DEMO_SRC, "示例 · 光流", { demo: true });
  }

  function openFilePicker() {
    if (state.recording) {
      showToast("请先停止录制，再导入新视频", "error");
      return;
    }
    if (state.exporting) return;
    el.fileInput.click();
  }

  /* ============================================================
     Canvas rendering
     ============================================================ */

  let sampleCanvas = null;
  let sampleCtx = null;

  function resetSampleCanvas() {
    sampleCanvas = document.createElement("canvas");
    sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    sampleCtx.imageSmoothingEnabled = true;
  }

  function sampleGrid(cols, rows) {
    if (!state.hasVideo || el.video.readyState < 2 || !el.video.videoWidth) return null;
    if (!sampleCanvas) resetSampleCanvas();
    if (sampleCanvas.width !== cols || sampleCanvas.height !== rows) {
      sampleCanvas.width = cols;
      sampleCanvas.height = rows;
      sampleCtx.imageSmoothingEnabled = true;
    }
    try {
      sampleCtx.drawImage(el.video, 0, 0, cols, rows);
      return sampleCtx.getImageData(0, 0, cols, rows).data;
    } catch (error) {
      if (error && error.name === "SecurityError") {
        resetSampleCanvas();
        if (!state.sampleTaintWarned) {
          state.sampleTaintWarned = true;
          console.warn("Frame sampling is blocked for this source; use the local launcher.", error);
        }
      } else {
        console.warn("Frame sample failed:", error);
      }
      return null;
    }
  }

  function mapPixelToValue(r, g, b) {
    let value = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    value = (value - 0.5) * (1 + state.settings.contrast / 100) + 0.5 + state.settings.brightness / 100;
    if (state.settings.invert) value = 1 - value;
    return clamp(value, 0, 1);
  }

  function chooseCharacter(value, ramp) {
    const index = Math.min(ramp.length - 1, Math.floor(value * ramp.length));
    return ramp[index];
  }

  function drawAsciiFrame(ctx, width, height, cols, rows, data) {
    const s = state.settings;
    const ramp = getRamp();
    ctx.save();
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, width, height);

    const cellW = width / cols;
    const cellH = height / rows;
    const fontSize = Math.max(1, cellH * 0.96);
    const fontCss = FONTS[s.font]?.css || FONTS.mono.css;
    ctx.font = `${fontSize}px ${fontCss}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const isMono = s.colorMode !== "source";
    if (isMono) ctx.fillStyle = s.fg;

    for (let y = 0; y < rows; y += 1) {
      const py = y * cellH + cellH / 2;
      for (let x = 0; x < cols; x += 1) {
        const offset = (y * cols + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const value = mapPixelToValue(r, g, b);
        const char = chooseCharacter(value, ramp);
        if (!char || char === " " || char === "\u3000") continue;
        if (!isMono) ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillText(char, x * cellW + cellW / 2, py);
      }
    }

    if (s.scanline) {
      const step = Math.max(2, Math.round(height / 300));
      ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
      for (let y = 0; y < height; y += step) {
        ctx.fillRect(0, y, width, Math.max(1, step * 0.25));
      }
    }
    ctx.restore();
  }

  function buildTextFromData(data, cols, rows) {
    const ramp = getRamp();
    const lines = [];
    for (let y = 0; y < rows; y += 1) {
      const line = [];
      for (let x = 0; x < cols; x += 1) {
        const offset = (y * cols + x) * 4;
        const value = mapPixelToValue(data[offset], data[offset + 1], data[offset + 2]);
        const char = chooseCharacter(value, ramp);
        line.push(char === "\u3000" ? " " : char);
      }
      lines.push(line.join("").replace(/[ \t]+$/, ""));
    }
    return lines.join("\n");
  }

  function makeOutputCanvas(longSide = 2560) {
    if (!state.hasVideo) return null;
    const aspect = state.videoAspect || 16 / 9;
    let width;
    let height;
    if (aspect >= 1) {
      width = longSide;
      height = Math.round(width / aspect);
    } else {
      height = longSide;
      width = Math.round(height * aspect);
    }
    width = Math.max(2, width - (width % 2));
    height = Math.max(2, height - (height % 2));
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    return out;
  }

  function renderPreview() {
    if (!state.hasVideo || el.video.readyState < 2) return;
    const data = sampleGrid(state.grid.cols, state.grid.rows);
    if (!data) return;
    const ctx = el.canvas.getContext("2d", { alpha: false });
    drawAsciiFrame(ctx, el.canvas.width, el.canvas.height, state.grid.cols, state.grid.rows, data);
    state.needsRender = false;
  }

  function drawIdle(now = performance.now()) {
    const canvas = el.canvas;
    if (!canvas) return;
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    const t = now * 0.001;
    const cols = clamp(Math.round(width / 13), 34, 150);
    const rows = clamp(Math.round((cols * 0.6) / (width / height)), 12, 90);
    const cellW = width / cols;
    const cellH = height / rows;

    ctx.save();
    ctx.fillStyle = "#060806";
    ctx.fillRect(0, 0, width, height);
    ctx.font = `${Math.max(2, cellH * 0.94)}px ${FONTS.mono.css}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let y = 0; y < rows; y += 1) {
      const ny = y / rows;
      for (let x = 0; x < cols; x += 1) {
        const nx = x / cols;
        const wave =
          Math.sin(nx * 10.5 - t * 1.15 + Math.cos(ny * 5.4 + t * 0.62) * 1.7) * 0.5 +
          Math.sin((nx + ny) * 7.2 + t * 0.48) * 0.22 +
          Math.sin(ny * 18 - t * 0.8 + nx * 3) * 0.13;
        const value = clamp((wave + 0.72) * 0.56, 0, 1);
        if (value < 0.12) continue;
        const char = value > 0.82 ? "#" : value > 0.64 ? "*" : value > 0.46 ? "+" : value > 0.3 ? ":" : ".";
        ctx.fillStyle = `rgba(201, 247, 111, ${0.035 + value * 0.15})`;
        ctx.fillText(char, x * cellW + cellW / 2, y * cellH + cellH / 2);
      }
    }

    const vignette = ctx.createRadialGradient(width / 2, height * 0.42, 0, width / 2, height * 0.42, Math.max(width, height) * 0.65);
    vignette.addColorStop(0, "rgba(6,8,6,0)");
    vignette.addColorStop(0.68, "rgba(6,8,6,0.08)");
    vignette.addColorStop(1, "rgba(6,8,6,0.72)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function layoutCanvas() {
    if (!el.stageArea) return;
    const rect = el.stageArea.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const style = getComputedStyle(el.stageArea);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availW = Math.max(80, rect.width - padX);
    const availH = Math.max(60, rect.height - padY);

    const aspect = state.hasVideo && state.videoAspect ? state.videoAspect : 16 / 9;
    let width = availW;
    let height = width / aspect;
    if (height > availH) {
      height = availH;
      width = height * aspect;
    }
    width = Math.max(60, Math.floor(width));
    height = Math.max(40, Math.floor(height));

    el.stageFrame.style.width = `${width}px`;
    el.stageFrame.style.height = `${height}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5, 3200 / width);
    const backingW = Math.max(2, Math.round(width * dpr));
    const backingH = Math.max(2, Math.round(height * dpr));
    if (el.canvas.width !== backingW || el.canvas.height !== backingH) {
      el.canvas.width = backingW;
      el.canvas.height = backingH;
    }
    state.needsRender = true;
    if (!state.hasVideo) drawIdle(performance.now());
    else if (el.video.readyState >= 2) renderPreview();
  }

  /* ============================================================
     Animation loop
     ============================================================ */

  function tick(now) {
    requestAnimationFrame(tick);

    const cells = state.grid.cols * state.grid.rows;
    const heavyGrid = cells > 22000;
    const recordInterval = heavyGrid ? 50 : 1000 / 30;

    if (state.recording && now - state.lastRecordAt >= recordInterval) {
      state.lastRecordAt = now;
      renderRecordFrame();
    }

    if (!state.hasVideo) {
      if (now - state.lastIdleAt > 70) {
        state.lastIdleAt = now;
        drawIdle(now);
      }
      return;
    }

    if (el.video.readyState < 2) return;
    let frameInterval = 34;
    if (state.recording) {
      frameInterval = heavyGrid ? 200 : 110;
    } else if (cells > 18000) {
      frameInterval = 66;
    } else if (cells > 10000) {
      frameInterval = 45;
    }
    if ((state.needsRender || (!el.video.paused && !el.video.ended)) && now - state.lastPreviewAt >= frameInterval) {
      state.lastPreviewAt = now;
      renderPreview();
    }
  }

  /* ============================================================
     Transports, peeking and fullscreen
     ============================================================ */

  function toggleLoop() {
    state.loop = !state.loop;
    if (!state.recording) el.video.loop = state.loop;
    el.loopBtn.classList.toggle("is-active", state.loop);
    el.loopBtn.setAttribute("aria-pressed", String(state.loop));
    savePrefsSoon();
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        if (el.stageArea.requestFullscreen) await el.stageArea.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (_) {
      showToast("当前浏览器无法进入全屏", "error");
    }
  }

  function startPeek(event) {
    if (!state.hasVideo) return;
    if (event) event.preventDefault();
    el.stageFrame.classList.add("is-peeking");
    if (event && el.peekBtn.setPointerCapture) {
      try { el.peekBtn.setPointerCapture(event.pointerId); } catch (_) { /* Ignore. */ }
    }
  }

  function stopPeek() {
    el.stageFrame.classList.remove("is-peeking");
  }

  /* ============================================================
     Export menu
     ============================================================ */

  function setExportMenu(open) {
    const shouldOpen = Boolean(open) && state.hasVideo && !el.exportBtn.disabled;
    el.exportMenu.hidden = !shouldOpen;
    el.exportBtn.setAttribute("aria-expanded", String(shouldOpen));
  }

  function closeDialog(force = false) {
    if (state.dialogBusy && !force) return;
    if (el.dialog.open) el.dialog.close();
    state.dialogKind = null;
    resetDialogUI();
  }

  function resetDialogUI() {
    state.dialogBusy = false;
    el.dialogStart.hidden = false;
    el.dialogStart.disabled = false;
    el.dialogCancel.disabled = false;
    el.dialogCancel.textContent = "取消";
    el.dialogClose.disabled = false;
    el.exportProgress.hidden = true;
    el.progressBar.style.width = "0%";
    $$(".dialog-fields input, .dialog-fields select", el.dialog).forEach((input) => {
      input.disabled = false;
    });
  }

  /* ============================================================
     Clipboard, downloads and current frame
     ============================================================ */

  function ensureReady() {
    if (!state.hasVideo || !state.ready) {
      showToast("请先导入一段视频", "error");
      return false;
    }
    return true;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 12000);
  }

  function currentFrameText() {
    const data = sampleGrid(state.grid.cols, state.grid.rows);
    if (!data) return "";
    return buildTextFromData(data, state.grid.cols, state.grid.rows);
  }

  function pauseForCapture() {
    const wasPlaying = !el.video.paused && !el.video.ended;
    if (wasPlaying) el.video.pause();
    state.needsRender = true;
    renderPreview();
    return wasPlaying;
  }

  async function copyFrame() {
    if (!ensureReady()) return;
    if (state.recording) {
      showToast("录制中无法复制帧，请先停止录制", "error");
      return;
    }
    const text = currentFrameText();
    if (!text) {
      showToast("当前帧尚未准备好", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制当前帧 · ${state.grid.cols} × ${state.grid.rows} 字符`);
    } catch (_) {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      showToast(ok ? "已复制当前帧文本" : "复制失败，请改用 TXT 导出", ok ? "success" : "error");
    }
  }

  async function exportPNG() {
    if (!ensureReady()) return;
    if (state.recording) {
      showToast("录制中无法导出截图", "error");
      return;
    }
    const wasPlaying = pauseForCapture();
    const data = sampleGrid(state.grid.cols, state.grid.rows);
    if (!data) {
      showToast("当前帧尚未准备好", "error");
      if (wasPlaying) playVideo();
      return;
    }
    const out = makeOutputCanvas([1920, 2560, 3840].includes(state.settings.outputRes) ? state.settings.outputRes : 2560);
    if (!out) return;
    drawAsciiFrame(out.getContext("2d", { alpha: false }), out.width, out.height, state.grid.cols, state.grid.rows, data);
    const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
    if (wasPlaying) playVideo();
    if (!blob) {
      showToast("PNG 生成失败", "error");
      return;
    }
    downloadBlob(blob, `${safeBaseName(state.currentName)}_字符画_${timestamp()}.png`);
    showToast(`PNG 已导出 · ${out.width} × ${out.height}`);
  }

  async function exportTXT() {
    if (!ensureReady()) return;
    if (state.recording) {
      showToast("录制中无法导出文本", "error");
      return;
    }
    const wasPlaying = pauseForCapture();
    const text = currentFrameText();
    if (wasPlaying) playVideo();
    if (!text) {
      showToast("当前帧尚未准备好", "error");
      return;
    }
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${safeBaseName(state.currentName)}_字符画_${timestamp()}.txt`);
    showToast(`TXT 已导出 · ${state.grid.cols} × ${state.grid.rows} 字符`);
  }

  /* ============================================================
     Dialog logic
     ============================================================ */

  function setProgress(percent, label, detail) {
    const safe = clamp(percent, 0, 100);
    el.progressBar.style.width = `${safe}%`;
    el.progressValue.textContent = `${Math.round(safe)}%`;
    if (label) el.progressLabel.textContent = label;
    if (detail !== undefined) el.progressDetail.textContent = detail;
  }

  function setDialogBusy(busy) {
    state.dialogBusy = busy;
    el.dialogStart.hidden = busy;
    el.dialogClose.disabled = busy;
    el.dialogCancel.textContent = busy ? "取消导出" : "取消";
    el.dialogCancel.disabled = false;
    $$(".dialog-fields input, .dialog-fields select", el.dialog).forEach((input) => {
      input.disabled = busy;
    });
    if (busy) {
      el.exportProgress.hidden = false;
      setProgress(0, "正在准备…", "请保持此页面处于打开状态");
    }
  }

  function requestCancelExport() {
    if (!state.dialogBusy) return;
    state.exportAbort = true;
    el.dialogCancel.disabled = true;
    el.progressLabel.textContent = "正在取消…";
    el.progressDetail.textContent = "正在结束当前帧的读取";
  }

  function openExportDialog(kind) {
    if (!ensureReady()) return;
    if (state.recording) {
      showToast("请先停止录制", "error");
      return;
    }

    closeDialog(true);
    if (!el.video.paused) el.video.pause();
    state.dialogKind = kind;
    state.exportAbort = false;
    resetDialogUI();

    const isRecord = kind === "record";
    el.frameFields.hidden = isRecord;
    el.recordFields.hidden = !isRecord;

    const duration = Number.isFinite(el.video.duration) ? el.video.duration : 0;
    el.exportStart.max = formatSecondsInput(duration);
    el.exportEnd.max = formatSecondsInput(duration);
    el.exportStart.value = "0.0";
    el.exportEnd.value = formatSecondsInput(duration);
    el.exportFps.value = kind === "html" ? "12" : "10";
    el.recordQuality.value = "1080";
    el.recordAudio.checked = true;
    el.recordCurrentHint.textContent = `当前 ${formatTime(el.video.currentTime)}`;
    const currentStart = $$('input[name="recordStart"]').find((input) => input.value === "current");
    if (currentStart) currentStart.checked = true;

    const titles = {
      zip: ["导出全部帧文本", "FRAMES TO ZIP", "开始导出"],
      html: ["生成字符动画网页", "ANIMATED HTML", "生成网页"],
      record: ["录制字符画视频", "RECORD WEBM", "开始录制"],
    };
    const [title, kicker, startLabel] = titles[kind] || ["导出字符画", "EXPORT", "开始导出"];
    el.dialogTitle.textContent = title;
    el.dialogKicker.textContent = kicker;
    el.dialogStartText.textContent = startLabel;

    const notes = {
      zip: "每一帧会保存为带编号的 TXT 文件，并打包为一个 ZIP。文本不含颜色，保留字符密度与版式。",
      html: "全部字符帧会内嵌进一个 HTML 文件，可双击离线播放。网页输出为单色字符动画。",
      record: "录制会按当前画面设置实时进行，可包含视频原声。请保持页面处于前台，避免浏览器降频。",
    };
    let note = notes[kind] || "";
    if ((kind === "zip" || kind === "html") && state.settings.colorMode === "source") {
      note += " 当前使用画面原色模式，但文本与网页只能记录单色字符。";
    }
    el.dialogNote.textContent = note;
    el.dialogNote.hidden = !note;

    updateDialogSummary();
    el.dialog.showModal();
  }

  function getDialogRange() {
    const duration = Number.isFinite(el.video.duration) ? el.video.duration : 0;
    let start = Number.parseFloat(el.exportStart.value);
    let end = Number.parseFloat(el.exportEnd.value);
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = duration;
    start = clamp(start, 0, duration);
    end = clamp(end, 0, duration);
    if (end < start) end = start;
    return { start, end, duration, valid: end - start >= 0.025 };
  }

  function getRecordDimensions(quality, aspect = state.videoAspect || 16 / 9) {
    const shortSide = [720, 1080, 1440, 2160].includes(Number(quality)) ? Number(quality) : 1080;
    let width;
    let height;
    if (aspect >= 1) {
      height = shortSide;
      width = Math.round(height * aspect);
    } else {
      width = shortSide;
      height = Math.round(width / aspect);
    }
    width = Math.max(2, width - (width % 2));
    height = Math.max(2, height - (height % 2));
    return { width, height };
  }

  function updateDialogSummary() {
    if (!state.dialogKind) return;
    const summaryMain = $(".summary-main", el.exportSummary);
    const summarySub = $(".summary-sub", el.exportSummary);
    summaryMain.classList.remove("summary-warn");

    if (state.dialogKind === "record") {
      const fromBeginning = $('input[name="recordStart"]:checked')?.value === "beginning";
      const start = fromBeginning ? 0 : el.video.currentTime;
      const remaining = Math.max(0, el.video.duration - start);
      const quality = Number.parseInt(el.recordQuality.value, 10) || 1080;
      const dimensions = getRecordDimensions(quality);
      const audio = el.recordAudio.checked ? "含声音轨" : "无声音轨";
      summaryMain.textContent = `预计录制 ${formatTime(remaining)} · ${quality}p · ${dimensions.width} × ${dimensions.height}`;
      summarySub.textContent = `从 ${formatTime(start)} 开始 · ${audio} · 30 fps · ${state.grid.cols} × ${state.grid.rows} 字符${quality >= 2160 ? " · 4K 输出 WebM" : ""}`;
      if (remaining < 0.6) {
        summaryMain.textContent = "当前位置已接近视频结尾";
        summaryMain.classList.add("summary-warn");
      }
      el.dialogStart.disabled = remaining < 0.6;
      return;
    }

    const { start, end, valid } = getDialogRange();
    const fps = Number.parseInt(el.exportFps.value, 10) || 10;
    const seconds = Math.max(0, end - start);
    const frameCount = valid ? Math.floor(seconds * fps) + 1 : 0;
    const maxFrames = MAX_EXPORT_FRAMES[state.dialogKind] || 1800;
    const estimatedBytes = frameCount * ((state.grid.cols + 1) * state.grid.rows + 180) + (state.dialogKind === "html" ? 24000 : 0);

    if (!valid) {
      summaryMain.textContent = "时间范围无效";
      summaryMain.classList.add("summary-warn");
      summarySub.textContent = "结束时间需要大于开始时间";
      el.dialogStart.disabled = true;
      return;
    }

    summaryMain.textContent = `预计 ${frameCount} 帧 · 约 ${formatBytes(estimatedBytes)}`;
    summarySub.textContent = `${fps} fps · ${seconds.toFixed(1)} 秒 · ${state.grid.cols} × ${state.grid.rows} 字符 · ${state.dialogKind === "zip" ? "TXT 序列" : "单色动画"}`;

    if (frameCount > maxFrames) {
      summaryMain.textContent = `帧数过多 · ${frameCount} / 上限 ${maxFrames}`;
      summaryMain.classList.add("summary-warn");
      summarySub.textContent = "请缩短时间范围或降低帧率后再导出";
      el.dialogStart.disabled = true;
    } else {
      el.dialogStart.disabled = false;
    }
  }

  async function seekVideo(time) {
    if (!Number.isFinite(time)) time = 0;
    const duration = Number.isFinite(el.video.duration) ? el.video.duration : 0;
    const target = clamp(time, 0, Math.max(0, duration - 0.02));
    if (Math.abs(el.video.currentTime - target) < 0.008) return;

    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        el.video.removeEventListener("seeked", onSeeked);
        el.video.removeEventListener("error", onError);
        window.clearTimeout(timeout);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("视频定位失败"));
      };
      const onSeeked = () => finish();
      const onError = () => fail();
      const timeout = window.setTimeout(finish, 5000);
      el.video.addEventListener("seeked", onSeeked);
      el.video.addEventListener("error", onError);
      try {
        el.video.currentTime = target;
      } catch (_) {
        fail();
      }
    });
    await waitPaint();
  }

  async function waitForVideoFrame() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function runFrameExport(kind) {
    if (!ensureReady()) return;
    const range = getDialogRange();
    const fps = Number.parseInt(el.exportFps.value, 10) || 10;
    const frameCount = Math.floor(Math.max(0, range.end - range.start) * fps) + 1;
    const maxFrames = MAX_EXPORT_FRAMES[kind] || 1800;
    if (!range.valid || frameCount < 1) {
      showToast("请设置有效的时间范围和帧率", "error");
      return;
    }
    if (frameCount > maxFrames) {
      showToast(`帧数超过上限（${maxFrames} 帧），请缩短范围或降低帧率`, "error");
      return;
    }

    const wasPlaying = !el.video.paused && !el.video.ended;
    const oldTime = el.video.currentTime;
    const oldLoop = el.video.loop;
    el.video.pause();
    el.video.loop = false;
    state.exporting = true;
    state.exportAbort = false;
    setDialogBusy(true);
    setProgress(0, "正在读取视频…", `准备生成 ${frameCount} 帧`);

    try {
      const frames = [];
      const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

      for (let index = 0; index < frameCount; index += 1) {
        if (state.exportAbort) throw new DOMException("Export cancelled", "AbortError");
        const time = range.start + index / fps;
        if (time > range.end + 0.001) break;
        await seekVideo(time);
        await waitForVideoFrame();
        const data = sampleGrid(state.grid.cols, state.grid.rows);
        if (!data) throw new Error("无法读取视频帧");
        const text = buildTextFromData(data, state.grid.cols, state.grid.rows);
        frames.push(text);

        if (index % 2 === 0 || index === frameCount - 1) {
          const percent = Math.round(((index + 1) / frameCount) * 86);
          setProgress(percent, `正在生成第 ${index + 1} / ${frameCount} 帧`, `${formatTime(time)} / ${formatTime(range.end)}`);
          await delay(0);
        }
      }

      if (state.exportAbort) throw new DOMException("Export cancelled", "AbortError");
      if (!frames.length) throw new Error("没有生成任何帧");

      const base = safeBaseName(state.currentName);
      if (kind === "zip") {
        setProgress(90, "正在打包 ZIP…", `共 ${frames.length} 个 TXT 帧`);
        await delay(30);
        const encoder = new TextEncoder();
        const files = [];
        for (let index = 0; index < frames.length; index += 1) {
          files.push({
            name: `frames/frame_${padNumber(index + 1, 5)}.txt`,
            data: encoder.encode(frames[index]),
          });
        }
        const readme = [
          "字符映画 · 连续字符画帧序列",
          "================================",
          `源视频：${state.currentName}`,
          `字符网格：${state.grid.cols} × ${state.grid.rows}`,
          `帧率：${fps} fps`,
          `时间范围：${formatSecondsInput(range.start)}s - ${formatSecondsInput(range.end)}s`,
          `字符集：${CHARSET_LABELS[state.settings.charset] || state.settings.charset}`,
          `总帧数：${frames.length}`,
          "",
          "每帧对应一个 TXT 文件，按 frame_00001.txt 顺序编号。",
          "文本为 UTF-8 编码，不含颜色信息。",
          "",
          `生成时间：${new Date().toLocaleString("zh-CN")}`,
        ].join("\r\n");
        files.unshift({ name: "README.txt", data: encoder.encode(readme) });

        if (state.exportAbort) throw new DOMException("Export cancelled", "AbortError");
        const zip = createZip(files);
        setProgress(100, "导出完成", `${frames.length} 帧 · ${formatBytes(zip.size)}`);
        await delay(260);
        downloadBlob(zip, `${base}_字符画帧序列_${fps}fps_${timestamp()}.zip`);
        closeDialog(true);
        showToast(`ZIP 已导出 · ${frames.length} 帧 · ${formatBytes(zip.size)}`);
      } else {
        setProgress(91, "正在生成动画网页…", `嵌入 ${frames.length} 帧字符数据`);
        await delay(30);
        const html = buildAnimationHTML(frames, {
          title: `${base} · 字符动画`,
          cols: state.grid.cols,
          rows: state.grid.rows,
          fps,
          aspect: state.videoAspect || 16 / 9,
          fg: state.settings.fg,
          bg: state.settings.bg,
          fontCss: FONTS[state.settings.font]?.css || FONTS.mono.css,
          source: state.currentName,
        });
        if (state.exportAbort) throw new DOMException("Export cancelled", "AbortError");
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        setProgress(100, "导出完成", `${frames.length} 帧 · ${formatBytes(blob.size)}`);
        await delay(260);
        downloadBlob(blob, `${base}_字符动画_${fps}fps_${timestamp()}.html`);
        closeDialog(true);
        showToast(`HTML 动画已导出 · ${frames.length} 帧 · ${formatBytes(blob.size)}`);
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        closeDialog(true);
        showToast("已取消导出");
      } else {
        console.error(error);
        closeDialog(true);
        showToast(`导出失败：${error.message || "未知错误"}`, "error");
      }
    } finally {
      state.exporting = false;
      state.exportAbort = false;
      el.video.loop = oldLoop;
      try {
        await seekVideo(oldTime);
      } catch (_) {
        /* The video may have been replaced. */
      }
      state.needsRender = true;
      if (!wasPlaying) el.video.pause();
      setControlsEnabled(state.hasVideo);
    }
  }

  function handleDialogStart() {
    if (!state.dialogKind || state.dialogBusy) return;
    if (state.dialogKind === "record") {
      startRecordingFromDialog();
    } else {
      runFrameExport(state.dialogKind);
    }
  }

  /* ============================================================
     ZIP writer (store-only, no external dependencies)
     ============================================================ */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    };
  }

  function createZip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const centralParts = [];
    let offset = 0;
    const stamp = dosDateTime(new Date());

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      parts.push(local, data);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...parts, ...centralParts, end], { type: "application/zip" });
  }

  /* ============================================================
     Self-contained animation HTML
     ============================================================ */

  function buildAnimationHTML(frames, meta) {
    const framesJson = JSON.stringify(frames)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    const title = escapeHtml(meta.title);
    const source = escapeHtml(meta.source);
    const generated = escapeHtml(new Date().toLocaleString("zh-CN"));
    const fontJson = JSON.stringify(meta.fontCss);
    const fgJson = JSON.stringify(meta.fg);
    const bgJson = JSON.stringify(meta.bg);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#050705">
<title>${title}</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050705;color:#eef2e8;font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  body{background:radial-gradient(ellipse 60% 50% at 50% 0%,rgba(201,247,111,.05),transparent 65%),#050705}
  #stage{position:fixed;inset:0 0 62px;display:flex;align-items:center;justify-content:center;padding:20px;cursor:pointer}
  #screen{display:block;border:1px solid rgba(232,245,222,.12);border-radius:8px;background:#050705;box-shadow:0 34px 90px rgba(0,0,0,.55)}
  #hud{position:fixed;left:50%;bottom:13px;display:flex;width:min(740px,calc(100vw - 24px));height:44px;align-items:center;gap:9px;padding:0 10px;border:1px solid rgba(232,245,222,.13);border-radius:12px;background:rgba(16,20,15,.92);box-shadow:0 14px 40px rgba(0,0,0,.42);transform:translateX(-50%);backdrop-filter:blur(12px)}
  #play{display:flex;width:29px;height:29px;flex:none;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:#c9f76f;color:#0a0c0a;font-size:11px;cursor:pointer}
  #timeline{flex:1;min-width:50px;height:20px;accent-color:#c9f76f;cursor:pointer}
  #time{min-width:78px;color:#aeb7a7;font-family:Consolas,"Courier New",monospace;font-size:9.5px;font-variant-numeric:tabular-nums;text-align:center}
  #loop{height:26px;padding:0 8px;border:1px solid rgba(232,245,222,.12);border-radius:7px;background:transparent;color:#8b9585;font-size:9px;cursor:pointer}
  #loop.on{border-color:rgba(201,247,111,.35);background:rgba(201,247,111,.1);color:#c9f76f}
  #badge{position:fixed;top:14px;left:16px;color:rgba(201,247,111,.55);font-family:Consolas,"Courier New",monospace;font-size:8px;letter-spacing:.12em;pointer-events:none}
  #credit{position:fixed;right:16px;bottom:2px;color:rgba(137,147,132,.4);font-size:8px;letter-spacing:.06em;pointer-events:none}
  @media(max-width:520px){#stage{padding:8px;bottom:56px}#hud{bottom:9px;height:40px}#time{min-width:64px;font-size:8px}#badge{font-size:7px}#credit{display:none}}
</style>
</head>
<body>
<div id="stage"><canvas id="screen" aria-label="字符动画"></canvas></div>
<div id="badge">ASCII FILM · ${meta.fps} FPS · ${meta.cols} × ${meta.rows}</div>
<div id="hud">
  <button id="play" type="button" aria-label="播放或暂停">❚❚</button>
  <input id="timeline" type="range" min="0" max="${Math.max(0, frames.length - 1)}" value="0" step="1" aria-label="动画进度">
  <span id="time">0:00 / 0:00</span>
  <button id="loop" class="on" type="button" aria-pressed="true">循环</button>
</div>
<div id="credit">字符映画 · ${source}</div>
<script>
(function () {
  "use strict";
  var rawFrames = ${framesJson};
  var gridFrames = rawFrames.map(function (frame) {
    return frame.split("\\n").map(function (line) { return Array.from(line); });
  });
  var cols = ${meta.cols};
  var rows = ${meta.rows};
  var fps = ${meta.fps};
  var aspect = ${Number(meta.aspect) || 16 / 9};
  var fg = ${fgJson};
  var bg = ${bgJson};
  var fontCss = ${fontJson};
  var canvas = document.getElementById("screen");
  var stage = document.getElementById("stage");
  var ctx = canvas.getContext("2d", { alpha: false });
  var playBtn = document.getElementById("play");
  var timeline = document.getElementById("timeline");
  var timeLabel = document.getElementById("time");
  var loopBtn = document.getElementById("loop");
  var index = 0;
  var playing = gridFrames.length > 1;
  var loop = true;
  var dirty = true;
  var last = performance.now();
  var acc = 0;

  function fmt(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var total = Math.floor(seconds);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function fit() {
    var availW = stage.clientWidth;
    var availH = stage.clientHeight;
    var w = availW;
    var h = w / aspect;
    if (h > availH) { h = availH; w = h * aspect; }
    w = Math.max(40, Math.floor(w));
    h = Math.max(30, Math.floor(h));
    var dpr = Math.min(window.devicePixelRatio || 1, 2, 2600 / w);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.max(2, Math.round(w * dpr));
    canvas.height = Math.max(2, Math.round(h * dpr));
    dirty = true;
  }

  function draw() {
    var w = canvas.width;
    var h = canvas.height;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    var cellW = w / cols;
    var cellH = h / rows;
    ctx.fillStyle = fg;
    ctx.font = (cellH * 0.96) + "px " + fontCss;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var frame = gridFrames[index] || [];
    for (var y = 0; y < rows; y++) {
      var line = frame[y];
      if (!line) continue;
      var py = y * cellH + cellH / 2;
      for (var x = 0; x < cols; x++) {
        var ch = line[x];
        if (!ch || ch === " " || ch === "\\u3000") continue;
        ctx.fillText(ch, x * cellW + cellW / 2, py);
      }
    }
  }

  function updateUI() {
    playBtn.textContent = playing ? "❚❚" : "▶";
    playBtn.setAttribute("aria-label", playing ? "暂停" : "播放");
    timeline.value = String(index);
    timeLabel.textContent = fmt(index / fps) + " / " + fmt(gridFrames.length / fps);
    loopBtn.classList.toggle("on", loop);
    loopBtn.setAttribute("aria-pressed", String(loop));
  }

  function toggle() {
    if (gridFrames.length < 2) return;
    if (!playing && index >= gridFrames.length - 1) {
      index = 0;
      dirty = true;
    }
    playing = !playing;
    last = performance.now();
    acc = 0;
    updateUI();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (playing && gridFrames.length > 1) {
      var delta = now - last;
      last = now;
      if (delta > 250) delta = 250;
      acc += delta;
      var frameDuration = 1000 / fps;
      if (acc >= frameDuration) {
        var steps = Math.floor(acc / frameDuration);
        acc -= steps * frameDuration;
        index += steps;
        if (index >= gridFrames.length) {
          if (loop) {
            index = index % gridFrames.length;
          } else {
            index = gridFrames.length - 1;
            playing = false;
          }
        }
        dirty = true;
      }
    } else {
      last = now;
    }
    if (dirty) {
      draw();
      updateUI();
      dirty = false;
    }
  }

  playBtn.addEventListener("click", toggle);
  stage.addEventListener("click", toggle);
  timeline.addEventListener("input", function () {
    playing = false;
    index = Math.max(0, Math.min(gridFrames.length - 1, parseInt(timeline.value, 10) || 0));
    dirty = true;
    updateUI();
  });
  loopBtn.addEventListener("click", function () {
    loop = !loop;
    updateUI();
  });
  window.addEventListener("resize", fit);
  document.addEventListener("keydown", function (event) {
    if (event.code === "Space") {
      event.preventDefault();
      toggle();
    }
  });
  document.addEventListener("visibilitychange", function () {
    last = performance.now();
    acc = 0;
  });

  fit();
  updateUI();
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
  }

  /* ============================================================
     Recording
     ============================================================ */

  function chooseRecorderMime(quality = 1080) {
    if (typeof MediaRecorder === "undefined") return "";
    const webm = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const mp4 = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
    ];
    // H.264 MP4 is the best choice for 1080p/1440p. For 4K, VP9 WebM
    // starts encoding more reliably in browsers and has broad support.
    const candidates = quality >= 2160 ? [...webm, ...mp4] : [...mp4, ...webm];
    for (const type of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(type)) return type;
      } catch (_) {
        /* Continue. */
      }
    }
    return "";
  }

  function renderRecordFrame() {
    if (!state.recordCtx || !state.hasVideo) return;
    const data = sampleGrid(state.grid.cols, state.grid.rows);
    if (!data) return;
    drawAsciiFrame(state.recordCtx, state.recordCanvas.width, state.recordCanvas.height, state.grid.cols, state.grid.rows, data);
  }

  function updateRecordHud() {
    if (!state.recording) return;
    const elapsed = (performance.now() - state.recordStart) / 1000;
    el.recordTime.textContent = formatTime(elapsed);
  }

  async function startRecordingFromDialog() {
    if (!state.hasVideo) return;
    const fromBeginning = $('input[name="recordStart"]:checked')?.value === "beginning";
    const quality = Number.parseInt(el.recordQuality.value, 10) || 1080;
    const includeAudio = el.recordAudio.checked;
    const startAt = fromBeginning ? 0 : el.video.currentTime;
    const remaining = Number.isFinite(el.video.duration) ? el.video.duration - startAt : 0;

    if (remaining < 0.6) {
      showToast("开始位置过于接近视频结尾", "error");
      return;
    }
    if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
      showToast("当前浏览器不支持网页录制，请使用最新版 Edge 或 Chrome", "error");
      return;
    }

    closeDialog(true);
    await startRecording({ startAt, quality, includeAudio });
  }

  async function startRecording({ startAt, quality, includeAudio }) {
    if (state.recording) return;
    const mime = chooseRecorderMime(quality);
    if (!mime) {
      showToast("当前浏览器不支持 WebM 录制", "error");
      return;
    }

    let audioIncluded = false;
    if (includeAudio) {
      audioIncluded = await ensureAudioGraph();
      if (!audioIncluded) showToast("原声不可用，将只录制字符画面", "error");
    }

    try {
      el.video.pause();
      await seekVideo(startAt);
      await waitForVideoFrame();

      const { width, height } = getRecordDimensions(quality);

      const recordCanvas = document.createElement("canvas");
      recordCanvas.width = width;
      recordCanvas.height = height;
      const recordCtx = recordCanvas.getContext("2d", { alpha: false });
      recordCtx.imageSmoothingEnabled = true;
      state.recordCanvas = recordCanvas;
      state.recordCtx = recordCtx;
      renderRecordFrame();

      const stream = recordCanvas.captureStream(30);
      if (audioIncluded && state.audioDest && state.audioDest.stream.getAudioTracks().length) {
        stream.addTrack(state.audioDest.stream.getAudioTracks()[0]);
      }

      const videoBitrate = quality >= 2160 ? 24000000 : quality >= 1440 ? 18000000 : quality >= 1080 ? 10000000 : 5000000;
      const options = {
        mimeType: mime,
        videoBitsPerSecond: videoBitrate,
      };
      if (audioIncluded) options.audioBitsPerSecond = 128000;

      const recorder = new MediaRecorder(stream, options);
      state.recordRecorder = recorder;
      state.recordStream = stream;
      state.recordChunks = [];
      state.recordMime = mime;
      state.recordTotal = Math.max(0, el.video.duration - startAt);
      state.recordStart = performance.now();
      state.recording = true;
      state.lastRecordAt = 0;
      syncPlayState();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) state.recordChunks.push(event.data);
      };
      recorder.onerror = (event) => {
        console.error("MediaRecorder error:", event.error || event);
        showToast("录制发生错误，已停止", "error");
        stopRecording(true);
      };
      recorder.onstop = finalizeRecording;

      el.video.loop = false;
      el.recordHud.hidden = false;
      el.recordTime.textContent = "0:00";
      el.exportBtn.disabled = true;
      el.recordTimer = window.setInterval(updateRecordHud, 250);

      state.recordEndedHandler = () => {
        window.setTimeout(() => {
          if (state.recording) stopRecording(false);
        }, 320);
      };
      el.video.addEventListener("ended", state.recordEndedHandler, { once: true });

      recorder.start(250);
      await el.video.play();
      updateRecordHud();
      showToast(`开始录制 · ${width} × ${height} · ${audioIncluded ? "含声音轨" : "无声音轨"}`);
    } catch (error) {
      console.error(error);
      try {
        if (state.recordRecorder) state.recordRecorder.onstop = null;
        if (state.recordRecorder && state.recordRecorder.state !== "inactive") state.recordRecorder.stop();
      } catch (_) {
        /* Ignore cleanup failure. */
      }
      state.recordChunks = [];
      cleanupRecordingState();
      el.recordHud.hidden = true;
      el.exportBtn.disabled = !state.ready;
      showToast(`无法开始录制：${error.message || "浏览器不支持"}`, "error");
    }
  }

  function stopRecording(manual = true) {
    if (!state.recording) return;
    state.recording = false;
    window.clearInterval(state.recordTimer);
    state.recordTimer = 0;
    el.recordHud.hidden = true;
    el.exportBtn.disabled = true;
    syncPlayState();
    if (manual && !el.video.paused) el.video.pause();
    if (state.recordEndedHandler) {
      el.video.removeEventListener("ended", state.recordEndedHandler);
      state.recordEndedHandler = null;
    }
    try {
      if (state.recordRecorder && state.recordRecorder.state !== "inactive") {
        state.recordRecorder.stop();
      } else {
        finalizeRecording();
      }
    } catch (error) {
      console.warn(error);
      finalizeRecording();
    }
  }

  function finalizeRecording() {
    const chunks = state.recordChunks.slice();
    const mime = state.recordMime || "video/webm";
    const base = safeBaseName(state.currentName);
    cleanupRecordingState();

    if (!chunks.length) {
      showToast("录制未产生有效数据，请重试", "error");
      el.exportBtn.disabled = !state.ready;
      return;
    }

    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    const isMp4 = mime.startsWith("video/mp4");
    const extension = isMp4 ? "mp4" : "webm";
    downloadBlob(blob, `${base}_字符画录制_${timestamp()}.${extension}`);
    showToast(`录制完成 · ${formatBytes(blob.size)} · ${isMp4 ? "MP4" : "WebM"} 已下载`);
    el.exportBtn.disabled = !state.ready;
    state.needsRender = true;
  }

  function cleanupRecordingState() {
    window.clearInterval(state.recordTimer);
    state.recordTimer = 0;
    state.recording = false;
    if (state.recordStream) {
      state.recordStream.getVideoTracks().forEach((track) => {
        try { track.stop(); } catch (_) { /* Ignore. */ }
      });
    }
    state.recordStream = null;
    state.recordRecorder = null;
    state.recordChunks = [];
    state.recordCanvas = null;
    state.recordCtx = null;
    if (state.recordEndedHandler) {
      el.video.removeEventListener("ended", state.recordEndedHandler);
      state.recordEndedHandler = null;
    }
    el.video.loop = state.loop;
    el.recordHud.hidden = true;
    el.exportBtn.disabled = !state.ready || state.recording;
    syncPlayState();
  }

  /* ============================================================
     Event binding
     ============================================================ */

  function bindEvents() {
    [el.openBtn, el.emptyOpen].forEach((button) => button.addEventListener("click", openFilePicker));
    [el.demoBtn, el.emptyDemo].forEach((button) => button.addEventListener("click", loadDemo));
    el.fileInput.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      loadFile(file);
    });

    el.resetBtn.addEventListener("click", resetSettings);
    $$(".preset").forEach((button) => {
      button.addEventListener("click", () => applyPreset(button.dataset.preset));
    });

    el.density.addEventListener("input", () => {
      commitSettings({ cols: Number(el.density.value) });
    });

    el.charset.addEventListener("change", () => {
      commitSettings({ charset: el.charset.value });
      if (el.charset.value === "custom") {
        el.customChars.hidden = false;
        el.customChars.focus();
      }
    });
    el.customChars.addEventListener("input", () => {
      const value = el.customChars.value.replace(/[\r\n\t]/g, "").slice(0, 80);
      commitSettings({ customChars: value });
    });

    $$("#colorMode button").forEach((button) => {
      button.addEventListener("click", () => commitSettings({ colorMode: button.dataset.value }));
    });
    el.fgColor.addEventListener("input", () => commitSettings({ fg: el.fgColor.value }));
    el.bgColor.addEventListener("input", () => commitSettings({ bg: el.bgColor.value }));

    el.brightness.addEventListener("input", () => commitSettings({ brightness: Number(el.brightness.value) }));
    el.contrast.addEventListener("input", () => commitSettings({ contrast: Number(el.contrast.value) }));
    el.font.addEventListener("change", () => commitSettings({ font: el.font.value }));
    el.invert.addEventListener("change", () => commitSettings({ invert: el.invert.checked }));
    el.scanline.addEventListener("change", () => commitSettings({ scanline: el.scanline.checked }));
    el.outputRes.addEventListener("change", () => {
      const value = Number(el.outputRes.value) || 2560;
      commitSettings({ outputRes: value });
      const label = el.outputRes.selectedOptions[0]?.textContent || `${value}px`;
      showToast(`截图分辨率：${label}`);
    });

    el.playBtn.addEventListener("click", togglePlay);
    el.seek.addEventListener("pointerdown", () => { state.scrubbing = true; });
    el.seek.addEventListener("input", () => {
      if (!state.hasVideo) return;
      state.scrubbing = true;
      const time = Number(el.seek.value);
      el.currentTime.textContent = formatTime(time);
      const duration = Number.isFinite(el.video.duration) ? el.video.duration : 0;
      el.playedBar.style.width = `${duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0}%`;
      try { el.video.currentTime = time; } catch (_) { /* Ignore. */ }
      state.needsRender = true;
    });
    const endScrub = () => {
      state.scrubbing = false;
      updateTimeline();
    };
    el.seek.addEventListener("change", endScrub);
    el.seek.addEventListener("pointerup", endScrub);
    el.seek.addEventListener("pointercancel", endScrub);

    el.muteBtn.addEventListener("click", () => {
      state.muted = !state.muted;
      updatePrefsUI();
      savePrefsSoon();
    });
    el.volume.addEventListener("input", () => {
      state.volume = clamp(Number(el.volume.value), 0, 1);
      if (state.volume > 0) state.muted = false;
      updatePrefsUI();
      savePrefsSoon();
    });
    el.speed.addEventListener("change", () => {
      state.speed = Number(el.speed.value) || 1;
      el.video.playbackRate = state.speed;
      savePrefsSoon();
    });
    el.loopBtn.addEventListener("click", toggleLoop);
    el.fullscreenBtn.addEventListener("click", toggleFullscreen);
    el.copyBtn.addEventListener("click", copyFrame);

    el.exportBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setExportMenu(el.exportMenu.hidden);
    });
    el.exportMenu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-export]");
      if (!button) return;
      const kind = button.dataset.export;
      setExportMenu(false);
      if (kind === "png") exportPNG();
      else if (kind === "txt") exportTXT();
      else openExportDialog(kind);
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".export-wrap")) setExportMenu(false);
    });

    el.dialogStart.addEventListener("click", handleDialogStart);
    el.dialogCancel.addEventListener("click", () => {
      if (state.dialogBusy) requestCancelExport();
      else closeDialog();
    });
    el.dialogClose.addEventListener("click", () => {
      if (state.dialogBusy) requestCancelExport();
      else closeDialog();
    });
    el.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (state.dialogBusy) requestCancelExport();
      else closeDialog();
    });
    el.dialog.addEventListener("click", (event) => {
      if (event.target === el.dialog && !state.dialogBusy) closeDialog();
    });

    el.exportStart.addEventListener("input", updateDialogSummary);
    el.exportEnd.addEventListener("input", updateDialogSummary);
    el.exportFps.addEventListener("change", updateDialogSummary);
    $$('input[name="recordStart"]').forEach((input) => input.addEventListener("change", updateDialogSummary));
    el.recordQuality.addEventListener("change", updateDialogSummary);
    el.recordAudio.addEventListener("change", updateDialogSummary);

    el.video.addEventListener("play", () => {
      el.loadingState.hidden = true;
      state.loading = false;
      syncPlayState();
    });
    el.video.addEventListener("pause", () => {
      state.needsRender = true;
      syncPlayState();
    });
    el.video.addEventListener("playing", () => {
      el.loadingState.hidden = true;
      state.loading = false;
      syncPlayState();
    });
    el.video.addEventListener("waiting", syncPlayState);
    el.video.addEventListener("ended", () => {
      state.needsRender = true;
      syncPlayState();
    });
    el.video.addEventListener("timeupdate", updateTimeline);
    el.video.addEventListener("durationchange", updateTimeline);
    el.video.addEventListener("progress", updateTimeline);
    el.video.addEventListener("seeked", () => {
      state.needsRender = true;
      updateTimeline();
    });
    el.video.addEventListener("loadeddata", () => {
      el.loadingState.hidden = true;
      state.needsRender = true;
    });
    el.video.addEventListener("canplay", () => {
      el.loadingState.hidden = true;
      state.needsRender = true;
    });

    el.peekBtn.addEventListener("pointerdown", startPeek);
    el.peekBtn.addEventListener("pointerup", stopPeek);
    el.peekBtn.addEventListener("pointercancel", stopPeek);
    el.peekBtn.addEventListener("pointerleave", stopPeek);
    el.peekBtn.addEventListener("blur", stopPeek);

    el.stopRecordBtn.addEventListener("click", () => stopRecording(true));

    el.stageFrame.addEventListener("dblclick", (event) => {
      if (!state.hasVideo) return;
      if (event.target.closest("button")) return;
      toggleFullscreen();
    });

    document.addEventListener("fullscreenchange", () => {
      window.setTimeout(layoutCanvas, 80);
    });

    let dragDepth = 0;
    const isFileDrag = (event) => {
      const types = event.dataTransfer && event.dataTransfer.types;
      return types && Array.from(types).includes("Files");
    };
    window.addEventListener("dragenter", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth += 1;
      document.body.classList.add("is-dragging");
    });
    window.addEventListener("dragover", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", (event) => {
      if (!isFileDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) document.body.classList.remove("is-dragging");
    });
    window.addEventListener("drop", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth = 0;
      document.body.classList.remove("is-dragging");
      if (state.recording) {
        showToast("请先停止录制，再导入新视频", "error");
        return;
      }
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      loadFile(file);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setExportMenu(false);
        return;
      }
      if (el.dialog.open) return;
      if (event.ctrlKey || event.metaKey || event.altKey) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
          event.preventDefault();
          openFilePicker();
        }
        return;
      }

      const tag = (event.target && event.target.tagName) || "";
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(tag) || event.target.isContentEditable) return;

      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (state.hasVideo) el.video.currentTime = Math.max(0, el.video.currentTime - 5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (state.hasVideo) el.video.currentTime = Math.min(el.video.duration || 0, el.video.currentTime + 5);
      } else if (event.key.toLowerCase() === "f") {
        toggleFullscreen();
      } else if (event.key.toLowerCase() === "m") {
        if (state.ready) {
          state.muted = !state.muted;
          updatePrefsUI();
          savePrefsSoon();
        }
      } else if (event.key.toLowerCase() === "l") {
        if (!state.recording) toggleLoop();
      } else if (event.key.toLowerCase() === "o") {
        openFilePicker();
      } else if (event.key.toLowerCase() === "s" && event.shiftKey) {
        event.preventDefault();
        exportPNG();
      }
    });

    const resize = debounce(layoutCanvas, 80);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(resize);
      observer.observe(el.stageArea);
    } else {
      window.addEventListener("resize", resize);
    }
    window.addEventListener("resize", resize);
  }

  /* ============================================================
     Boot
     ============================================================ */

  function init() {
    cacheDom();
    loadPersisted();
    bindEvents();
    syncControls();
    updatePrefsUI();
    refreshGeometry();
    setControlsEnabled(false);
    updateTimeline();
    syncPlayState();
    updateDialogSummary();

    if (IS_FILE_PROTOCOL) {
      const note = $(".format-note");
      if (note) note.textContent = "提示：双击「启动字符画工坊.bat」可体验示例与完整功能";
    }

    requestAnimationFrame(() => {
      layoutCanvas();
      setExportMenu(false);
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        aspectKey = "";
        refreshGeometry();
        layoutCanvas();
      });
    }

    requestAnimationFrame(tick);

    window.addEventListener("beforeunload", () => {
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      if (state.recording) {
        try { state.recordRecorder?.stop(); } catch (_) { /* Ignore. */ }
      }
    });
  }

  /* A tiny read-only hook for local diagnostics. */
  window.__CHARACTER_STUDIO__ = {
    getState: () => ({
      hasVideo: state.hasVideo,
      ready: state.ready,
      grid: { ...state.grid },
      settings: { ...state.settings },
      recording: state.recording,
      exporting: state.exporting,
      audioReady: state.audioReady,
      video: {
        width: state.videoWidth,
        height: state.videoHeight,
        duration: el.video?.duration || 0,
        currentTime: el.video?.currentTime || 0,
        paused: el.video?.paused ?? true,
      },
    }),
    openDemo: loadDemo,
  };

  init();
})();
