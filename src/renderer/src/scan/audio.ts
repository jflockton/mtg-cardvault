// Feedback tones via Web Audio — no assets, quiet sine waves.

let ctx: AudioContext | null = null

function ensureCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, startOffset: number, duration: number, gain = 0.07): void {
  const ac = ensureCtx()
  const osc = ac.createOscillator()
  const g = ac.createGain()
  const t0 = ac.currentTime + startOffset
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(g).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

/** Card locked + added: quick rising two-tone. */
export function playSuccess(): void {
  tone(880, 0, 0.09)
  tone(1318.5, 0.09, 0.13)
}

/** Couldn't lock / needs attention: gentle low double-blip. */
export function playAttention(): void {
  tone(233, 0, 0.1, 0.05)
  tone(233, 0.14, 0.1, 0.05)
}

/** Undo: single low tick. */
export function playUndo(): void {
  tone(440, 0, 0.07, 0.05)
}
