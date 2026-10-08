## What this changes

<!-- one or two sentences -->

## Why

<!-- the problem it solves; if it is a bug, how to reproduce it -->

## How it was verified

- [ ] `node build\build.mjs --toolchain "<installed dir>"`
- [ ] `node build\check-release.mjs`
- [ ] `node build\check-paths.mjs`
- [ ] package-visible files changed (`src\`, `launcher\`, `standalone\`, `defaults\`, `assets\`, `verify.mjs`) → artifacts rebuilt and an install verified with `python build\verify-install.py stage <scratch dir>`

Paste the command output (or the relevant lines) below:

```
```

## Checklist

- [ ] No internal identifiers renamed (`BlueHairMaid`, `dsh-pet`, `dsh-pet-electron-helper`, `dsh-pet-*`, `/dsh-pet-7340`)
- [ ] No local absolute paths, API keys or tokens added anywhere
- [ ] Upstream attribution untouched (`LICENSE`, `assets/LICENSE.txt`, `NOTICE.md`)
- [ ] I did not reformat files I was not otherwise changing
