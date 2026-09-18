import { countRaisedFingers, poseConfidence, qualifyingCount, type Point } from "./count-fingers";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL = "/models/hand_landmarker.task";

type HandLandmarkerHandle = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => { landmarks: Point[][] };
  close?: () => void;
};

export type TrackerResult = {
  landmarks: Point[] | null;
  localCount: number;
  qualify: 1 | 2 | null;
  confidence: number;
};

export async function createHandTracker(): Promise<{
  detect: (video: HTMLVideoElement, timestamp: number) => TrackerResult;
  close: () => void;
}> {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);

  async function make(delegate: "GPU" | "CPU") {
    return vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.35,
      minHandPresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
    });
  }

  let landmarker: HandLandmarkerHandle;
  try {
    landmarker = await make("GPU");
  } catch {
    landmarker = await make("CPU");
  }

  return {
    detect(video, timestamp) {
      const res = landmarker.detectForVideo(video, timestamp);
      const landmarks = res.landmarks[0] ?? null;
      if (!landmarks) {
        return { landmarks: null, localCount: 0, qualify: null, confidence: 0 };
      }
      const localCount = countRaisedFingers(landmarks);
      const qualify = qualifyingCount(localCount);
      const confidence = qualify ? poseConfidence(landmarks, qualify) : 0;
      return { landmarks, localCount, qualify, confidence };
    },
    close() {
      landmarker.close?.();
    },
  };
}

export function cropHandJpeg(video: HTMLVideoElement, landmarks: Point[] | null): string {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return "";

  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;

  if (landmarks && landmarks.length >= 21) {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const p of landmarks) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 0.2;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(1, maxX + pad);
    maxY = Math.min(1, maxY + pad);
    sx = minX * vw;
    sy = minY * vh;
    sw = Math.max(32, (maxX - minX) * vw);
    sh = Math.max(32, (maxY - minY) * vh);
  }

  const maxEdge = 480;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(64, Math.round(sw * scale));
  canvas.height = Math.max(64, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.62);
}
