# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository (Security Advisories). If that is not available to you, open an issue that says only "security report — please contact me" and wait to be contacted.

Please include: what you did, what happened, which version (see `package.json` / the console title), and whether the pet was running standalone or inside another host. I will acknowledge within a few days. There is no bounty — this is a hobby project maintained by one person.

## Supported versions

Only the latest release is supported. Security fixes are shipped in a new release, not back-ported.

## What this application is, from a security point of view

Cute Fat Fish Pet is a Windows desktop application that:

- renders a transparent, always-on-top window on your desktop;
- can take screenshots of your desktop (when screen watching is switched on) and send them to **the model you configured** — a local Ollama model by default, or an online endpoint if you choose one;
- can open apps, files, folders and web pages on your behalf (three separate permission switches, all off until you turn them on);
- can start and stop a screen recording by driving OBS over its WebSocket interface;
- listens on **loopback only** (`127.0.0.1`), never on a LAN interface;
- has **no telemetry** and makes no network request except the ones your own configuration enables (online model endpoints, Edge TTS, update-free by design: there is no updater).

An attacker's realistic goals are therefore: (1) reach the local control ports from a web page you visit, (2) use the pet to open or run something, (3) read what the pet has stored (screenshots, chat history, API keys).

## Local ports and how they are protected

| Port | Who listens | Protection |
| --- | --- | --- |
| `3099` +0…9 | desktop-side control bridge in `src/runtime/electron-helper/main.js` (`startControlBridge`) | **Token required** for every write; CORS origin allow-list; `__proto__` key names rejected; binds `127.0.0.1` |
| `3080` +0…24 | standalone runner in `standalone/server.mjs` | CORS origin allow-list; `/shutdown` requires **POST + token**; binds `127.0.0.1` |

### Token

The desktop-side bridge generates a token per installation (`crypto.randomBytes(24).toString('hex')`), stores it in `helper-control.json` inside the pet's data directory under `$DSH_HOME` (mode `0600`, together with the port and pid), and requires it as `Authorization: Bearer <token>` or `X-Pet-Token: <token>` on write requests. The comparison is constant-time. If the token file cannot be written, the bridge **fails closed**: every write is refused with `401` rather than silently running without authentication.

Requests without a valid token get `401` and — importantly — **nothing happens**: no key is written into the page and the window is not reloaded.

`GET /health` is deliberately unauthenticated so that a launcher can tell whether the bridge is alive; it returns only `{ ok, mode, pid, windows, auth }`.

### CORS

`Access-Control-Allow-Origin: *` is gone. Requests carrying an `Origin` are accepted only when the origin is `http(s)://127.0.0.1[:port]`, `http(s)://localhost[:port]` or `http(s)://[::1][:port]`; the response echoes that origin and carries `Vary: Origin`. Requests with no `Origin` (a local script, `curl`, the app's own renderer) are allowed. Anything else gets `403` **without** CORS headers, so a page cannot read the response — and, because the origin check runs before the routes, unknown origins cannot trigger any action either.

`OPTIONS` is answered only as a preflight (`204`).

This closes the "any web page can silently drive the pet" class of issue: a page you visit can no longer POST to the control bridge, and it can no longer shut the pet down with `<img src="http://127.0.0.1:3080/shutdown">`.

### The `dsh-pet-bridge://` custom protocol

When the pet runs inside a host that uses the `dsh-pet-bridge://` protocol, that protocol still answers with `Access-Control-Allow-Origin: *`. It is not a TCP port: only an application that has registered the protocol handler can answer it, so the usual cross-origin threat model does not apply. It is intentionally left permissive for now and tracked in [docs/architecture-roadmap.zh-CN.md](docs/architecture-roadmap.zh-CN.md).

## Permissions

- Opening apps / files / folders / URLs is behind three permission switches (`pc-ipc`), all **off** by default. Only "open" is implemented — there is no delete, move or "execute this command" path.
- Paths and program names are resolved in the main process; the renderer can only send an action plus the name the user said, never a path of its own choosing.
- Screen recording is delegated to OBS over its WebSocket interface, and the WebSocket password stays in the main process.
- Microphone access is only requested when voice mode is switched on.

## Secrets and private data

| What | Where | Note |
| --- | --- | --- |
| Online model API key | `standalone\online.json` in the program directory | **Plain text.** It is a local file; do not share it or upload the directory |
| Control-bridge token | pet data directory (`$DSH_HOME\dsh-pet\helper-control.json`) | Mode `0600`; regenerated if missing |
| Chat history, persona, screen-watch state | `%APPDATA%\BlueHairMaid\dsh-pet\` (or your custom data root) | Delete the directory to erase; uninstalling does **not** delete it |
| Screenshots taken while screen watching | Temporary, inside the data directory | Sent only to the model you configured |
| Voice self-test recording | Data directory | Only when you press the mic self-test |

What leaves your machine: screenshots (only when screen watching is on **and** an online vision model is configured), TTS text (Edge TTS is an online service), chat prompts (only the model endpoint you configured). Nothing else.

## Verifying a download

Every release asset has a `.sha256` next to it, and the expected hashes are listed in the release notes. Inside the installed package, `node verify.mjs` re-checks the whole `app\` tree and refuses to pass if a file that should never ship (development leftovers, runtime state, `patched\`, user data) is present.

## What is explicitly out of scope

- The absence of code signing (SmartScreen warnings). See [docs/code-signing.zh-CN.md](docs/code-signing.zh-CN.md).
- Anything an attacker can already do after they have code execution as your user: the pet's files are readable by you, and so they are readable by anything running as you.
- The safety of third-party services you configure (Ollama, online model endpoints, Edge TTS, OBS).
- Denial of service on your own machine by your own pet.

---

## 中文摘要

- **报告漏洞**：请走本仓库的 **Security → Report a vulnerability**（私密通道），不要开公开 issue。
- **本机端口只有两个，且都只绑 `127.0.0.1`**：`3099`+（桌面侧控制桥，`src/runtime/electron-helper/main.js`）与 `3080`+（独立运行器，`standalone/server.mjs`）。
- **1.1.0 起的加固**：控制桥的每个写请求都要 token（`Authorization: Bearer` 或 `X-Pet-Token`，常数时间比较；token 存在数据目录的 `helper-control.json`，权限 `0600`；写不进去就**一律拒绝**＝fail-closed）；`Access-Control-Allow-Origin: *` 改成来源白名单（只认 `127.0.0.1` / `localhost` / `::1` 的 http(s)，回显该 Origin 并带 `Vary: Origin`，其它来源 `403` 且不回 CORS 头，且**在路由之前判**）；键名含 `__proto__` 的请求被拒；`/health` 免鉴权但只回状态；独立运行器的 `/shutdown` 改成**必须 POST + token**——以前任何网页用一个 `<img>` 就能把她关掉。
- **权限**：打开软件 / 文件 / 文件夹 / 网页三个开关默认全关，只实现「打开」，没有删除 / 移动 / 执行命令的通道。
- **密钥**：联网模型的 API Key 是**明文**存在程序目录的 `standalone\online.json`，别外发、别整目录上传。
- **只有你配置的联网功能会走网络**：屏幕监测（且必须是联网视觉模型）、Edge TTS、联网模型接口；没有遥测、没有自动更新。
- **核对下载**：每个成品旁边都有 `.sha256`，装好后可跑包里的 `node verify.mjs` 自查。
