# MTG CardVault

Webcam card scanner + local-first inventory app for a game shop's Magic: The Gathering singles (~3000+ loose cards, no existing inventory). Present a card to the camera, get a confident match, write it to the database, repeat — speed of entry is the top priority.

**Status: steps 1–4 done and battle-hardened in live scanning sessions.** Hold a card up, it locks, beeps, and writes itself to inventory; swap to the next card. The operator contract: **beep = counted, no beep = didn't count.**

| Step | What | Status |
|---|---|---|
| 1 | Scaffold + DB + Scryfall bulk import + manual add form | ✅ |
| 2 | Camera feed + frame capture | ✅ |
| 3 | OCR pipeline (Tesseract, corner crop, set/collector parse + resolve) | ✅ |
| 4 | Fast add loop (auto-lock, audio confirm, undo, keyboard flow) | ✅ |
| — | Extras: Name mode (old cards), precon bulk add (MTGJSON), token sets, scan log with value+UTC, collection value + list export | ✅ |
| 5 | Remove mode | ⬜ |
| 6 | Search / browse UI + CSV export (collection view, value total, and clipboard CSV export — `quantity,card-name,expansion,id` per printing — exist; filters pending) | 🟡 |
| 7 | Packaging: NSIS installer via GitHub Actions | 🟡 config in place, unverified |

## How it works

- **The bottom-left corner is the whole identity — nothing else is OCR'd.** Modern cards (~2015+) print `0123/280` + `M21 • EN` there: set code + collector number, a direct unique lookup. Older frames print **no set code at all** — just `13/150` and a copyright line — so the resolver identifies the set by its printed size (Scryfall's `printed_size`, exactly what the `/150` means) and breaks ties with the copyright year. `13/150` + `©2008` → Morningtide, one exact hit. Genuinely ambiguous reads produce a tap-to-pick shortlist, never a silent guess. (Name OCR was dropped: webcam-resolution title bars OCR too poorly to be a useful cross-check — the confirm-before-write step is the accuracy gate instead.)
- **Finish (foil / etched) is not printed on the card**, so it's a manual toggle in the UI (default: nonfoil). Foil and nonfoil of the same printing are separate inventory stacks.
- **Camera capture** (step 2): live `getUserMedia` feed with a card-outline guide — the operator fills the outline with the card. The on-screen guide and the frame cropper share one set of geometry constants ([src/renderer/src/scan/geometry.ts](src/renderer/src/scan/geometry.ts)), so what you align to is exactly what gets cropped. Space captures; camera choice is remembered.
- **OCR** (step 3): the corner crop is extracted at 3×, grayscaled with a percentile contrast stretch, and produced in both polarities (black-border cards print white-on-black; Tesseract wants dark-on-light). tesseract.js runs in the **main process** with bundled traineddata (`npm run fetch:tessdata`), so OCR is fully offline and the renderer carries no wasm/worker plumbing — a scan round-trip is well under 200 ms. The parser handles OCR digit confusions (O→0, I→1…) and both corner formats; the raw read is always shown in the UI for tuning.
- **Auto scan — the fast loop** (step 4): toggle **▶ Auto scan** and the app OCRs frames continuously (~2/sec). A **lock requires two consecutive frames resolving to the same exact printing, each with ≥65% confidence on the number token** — a misread or blurry read can't silently write a wrong card (low-confidence locks open a preview for a one-glance Enter-confirm instead). On lock: the card is added, a soft two-tone beep confirms, and the same card won't re-add until it's seen leaving the frame — duplicates count naturally as you feed them one by one. Can't lock after a few frames → one gentle low double-blip and the raw read is shown; ambiguous old frames pause with the tap-to-pick shortlist.
- **Finish is handled after the scan, not during.** Auto-adds land as nonfoil (or the printing's only finish); the loop never stops for foils. Tap **F** right after a beep to flip the just-added copy (foil → etched → back), use the per-row finish selector in the Just Added list for later corrections (it moves one copy between stacks), **Backspace** undoes the last add, and every row has a −1 button.
- **Offline-first Scryfall data.** No per-card API calls. The app imports Scryfall's `default_cards` bulk file (streamed to disk, then stream-parsed into SQLite) so every scan is an instant local lookup. Installers ship with a pre-built reference DB, so the app works on first launch with no internet. A "Refresh card data" button rebuilds it (needed roughly weekly / after a set release). Only a genuine cache miss (e.g. a brand-new set) falls back to one live API call, which is then cached locally.

## Tech stack

- **Electron + React + TypeScript**, bundled with [electron-vite](https://electron-vite.org/). Electron bundles Node + Chromium, which is why the target machine needs nothing installed.
- **better-sqlite3** — synchronous, fast, file-based storage. Native module (see deployment).
- **tesseract.js** — on-device OCR, no cloud cost (from step 3).
- **electron-builder** — NSIS installer for Windows, DMG for macOS.
- [Scryfall](https://scryfall.com/docs/api) for all card reference data.

## Data model

Two SQLite files in the OS app-data dir (`%APPDATA%/mtg-cardvault/data` on Windows, `~/Library/Application Support/mtg-cardvault/data` on macOS) — they survive reinstalls and are what the shop backs up:

- **`reference.db`** — `scryfall_cards` imported from bulk data plus `scryfall_sets` (set names, release dates, `printed_size` for old-frame resolution); read-only after import, rebuilt wholesale on refresh (built to a `.tmp` and atomically swapped). Indexed on `(set_code, collector_number)` and `name`.
- **`inventory.db`** — `inventory` table: what the shop owns. Denormalised card fields (name, set, rarity, …) so the collection stays browsable independently of reference data. `UNIQUE(scryfall_id, finish)` — adding an existing stack increments `quantity`.

Lookups normalise OCR-style input: `"M21"` + `"0123/274"` → set `m21`, collector `123`.

## Development (Mac or any machine with Node)

```bash
npm install                                  # deps; better-sqlite3 compiled for Node
npm run build:refdb                          # one-off: build ./data/reference.db from Scryfall bulk (~2GB download, deleted after import)
npm run fetch:tessdata                       # one-off: Tesseract eng traineddata (~4MB) for offline OCR
npm run check:refdb                          # sanity-check lookups, old-frame resolution, inventory logic
npm run rebuild:electron                     # recompile better-sqlite3 for Electron's ABI
MTG_CARDVAULT_DATA_DIR=./data npm run dev    # run the app against the local data dir
```

**The one gotcha — native module ABI.** `better-sqlite3` is compiled C++. Node and Electron have different ABIs, so it must be compiled for whichever runtime loads it:

- `npm run rebuild:node` → for the CLI scripts (`build:refdb`, `check:refdb`)
- `npm run rebuild:electron` → for `npm run dev` / packaged builds

If you see `NODE_MODULE_VERSION` mismatch errors, you're one `rebuild:*` away from fixing it.

Without `MTG_CARDVAULT_DATA_DIR`, the app uses the real app-data location and (in a packaged build) seeds `reference.db` from the installer's bundled copy on first launch.

## Deployment

**Hard constraint:** the shop's Windows machine has *zero* dev tools — no Node, no Python, no compilers. The deliverable is a single self-contained `.exe` installer. "Runs on a clean Windows box" is the definition of done.

### Primary path — GitHub Actions (no Windows machine needed)

`better-sqlite3` compiled on macOS won't run on Windows, so Windows installers are built on a `windows-latest` runner ([.github/workflows/build.yml](.github/workflows/build.yml)). On every version tag push (or manual dispatch):

1. `npm ci` — native module compiles for Node on Windows.
2. `npm run build:refdb -- --out resources/reference.db` — builds the bundled reference DB fresh from Scryfall.
3. `npm run check:refdb -- --data resources` — sanity-check before it ships.
4. `npm run build` + `electron-builder --win` — electron-builder recompiles better-sqlite3 for Electron's ABI (`npmRebuild: true`) and produces the NSIS installer with the reference DB in `resources/`.
5. The `.exe` (and the Mac `.dmg`) are uploaded as build artifacts and attached to the GitHub Release for the tag.

Release procedure:

```bash
git tag v0.1.0 && git push origin v0.1.0
# → download the .exe from the workflow artifacts / release page
```

### Fallbacks (documented, not the default)

- **Build on Windows directly** (PC/VM with Node): `npm ci && npm run build:refdb -- --out resources/reference.db && npm run dist:win`.
- **Pure-Mac path:** swap `better-sqlite3` for WASM SQLite (`sql.js`) — no native compilation, identical build on every platform, but the whole DB lives in memory and large writes are slower. The data layer is isolated in [src/main/store.ts](src/main/store.ts) + [src/main/refdb.ts](src/main/refdb.ts) precisely so this swap stays cheap if ever needed.

### Code signing (optional)

The unsigned installer triggers a SmartScreen "unknown publisher" warning (More info → Run anyway) — acceptable for a single shop. An OV/EV certificate removes it: configure `win.certificateFile` in [electron-builder.yml](electron-builder.yml) or the `CSC_LINK` / `CSC_KEY_PASSWORD` env vars in CI.

## Scryfall etiquette

All live calls send a real `User-Agent` (`MTGCardVault/…`) and `Accept` header. Card-by-collector lookups stay far under the ~10 req/s allowance because they only happen on genuine cache misses, and hits are cached into the local reference DB. 429 responses surface as errors rather than being retried. Bulk data is only re-downloaded on explicit refresh.

## Project layout

```
src/
  main/           Electron main process
    index.ts      app entry, IPC, app-data resolution, first-launch DB seeding
    store.ts      DataStore — all SQL (reference lookups + inventory upserts)
    refdb.ts      Scryfall bulk download + streaming import (Electron-free)
  preload/        contextBridge API exposed to the renderer
  renderer/       React UI
  shared/         types shared across processes
scripts/
  build-reference-db.ts   build reference.db under plain Node (dev + CI)
  check-refdb.ts          sanity checks: lookups, normalisation, inventory cycle
.github/workflows/build.yml   installer builds (windows-latest + macos-latest)
electron-builder.yml          NSIS/DMG packaging config
```
