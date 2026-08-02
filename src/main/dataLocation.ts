// Where the precious inventory.db lives. By default it sits next to reference.db
// in the local app-data dir, but the shop can move it into a cloud-synced
// folder (Dropbox) so it's backed up and shared between machines. reference.db
// is deliberately NOT moved — it's large (~128MB) and rebuildable, so syncing
// it would be pure waste.
//
// The chosen location is remembered in a small local config file (location.json)
// kept in the local data dir — the pointer is per-machine on purpose, because a
// Dropbox folder resolves to a different absolute path on each computer.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Find the user's Dropbox folder. Reads Dropbox's own info.json (which records
 * the real path even when Dropbox was installed somewhere non-standard), and
 * falls back to a plain ~/Dropbox. Returns null if Dropbox isn't present.
 */
export function findDropboxDir(): string | null {
  const home = os.homedir()
  const infoFiles: string[] = []
  if (process.env.APPDATA) infoFiles.push(path.join(process.env.APPDATA, 'Dropbox', 'info.json'))
  if (process.env.LOCALAPPDATA)
    infoFiles.push(path.join(process.env.LOCALAPPDATA, 'Dropbox', 'info.json'))
  infoFiles.push(path.join(home, '.dropbox', 'info.json'))
  infoFiles.push(path.join(home, 'Library', 'Application Support', 'Dropbox', 'info.json'))

  for (const info of infoFiles) {
    try {
      const j = JSON.parse(fs.readFileSync(info, 'utf8')) as {
        personal?: { path?: string }
        business?: { path?: string }
      }
      const p = j.personal?.path || j.business?.path
      if (p && fs.existsSync(p)) return p
    } catch {
      /* not this one */
    }
  }

  const plain = path.join(home, 'Dropbox')
  try {
    if (fs.statSync(plain).isDirectory()) return plain
  } catch {
    /* no plain Dropbox */
  }
  return null
}

/** The folder we'd put the inventory in if the shop opts into Dropbox. */
export function defaultCloudInventoryDir(): string | null {
  const dbx = findDropboxDir()
  return dbx ? path.join(dbx, 'mtgCardVault') : null
}

interface LocationConfig {
  inventoryDir?: string
}

function configPath(localDataDir: string): string {
  return path.join(localDataDir, 'location.json')
}

/** The remembered inventory dir, or `fallback` (the local data dir) if unset. */
export function loadInventoryDir(localDataDir: string, fallback: string): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(localDataDir), 'utf8')) as LocationConfig
    if (cfg.inventoryDir && typeof cfg.inventoryDir === 'string') return cfg.inventoryDir
  } catch {
    /* no config yet */
  }
  return fallback
}

export function saveInventoryDir(localDataDir: string, dir: string): void {
  fs.mkdirSync(localDataDir, { recursive: true })
  fs.writeFileSync(configPath(localDataDir), JSON.stringify({ inventoryDir: dir }, null, 2))
}

export function clearInventoryDir(localDataDir: string): void {
  try {
    fs.unlinkSync(configPath(localDataDir))
  } catch {
    /* already absent */
  }
}

/**
 * Dropbox names divergent edits "inventory (Machine's conflicted copy DATE).db".
 * Their presence means two machines edited the inventory without letting the
 * sync settle — we surface them so the shop can reconcile rather than silently
 * losing scans.
 */
export function findConflictedCopies(inventoryDir: string): string[] {
  try {
    return fs
      .readdirSync(inventoryDir)
      .filter((f) => /conflicted copy/i.test(f) && /^inventory/i.test(f))
  } catch {
    return []
  }
}
