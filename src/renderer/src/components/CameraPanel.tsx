import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CARD_ASPECT,
  GUIDE_HEIGHT_FRAC,
  TITLE_REGION,
  CORNER_REGION,
  regionToFrameRect,
  type NormRect
} from '../scan/geometry'

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
 * Prepare OCR variants: grayscale with a percentile contrast stretch, in both
 * polarities. Tesseract strongly prefers dark text on a light background, and
 * card corners come both ways (black-border cards print white-on-black), so
 * we lead with whichever polarity this crop most likely needs.
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

  let meanSum = 0
  for (let i = 0; i < n; i++) meanSum += lum[i]
  const darkBackground = meanSum / n < 118

  const render = (invert: boolean): string => {
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const octx = out.getContext('2d')!
    const oimg = octx.createImageData(w, h)
    for (let i = 0; i < n; i++) {
      let v = Math.max(0, Math.min(255, Math.round(((lum[i] - lo) / range) * 255)))
      if (invert) v = 255 - v
      oimg.data[i * 4] = v
      oimg.data[i * 4 + 1] = v
      oimg.data[i * 4 + 2] = v
      oimg.data[i * 4 + 3] = 255
    }
    octx.putImageData(oimg, 0, 0)
    return out.toDataURL('image/png')
  }

  // Dark background → the inverted (light) version is the likely winner.
  return darkBackground ? [render(true), render(false)] : [render(false), render(true)]
}

export function captureFromVideo(video: HTMLVideoElement): CapturedFrame {
  const frame = document.createElement('canvas')
  frame.width = video.videoWidth
  frame.height = video.videoHeight
  frame.getContext('2d')!.drawImage(video, 0, 0)
  const corner = cropRegion(video, CORNER_REGION)
  return {
    frame,
    title: cropRegion(video, TITLE_REGION),
    corner,
    cornerVariants: toOcrVariants(corner),
    width: video.videoWidth,
    height: video.videoHeight
  }
}

export default function CameraPanel({
  onCapture
}: {
  onCapture: (capture: CapturedFrame) => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem(DEVICE_KEY) ?? '')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setRunning(false)
  }, [])

  const start = useCallback(
    async (preferredId?: string) => {
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

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || !running || video.videoWidth === 0) return
    onCapture(captureFromVideo(video))
  }, [running, onCapture])

  // Space captures a frame (unless typing in an input).
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        capture()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [capture])

  // Overlay geometry as CSS percentages — same constants the cropper uses.
  const guideStyle: React.CSSProperties = {
    height: `${GUIDE_HEIGHT_FRAC * 100}%`,
    aspectRatio: `${CARD_ASPECT}`,
    left: '50%',
    top: `${((1 - GUIDE_HEIGHT_FRAC) / 2) * 100}%`,
    transform: 'translateX(-50%)'
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
        <button className="primary" onClick={capture} disabled={!running}>
          Capture (Space)
        </button>
      </div>

      {error && <p className="warn">{error}</p>}

      <div className="camera-stage">
        <video ref={videoRef} muted playsInline />
        {running && (
          <div className="card-guide" style={guideStyle}>
            <div className="region-guide corner" style={regionStyle(CORNER_REGION)}>
              <span>collector info</span>
            </div>
          </div>
        )}
      </div>
      <p className="muted small">
        Fill the outline with the card — the bottom-left fine print (collector number) must
        land in the dashed box, sharp.
      </p>
    </div>
  )
}
