# Contributing

Thanks for wanting to help. This is a hobby project maintained by one person, so the most useful things are: a clear bug report, a small focused pull request, or a build/reproducibility fix.

## Ground rules

1. **Do not rename internal identifiers.** `BlueHairMaid`, `dsh-pet`, `dsh-pet-electron-helper`, the `dsh-pet-*` storage keys, the `/dsh-pet-7340` route prefix and the `%APPDATA%\BlueHairMaid` data root are deliberately kept. Renaming any of them silently breaks existing installations ([NOTICE.md](NOTICE.md), section 5).
2. **Keep the upstream attribution intact.** `assets/LICENSE.txt` is the upstream MIT text and ships byte-identical; the upstream copyright line in `LICENSE` stays.
3. **No local paths, no secrets, ever.** `node build\check-paths.mjs` is a build gate that scans for absolute paths and private directories, and the build refuses to run when it fails. Bug reports and PRs must not contain API keys, tokens, or absolute paths from your machine.
4. **Package-visible files need a rebuild.** `src/`, `launcher/`, `standalone/`, `defaults/`, `assets/`, and `verify.mjs` **are** the shipped package: changing any of them changes the released artifacts, so a change there must be followed by a rebuild and a re-verification (below).
5. **Chinese or English is fine** in issues, commit messages and code comments. User-facing docs are English-first (`README.md` + `README.zh-CN.md`).

## Setting up a build

Requirements: Windows 10/11 x64, Node.js 24, Python 3, [NSIS 3](https://nsis.sourceforge.io/) (only for the installer).

About 689 MB of runtime (Electron 43.3.0, node v24.21.0, sherpa-onnx + SenseVoice) is **not** in git. The easiest source is an installed copy of the app:

```powershell
npm run toolchain                                                      # what is missing, and where to get it
node build\build.mjs --toolchain "<an installed Cute Fat Fish Pet dir>" # lay out stage\
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `node build\build.mjs` | Lay out `stage\` (runs the privacy gate first) |
| `node build\build.mjs app launcher` | Rebuild only these blocks |
| `node build\build.mjs --list` | Show what would be done, change nothing |
| `node build\build.mjs --clean` | Delete `stage\` |
| `node build\build.mjs verify` | Refresh and check the staged `verify.mjs` |
| `node build\check-paths.mjs` | Privacy gate only |
| `node build\check-release.mjs` | Prove `stage\` matches the repository byte for byte |
| `node stage\verify.mjs` | Installed-package self-check (tree fingerprints + "must not ship" list) |
| `python build\mkzip.py` / `python build\mkexe.py` | Build the portable zip / the installer |
| `python build\checkzip.py` | Audit a built zip (entries, UTF-8 names, key files) |

## Before you open a pull request

Run these three and paste the result into the PR description:

```powershell
node build\build.mjs --toolchain "<installed dir>"
node build\check-release.mjs
node build\check-paths.mjs
```

If you touched anything under `src\`, `launcher\`, `standalone\`, `defaults\`, `assets\` or `verify.mjs`, also rebuild the artifacts and verify an install:

```powershell
python build\mkzip.py
python build\checkzip.py
python build\mkexe.py
# silent install into a scratch directory, then a byte-for-byte comparison:
python build\verify-install.py stage <scratch dir>
```

> **Careful when testing installs.** The installer and uninstaller write to your real `HKCU` (uninstall entry, desktop shortcut) regardless of where you install. On a machine that already has the pet installed, export `HKCU\Software\BlueHairMaid` and `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BlueHairMaid` first and restore them afterwards. Installing is also not finished after the directory page appears — NSIS starts copying as soon as you press Next, so do not click through the wizard on a machine you care about.

## Style

- Keep changes small and explain **why** in the commit message (what problem it solves, how you verified it). The [development log](docs/development-log.md) is written in exactly that shape — goal → change → verification → commit.
- Match the surrounding code: the engine is plain JS/ESM, the console is one HTML file plus a thin Electron shell, the build is Node scripts plus two Python scripts.
- `src/lib/` is compiled output; if you change the TypeScript in `src/src/`, rebuild `lib/` with the upstream toolchain and say so in the PR.
- Do not reformat files you are not otherwise changing: the released artifacts are compared byte for byte, and whitespace-only churn makes that comparison noisy.

## Reporting bugs

Use the bug report template and include: version, whether the console says the pet is running, what you expected, what happened, and the relevant log (`%APPDATA%\BlueHairMaid\logs\runner.log`, `runner.err.log`, or `pet-control.log`). Strip API keys and personal paths before pasting.

## Security issues

Do not open a public issue — see [SECURITY.md](SECURITY.md).

## What CI does not do

There is no CI yet: gates are run locally and their output is quoted in the pull request and in the [development log](docs/development-log.md). If you want to help by adding a GitHub Actions workflow that builds and runs the gates on Windows, that would be genuinely useful — open an issue first so we can agree on what it should run.
