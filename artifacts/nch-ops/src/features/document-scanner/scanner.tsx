import { useState, useRef, useEffect, useCallback } from "react";
import { X, RotateCcw, Check, Loader as Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DocumentScannerProps {
  onCapture: (base64: string) => void;
  onClose: () => void;
}

type ScanState = "loading" | "scanning" | "preview";

let opencvLoadPromise: Promise<boolean> | null = null;

function loadOpenCV(): Promise<boolean> {
  if (opencvLoadPromise) return opencvLoadPromise;
  opencvLoadPromise = new Promise((resolve) => {
    if ((window as any).cv && (window as any).cv.Mat) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://docs.opencv.org/4.x/opencv.js";
    script.async = true;
    script.onload = () => {
      const check = () => {
        if ((window as any).cv && (window as any).cv.Mat) {
          resolve(true);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    setTimeout(() => resolve(false), 15000);
  });
  return opencvLoadPromise;
}

function canvasToBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", 0.92);
}

export function DocumentScanner({ onCapture, onClose }: DocumentScannerProps) {
  const [state, setState] = useState<ScanState>("loading");
  const [cvReady, setCvReady] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [stableCount, setStableCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastContourRef = useRef<number[][] | null>(null);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("scanning");
    } catch {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadOpenCV();
      if (cancelled) return;
      setCvReady(loaded);
      await startCamera();
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const findDocumentContour = useCallback((video: HTMLVideoElement): number[][] | null => {
    if (!cvReady) return null;
    const cv = (window as any).cv;
    if (!cv || !cv.Mat) return null;

    try {
      const src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
      const cap = new cv.VideoCapture(video);
      cap.read(src);

      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      const blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      const edges = new cv.Mat();
      cv.Canny(blurred, edges, 50, 150);

      const dilated = new cv.Mat();
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.dilate(edges, dilated, kernel);

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let bestContour: number[][] | null = null;
      let maxArea = 0;
      const imgArea = video.videoWidth * video.videoHeight;
      const minArea = imgArea * 0.1;

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < minArea) { cnt.delete(); continue; }

        const peri = cv.arcLength(cnt, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

        if (approx.rows === 4 && area > maxArea) {
          maxArea = area;
          bestContour = [];
          for (let j = 0; j < 4; j++) {
            bestContour.push([approx.intAt(j, 0), approx.intAt(j, 1)]);
          }
        }
        approx.delete();
        cnt.delete();
      }

      src.delete(); gray.delete(); blurred.delete(); edges.delete();
      dilated.delete(); kernel.delete(); contours.delete(); hierarchy.delete();

      return bestContour;
    } catch {
      return null;
    }
  }, [cvReady]);

  const drawOverlay = useCallback((contour: number[][] | null) => {
    const overlay = overlayRef.current;
    const video = videoRef.current;
    if (!overlay || !video) return;

    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (!contour) return;

    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 4;
    ctx.fillStyle = "rgba(34, 197, 94, 0.1)";

    ctx.beginPath();
    ctx.moveTo(contour[0][0], contour[0][1]);
    for (let i = 1; i < contour.length; i++) {
      ctx.lineTo(contour[i][0], contour[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    for (const pt of contour) {
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 8, 0, Math.PI * 2);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
    }
  }, []);

  const processFrame = useCallback(() => {
    if (state !== "scanning" || !videoRef.current) return;

    const contour = findDocumentContour(videoRef.current);
    drawOverlay(contour);

    if (contour) {
      const prev = lastContourRef.current;
      const isStable = prev && contoursMatch(prev, contour);
      if (isStable) {
        setStableCount((c) => c + 1);
      } else {
        setStableCount(0);
      }
      lastContourRef.current = contour;
    } else {
      setStableCount(0);
      lastContourRef.current = null;
    }

    animFrameRef.current = requestAnimationFrame(processFrame);
  }, [state, findDocumentContour, drawOverlay]);

  useEffect(() => {
    if (state === "scanning") {
      animFrameRef.current = requestAnimationFrame(processFrame);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [state, processFrame]);

  useEffect(() => {
    if (stableCount >= 30 && lastContourRef.current) {
      captureAndTransform(lastContourRef.current);
    }
  }, [stableCount]);

  const captureAndTransform = useCallback((contour: number[][]) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setState("preview");
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const cv = (window as any).cv;
    if (!cv || !cv.Mat) {
      captureRaw();
      return;
    }

    try {
      const src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
      const cap = new cv.VideoCapture(video);
      cap.read(src);

      const ordered = orderPoints(contour);
      const width = Math.max(
        dist(ordered[0], ordered[1]),
        dist(ordered[2], ordered[3]),
      );
      const height = Math.max(
        dist(ordered[0], ordered[3]),
        dist(ordered[1], ordered[2]),
      );

      const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, ordered.flat());
      const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0, width, 0, width, height, 0, height,
      ]);

      const M = cv.getPerspectiveTransform(srcPts, dstPts);
      const warped = new cv.Mat();
      cv.warpPerspective(src, warped, M, new cv.Size(width, height));

      const gray = new cv.Mat();
      cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

      const enhanced = new cv.Mat();
      cv.adaptiveThreshold(gray, enhanced, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 10);

      canvas.width = width;
      canvas.height = height;
      cv.imshow(canvas, enhanced);

      setPreviewSrc(canvasToBase64(canvas));

      src.delete(); srcPts.delete(); dstPts.delete();
      M.delete(); warped.delete(); gray.delete(); enhanced.delete();
    } catch {
      captureRaw();
    }
  }, []);

  const captureRaw = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      setPreviewSrc(canvasToBase64(canvas));
    }
    setState("preview");
  };

  const handleManualCapture = () => {
    if (lastContourRef.current) {
      captureAndTransform(lastContourRef.current);
    } else {
      captureRaw();
    }
  };

  const handleRetake = () => {
    setPreviewSrc(null);
    setStableCount(0);
    lastContourRef.current = null;
    setState("scanning");
  };

  const handleUseScan = () => {
    if (previewSrc) {
      stopCamera();
      onCapture(previewSrc);
    }
  };

  if (state === "preview" && previewSrc) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
          <img src={previewSrc} alt="Scanned document" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
        <div className="p-4 flex gap-3">
          <Button
            variant="outline"
            className="flex-1 h-14 text-lg border-white/30 text-white hover:bg-white/10"
            onClick={handleRetake}
          >
            <RotateCcw className="w-5 h-5 mr-2" />
            Retake
          </Button>
          <Button
            className="flex-1 h-14 text-lg bg-green-600 hover:bg-green-700 text-white"
            onClick={handleUseScan}
          >
            <Check className="w-5 h-5 mr-2" />
            Use Scan
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-4 left-4 z-10">
        <button onClick={() => { stopCamera(); onClose(); }} className="bg-black/50 text-white rounded-full p-2">
          <X className="w-6 h-6" />
        </button>
      </div>

      {state === "loading" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-white">
            <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3" />
            <p className="text-lg">Starting scanner...</p>
          </div>
        </div>
      )}

      <div className={`flex-1 relative ${state === "loading" ? "hidden" : ""}`}>
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
        {cvReady && stableCount > 10 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-green-600/90 text-white px-4 py-2 rounded-full text-sm font-medium">
            Document detected - hold steady...
          </div>
        )}
        {!cvReady && state === "scanning" && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-600/90 text-white px-4 py-2 rounded-full text-sm font-medium">
            Basic mode - tap capture
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {state === "scanning" && (
        <div className="p-4 flex justify-center">
          <button
            onClick={handleManualCapture}
            className="w-16 h-16 rounded-full border-4 border-white bg-white/20 active:bg-white/40 transition-colors"
          />
        </div>
      )}
    </div>
  );
}

function orderPoints(pts: number[][]): number[][] {
  const sorted = [...pts].sort((a, b) => a[1] - b[1]);
  const top = sorted.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const bottom = sorted.slice(2, 4).sort((a, b) => a[0] - b[0]);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function dist(a: number[], b: number[]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

function contoursMatch(a: number[][], b: number[][]): boolean {
  const threshold = 20;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(a[i][0] - b[i][0]) > threshold) return false;
    if (Math.abs(a[i][1] - b[i][1]) > threshold) return false;
  }
  return true;
}
