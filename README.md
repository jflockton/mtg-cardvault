# MTG CardVault

Webcam card scanner + local-first inventory app for a game shop's Magic: The Gathering singles (~3000+ loose cards, no existing inventory). Present a card to the camera, get a confident match, write it to the database, repeat — speed of entry is the top priority. Beyond scanning, it now browses the collection, builds and analyses Commander decks against live stock, and ships as a self-contained installer on Windows and macOS.

**Status: shipping — currently v0.2.1.** The scan-in loop is battle-hardened in live sessions (hold a card up, it locks, beeps, and writes itself to inventory — **beep = counted, no beep = didn't count**). Sell/remove mode, the full Show-Inventory browser, and a complete deck builder are all in the packaged app. Four releases are out (v0.1.0 → v0.2.1), each a self-contained `.exe`/`.dmg` with the reference DB bundled.

| Step | What | Status |
|---|---|---|
| 1 | Scaffold + DB + Scryfall bulk import + manual add form | ✅ |
| 2 | Camera feed + frame capture | ✅ |
| 3 | OCR pipeline (Tesseract, corner crop, set/collector parse + resolve) | ✅ |
| 4 | Fast add loop (auto-lock, audio confirm, undo, keyboard flow) | ✅ |
| 5 | Sell / remove mode (same lock loop, restock on undo) | ✅ |
| 6 | Show-Inventory browser: card-image grid, Cardmarket £ + USD prices, set + type/rarity/colour/mana/value/full-art/borderless filters, name search, any-card mode over all ~107k printings, clipboard/CSV exports | ✅ |
| 7 | Packaging: NSIS `.exe` + macOS `.dmg`, self-contained (bundled reference.db + tessdata) | ✅ shipping |
| 🃏 | **Deck builder**: create/import/analyse/export Commander decks against live inventory | ✅ (v0.2.0) |
| — | Extras: Name mode (old cards), precon bulk add (MTGJSON), token sets, scan log with value+UTC, cloud (Dropbox) inventory storage, card magnifier, double-faced card flip | ✅ |

## Index

| Section | Description |
|---|---|
| [How it works](#how-it-works) | Corner OCR identity, camera capture, the auto-scan lock loop, sell mode, and the inventory browser |
| [Tech stack](#tech-stack) | Electron, React, better-sqlite3, tesseract.js, electron-builder |
| [Data model](#data-model) | `reference.db` vs `inventory.db`, where they live, and Dropbox storage |
| [Development](#development-mac-or-any-machine-with-node) | Local dev loop and the better-sqlite3 native-ABI gotcha |
| [Install as a Mac app](#install-as-a-mac-app) | Building and installing the `.app`, plus Gatekeeper notes |
| [Deployment](#deployment) | The zero-dev-tools Windows constraint and how the installer is produced |
| [Primary path — GitHub Actions](#primary-path--github-actions-no-windows-machine-needed) | Tag-triggered CI build and release attach |
| [Fallbacks](#fallbacks-documented-not-the-default) | Building on Windows or macOS directly, and the WASM-SQLite escape hatch |
| [Code signing](#code-signing-optional) | Why the installer is unsigned and what removes the warning |
| [Scryfall etiquette](#scryfall-etiquette) | Rate limits, User-Agent, and when live calls actually happen |
| [Project layout](#project-layout) | Directory map of `src/`, `scripts/` and the packaging config |

## How it works

- **The bottom-left corner is the whole identity — nothing else is OCR'd.** Modern cards (~2015+) print `0123/280` + `M21 • EN` there: set code + collector number, a direct unique lookup. Older frames print **no set code at all** — just `13/150` and a copyright line — so the resolver identifies the set by its printed size (Scryfall's `printed_size`, exactly what the `/150` means) and breaks ties with the copyright year. `13/150` + `©2008` → Morningtide, one exact hit. Genuinely ambiguous reads produce a tap-to-pick shortlist, never a silent guess. (Name OCR was dropped: webcam-resolution title bars OCR too poorly to be a useful cross-check — the confirm-before-write step is the accuracy gate instead.)
- **Finish (foil / etched) is not printed on the card**, so it's a manual toggle in the UI (default: nonfoil). Foil and nonfoil of the same printing are separate inventory stacks.
- **Camera capture** (step 2): live `getUserMedia` feed with a card-outline guide — the operator fills the outline with the card. The on-screen guide and the frame cropper share one set of geometry constants ([src/renderer/src/scan/geometry.ts](src/renderer/src/scan/geometry.ts)), so what you align to is exactly what gets cropped. Space captures; camera choice is remembered. A capability-driven `⚙ Controls` panel reads `track.getCapabilities()` and surfaces sliders/toggles for whatever the active camera exposes (zoom, focus, exposure, torch…).
- **OCR** (step 3): the corner crop is extracted at 3×, grayscaled with a percentile contrast stretch, and produced in both polarities (black-border cards print white-on-black; Tesseract wants dark-on-light). tesseract.js runs in the **main process** with bundled traineddata (`npm run fetch:tessdata`), so OCR is fully offline and the renderer carries no wasm/worker plumbing — a scan round-trip is well under 200 ms. The parser handles OCR digit confusions (O→0, I→1…) and both corner formats; the raw read is always shown in the UI for tuning.
- **Auto scan — the fast loop** (step 4): toggle **▶ Auto scan** and the app OCRs frames continuously (~2/sec). A **lock requires two consecutive frames resolving to the same exact printing, each with ≥65% confidence on the number token** — a misread or blurry read can't silently write a wrong card (low-confidence locks open a preview for a one-glance Enter-confirm instead). On lock: the card is added, a soft two-tone beep confirms, and the same card won't re-add until it's seen physically leaving the frame (two genuinely empty frames, then a new card) — duplicates count naturally as you feed them one by one. Can't lock after a few frames → one gentle low double-blip and the raw read is shown; ambiguous old frames pause with the tap-to-pick shortlist. A right-hand session panel shows the big "just scanned" image and a running list of everything scanned this session, with a per-row ✨ Shiny finish toggle and a Remove-that-scan button.
- **Sell / remove mode** (step 5): the same lock loop, inverted — a locked scan removes a copy from stock (nonfoil → foil → etched), with a sale blip vs. an attention beep when a card is already out of stock (quantity never goes negative). Backspace restocks the last removal; manual entry removes too. Leaving Sell mode drops any staged removals; leaving Scan mode commits staged adds.
- **Offline-first Scryfall data.** No per-card API calls. The app imports Scryfall's `default_cards` bulk file (gzipped JSONL, ~77 MB, streamed to disk then stream-parsed into SQLite) so every scan is an instant local lookup. Installers ship with a pre-built reference DB, so the app works on first launch with no internet. A "Refresh card data" button rebuilds it (needed roughly weekly / after a set release). Only a genuine cache miss (e.g. a brand-new set) falls back to one live API call, which is then cached locally.
- **Show Inventory — the embedded browser.** The collection browser is a card-image grid: totals and per-card prices in **Cardmarket £** (Cardmarket is euro-native — like their own site's GBP display, the € price is converted at the ECB daily rate, fetched once and cached; the native € is shown alongside, and it falls back to € when offline) plus USD, quantity/foil badges, a set dropdown with per-set counts, and a name search that pops the card up big the moment it narrows to one. Filters cover **card type/subtype, rarity, Commander-legality, foil, full art, colour, mana cost, and card value** — the value band is typed in **£** (in € when offline) and matched against the same Cardmarket price the tile shows, so an unpriced card never counts as £0. The **Full art** chip narrows to full-art printings (Scryfall's `full_art` flag — full-art basic lands, textless promos, and the like) and those tiles carry a ◈ badge; the **Borderless** chip does the same for borderless printings (Scryfall's `border_color`) with a ▢ badge. The two are independent — a printing can be full-art, borderless, both, or neither. A **Sort** dropdown then orders whatever the filters left on screen: value high→low or low→high, mana cost either way, or name — "show me everything over £5, dearest first" is two controls. A **card magnifier** enlarges any card on hover. Two-sided printings — transform and modal DFCs, double-faced tokens, reversible and art-series cards — get a **flip button** directly under the card on the full-card view, turning it over with a 3D rotation (or press `F`); the button is labelled with the face it will show, and the magnifier works on either side. Scryfall's back-face art rides along in the reference DB (`layout` + `back_image_uri`), and a card the DB predates is resolved live on first open and cached. Untick **"In my inventory"** for any-card mode: search or page the entire ~107k-printing reference DB in collector order with the same prices, filters and sorting — sorting and paging happen in SQL, so page 1 really is the most valuable 300 cards, and owned copies get an "own ×N" badge. The page keeps itself current: it polls a tiny change token and redraws within a few seconds of a card being scanned in or sold anywhere in the app, so an open browser never shows a stale total. Works offline too: missing images fall back to text tiles. Exports copy the current view to the clipboard or CSV.
- **Deck builder.** A full Commander deck workspace (see [src/renderer/src/components/DeckBuilding.tsx](src/renderer/src/components/DeckBuilding.tsx)):
  - **Create / import:** New (blank), **Clipboard**, **File (.txt)**, **Archidekt URL** (auto-sets the commander and exact printings), or an **Obsidian vault deck note** — the 💎 Obsidian button lists every note in the Dropbox-synced vault carrying a `## 📜 Deck List` section (searchable, newest first), pulls the decklist out of the code block under that heading, and lifts the note's commander into a Commander section so the commander is set on import. Archidekt-style category tags (`1 Ashnod's Altar (CMM) 368 *F* [Ramp]`) are understood everywhere lists are parsed — the functional tag is dropped, `[Commander]`/`[Sideboard]`/`[Maybeboard]` set the board. Moxfield is export→paste (Cloudflare blocks direct fetch). You can also import a list into an existing deck.
  - **Stacks view** (Archidekt-style) with hover-fan and wrap-to-rows; click any card for a modal with big art, set/unset commander, set-as-deck-image, **change printing/art**, quantity, and remove. The commander is pinned first, with eligibility and the max-two-commanders rule enforced. Each Stacks column header shows its **per-category card count and £ cost** (e.g. `Lands  11 · £17.55`).
  - **Analysis** ([src/shared/deckStats.ts](src/shared/deckStats.ts), pure/dependency-free): colour breakdown by pip and by card, mana curve (mana value parsed from the printed cost, capped at 7+), average mana value, and opening-hand draw-odds per card type via an exact hypergeometric calculation. Anything the reference DB couldn't resolve is skipped, never guessed.
  - **Owned-vs-missing** panel with a printing-aware missing-singles list and a **Copy buy list** button, so a deck turns straight into a shopping list against current stock.
  - **Printing-specific export** to clipboard or `.txt`. Smart resolution excludes art-series cards and Secret-Lair/promo printings and handles modal double-faced front faces.
- **Cardmarket is the house currency.** Every add writes the Cardmarket (EUR) price at scan time into the scan log alongside USD; the in-app collection value, per-row prices and the scan preview all display Cardmarket **£** (converted at the ECB daily rate, native € shown when offline, USD kept alongside). Inventories created before this feature are migrated automatically, with pre-existing scan events stamped at the then-current Cardmarket price.

## Tech stack

- **Electron + React + TypeScript**, bundled with [electron-vite](https://electron-vite.org/). Electron bundles Node + Chromium, which is why the target machine needs nothing installed.
- **better-sqlite3** — synchronous, fast, file-based storage. Native module (see deployment).
- **tesseract.js** — on-device OCR, no cloud cost (from step 3).
- **electron-builder** — NSIS installer for Windows, DMG for macOS.
- [Scryfall](https://scryfall.com/docs/api) for all card reference data.

## Data model

Two SQLite files in the OS app-data dir (`%APPDATA%/mtg-cardvault/data` on Windows, `~/Library/Application Support/mtg-cardvault/data` on macOS) — they survive reinstalls and are what the shop backs up. The inventory DB can optionally live in a Dropbox folder to back it up / share it between machines (Settings → Inventory storage); the big rebuildable reference DB always stays local.

- **`reference.db`** — `scryfall_cards` imported from bulk data plus `scryfall_sets` (set names, release dates, `printed_size` for old-frame resolution) and Cardmarket EUR prices; read-only after import, rebuilt wholesale on refresh (built to a `.tmp` and atomically swapped). Indexed on `(set_code, collector_number)` and `name`. **This file is a plain, cross-platform SQLite database** — one built on any OS is byte-for-byte usable on any other, which matters for packaging (see Deployment).
- **`inventory.db`** — `inventory` table: what the shop owns. Denormalised card fields (name, set, rarity, …) so the collection stays browsable independently of reference data. `UNIQUE(scryfall_id, finish)` — adding an existing stack increments `quantity`. A `decks` table + join hold saved decks. When the inventory DB lives in Dropbox it uses `journal_mode = DELETE` (never WAL) so a synced SQLite file stays self-consistent.

Lookups normalise OCR-style input: `"M21"` + `"0123/274"` → set `m21`, collector `123`.

## Development (Mac or any machine with Node)

```bash
npm install                                  # deps; better-sqlite3 compiled for Node
npm run build:refdb                          # one-off: build ./data/reference.db from Scryfall bulk (~77MB download, deleted after import)
npm run fetch:tessdata                       # one-off: Tesseract eng traineddata (~4MB) for offline OCR
npm run check:refdb                          # sanity-check lookups, old-frame resolution, inventory logic
npm run rebuild:electron                     # recompile better-sqlite3 for Electron's ABI
MTG_CARDVAULT_DATA_DIR=./data npm run dev    # run the app against the local data dir
```

**The one gotcha — native module ABI.** `better-sqlite3` is compiled C++. Node and Electron have different ABIs, so it must be compiled for whichever runtime loads it:

- `npm run rebuild:node` → for the CLI scripts (`build:refdb`, `check:refdb`)
- `npm run rebuild:electron` → for `npm run dev` / packaged builds

If you see `NODE_MODULE_VERSION` mismatch errors, you're one `rebuild:*` away from fixing it. On a machine with **no C++ toolchain**, `rebuild:node` can't actually compile and may silently fall back to a prebuilt binary that crashes (segfault on the first query) — on Windows that means installing the Visual Studio "Desktop development with C++" workload, or building `reference.db` on another machine and copying the file across (it's cross-platform).

Without `MTG_CARDVAULT_DATA_DIR`, the app uses the real app-data location and (in a packaged build) seeds `reference.db` from the installer's bundled copy on first launch.

## Install as a Mac app

The dev loop is fine for hacking, but the app also builds as a normal macOS application (Launchpad, Spotlight, Dock — the lot), with a front-facing icon ([build/icon.svg](build/icon.svg), rendered to `icon.icns`/`icon.png` for the packagers):

```bash
npm run build:refdb                       # if ./data/reference.db doesn't exist yet
cp data/reference.db resources/reference.db
npm run fetch:tessdata                    # if resources/tessdata is missing
npm run dist:mac                          # add -- --universal for an Intel + Apple Silicon build
cp -R "dist/mac-arm64/MTG CardVault.app" /Applications/
```

Notes:

- The packaged app stores its data in `~/Library/Application Support/mtg-cardvault/data/` (Electron uses the package *name*, not the display name; the repo's `./data` is dev-only). On first launch it seeds `reference.db` from the copy bundled inside the app, so it works offline immediately. To carry a dev inventory over, copy `data/inventory.db` into that folder (quit the app first).
- The build is ad-hoc signed (no Apple Developer cert). Locally built apps run fine; when you hand the `.dmg` to another Mac, the recipient **right-clicks → Open** the first time (Gatekeeper blocks a plain double-click for unsigned apps).
- `npm run dist:mac` builds for the host architecture by default (an arm64 `.dmg` on Apple Silicon); add `-- --universal` for one `.dmg` that runs on both Intel and Apple Silicon.

## Deployment

**Hard constraint:** the shop's Windows machine has *zero* dev tools — no Node, no Python, no compilers. The deliverable is a single self-contained `.exe` installer with the reference DB and OCR data baked in. "Runs on a clean Windows box" is the definition of done.

### Primary path — GitHub Actions (no Windows machine needed)

`better-sqlite3` compiled on macOS won't run on Windows, so Windows installers are built on a `windows-latest` runner ([.github/workflows/build.yml](.github/workflows/build.yml)). On every version tag push (or manual dispatch):

1. `npm ci` — native module compiles for Node on Windows.
2. `npm run build:refdb -- --out resources/reference.db` — builds the bundled reference DB fresh from Scryfall.
3. `npm run check:refdb -- --data resources` — sanity-check before it ships.
4. `npm run build` + `electron-builder --win` — electron-builder recompiles better-sqlite3 for Electron's ABI (`npmRebuild: true`) and produces the NSIS installer with the reference DB in `resources/`.
5. The `.exe` (and the Mac `.dmg`) are uploaded as build artifacts and attached to the GitHub Release for the tag.

The workflow needs `permissions: contents: write` (else the release-attach 403s) and `fail-fast: false` (else one OS failure cancels the other) — both are set. Cut a release by pushing a tag:

```bash
npm version patch                 # bumps package.json + package-lock, commits, tags vX.Y.Z
git push && git push --tags       # tag push triggers the build + release
```

> **Note:** CI depends on GitHub's action-download service; a transient GitHub outage can fail a run with *"Failed to resolve action download info: Service Unavailable"* (this hit the v0.2.1 tag). It's not a repo/workflow fault — re-run the workflow (`gh run rerun <run-id>`) or fall back to a local build below.

### Fallbacks (documented, not the default)

- **Build on Windows directly** (PC/VM with Node **and** a C++ toolchain): `npm ci && npm run build:refdb -- --out resources/reference.db && npm run dist:win`. If the box has no compiler, `build:refdb` can't run — instead build `reference.db` on another machine, copy it into `resources/reference.db` (SQLite files are cross-platform), then `npm run dist:win`. Packaging itself doesn't need a working Node build of better-sqlite3 — electron-builder rebuilds it for Electron and copies `reference.db` in as a static resource. **The installer ships without card data if `resources/reference.db` is missing** — the build only warns, so always confirm the file is in place first.
- **Build on macOS** for the Mac `.dmg`: same `cp data/reference.db resources/reference.db` step, then `npm run dist:mac`. Attach with `gh release upload vX.Y.Z "dist/…"`.
- **Pure-Mac path (no native module):** swap `better-sqlite3` for WASM SQLite (`sql.js`) — no native compilation, identical build on every platform, but the whole DB lives in memory and large writes are slower. The data layer is isolated in [src/main/store.ts](src/main/store.ts) + [src/main/refdb.ts](src/main/refdb.ts) precisely so this swap stays cheap if ever needed.

### Code signing (optional)

Signing is not configured, so the installer is unsigned → SmartScreen "unknown publisher" warning (More info → Run anyway), acceptable for a single shop. An OV/EV certificate removes it: configure `win.certificateFile` in [electron-builder.yml](electron-builder.yml) or the `CSC_LINK` / `CSC_KEY_PASSWORD` env vars in CI.

## Scryfall etiquette

All live calls send a real `User-Agent` (`MTGCardVault/…`) and `Accept` header. Card-by-collector lookups stay far under the ~10 req/s allowance because they only happen on genuine cache misses, and hits are cached into the local reference DB. 429 responses surface as errors rather than being retried. Bulk data is only re-downloaded on explicit refresh.

## Project layout

```
src/
  main/           Electron main process
    index.ts      app entry, IPC, app-data resolution, first-launch DB seeding
    store.ts      DataStore — all SQL (reference lookups + inventory + decks)
    refdb.ts      Scryfall bulk download + streaming import (Electron-free)
    dataLocation.ts   local vs Dropbox inventory storage + relocation
    deckImport.ts     decklist / Archidekt import + printing resolution
  preload/        contextBridge API exposed to the renderer
  renderer/       React UI (scan, sell, viewer, DeckBuilding)
  shared/         types + deckStats.ts (pure deck analysis), shared across processes
scripts/
  build-reference-db.ts   build reference.db under plain Node (dev + CI)
  check-refdb.ts          sanity checks: lookups, normalisation, inventory cycle
.github/workflows/build.yml   installer builds (windows-latest + macos-latest)
electron-builder.yml          NSIS/DMG packaging config
```
