import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from "./vendor/mp4-muxer.mjs";

let muxer = null;
let target = null;
let writable = null;
let fileHandle = null;
let streaming = false;
let videoEncoder = null;
let audioEncoder = null;
let hasAudio = false;
let sampleRate = 48000;
let channels = 2;
let videoChunks = 0;
let audioChunks = 0;
let finalized = false;

function post(type, payload = {}, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

function fail(message) {
  post("error", { message });
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === "init") await init(message);
    else if (message.type === "video") await encodeVideo(message);
    else if (message.type === "audio") encodeAudio(message);
    else if (message.type === "finish") await finish();
    else if (message.type === "cancel") cleanup();
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
    cleanup();
  }
};

async function init(message) {
  const width = message.width;
  const height = message.height;
  const fps = message.fps;
  const bitrate = message.bitrate;
  const codec = message.codec;
  hasAudio = Boolean(message.hasAudio);
  sampleRate = message.sampleRate || 48000;
  channels = message.channels || 2;
  videoChunks = 0;
  audioChunks = 0;
  finalized = false;
  streaming = Boolean(message.fileHandle);
  fileHandle = message.fileHandle || null;

  const videoConfig = {
    codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: "quality",
    avc: { format: "avc" },
  };
  const candidates = [
    { ...videoConfig, hardwareAcceleration: "prefer-hardware" },
    { ...videoConfig, hardwareAcceleration: "no-preference" },
    { ...videoConfig, hardwareAcceleration: "prefer-software" },
  ];
  let chosenConfig = null;
  let videoSupport = null;
  let lastSupportError = null;
  for (const config of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        chosenConfig = { ...config, ...(support.config || {}) };
        videoSupport = support;
        break;
      }
    } catch (error) {
      lastSupportError = error;
    }
  }
  if (!chosenConfig) {
    throw new Error(
      `当前浏览器不支持 ${width}×${height} 的 H.264 编码` +
      (lastSupportError ? `（${lastSupportError.message || lastSupportError}）` : ""),
    );
  }

  if (streaming) {
    writable = await fileHandle.createWritable();
    target = new FileSystemWritableFileStreamTarget(writable, { chunkSize: 8 * 1024 * 1024 });
  } else {
    target = new ArrayBufferTarget();
  }

  const fastStart = streaming
    ? {
        expectedVideoChunks: message.expectedVideoChunks || message.totalFrames || 1,
        ...(hasAudio ? { expectedAudioChunks: message.expectedAudioChunks || 100000 } : {}),
      }
    : "in-memory";

  muxer = new Muxer({
    target,
    video: { codec: "avc", width, height, frameRate: fps },
    audio: hasAudio ? { codec: "aac", numberOfChannels: channels, sampleRate } : undefined,
    fastStart,
    firstTimestampBehavior: "strict",
  });

  videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        videoChunks += 1;
        muxer.addVideoChunk(chunk, meta);
      } catch (error) {
        fail("写入视频轨道失败：" + (error.message || error));
      }
    },
    error: (error) => fail("视频编码失败：" + (error.message || error)),
  });
  videoEncoder.configure(chosenConfig);

  if (hasAudio) {
    const audioConfig = {
      codec: "mp4a.40.2",
      sampleRate,
      numberOfChannels: channels,
      bitrate: 128000,
    };
    const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
    if (!audioSupport.supported) {
      throw new Error("当前浏览器不支持 AAC 音频编码");
    }
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        try {
          audioChunks += 1;
          muxer.addAudioChunk(chunk, meta);
        } catch (error) {
          fail("写入音频轨道失败：" + (error.message || error));
        }
      },
      error: (error) => fail("音频编码失败：" + (error.message || error)),
    });
    audioEncoder.configure(audioConfig);
  }

  post("ready", {
    hasAudio,
    width,
    height,
    fps,
    hardwareAcceleration: chosenConfig.hardwareAcceleration || "no-preference",
    encoderConfig: videoSupport?.config || chosenConfig,
  });
}

async function encodeVideo(message) {
  if (!videoEncoder) throw new Error("视频编码器尚未初始化");
  const frame = message.frame;
  if (!frame) throw new Error("收到空的视频帧");
  videoEncoder.encode(frame, { keyFrame: Boolean(message.keyFrame) });
  frame.close();

  // Avoid unbounded encoder queues when the source decoding is faster than encoding.
  while (videoEncoder.encodeQueueSize > 8) {
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  post("frameAck", { index: message.index, queue: videoEncoder.encodeQueueSize });
}

function encodeAudio(message) {
  if (!audioEncoder) return;
  const audioData = new AudioData({
    format: "f32-planar",
    sampleRate,
    numberOfFrames: message.frames,
    numberOfChannels: channels,
    timestamp: message.timestamp,
    data: message.data,
  });
  audioEncoder.encode(audioData);
  audioData.close();
}

async function finish() {
  if (finalized) return;
  finalized = true;
  if (videoEncoder) {
    await videoEncoder.flush();
    videoEncoder.close();
    videoEncoder = null;
  }
  if (audioEncoder) {
    await audioEncoder.flush();
    audioEncoder.close();
    audioEncoder = null;
  }
  if (!videoChunks) throw new Error("没有生成任何视频帧");
  muxer.finalize();
  muxer = null;

  if (streaming) {
    await writable.close();
    writable = null;
    const file = await fileHandle.getFile();
    post("done", {
      streaming: true,
      size: file.size,
      videoChunks,
      audioChunks,
    });
  } else {
    const buffer = target.buffer;
    post("done", {
      streaming: false,
      buffer,
      size: buffer.byteLength,
      videoChunks,
      audioChunks,
    }, [buffer]);
    target = null;
  }
  fileHandle = null;
}

function cleanup() {
  try { if (videoEncoder && videoEncoder.state !== "closed") videoEncoder.close(); } catch (_) {}
  try { if (audioEncoder && audioEncoder.state !== "closed") audioEncoder.close(); } catch (_) {}
  try { if (writable) writable.abort(); } catch (_) {}
  videoEncoder = null;
  audioEncoder = null;
  muxer = null;
  target = null;
  writable = null;
  fileHandle = null;
  streaming = false;
}
