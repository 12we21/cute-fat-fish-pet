# How to publish a release (maintainer checklist)

**English summary.** Step-by-step release checklist: one-time setup, build, run the gates (`build.mjs`, `check-release.mjs`, `check-paths.mjs`, `stage\verify.mjs`), tag, `gh release create`, upload the four assets, then verify the page. **The important rule is at the end: GitHub silently deletes non-ASCII characters from asset names, so every published file name must be ASCII** (`cute-fat-fish-pet-<version>-setup.exe`, `…-win-x64.zip`). No local paths are written in this document; `<...>` means "substitute your own". **This document is in Chinese.**

---

# 怎么把这个仓库发到 GitHub（给自己看的步骤）

> **这份文档里不写任何本机路径**：凡是 `<...>` 的地方按自己的情况替换，`release\`、`stage\` 都是仓库内的相对路径。
> 目标仓库名：`cute-fat-fish-pet`；本版 tag：`v1.1.2`。

## 0. 一次性准备

1. 有 GitHub 账号就登录 <https://github.com>（没有就注册一个，免费）。
2. 装 `git`，再装 `gh` CLI（`winget install --id GitHub.cli -e`），然后登录一次：

   ```powershell
   gh auth login          # 选 GitHub.com → HTTPS → 用浏览器登录
   gh auth status         # 应该显示 Logged in to github.com
   ```

   设备登录偶尔会超时并报 `failed to authenticate via web browser: context deadline exceeded` ——
   重来一次会给**新的** 8 位代码（旧的作废），拿到代码后要去 <https://github.com/login/device> 输入并授权。
3. 不用 `gh` 也行：第一次 `git push` 时 GitHub 不收密码，用 **Personal Access Token** 当密码
   （GitHub → 头像 → Settings → Developer settings → Personal access tokens → Tokens (classic) →
   Generate new token (classic) → 勾 `repo` → 复制那串 `ghp_...`，**只显示一次**）。
   Windows 上一般还会弹一个浏览器登录窗口（Git Credential Manager），点登录更省事。

## 1. 本地先提交好

如果这个目录还不是 git 仓库：

```powershell
git init -b main
git add -A
git commit -m "1.1.2: 联网模型不再把思考过程当台词"
```

提交前先 `git status` 看一眼：**应该看不到** `stage\`、`release\`、`*.log`、`*.bak-*`、`userdata\`、`runtime.json`、
`online.json`（这些都在 `.gitignore` 里）。`git log --stat` 可以看提交内容；提交信息写错了就 `git commit --amend`。

## 2. 在 GitHub 建一个**空**仓库

网页方式：

- 名字：`cute-fat-fish-pet`
- 可见性：`Public`
- **不要**勾 "Add a README file" / ".gitignore" / "license"（否则 push 会撞车）

一条命令方式（顺手就把远端和首次推送做掉了）：

```powershell
gh repo create <你的用户名>/cute-fat-fish-pet --public --source . --push
```

## 3. 推送

```powershell
git remote add origin https://github.com/<你的用户名>/cute-fat-fish-pet.git
git push -u origin main
```

（上面 `gh repo create … --push` 已经做过的话，这一步会提示远端已存在，跳过即可。）

## 4. 发 Release（成品包放这里）

网页方式：

1. 仓库页右侧 **Releases** → **Draft a new release**
2. Choose a tag：填 `v1.1.2` → Create new tag
3. Release title：`可爱大肥鱼桌宠 1.1.2`
4. 说明：把 `docs\release-notes-1.1.2.md` 的内容整段粘进去（**记得先把指纹表里的「打包后填写」换成真值**）
5. 附件（Attach binaries）：拖进 `release\` 里这四个文件
   - `cute-fat-fish-pet-1.1.2-setup.exe`（**主推**，双击就能装；GitHub 附件单文件上限 2 GB，够）
   - `cute-fat-fish-pet-1.1.2-setup.exe.sha256`
   - `cute-fat-fish-pet-1.1.2-win-x64.zip`（绿色包）
   - `cute-fat-fish-pet-1.1.2-win-x64.zip.sha256`
6. **Publish release**

用 `gh` 一条命令也行：

```powershell
gh release create v1.1.2 `
  "release\cute-fat-fish-pet-1.1.2-setup.exe" `
  "release\cute-fat-fish-pet-1.1.2-setup.exe.sha256" `
  "release\cute-fat-fish-pet-1.1.2-win-x64.zip" `
  "release\cute-fat-fish-pet-1.1.2-win-x64.zip.sha256" `
  --title "可爱大肥鱼桌宠 1.1.2" --notes-file "docs\release-notes-1.1.2.md"
```

> **另外每次都要传一个不带版本号的别名资产**，README / 发布说明里那条「永远指向最新版」的链接才一直有效：
> `cute-fat-fish-pet-setup.exe`（内容与带版本号的完全相同，等于给下载链接一个固定的门牌号）与它的 `.sha256`。
> GitHub 的 `…/releases/latest/download/<文件名>` 是按**资产名**去最新那一版里找资产的，名字里带版本号的话，下一版就 404。
>
> 做法：本地复制一份改过名的副本再上传。
> ⚠️ 别用 `gh` 的 `文件名#标签` 语法去改名 —— 它设的是**显示标签**，不是资产名：2026-10-08 实测，
> 用 `#` 传上去之后资产名仍然是带版本号的那个，永久链接照样 404，而那个多余的标签还得用
> `gh api -X PATCH repos/<owner>/<repo>/releases/assets/<数字 id> --input label.json` 清掉
> （payload 必须是 `{"label":""}`；`{"label":null}` 会被 422 拒绝。数字 id 从
> `gh api repos/<owner>/<repo>/releases/latest` 的 `.assets[].id` 取，`gh release view --json assets`
> 给的是 `RA_…` 形式的 node id，拿去 PATCH 会 404）。
>
> ```powershell
> Copy-Item "release\cute-fat-fish-pet-1.1.2-setup.exe" "release\cute-fat-fish-pet-setup.exe"
> $h = ((Get-Content "release\cute-fat-fish-pet-1.1.2-setup.exe.sha256" -Raw).Trim() -split '\s+')[0]
> Set-Content "release\cute-fat-fish-pet-setup.exe.sha256" "$h  cute-fat-fish-pet-setup.exe" -Encoding ASCII
> gh release upload v1.1.2 "release\cute-fat-fish-pet-setup.exe" "release\cute-fat-fish-pet-setup.exe.sha256"
> Remove-Item "release\cute-fat-fish-pet-setup.exe"   # 传完就删，别白占 348 MB
> ```
>
> 传完自己验一下永久链接（要 200，且 `Content-Length` 等于 exe 大小，v1.1.2 是 347760952）：
>
> ```powershell
> Invoke-WebRequest -Method Head "https://github.com/12we21/cute-fat-fish-pet/releases/latest/download/cute-fat-fish-pet-setup.exe"
> ```

> **附件名必须全是 ASCII。** GitHub 会把资产名里的非 ASCII 字符直接删掉：上传
> `可爱大肥鱼桌宠-1.1.0-安装程序.exe` 之后页面上显示成 `-1.1.0-.exe`，用 API
> 改名（`gh api -X PATCH repos/<owner>/<repo>/releases/assets/<id> --input name.json`，
> payload 是 UTF-8 无 BOM 的 `{"name":"…"}`）也会被同样地净化掉。所以 `build\mkexe.py`
> 与 `build\mkzip.py` 现在都产出 ASCII 文件名；中文只留在产品名、快捷方式、「应用和功能」里。

> 产物名和版本号都是从 `src\package.json` 的 `version` 生成的，改名之前先改那里。

## 为什么大文件不在仓库里

GitHub 硬限制**单个文件 100 MB**（超过直接拒收），仓库建议 1 GB 以内。发布包里超过的有：

| 文件 | 大小 |
|---|---|
| `electron\electron.exe` | 225 MB |
| `speech\sensevoice\models\sensevoice-onnx\model.int8.onnx` | 239 MB |
| `node\bin\node.exe` | 93 MB |

所以：**仓库只放源码 / 脚本 / 安装器，成品 zip 与 exe 走 Release 附件**。
`electron\`、`node\`、`speech\` 这三块（合起来约 690 MB）在仓库里只有定位脚本 `build\toolchain.mjs`；
`stage\` 与 `release\` 都被 `.gitignore` 排除，`git status` 里看到它们冒出「未跟踪」就去检查 `.gitignore` 是不是被改了。

## 想从源码重建的人需要什么

`src\` 就是完整源码（不再需要任何「蓝本目录」）。重建只差三块外部运行时，用 `node build\toolchain.mjs`
可以查现状，三种补齐方式（优先级从高到低）：

1. 命令行：`node build\build.mjs --toolchain <一份已装好的 BlueHairMaid 目录>`，
   或分别指 `--electron <目录>` / `--node <目录>` / `--speech <目录>`；
2. 环境变量：`BLUEHAIRMAID_TOOLCHAIN` / `BLUEHAIRMAID_ELECTRON` / `_NODE` / `_SPEECH`
   （语音包还可用 `BLUEHAIRMAID_SHERPA` + `BLUEHAIRMAID_STT_MODELS` 拼）；
3. 常见安装位置：`%LOCALAPPDATA%\BlueHairMaid`、`%ProgramFiles%\BlueHairMaid`、`%USERPROFILE%\BlueHairMaid`。

找不到不会静默跳过：`build\build.mjs` 会直接报错并说明缺哪块。
只想**用**这只桌宠的人：下 Release 解压 → 双击 `安装.cmd`，上面这些都不需要。

## 每次改完东西，重新发一版

```powershell
npm run build          # 铺 stage\（含路径门禁；--no-gate 可跳过，不推荐）
npm run paths          # 单独跑一遍路径门禁
npm run verify         # stage\verify.mjs 核对整树指纹
npm run check          # build\check-release.mjs 与源码对账
npm run zip            # 打 zip 到 release\
npm run exe            # 打安装程序 exe 到 release\（需要本机装了 NSIS 3）
git add -A; git commit -m "1.1.1: ..."; git push
# 再把 release\ 里新的 exe + zip + 两个 .sha256 传到 GitHub Releases（tag v1.1.2）
```

指纹（大小 / sha256）出现在两处：`README.md` 的下载表、`docs\发布说明-<版本>.md` 的下载表 ——
换版本时这两处要一起改（打包前是占位符，打包后填真值）。
