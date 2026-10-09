# Differences from upstream `dsh-pet` 0.3.0

This document exists so that nobody has to take our word for what came from where. Every number below can be regenerated on your own machine with two commands (at the end of this page), and every change we made is marked in the source with a `[local patch …]` comment.

**Short version:** of the 243 files in the published upstream package `dsh-pet@0.3.0`, **232 are byte-identical in our `src\`**, **11 differ**, **0 are missing**, and we added **3 engine files** of our own (plus `node_modules`, which upstream does not publish).

[中文摘要见文末](#中文摘要)

---

## What is being compared

| Side | What it is |
| --- | --- |
| Upstream (baseline A) | `dsh-pet@0.3.0` as **published on npm** — the built package that `dsh plugin add dsh-pet@0.3.0` installs. 243 files. |
| Upstream (baseline B) | The **git tag `v0.3.0`** of <https://github.com/PC2005-cloud/dsh-pet> — the source repository, which also contains files the package does not ship. 332 files under `dsh-pet/`. |
| Ours | This repository's `src\` — the pet engine exactly as it is copied into the installer. 593 files. |

Both upstream artifacts are MIT-licensed and publicly downloadable, which is the point: the comparison is reproducible without any private access.

## Headline numbers (baseline A: the published package)

| | Files | Bytes |
| --- | --- | --- |
| Upstream package | 243 | — |
| Our `src\` | 593 | — |
| **Byte-identical** (same git blob SHA-1) | **232** | — |
| **Different** | **11** | see the table below |
| **Upstream files missing from ours** | **0** | — |
| **Only here** | 350 | 9,521,266 |

Where the 232 identical files live:

| Directory | Files | Bytes |
| --- | --- | --- |
| `assets/` (animations, memes, fonts, previews) | 143 | 63,573,365 |
| `src/` (TypeScript sources of the engine) | 48 | 534,639 |
| `lib/` (build output other than `index.js`) | 33 | 236,980 |
| `runtime/electron-helper/` (`constants.js`, `host-liveness.js`, `index.html`, `pointer-target.js`, `renderer.js`) | 5 | 29,727 |
| root (`LICENSE`, `cordis.patch.yml`) | 2 | 2,139 |
| `scripts/` | 1 | 2,440 |

*48 of the 50 upstream TypeScript source files are byte-identical* — that is the strongest single piece of evidence about provenance: the engine's source is upstream 0.3.0, with our changes visible in the two files listed below and in the packaged runtime.

## The 11 files that differ

`Markers` = how many lines in that file carry a `[local patch …]` / `[bridge-auth@…]` comment (201 marker lines in total across 7 files).

| File (relative to `src\`) | Upstream | Ours | Markers | Why it differs |
| --- | --- | --- | --- | --- |
| `runtime/electron-helper/sprite.js` | 61,132 | 250,704 | 144 | menu state, drag-hold, speech stats, gaze/cursor handling, animation fixes, voice/typed 「open X」 routing |
| `runtime/electron-helper/main.js` | 54,047 | 138,421 | 24 | local control bridge (now with a token + CORS allow-list), OBS recording channel, cursor broadcast, persona/desktop IPC, folder/file opens |
| `runtime/electron-helper/preload.js` | 3,520 | 8,359 | 15 | the renderer-side counterparts of those bridges (cursor, voice, TTS, canvas) |
| `runtime/electron-helper/shared-core.js` | 51,376 | 52,708 | 2 | chat-send hook (a question is answered before idle chatter) |
| `runtime/electron-helper/events.js` | 17,500 | 18,069 | 0 | permission/chat-priority adjustments; no marker text of its own |
| `lib/index.js` | 82,799 | 116,727 | 16 | balance display, "follow the global switch", chat-priority routing, and answering "online or offline?" from the configuration; this file is a build output |
| `package.json` | 4,615 | 4,277 | 0 | our identity: description, author, `homepage`/`repository`/`bugs` → this repository, version `1.2.1`; `version` and `scripts` are ours |
| `runtime/electron-helper/package.json` | 185 | 258 | 0 | our version plus the files this package ships |
| `README.md` | 30,116 | 31,136 | 0 | a short note at the top of the packaged readme pointing at this repository |
| `src/host/helper-process.ts` | 26,638 | 27,571 | 0 | privacy: no hard-coded user paths; the runtime path is resolved from the installation directory |
| `src/host/storage-paths.test.ts` | 6,540 | 7,039 | 0 | the test uses placeholder names instead of a real user name |

The packaged runtime files are noticeably larger than the npm artifacts. They are the *working copies* of the installed engine (which also carry our patches), not a rebuild of the published bundle, so byte-equality there was never expected — that is why this table exists instead of a claim.

## Files that exist only here

| Path | Files | Bytes | What it is |
| --- | --- | --- | --- |
| `node_modules/` | 348 | 9,487,014 | the engine's runtime dependencies; upstream does not publish them, `npm install` recreates them |
| `runtime/electron-helper/obs-ctl.js` | 1 | — | the OBS WebSocket channel (start/stop recording) |
| `runtime/electron-helper/stt-worker.mjs` | 1 | — | the speech-recognition worker |
| `runtime/electron-helper/targets.js` | 1 | 9,430 | turns what she heard into a URL / a local folder or file / an app name |

## Second view (baseline B: the `v0.3.0` source tag)

| | Files |
| --- | --- |
| Byte-identical | 199 |
| Different | 9 |
| Only upstream | 124 |
| Only ours | ~385 |

The extra 124 upstream-only files are mostly `assets/preview/*.gif` (the animated previews the upstream *repository* uses in its readme; they are not part of the installed package) plus `.prettierignore` and `.prettierrc.json`. Our extra files are `node_modules\`, the `lib\` build output (upstream build output is not committed at the tag) and the three engine files above. So the two baselines measure two different things on purpose: A says "the code and assets you ship are upstream's", B says "you did not delete anything from the project either".

## Honest limits

- No upstream file was deleted, and upstream's own MIT text ships byte-identical as `assets\LICENSE.txt`; the credit lines are untouched (see [NOTICE.md](../NOTICE.md)).
- `src\lib\` is build output produced from `src\src\`; upstream distributes its own build output the same way.
- We do not claim every one of the 11 differences is an improvement — several are simply our product's identity (name, links, version) and two are privacy fixes.
- The marker count (198 lines) counts *comment lines we added*; individual hunks are visible with `git log -p` or by searching for `local patch`.

## Reproduce it

```powershell
# Baseline A — the published npm package (about 62 MB)
iwr "https://registry.npmjs.org/dsh-pet/-/dsh-pet-0.3.0.tgz" -OutFile dsh-pet-0.3.0.tgz
python -m tarfile -e dsh-pet-0.3.0.tgz _upstream\npm-0.3.0
node build/compare-upstream.mjs --dir _upstream\npm-0.3.0\package --md _accept\compare-a.md

# Baseline B — the source tag (one small API request, no download of file contents)
gh api "repos/PC2005-cloud/dsh-pet/git/trees/v0.3.0?recursive=1" > _upstream\upstream-tree-v0.3.0.json
node build/compare-upstream.mjs --tree _upstream\upstream-tree-v0.3.0.json --md _accept\compare-b.md
```

The script compares **git blob SHA-1** values (`sha1("blob <size>\0" + content)`), which is what GitHub's tree API reports, so baseline B needs no file downloads at all. `--json <file>` writes the full per-file result if you want to diff it yourself.

---

## 中文摘要

- **对比对象**：①npm 上发布的 `dsh-pet@0.3.0`（安装包形态，243 个文件）；②上游仓库 `v0.3.0` 标签的源码树（332 个文件）。
- **结论（以发布包为准）**：243 个文件里 **232 个逐字节相同**、**11 个不同**、**0 个缺失**；我们另加 3 个引擎文件（`runtime/electron-helper/obs-ctl.js`、`stt-worker.mjs`、`targets.js`）与不随上游发布的 `node_modules\`（348 个文件）。
- **最有说服力的一条**：上游 50 个 TypeScript 源文件里 **48 个逐字节相同** —— 引擎源码就是 0.3.0 的，改动集中在下面两处以及打包后的运行端文件里。
- **11 个不同的文件**：`runtime/electron-helper/sprite.js`（61,132→250,704，144 处补丁标记）、`main.js`（54,047→138,421，24 处）、`preload.js`（3,520→8,359，15 处）、`shared-core.js`（51,376→52,708，2 处）、`events.js`（17,500→18,069）、`lib/index.js`（82,799→116,727，16 处）、`package.json`（本仓库身份：名称/作者/链接/版本 1.2.1）、`runtime/electron-helper/package.json`（本包版本与其分发的文件）、`README.md`（顶部指向本仓库）、`src/host/helper-process.ts`（隐私：不再硬编码用户路径）、`src/host/storage-paths.test.ts`（测试用占位名）。
- **我们没有删掉上游任何文件**；上游 MIT 全文以 `assets\LICENSE.txt` 逐字节随包分发，署名两行原样保留（见 [NOTICE.md](../NOTICE.md)）。
- **可复跑**：文末两条命令即可自行核对（基线 A 需要下载 62 MB 的 npm 包；基线 B 只需一次 API 请求，脚本比的是 git blob SHA-1，不下载文件内容）。
