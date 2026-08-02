import { useEffect, useState } from 'react'

/**
 * The Show Inventory browser, embedded in-app. It's a self-contained loopback
 * web page (served by the main process); we start the server, get its URL and
 * frame it here instead of opening a separate window.
 */
export default function InventoryViewer(): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    window.api
      .ensureViewer()
      .then((r) => {
        if (alive) setUrl(r.url)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="section-body viewer-body">
      {error ? (
        <p className="warn">Couldn’t start the inventory browser: {error}</p>
      ) : url ? (
        <iframe className="viewer-frame" src={url} title="Inventory browser" />
      ) : (
        <p className="muted">Starting inventory browser…</p>
      )}
    </div>
  )
}
