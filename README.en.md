# Branchcraft

[中文（默认）](README.md) | English

A local Git desktop workbench built with Electron and vanilla JavaScript. It invokes system Git and targets Windows, Linux and macOS. The current development branch is `feature/cross-platform`.

## Features

- **Project files**: browse tracked and non-ignored untracked files; edit UTF-8 text and compare it with HEAD or the index. Ctrl+S saves only to the working tree, without staging.
- **Workspace and commits**: folder-grouped staged, unstaged, conflicted and untracked changes; stage/unstage files or all changes, with hunk operations for supported text. Review diffs before committing; message drafts are stored locally per repository.
- **History and branches**: the latest 180 commits, parent graph, labels and patches; create/switch local branches, explicitly create tracking branches from remote branches, merge and abort merges.
- **Remotes and Stash**: fetch, fast-forward pull and ordinary push; stash lists/patches, save, apply, pop and confirmed deletion. Untracked files are included by default, ignored files are not. Conflicted applications retain the stash; original staging is not guaranteed (`--index` is not used).
- **Conflicts**: inspect base/current/incoming text, edit a resolution, save and stage it.
- **Workflow**: automatic external-change refresh plus F5/manual refresh; file/hunk rollback of unstaged changes, with a limited local recovery safety net.
- **Persistent terminal**: a right-side PTY retains shell, directory and process state, supporting input, Ctrl+C and resizing. Hiding preserves the session; switching repositories, reloading or closing the window cleans it up.

## Quick start: source development

Use **Node.js 24, npm 11 and Git** (Git for Windows on Windows). `git --version` must work in your terminal.

```powershell
git clone --branch feature/cross-platform https://github.com/MannixYang/Branchcraft.git
cd Branchcraft
npm ci
npm start
```

These commands work in PowerShell; use `npm.cmd` if execution policy blocks `npm.ps1`. On Linux/macOS, use the same npm commands in your terminal. Open an **existing Git repository** in the app; it does not initialize repositories or configure your global Git identity.

`npm ci` checks for complete target N-API prebuilds for node-pty and installs/builds native dependencies when absent. Linux needs Python, make and a C/C++ compiler; other platforms also need their native toolchain when prebuilds are unavailable. Do not disable native compilation globally.

### Source runs versus release packages

- `npm start` runs current source and requires Node.js and npm.
- Release packages bundle Electron and need no separate Node.js installation, but **still require system Git**. Portable means no app installation; settings/recovery data still use the system user-data directory.
- `npm run pack` updates only the current platform's **unpacked directory** (`release/win-unpacked` on Windows). It **does not update an existing portable EXE or installer**.
- `npm run dist` generates current-platform distributables; explicit commands are `npm run dist:win`, `npm run dist:linux` and `npm run dist:mac`. Output goes to `release/`. Build macOS releases on macOS.

## Platforms and validation scope

| Platform | Configured release targets | This round's real-machine scope |
| --- | --- | --- |
| Windows x64 | NSIS installer, portable EXE | Current usage/validation platform; source and fresh unpacked app, not proof of installer/portable validation |
| Linux x64 | AppImage, deb | **Not validated on a real machine this round** |
| macOS x64 / arm64 | DMG, ZIP | **Not validated on a real machine this round** |

Build configuration, Docker validation scripts and `.github/workflows/build.yml` are not evidence of passing cloud CI or platform acceptance. This document does not claim verified cloud CI, installers or portable launchers.

Linux needs desktop libraries such as GTK3/NSS/GBM; AppImage may need executable permission and FUSE. Do not run the desktop app as root or bypass normal permission problems with `--no-sandbox`. Windows publisher signing and Apple signing/notarization are not configured; run only trusted artifacts and expect possible OS warnings or blocking.

## Safety and limitations

- **Real repository changes**: commit or independently back up important work first. Avoid concurrent writers from other Git clients; automatic refresh is not an interprocess lock. Complex parallel-branch graphs may overlap visually.
- **Git configuration and authentication**: the app uses local identity, remotes, SSH keys/agent and credential helpers, without built-in account login. Interactive Git password prompts are disabled; configure authentication in a terminal first. GUI launches may not inherit custom terminal SSH environments. `BRANCHCRAFT_GIT` accepts an absolute Git executable path, without command arguments.
- **Remote boundaries**: pull always uses `--ff-only` and rejects divergence. Push uses Git's default remote/upstream; new branches may need upstream setup in a terminal. Local bare-remote tests do not verify third-party network/authentication flows. The UI provides no clone, interactive rebase or force push.
- **Hunks and rollback**: hunk staging/unstaging supports ordinary tracked UTF-8 text. Added/deleted/renamed files, mode changes, conflicts, binary or oversized content require file-level operations or external tools. There is no individual-line selection. Hunk actions validate preview tokens and require a fresh preview after changes; unstaged rollback leaves the index unchanged. Git similarity detection may display a rename as deletion plus addition.
- **Editing and conflicts**: project/conflict editing is limited to ordinary UTF-8 text up to 2MiB. Use external tools for unsupported binary, delete/modify or special rename conflicts, then refresh. Project editing does not follow symlinks and checks external-change tokens when saving; this is not an interprocess atomic compare-and-swap, so avoid concurrent edits. Index/HEAD changes after commit review require another review.
- **Size/time limits**: untracked previews and hunk files/diffs have 2MiB limits; Git output buffers are capped at 24MiB and individual commands time out after 120 seconds.
- **The PTY is not a sandbox**: Windows uses PowerShell; Linux/macOS use a login shell. It executes real system commands without confirming each dangerous action. Git hooks and terminal commands must also be trusted.
- **Local recovery is not a complete backup**: original bytes are captured only for supported working-tree rollback/recovery actions; backup failure blocks destructive actions. It does not cover everything (for example, stash deletion or merge abort) or replace commits/independent backups. Restoration leaves the index unchanged and backs up the current state first.
- Recovery records live under Electron's `userData/recovery`, sharing a **7-day, 100MiB** limit across repositories (including JSON/Base64 overhead). Reads/writes prune expired/oldest records; this is not scheduled backup. Records are **unencrypted** and may contain sensitive source. Protect account/directory access; clearing is not secure erasure, and records are not permanent.

## Tests and builds

```powershell
npm test
npm run pack
npm run dist
```

`npm test` covers Git integration, platform environment, file trees, project editing, PTY, local recovery and repository watching, using temporary repositories. Never use personal working repositories for destructive tests.

Real desktop smoke tests need a graphical environment and the extra optional tool `playwright-core` (not an application runtime dependency):

```powershell
npm install --no-save --package-lock=false playwright-core
npm run test:desktop
npm run test:terminal
# Build the unpacked app first; this does not test installers/portable launchers.
npm run pack
node test/packaged-smoke.cjs
```

Desktop tests use temporary repositories, replace the directory picker and write screenshots to `screenshots/` by default. See [Contributing](CONTRIBUTING.md) for more smoke entry points, architecture and PR requirements. These are reproduction instructions, not proof they ran in this task or passed cloud CI.

## Contributing and license

Issues, PRs, documentation improvements and **Linux/macOS real-machine testing contributions** are welcome! Report platform, architecture, reproduction steps and actual test scope. Keep changes small and exclude generated artifacts. See [CONTRIBUTING.md](CONTRIBUTING.md), including its English participation section.

Licensed under the [MIT License](LICENSE).
