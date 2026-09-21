# LinDirStat

A [WinDirStat](https://windirstat.net/)-style disk-usage visualizer for Linux: a treemap of nested boxes you drill into, paired with a few common disk-cleanup shortcuts, wrapped as a small Electron desktop app.

Built almost entirely by describing what I wanted to [Claude Code](https://claude.com/claude-code), and I have no reservations about saying so — it produced a genuinely useful tool in an evening on a Pinebook Pro, with every line reviewed before being committed.

## What it does

- **Storage Map** — a treemap of your disk, starting from a single "All Storage" box. Double-clicking a box expands it in place (its own boxes appear nested inside, with the header bar staying visible); double-clicking again collapses it. Directories that haven't been expanded yet are marked with `⋯`.
- **Free space** — an optional dashed box on device-level boxes representing unused space, sized from the free-byte figure reported by `df`.
- **File tree** — the same underlying data as a conventional expand/collapse tree, kept in sync with the box view.
- **Cleanup panel** — one-click clearing of the npm cache, Trash, and thumbnail cache. Clearing the native package cache (pacman, APT, DNF, Zypper, or APK — whichever is actually installed) and vacuuming the systemd journal are shown as copyable commands instead, since both require `sudo` and the app never invokes it on your behalf.
- **Right-click menu** (available in either the tree or the box view) — "Open in file browser", which reveals the item via `xdg-open`, and "Delete…", which prompts for confirmation before removing anything.
- **Background prefetch** — expanding a folder quietly fetches its children's children one level ahead, so the next expansion usually feels instant.
- **Refresh button** — discards all cached data and re-fetches everything from scratch.

## How it's built

- `server/` — a small Express API. Sizes come from `df` (device totals) and `du` (per-directory breakdown); there is no custom disk-scanning logic, only the standard utilities.
- `client/` — Vite, vanilla JS, and [D3](https://d3js.org/) (`d3.treemap` with `paddingTop` reserved for header bars — that's what produces the nested-box-with-a-label effect).
- `electron/` — a thin wrapper that spawns the Express server as a child process (running the Electron binary itself in Node mode, via `ELECTRON_RUN_AS_NODE`) and points a `BrowserWindow` at it.

## Requirements

Linux, with `du`, `df`, `xdg-open`, and `rm` available on `PATH` — present on virtually every desktop distribution. Node.js 18 or later is required when running from source.

The cleanup panel detects which package manager is actually installed (pacman, APT, DNF, Zypper, or APK) and only shows the matching action; everything else — storage browsing, delete, open-in-file-browser, Trash, and thumbnails — works on any distribution regardless of package manager.

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

Releases are versioned and published entirely by CI — there is no manual tagging step. Every push to `main` runs [semantic-release](https://semantic-release.gitbook.io/), which reads the commit messages since the last release and follows the [Angular commit convention](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#-commit-message-format) to decide what to do:

| Commit prefix / footer                | Effect                    |
| -------------------------------------- | ------------------------- |
| `fix:` or `perf:`                      | Patch release             |
| `feat:`                                | Minor release             |
| `BREAKING CHANGE:` footer, or `!` after the type | Major release   |
| `docs:`, `chore:`, `ci:`, `refactor:`, `style:`, `test:` | No release |

If the commits since the last release warrant one, semantic-release creates the version tag and the GitHub Release itself, with notes generated from those same commit messages; a second job then builds the x64 and arm64 AppImages and attaches them to that release. If nothing releasable landed (e.g. a docs-only push), the workflow does nothing beyond that check — no build, no release.

Just write properly prefixed commit messages and push to `main`; that's the entire release process.

## Known limitations

- `du` has to walk the actual filesystem, so the first look at a large directory (e.g. `/home`) can take a while on slower disks. That's inherent to how `du` works, not something this app can shortcut.

## License

No license has been chosen for this project yet.
