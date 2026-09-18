import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, LoaderCircle } from "lucide-react";
import { cropHandJpeg, createHandTracker } from "@/lib/hand-tracker";
import { verifyFingers } from "@/lib/verify-fingers";
import { cn } from "@/lib/cn";

type Phase = "idle" | "starting" | "live" | "denied" | "unsupported";

type LogLine = {
  id: number;
  time: string;
  text: string;
  tone: "plain" | "pending" | "confirm" | "false";
};

const STABLE_FRAMES = 6;
const FREEZE_MS = 10_000;
const MAX_CHECKS = 20;
const MAX_SHOTS = 3;
const FAST_MS = 55;
const PENDING_MS = 220;
const BOOST = 8;
const SHOT_GAP_MS = 450;

function clock() {
  return new Date().toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function wordCount(n: number) {
  if (n === 1) return "One";
  if (n === 2) return "Two";
  return String(n);
}

export function CameraApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<Awaited<ReturnType<typeof createHandTracker>> | null>(null);
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef(0);
  const stableRef = useRef<{ count: 1 | 2 | null; frames: number }>({
    count: null,
    frames: 0,
  });
  const inflightRef = useRef(false);
  const freezeUntilRef = useRef(0);
  const waitDropRef = useRef(false);
  const checksRef = useRef(0);
  const episodeRef = useRef({
    shots: 0,
    pending: 0,
    lastConf: 0,
    lastSendAt: 0,
    count: null as 1 | 2 | null,
  });
  const logId = useRef(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [modelReady, setModelReady] = useState(false);
  const [qualify, setQualify] = useState<1 | 2 | null>(null);
  const [localConf, setLocalConf] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [confirmed, setConfirmed] = useState<1 | 2 | null>(null);
  const [freezeUntil, setFreezeUntil] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [log, setLog] = useState<LogLine[]>([]);

  const freezeLeft = Math.max(0, Math.ceil((freezeUntil - nowTick) / 1000));
  const frozen = freezeLeft > 0;

  const pushLog = useCallback((text: string, tone: LogLine["tone"] = "plain") => {
    const id = ++logId.current;
    setLog((prev) => [...prev, { id, time: clock(), text, tone }].slice(-40));
  }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackerRef.current?.close();
    trackerRef.current = null;
    setModelReady(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!frozen) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [frozen]);

  const beginFreeze = useCallback(() => {
    const until = Date.now() + FREEZE_MS;
    freezeUntilRef.current = until;
    setFreezeUntil(until);
    setNowTick(Date.now());
  }, []);

  const sendVerify = useCallback(
    async (count: 1 | 2, jpeg: string, confidence: number, shot: number) => {
      if (Date.now() < freezeUntilRef.current) return;
      if (checksRef.current >= MAX_CHECKS) {
        pushLog("Check limit reached this session.", "false");
        return;
      }
      const ep = episodeRef.current;
      ep.pending += 1;
      ep.shots = shot;
      ep.lastConf = confidence;
      ep.lastSendAt = Date.now();
      ep.count = count;
      checksRef.current += 1;
      inflightRef.current = true;
      setVerifying(true);
      pushLog(
        shot === 1
          ? `Sending photo for double confirm… (local ${confidence}%)`
          : `Sending photo #${shot} — local confidence rose to ${confidence}%`,
        "pending",
      );
      try {
        const result = await verifyFingers({ data: { imageDataUrl: jpeg, localCount: count } });
        if (Date.now() < freezeUntilRef.current) return;
        if (!result.ok) {
          pushLog(result.error, "false");
          return;
        }
        const secs = Math.max(1, Math.round(result.ms / 1000));
        const confirmedOneOrTwo = result.fingersUp === 1 || result.fingersUp === 2;
        const label = `${wordCount(result.fingersUp)} finger${result.fingersUp === 1 ? "" : "s"} detected (${result.confidence}% confidence), processing time ${secs}s`;
        pushLog(label, confirmedOneOrTwo ? "confirm" : "false");
        if (result.fingersUp === 1 || result.fingersUp === 2) {
          setConfirmed(result.fingersUp);
          beginFreeze();
          waitDropRef.current = true;
        }
      } catch (err) {
        pushLog(err instanceof Error ? err.message : "Double-check failed", "false");
      } finally {
        ep.pending = Math.max(0, ep.pending - 1);
        inflightRef.current = ep.pending > 0;
        if (ep.pending === 0) {
          setVerifying(false);
          waitDropRef.current = true;
        }
      }
    },
    [beginFreeze, pushLog],
  );

  const loop = useCallback(() => {
    const video = videoRef.current;
    const tracker = trackerRef.current;
    if (!video || !tracker || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    const now = performance.now();
    const ep = episodeRef.current;
    const pending = ep.pending > 0;
    const minGap = pending ? PENDING_MS : FAST_MS;
    if (now - lastTsRef.current < minGap) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    lastTsRef.current = now;

    if (Date.now() < freezeUntilRef.current) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }

    try {
      const result = tracker.detect(video, now);
      const q = result.qualify;
      setQualify(q);
      setLocalConf(result.confidence);

      if (!q) {
        stableRef.current = { count: null, frames: 0 };
        if (ep.pending === 0) {
          waitDropRef.current = false;
          ep.shots = 0;
          ep.count = null;
          ep.lastConf = 0;
        }
      } else if (waitDropRef.current && ep.pending === 0) {
        stableRef.current = { count: null, frames: 0 };
      } else if (ep.shots === 0) {
        if (stableRef.current.count === q) stableRef.current.frames += 1;
        else stableRef.current = { count: q, frames: 1 };

        if (stableRef.current.frames >= STABLE_FRAMES) {
          const jpeg = cropHandJpeg(video, result.landmarks);
          if (jpeg) void sendVerify(q, jpeg, result.confidence, 1);
        }
      } else if (pending && ep.shots < MAX_SHOTS && q === ep.count) {
        const rose = result.confidence >= ep.lastConf + BOOST;
        const spaced = Date.now() - ep.lastSendAt >= SHOT_GAP_MS;
        if (rose && spaced) {
          const jpeg = cropHandJpeg(video, result.landmarks);
          if (jpeg) void sendVerify(q, jpeg, result.confidence, ep.shots + 1);
        }
      }
    } catch {
      // Drop a bad frame; keep the loop alive.
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [sendVerify]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported");
      return;
    }
    setPhase("starting");
    try {
      const camTimeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => {
          reject(new DOMException("Camera timed out", "NotAllowedError"));
        }, 12000);
      });
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        }),
        camTimeout,
      ]);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.srcObject = stream;
      await video.play();
      setPhase("live");
      trackerRef.current = await createHandTracker();
      setModelReady(true);
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPhase("denied");
      } else {
        setPhase("unsupported");
      }
    }
  }, [loop]);

  const badge = frozen ? (confirmed ?? qualify) : qualify;
  const heading =
    phase === "idle" || phase === "denied" || phase === "unsupported" || phase === "starting"
      ? "Allow the front camera"
      : verifying || (frozen && !confirmed)
        ? qualify === 2
          ? "TWO fingers suspected"
          : "ONE finger suspected"
        : confirmed === 1
          ? "ONE finger detected"
          : confirmed === 2
            ? "TWO fingers detected"
            : qualify === 1
              ? "ONE finger suspected"
              : qualify === 2
                ? "TWO fingers suspected"
                : "Hold 1 or 2 fingers";

  const hint = !modelReady && phase === "live"
    ? "Loading on-device hand model…"
    : frozen
      ? `Detected in last 10s (${freezeLeft}s left)`
      : verifying
        ? `Waiting for Grok · sampling slower. Extra shot if local confidence rises (now ${localConf}%).`
        : phase === "live"
          ? "Hold up exactly one or two fingers."
          : "Permission is required to use the selfie camera.";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] md:flex-row md:items-stretch md:gap-8 md:px-8 md:pt-8">
      <section className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-fg shadow-panel md:aspect-auto md:min-h-128 md:flex-1">
        <video
          ref={videoRef}
          className={cn(
            "absolute inset-0 size-full object-cover scale-x-[-1]",
            phase === "live" ? "opacity-100" : "opacity-0",
          )}
          playsInline
          muted
          autoPlay
        />
        {phase !== "live" ? (
          <button
            type="button"
            disabled={phase === "starting"}
            onClick={() => void start()}
            className="absolute inset-0 z-10 flex flex-col items-center px-4 pt-4 text-left disabled:opacity-80"
          >
            <span className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-teal px-5 font-medium text-warm-fg">
              {phase === "starting" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Camera className="size-4" />
              )}
              {phase === "starting"
                ? "Waiting for permission"
                : phase === "denied"
                  ? "Camera blocked — try again"
                  : "Allow front camera"}
            </span>
            {phase === "denied" ? (
              <span className="mt-3 text-center text-sm text-warm-fg/80">
                Allow the front camera in the browser prompt, then tap again.
              </span>
            ) : phase === "unsupported" ? (
              <span className="mt-3 text-center text-sm text-warm-fg/80">
                This browser cannot open a camera here. Open the app on your phone.
              </span>
            ) : phase === "idle" ? (
              <span className="mt-3 text-center text-sm text-warm-fg/70">
                Tap anywhere to request the selfie camera.
              </span>
            ) : null}
          </button>
        ) : null}
        {badge ? (
          <div className="absolute left-4 top-4 flex size-11 items-center justify-center rounded-full bg-warm text-lg font-semibold text-warm-fg tabular-nums">
            {badge}
          </div>
        ) : null}
        {frozen ? (
          <div className="absolute bottom-4 left-4 right-4 rounded-md bg-bg-elevated/95 px-3 py-2 text-sm text-fg">
            Detected in last 10s · {freezeLeft}s freeze
          </div>
        ) : verifying ? (
          <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-md bg-bg-elevated/90 px-3 py-2 text-sm text-fg">
            <LoaderCircle className="size-4 animate-spin" />
            Double-checking · local {localConf}%
          </div>
        ) : null}
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-4 pb-[env(safe-area-inset-bottom)]">
        <header className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-warm text-lg font-semibold text-warm-fg tabular-nums">
            {badge ?? "–"}
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-snug text-balance">{heading}</h1>
            <p className="mt-1 text-sm text-muted text-pretty">{hint}</p>
          </div>
        </header>

        <div className="min-h-40 flex-1 overflow-y-auto rounded-lg bg-bg-elevated p-4 shadow-panel">
          {log.length === 0 ? (
            <p className="text-sm text-subtle">
              A photo is captured only for a stable 1 or 2 fingers. While Grok replies,
              local sampling slows; a 2nd/3rd crop is sent only if local confidence rises.
              A 10s freeze starts only after Grok confirms 1 or 2.
            </p>
          ) : (
            <ol className="space-y-2 font-mono text-sm leading-snug">
              {log.map((line) => (
                <li key={line.id} className="flex gap-3">
                  <time className="shrink-0 tabular-nums text-subtle">{line.time}</time>
                  <span
                    className={cn(
                      line.tone === "pending" && "text-muted",
                      line.tone === "confirm" && "text-log-confirm",
                      line.tone === "false" && "text-log-false",
                    )}
                  >
                    {line.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {phase === "live" ? (
          <p className="text-xs text-subtle">
            {modelReady
              ? "On-device model is live. Extra shots while pending only if confidence rises."
              : "Starting the on-device model…"}
          </p>
        ) : null}
      </section>
    </main>
  );
}
