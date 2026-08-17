# Changelog

All notable changes to MTG CardVault. Versions are the tagged releases on GitHub — each ships a self-contained Windows `.exe` and macOS `.dmg` with the reference DB and OCR data bundled.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/); this project uses simple `MAJOR.MINOR.PATCH` tags.

## [Unreleased]

Inventory viewer: value filter, sorting, full-art filter, and a self-updating page.

### Added
- **Card value filter** in the inventory viewer / any-card browser — a min/max band in **£** (€ when offline), matched against the Cardmarket price shown on the tile. Unpriced cards fall outside every band rather than counting as £0.
- **Sort dropdown** — value high→low / low→high, mana cost either way, or name A–Z, on top of any combination of filters. In any-card mode the sort runs in SQL so it orders the whole result set, not just the current page.
- **Full-art filter + badge** — a "Full art" chip restricts the grid to full-art printings (Scryfall's `full_art` flag: full-art basic lands, textless promos, etc.), and full-art tiles carry a ◈ badge in both inventory and any-card mode. The reference DB gained a `full_art` column, populated on the next **Refresh card data** (existing DBs migrate the column in and default it to 0 until refreshed).
- **Borderless filter + badge** — a "Borderless" chip and a ▢ badge, from Scryfall's `border_color`. Separate from full art: a card can be either, both, or neither. Same `borderless` reference-DB column and refresh rule as above.

### Changed
- The `Cost:` filter is now labelled **`Mana cost:`** — it filters by mana value, and the new `Value £:` boxes are the money one.
- **Set filtering ignores punctuation and word order.** It was a literal substring match, so `spiderman` and `spider man` both missed "Marvel's Spider-Man" over a hyphen. Now the query and the set name are compared on letters and digits only, with each word matched independently — `spiderman`, `spider man`, `marvel spider` and the set code `spm` all find it, and `assassins creed` finds "Assassin's Creed".

### Fixed
- An open inventory viewer no longer shows stale totals: the page caches the collection for fast filtering but now polls a cheap change token (`/api/stamp`) and redraws within ~5s of any inventory write — a scan-in, a sale, a ± adjustment in another window, or a Dropbox-synced change from the shop's other machine. It also re-checks the moment the page regains focus.
- Overlapping refreshes can no longer paint out of order: a slow any-card query returning after a newer one used to leave the wrong result set (and the wrong status line) on screen.
- A **"Refresh card data"** now also refreshes the viewer's cached collection. The change token was built from inventory writes alone, so a reference-DB rebuild left the cached cards carrying stale reference-derived fields — most visibly, owned full-art cards vanished under the Full art filter until the page was reloaded by hand.

## [0.2.1] — 2026-08-06

Viewer filters, card magnifier & deck cost polish.

### Added
- **Colour + mana-cost filters** in the inventory viewer / any-card browser.
- **Card magnifier** — enlarge any card on hover, in both the deck builder and the inventory viewer.
- **Per-category cost** in each Stacks column header in the deck builder (e.g. `Lands  11 · £17.55`).
- Zoom-In keyboard shortcut bound to `Ctrl+=` and numpad `+`/`-` alongside `Ctrl+Plus`.

### Changed
- Missing-singles list in decks is now printing-aware.
- Colour chips default to "Only these", with strict colourless handling; colour filters never match lands.
- Dropped a redundant viewer header now that the viewer is embedded.

### Fixed
- Focus recovery for dead name inputs in deck modals (three-layer fix).
- Window blur/focus workaround to dislodge a stuck out-of-process-iframe keyboard frame.

### Packaging note
- The v0.2.1 CI run failed on a transient GitHub outage (*"Failed to resolve action download info: Service Unavailable"*), not a code fault. The release installers were built and uploaded manually; the reference DB was built on macOS and copied into `resources/` for the Windows package (SQLite files are cross-platform).

## [0.2.0] — 2026-08-02

Deck builder: build, import, analyse, and export decks against live shop inventory.

### Added
- **Deck builder** — a full Commander deck workspace:
  - Create/import decks: New (blank), Clipboard, File (`.txt`), or Archidekt URL (auto-sets commander + exact printings).
  - Archidekt-style **Stacks view** with hover-fan and a click-a-card modal (big art, set/unset commander, change printing/art, quantity, remove); commander pinned first with eligibility + max-two rules enforced.
  - **Analysis**: colour breakdown, mana curve, and opening-hand draw-odds by card type (exact hypergeometric).
  - **Owned-vs-missing** panel + **Copy buy list**.
  - Printing-specific export to clipboard or `.txt`; excludes art-series and Secret-Lair/promo printings, handles MDFC front faces.
  - Embedded inventory browser with right-click / full-card "Add to deck" hooks feeding decks from stock.
- New launcher art (high-res face tiles).

## [0.1.1] — 2026-08-02

Cloud (Dropbox) inventory storage.

### Added
- The shop's `inventory.db` can live in a Dropbox folder (`<Dropbox>/mtgCardVault`, auto-detected) to back it up and share it between machines, while the large rebuildable `reference.db` stays local. **Settings → Inventory storage** to choose local vs Dropbox and move between them.

### Fixed
- Synced inventory DBs use `journal_mode = DELETE` (never WAL) so Dropbox can't corrupt a SQLite file by syncing `-wal`/`-shm` sidecars out of step. Dropbox "conflicted copy" files are detected and surfaced.

## [0.1.0] — 2026-08-02

First Windows/macOS installer build.

### Added
- First end-to-end CI installer build on `windows-latest` + `macos-latest`: self-contained NSIS `.exe` and macOS `.dmg` with bundled `reference.db` + tessdata, needing zero dev tools on the target machine.
- Steps 1–6 shipped: webcam scan-in with auto-lock loop, corner-only OCR with old-frame resolution, sell/remove mode, the Show-Inventory browser, precon bulk add, and Cardmarket £ pricing throughout.

### Fixed
- CI: granted `permissions: contents: write` (release-attach was 403ing) and set `fail-fast: false` so one OS failing doesn't cancel the other.

[0.2.1]: https://github.com/jflockton/mtg-cardvault/releases/tag/v0.2.1
[0.2.0]: https://github.com/jflockton/mtg-cardvault/releases/tag/v0.2.0
[0.1.1]: https://github.com/jflockton/mtg-cardvault/releases/tag/v0.1.1
[0.1.0]: https://github.com/jflockton/mtg-cardvault/releases/tag/v0.1.0
