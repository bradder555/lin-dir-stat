# LinDirStat

A [WinDirStat](https://windirstat.net/)-style disk-usage visualizer for Linux: a treemap of nested boxes you drill into, paired with a few common disk-cleanup shortcuts, wrapped as a small Electron desktop app.

Built almost entirely by describing what I wanted to [Claude Code](https://claude.com/claude-code), and I have no reservations about saying so — it produced a genuinely useful tool in an evening on a Pinebook Pro, with every line reviewed before being committed.

## What it does

- **Storage Map** — a treemap of your disk, starting from a single "All Storage" box. Double-clicking a box expands it in place (its own boxes appear nested inside, with the header bar staying visible); double-clicking again collapses it. Directories that haven't been expanded yet are marked with `⋯`.
- **Free space** — an optional dashed box on device-level boxes representing unused space, sized from the free-byte figure reported by `df`.
- **File tree** — the same underlying data as a conventional expand/collapse tree, kept in sync with the box view.
- **Cleanup panel** — one-click clearing of the npm cache, Trash, and thumbnail cache. Clearing the pacman package cache and vacuuming the systemd journal are shown as copyable commands instead, since both require `sudo` and the app never invokes it on your behalf.
- **Right-click menu** (available in either the tree or the box view) — "Open in file browser", which reveals the item via `xdg-open`, and "Delete…", which prompts for confirmation before removing anything.
- **Background prefetch** — expanding a folder quietly fetches its children's children one level ahead, so the next expansion usually feels instant.
- **Refresh button** — discards all cached data and re-fetches everything from scratch.

## How it's built

- `server/` — a small Express API. Sizes come from `df` (device totals) and `du` (per-directory breakdown); there is no custom disk-scanning logic, only the standard utilities.
- `client/` — Vite, vanilla JS, and [D3](https://d3js.org/) (`d3.treemap` with `paddingTop` reserved for header bars — that's what produces the nested-box-with-a-label effect).
- `electron/` — a thin wrapper that spawns the Express server as a child process (running the Electron binary itself in Node mode, via `ELECTRON_RUN_AS_NODE`) and points a `BrowserWindow` at it.

## Requirements

Linux, with `du`, `df`, `xdg-open`, and `rm` available on `PATH` — present on virtually every desktop distribution. Node.js 18 or later is required when running from source.

The cleanup panel's package-cache action currently assumes `pacman` (Arch/Manjaro). Everything else — storage browsing, delete, open-in-file-browser, Trash, and thumbnails — works on any distribution.

## Running it

```bash
npm run install:all   # installs dependencies for server, client, and electron
npm run dev           # starts the API (port 3001) and the Vite dev server (port 5173)
```

Then open http://localhost:5173.

To run it as a desktop app instead (this builds the client, then launches Electron):

```bash
npm run electron
```

## Building an AppImage locally

```bash
npm run build:client
cd electron
npm run dist -- --linux AppImage --x64    # or --arm64
```

The resulting AppImage is written to `electron/dist/`.

## Creating a release

Releases are built and published entirely by CI. Tag a commit on `main` and push the tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Pushing a tag matching `v*` triggers `.github/workflows/release.yml`, which builds x64 and arm64 AppImages in parallel and, once both succeed, attaches them to a new GitHub Release named after the tag. No manual build step and no package registry are involved — the release's assets are the two AppImages, ready to download and run.

## Known limitations

- The cleanup panel's package-cache detection is Arch/pacman-only for now; generalizing it to detect `apt`, `dnf`, `zypper`, and others is planned.
- `du` has to walk the actual filesystem, so the first look at a large directory (e.g. `/home`) can take a while on slower disks. That's inherent to how `du` works, not something this app can shortcut.

## License

No license has been chosen for this project yet.
