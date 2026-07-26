import { useCallback, useEffect, useRef, useState } from 'react'
import {
  TITLE_REGION,
  CORNER_REGION,
  cardGuideRect,
  regionToFrameRect,
  type NormRect
} from '../scan/geometry'

/** Maximum on-screen height of the camera stage (px). */
const MAX_DISPLAY_HEIGHT = 420

const DEVICE_KEY = 'cardvault.cameraDeviceId'

export interface CapturedFrame {
  /** Full frame at native camera resolution. */
  frame: HTMLCanvasElement
  /** Title-bar crop (card name — kept for a future cross-check). */
  title: HTMLCanvasElement
  /** Bottom-left crop (collector number / set code / copyright). */
  corner: HTMLCanvasElement
  /**
   * OCR-ready corner variants (PNG data URLs), most-likely polarity first:
   * grayscale + contrast-stretched, dark-text-on-light.
   */
  cornerVariants: string[]
  /** OCR-ready title-bar variants (name mode). */
  titleVariants: string[]
  width: number
  height: number
}

function cropRegion(video: HTMLVideoElement, region: NormRect, scale = 3): HTMLCanvasElement {
  const rect = regionToFrameRect(region, video.videoWidth, video.videoHeight)
  const out = document.createElement('canvas')
  out.width = Math.round(rect.w * scale)
  out.height = Math.round(rect.h * scale)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height)
  return out
}

/**
 * Prepare OCR variants from the crop, best-guess first:
 *   1–2. Otsu-binarized, both polarities (clean black/white kills the color
 *        noise of card borders — green-on-dark corners, red frames, glare)
 *   3.   percentile contrast-stretched grayscale (fallback when binarization
 *        eats thin strokes)
 * Tesseract wants dark text on light background; card corners come both ways
 * (black-border cards print white-on-black), so polarity order is chosen by
 * the median luminance.
 */
function toOcrVariants(src: HTMLCanvasElement): string[] {
  const w = src.width
  const h = src.height
  const ctx = src.getContext('2d')!
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  const n = w * h

  const lum = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) {
    const l = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
    lum[i] = l
    hist[l & 0xff]++
  }

  // Otsu's threshold: maximize between-class variance over the histogram.
  let sumAll = 0
  for (let v = 0; v < 256; v++) sumAll += v * hist[v]
  let sumBg = 0
  let weightBg = 0
  let bestVar = -1
  let threshold = 127
  for (let v = 0; v < 256; v++) {
    weightBg += hist[v]
    if (weightBg === 0) continue
    const weightFg = n - weightBg
    if (weightFg === 0) break
    sumBg += v * hist[v]
    const meanBg = sumBg / weightBg
    const meanFg = (sumAll - sumBg) / weightFg
    const between = weightBg * weightFg * (meanBg - meanFg) ** 2
    if (between > bestVar) {
      bestVar = between
      threshold = v
    }
  }

  // 5th/95th percentile stretch — robust against glare pixels.
  let lo = 0
  let hi = 255
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= n * 0.05) {
      lo = v
      break
    }
  }
  acc = 0
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]
    if (acc >= n * 0.05) {
      hi = v
      break
    }
  }
  const range = Math.max(1, hi - lo)

  // Median luminance: robust polarity guess even when a bright frame edge
  // or rules box occupies part of the crop.
  let seen = 0
  let median = 127
  for (let v = 0; v < 256; v++) {
    seen += hist[v]
    if (seen >= n / 2) {
      median = v
      break
    }
  }
  const darkBackground = median < 118

  const render = (mode: 'binary' | 'stretch', invert: boolean): string => {
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const octx = out.getContext('2d')!
    const oimg = octx.createImageData(w, h)
    for (let i = 0; i < n; i++) {
      let v: number
      if (mode === 'binary') {
        v = lum[i] > threshold ? 255 : 0
      } else {
        v = Math.max(0, Math.min(255, Math.round(((lum[i] - lo) / range) * 255)))
      }
      if (invert) v = 255 - v
      oimg.data[i * 4] = v
      oimg.data[i * 4 + 1] = v
      oimg.data[i * 4 + 2] = v
      oimg.data[i * 4 + 3] = 255
    }
    octx.putImageData(oimg, 0, 0)
    return out.toDataURL('image/png')
  }

  return [
    render('binary', darkBackground),
    render('binary', !darkBackground),
    render('stretch', darkBackground)
  ]
}

export function captureFromVideo(video: HTMLVideoElement): CapturedFrame {
  const frame = document.createElement('canvas')
  frame.width = video.videoWidth
  frame.height = video.videoHeight
  frame.getContext('2d')!.drawImage(video, 0, 0)
  const corner = cropRegion(video, CORNER_REGION)
  const title = cropRegion(video, TITLE_REGION)
  return {
    frame,
    title,
    corner,
    cornerVariants: toOcrVariants(corner),
    titleVariants: toOcrVariants(title),
    width: video.videoWidth,
    height: video.videoHeight
  }
}

export default function CameraPanel({
  onCapture,
  autoMode = false,
  autoIntervalMs = 500,
  guideRegion = 'corner'
}: {
  onCapture: (capture: CapturedFrame, auto: boolean) => void
  autoMode?: boolean
  autoIntervalMs?: number
  /** Which crop the operator needs to land: corner (modern) or title (name mode). */
  guideRegion?: 'corner' | 'title'
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Bumped on every start(); stale starts (dev double-mount, quick device
  // switches) see a newer generation and bow out instead of erroring.
  const startSeq = useRef(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem(DEVICE_KEY) ?? '')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Native stream dimensions — refreshed when the source flips orientation
  // mid-stream (iPhone Continuity Camera does this when the phone tilts).
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null)
  // Available width for the stage (responsive two-column layout).
  const stageWrapRef = useRef<HTMLDivElement>(null)
  const [stageWidth, setStageWidth] = useState(0)

  useEffect(() => {
    const el = stageWrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageWidth(el.clientWidth))
    ro.observe(el)
    setStageWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Cameras come and go (iPhone Continuity Camera appears/vanishes as the
  // phone sleeps or leaves range) — keep the picker list live.
  useEffect(() => {
    const refresh = async (): Promise<void> => {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'videoinput'))
    }
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const update = (): void => {
      if (video.videoWidth > 0) setVideoDims({ w: video.videoWidth, h: video.videoHeight })
    }
    video.addEventListener('loadedmetadata', update)
    video.addEventListener('resize', update)
    return () => {
      video.removeEventListener('loadedmetadata', update)
      video.removeEventListener('resize', update)
    }
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setRunning(false)
  }, [])

  const start = useCallback(
    async (preferredId?: string) => {
      const mySeq = ++startSeq.current
      stop()
      setError(null)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: preferredId ? { exact: preferredId } : undefined,
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        })
        if (startSeq.current !== mySeq) {
          // A newer start owns the camera now — release this stream quietly.
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setRunning(true)
        // Labels only populate after permission is granted.
        const all = await navigator.mediaDevices.enumerateDevices()
        setDevices(all.filter((d) => d.kind === 'videoinput'))
        const actualId = stream.getVideoTracks()[0]?.getSettings().deviceId
        if (actualId) {
          setDeviceId(actualId)
          localStorage.setItem(DEVICE_KEY, actualId)
        }
      } catch (err) {
        const name = err instanceof Error ? err.name : ''
        if (name === 'AbortError' || startSeq.current !== mySeq) {
          // play() interrupted because a newer start replaced the source —
          // harmless; the newer start reports its own outcome.
          return
        }
        if (preferredId && name === 'OverconstrainedError') {
          // Remembered camera is gone (unplugged) — fall back to any camera.
          localStorage.removeItem(DEVICE_KEY)
          return start(undefined)
        }
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was denied. Allow camera access for MTG CardVault and press Retry.'
            : name === 'NotFoundError'
              ? 'No camera found. Plug in a webcam and press Retry.'
              : `Camera error: ${err instanceof Error ? err.message : String(err)}`
        )
        setRunning(false)
      }
    },
    [stop]
  )

  useEffect(() => {
    start(deviceId || undefined)
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [])

  const capture = useCallback(
    (auto = false) => {
      const video = videoRef.current
      if (!video || !running || video.videoWidth === 0) return
      onCapture(captureFromVideo(video), auto)
    },
    [running, onCapture]
  )

  // Auto mode: pump frames on an interval. The consumer decides whether a
  // frame is worth acting on (it may still be busy with the previous one).
  useEffect(() => {
    if (!autoMode || !running) return
    const id = window.setInterval(() => capture(true), autoIntervalMs)
    return () => window.clearInterval(id)
  }, [autoMode, running, autoIntervalMs, capture])

  // Space captures a frame (unless typing in an input).
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        capture(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [capture])

  // Overlay geometry in display pixels, from the SAME cardGuideRect the
  // cropper uses — orientation-proof by construction. The video scales to
  // fit the available column width, capped in height.
  let guideStyle: React.CSSProperties = { display: 'none' }
  let videoStyle: React.CSSProperties = { height: MAX_DISPLAY_HEIGHT }
  if (videoDims) {
    const maxW = stageWidth > 40 ? stageWidth : MAX_DISPLAY_HEIGHT * (videoDims.w / videoDims.h)
    const scale = Math.min(maxW / videoDims.w, MAX_DISPLAY_HEIGHT / videoDims.h)
    const dispW = videoDims.w * scale
    const dispH = videoDims.h * scale
    videoStyle = { width: dispW, height: dispH }
    const g = cardGuideRect(dispW, dispH)
    guideStyle = { left: g.x, top: g.y, width: g.w, height: g.h }
  }
  const regionStyle = (r: NormRect): React.CSSProperties => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`
  })

  return (
    <div className="camera-panel">
      <div className="camera-toolbar">
        <label>
          Camera
          <select
            value={deviceId}
            onChange={(e) => {
              localStorage.setItem(DEVICE_KEY, e.target.value)
              setDeviceId(e.target.value)
              start(e.target.value)
            }}
          >
            {devices.length === 0 && <option value="">default</option>}
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button onClick={stop}>Stop camera</button>
        ) : (
          <button onClick={() => start(deviceId || undefined)}>
            {error ? 'Retry' : 'Start camera'}
          </button>
        )}
        <button className="primary" onClick={() => capture(false)} disabled={!running}>
          Capture (Space)
        </button>
      </div>

      {error && <p className="warn">{error}</p>}

      <div ref={stageWrapRef} className="camera-stage-wrap">
        <div className="camera-stage">
          <video ref={videoRef} muted playsInline style={videoStyle} />
          {running && videoDims && (
            <div className="card-guide" style={guideStyle}>
              {guideRegion === 'corner' ? (
                <div className="region-guide corner" style={regionStyle(CORNER_REGION)}>
                  <span>collector info</span>
                </div>
              ) : (
                <div className="region-guide title" style={regionStyle(TITLE_REGION)}>
                  <span>card name</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
