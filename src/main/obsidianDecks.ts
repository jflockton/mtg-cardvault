// Import decks straight from the Obsidian vault. Deck notes (written by the
// MTG Deck Importer project) carry the full list in a fenced code block right
// under a "## 📜 Deck List" heading, plus frontmatter naming the commander —
// enough to import a deck with its commander set, no copy-paste hop through
// Obsidian needed. The vault lives in Dropbox ("obsidianVault"), so the same
// discovery works on every machine that syncs it.

import fs from 'node:fs'
import path from 'node:path'
import { findDropboxDir } from './dataLocation'

export interface VaultDeckNote {
  /** Absolute path — the ticket for deckVaultRead. */
  path: string
  /** Note title (basename without .md). */
  title: string
  /** Frontmatter deck-name, when present. */
  deckName: string | null
  /** The deck's commander, when the note names one. */
  commander: string | null
  /** Containing folder relative to the vault — tells near-identical notes apart. */
  folder: string
  /** File mtime, ISO — the list is shown newest first. */
  modifiedAt: string
}

const DECK_HEADING = /^##\s*(?:📜\s*)?Deck List\s*$/m

/** The vault root, or null when this machine has no synced vault. */
export function findVaultDir(): string | null {
  const dbx = findDropboxDir()
  if (!dbx) return null
  const vault = path.join(dbx, 'obsidianVault')
  try {
    return fs.statSync(vault).isDirectory() ? vault : null
  } catch {
    return null
  }
}

/** One frontmatter scalar from the top of a note, tolerating quotes. */
function frontmatterValue(text: string, key: string): string | null {
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end < 0) return null
  const m = text.slice(0, end).match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!m) return null
  const v = m[1].trim().replace(/^["']|["']$/g, '')
  return v || null
}

/**
 * The deck's commander. Deck notes put it in frontmatter; the generated
 * analysis briefs have no frontmatter at all and name it in a body line
 * instead ("Commander: Brago, King Eternal"). Only text above the decklist is
 * searched, so a "Commander" section inside the list can't be mistaken for it.
 */
function commanderOf(text: string): string | null {
  const fm = frontmatterValue(text, 'commander')
  if (fm) return fm
  const heading = DECK_HEADING.exec(text)
  const head = text.slice(0, heading ? heading.index : text.length)
  const m = head.match(/^\s*(?:\*\*)?Commander(?:\*\*)?:\s*(.+?)\s*$/m)
  return m ? m[1].replace(/^\[\[|\]\]$/g, '').trim() || null : null
}

/**
 * Every deck note in the vault: any .md file containing a "## 📜 Deck List"
 * heading. The whole vault is a few MB, so a read-everything sweep is cheap
 * (and needs zero configuration); hidden folders (.obsidian, .trash) skipped.
 */
export function listVaultDeckNotes(): { vaultDir: string | null; notes: VaultDeckNote[] } {
  const vaultDir = findVaultDir()
  if (!vaultDir) return { vaultDir: null, notes: [] }

  const notes: VaultDeckNote[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        try {
          const text = fs.readFileSync(full, 'utf8')
          if (!DECK_HEADING.test(text)) continue
          notes.push({
            path: full,
            title: e.name.replace(/\.md$/, ''),
            deckName: frontmatterValue(text, 'deck-name'),
            commander: commanderOf(text),
            folder: path.relative(vaultDir, dir),
            modifiedAt: fs.statSync(full).mtime.toISOString()
          })
        } catch {
          /* unreadable file — skip */
        }
      }
    }
  }
  walk(vaultDir, 0)
  notes.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return { vaultDir, notes }
}

/**
 * Read one deck note and pull the decklist out: the first fenced code block
 * after the "## 📜 Deck List" heading. When the frontmatter names a commander
 * and the list holds a matching line, the list is restructured with an explicit
 * "Commander" section so importDeckText sets the commander automatically.
 */
export function readVaultDeckNote(
  filePath: string
): { name: string; commander: string | null; text: string } | { error: string } {
  const vaultDir = findVaultDir()
  // Only vault notes may be read through this channel.
  if (!vaultDir || !path.resolve(filePath).startsWith(vaultDir + path.sep)) {
    return { error: 'That file is not inside the Obsidian vault.' }
  }
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return { error: 'Could not read the note (was it moved or deleted?).' }
  }

  const headingMatch = DECK_HEADING.exec(raw)
  if (!headingMatch) return { error: 'No "## 📜 Deck List" section in that note.' }
  const afterHeading = raw.slice(headingMatch.index + headingMatch[0].length)
  const block = afterHeading.match(/```[^\n]*\n([\s\S]*?)```/)
  if (!block || !block[1].trim()) {
    return { error: 'The Deck List section has no decklist code block.' }
  }
  let text = block[1].replace(/\s+$/, '')

  const commander = commanderOf(raw)
  if (commander && !/^\s*commander\s*:?\s*$/im.test(text)) {
    // Lift the commander's line into a Commander section. Match on the name
    // part only, so "1 Krenko, Mob Boss (SLD) 123" still counts.
    const lines = text.split(/\r?\n/)
    const idx = lines.findIndex((l) => {
      const m = l.trim().match(/^\d+\s*[xX]?\s+(.+?)(?:\s*\([A-Za-z0-9]{2,6}\).*)?$/)
      return m != null && m[1].trim().toLowerCase() === commander.trim().toLowerCase()
    })
    if (idx >= 0) {
      const cmdLine = lines.splice(idx, 1)[0].trim()
      text = `Commander\n${cmdLine}\n\nDeck\n${lines.join('\n').trim()}`
    }
  }

  const name =
    frontmatterValue(raw, 'deck-name') ?? path.basename(filePath).replace(/\.md$/, '')
  return { name, commander, text }
}
