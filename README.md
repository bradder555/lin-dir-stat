# LinDirStat

A [WinDirStat](https://windirstat.net/)-style disk usage visualizer for Linux — a treemap of nested boxes you drill into, plus a few common disk-cleanup shortcuts, wrapped as a small Electron desktop app.

Built almost entirely by describing what I wanted to [Claude Code](https://claude.com/claude-code). I'm not precious about that — it got a genuinely useful tool built in an evening on a Pinebook Pro, and I saw every line before it landed.

![License: none yet](https://img.shields.io/badge/license-unspecified-lightgrey)

## What it does

- **Storage Map** — a treemap of your disk, starting from one "All Storage" box. Double-click a box to expand it in place (its own boxes appear nested inside, header bar stays visible); double-click again to collapse. Directories that haven't been expanded yet are marked with `⋯`.
- **Free space** — toggle a dashed "Free space" box on device-level boxes, sized from `df`'s free-bytes figure.
- **File tree** — the same data as a conventional expand/collapse tree, kept in sync with the box view.
- **Cleanup panel** — one-click clearing of the npm cache, Trash, and thumbnail cache; pacman package cache and systemd journal vacuuming are shown as copyable commands (they need `sudo`, so the app never tries to run them itself).
- **Right-click menu** (tree or box view) — "Open in file browser" (reveals the item via `xdg-open`) and "Delete…" with a confirmation dialog before anything is removed.
- **Background prefetch** — expanding a folder quietly fetches its children's children one level ahead, so the next click in usually feels instant.
- **Refresh** button — re-fetches everything from scratch.

## How it's built

- `server/` — a small Express API. Sizes come from `df` (device totals) and `du` (per-directory breakdown); no custom disk-scanning code, just shelling out to the standard tools.
- `client/` — Vite + vanilla JS + [D3](https://d3js.org/) (`d3.treemap` with `paddingTop` reserved for header bars — that's what makes the nested-box-with-a-label effect work).
- `electron/` — a thin wrapper that spawns the Express server as a child process (running the Electron binary itself in Node mode, via `ELECTRON_RUN_AS_NODE`) and points a `BrowserWindow` at it.

## Requirements

Linux, with `du`, `df`, `xdg-open`, and `rm` on `PATH` (present on essentially every desktop distro). Node 18+ if running from source.

The cleanup panel's package-cache action currently assumes `pacman` (Arch/Manjaro) — everything else (storage browsing, delete, open-in-file-browser, Trash, thumbnails) works on any distro.

## Running it

```bash
npm run install:all   # installs deps for server, client, and electron
npm run dev           # starts the API (port 3001) and Vite dev server (port 5173)
```

Then open http://localhost:5173.

To run it as a desktop app instead (builds the client, then launches Electron):

```bash
npm run electron
```

## Building a release build (AppImage)

```bash
npm run build:client
cd electron
npm run dist -- --linux AppImage --x64    # or --arm64
```

Pushing a tag like `v1.0.0` triggers `.github/workflows/release.yml`, which builds x64 and arm64 AppImages in CI and attaches them to a new GitHub Release — no package registry involved.

## Known limitations

- Cleanup panel's package-cache detection is Arch/pacman-only for now; generalizing it to detect `apt`/`dnf`/`zypper`/etc. is on the list.
- `du` has to walk the actual filesystem, so the first look at a large directory (e.g. `/home`) can take a while on slower disks — that's inherent to how `du` works, not something this app can shortcut.
