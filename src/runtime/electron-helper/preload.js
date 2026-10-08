/* dsh-pet local patches: cursor-bridge@6 voice-bridge@3 tts-bridge@2 cache-bridge@1 obs-rec-bridge@1 */
// preload 桥：只暴露窗口控制原语——
//   - setBounds：宠物窗口逐帧跟随（renderer 上报包围盒的屏幕坐标，主进程 setContentBounds）。
//     x/y/width/height = 窗口内容区坐标（用于移动窗口）；boxX/boxY = 宠物包围盒左上角
//     （工作区坐标）——碰撞站场必须用包围盒坐标，不能用窗口坐标（窗口 = 包围盒 + 四周外扩 margin，
//     差半只宠物宽，会让跨窗碰撞检测整体错位）。
//     size/bottomPad = 碰撞站场登记用（静止宠物只发 set-bounds，靠它带上尺寸才能被其它
//     飞行宠物撞到）；vx/vy = 当前速度（飞行中实时值，静止/拖拽 = 0）。
//   - setInteractive：点击穿透翻转——窗口默认整窗穿透（透明像素不挡下层应用），
//     renderer 在光标进/出宠物身体命中区时上报，主进程 setIgnoreMouseEvents 翻转。
//   - setInputBusy：**我正在用这个窗口的鼠标输入**（拖拽中 / 菜单开着 / 对话弹窗开着），
//     由渲染端上报。主进程光看光标位置与窗口位移分不清"拖拽跟手"和"漫游/抛掷"，而渲染端知道。
//     busy 期间主进程的兜底通道**绝不翻回穿透**（一旦翻回，渲染端正在用的 window 级
//     pointermove/pointerup 就断了：宠物会按旧速度飞出去，连松手的 pointerup 都收不到）。
//     只在状态翻转时发一次（幂等，不逐帧）。
//   - 宠物间碰撞（跨窗，主进程 broker）：
//       reportFlight：飞行中每 ~30ms 上报自己的状态（位置/速度/尺寸）→ 主进程汇聚并广播；
//       onFlightStates：订阅主进程广播的全量宠物状态（碰撞检测用其它宠物的最新位置/速度）；
//       reportCollide：本窗飞行方检测到撞到 targetId → 主进程把动量结果转发给目标窗；
//       onPetHit：订阅「你被撞了」→ 用新初速 startThrow 抛出去（与浏览器 onHit 同语义）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  setBounds(x, y, width, height, boxX, boxY, size, bottomPad, vx, vy) {
    ipcRenderer.send('pet:set-bounds', { x, y, width, height, boxX, boxY, size, bottomPad, vx, vy });
  },
  setInteractive(interactive) {
    ipcRenderer.send('pet:set-interactive', !!interactive);
  },
  // 我正在用这个窗口的鼠标输入（拖拽中/菜单开/弹窗开）：主进程兜底通道在 busy 期间绝不翻回穿透
  setInputBusy(busy) {
    ipcRenderer.send('pet:input-busy', !!busy);
  },
  // 右键菜单「打开网站」：主进程用系统默认浏览器打开 DSH 网站（等效网页 Ctrl+点击链接）
  openDshSite(url) {
    ipcRenderer.send('pet:open-site', { url });
  },
  // ---- 宠物间碰撞（跨窗 broker）----
  reportFlight(state) {
    ipcRenderer.send('pet:report-flight', state);
  },
  onFlightStates(cb) {
    ipcRenderer.on('pet:flight-states', (e, states) => cb(states));
  },
  reportCollide(targetId, vx, vy) {
    ipcRenderer.send('pet:collide-result', { targetId, vx, vy });
  },
  onPetHit(cb) {
    ipcRenderer.on('pet:hit', (e, payload) => cb(payload));
  },
  // 显示器热更新：分辨率/缩放变化、插拔屏、旋转后主进程重算桌面几何并推来
  // （{hull, areas, primaryIndex}，屏幕坐标）——渲染端就地重挂视口与边界。
  onDisplays(cb) {
    ipcRenderer.on('pet:displays', (e, geo) => cb(geo));
  },
  // [local patch G] 全屏光标位置（屏幕坐标；位置变化时推送）→「鼠标接近时看向鼠标」
  onCursor(cb) {
    ipcRenderer.on('pet:cursor', (e, p) => cb(p));
  },
  // [local patch I] 人设写入：交给主进程落到 main-config.json 顶层 whisperPrompt（null = 删掉，回默认人设）
  setPersona(prompt) {
    return ipcRenderer.invoke('pet:set-persona', { prompt: prompt === null || prompt === undefined ? null : String(prompt) });
  },
  // [local patch J] 唱歌：当前在放什么歌（只读窗口标题；v7 起不再取歌词，她自己编词）
  nowPlaying() {
    return ipcRenderer.invoke('pet:now-playing');
  },
  // [local patch K] 自主说话 / 逗图标：桌面**只读**枚举 + 本地小模型直接出语录（不经过 host /chat）
  desktopItems() {
    return ipcRenderer.invoke('pet:desktop-items');
  },
  // [local patch E6] 第四、五个参数：菜单里选的文本模型 / 是否腾显存。
  // 不传 model = 用 state.json 里的 quipModel（老行为，一个字没变）；yieldVram 省略 = 腾。
  localQuip(prompt, system, numPredict, model, yieldVram) {
    return ipcRenderer.invoke('pet:local-quip', {
      prompt: String(prompt || ''),
      system: String(system || ''),
      // [local patch E2] 导演模式要模型吐一段 JSON，80 token 不够 → 允许渲染端指定预算（主进程会夹到安全范围）
      numPredict: Number(numPredict) > 0 ? Number(numPredict) : undefined,
      model: typeof model === 'string' && model.trim() ? model.trim() : undefined,
      yieldVram: yieldVram === false ? false : undefined,
    });
  },
  // [local patch E6] 本机装了哪些 Ollama 模型、现在常驻哪些（右键菜单列选项用；**只读**）
  listModels() {
    return ipcRenderer.invoke('pet:list-models');
  },
  // [local patch P] 权限设置：只做"打开"（软件/文件夹/文件/网页），没有删除/移动/执行命令的通道
  listApps() {
    return ipcRenderer.invoke('pet:list-apps');
  },
  openTarget(payload) {
    return ipcRenderer.invoke('pet:open-target', payload || {});
  },
  // [local patch Z] OBS 录屏：渲染端只能传**动作**，路径/端口/密码全在主进程（obs-ctl.js）里
  recStart() {
    return ipcRenderer.invoke('pet:rec-start');
  },
  recStop() {
    return ipcRenderer.invoke('pet:rec-stop');
  },
  recStatus() {
    return ipcRenderer.invoke('pet:rec-status');
  },
  // [local patch V] 语音模式：开关（主进程据此门控麦克风权限）+ 16kHz Float32 PCM 送本机转写
  setVoiceMode(on) {
    return ipcRenderer.invoke('pet:voice-mode', { on: !!on });
  },
  voiceTranscribe(pcm, lang) {
    // 语言只认 'zh' / 'auto'（默认 zh）：渲染端的值在这里收一次口，主进程还会再收一次
    return ipcRenderer.invoke('pet:voice-transcribe', { pcm, lang: lang === 'auto' ? 'auto' : 'zh' });
  },
  // [local patch V] 自检留录音：把这段 16k 单声道 PCM 覆盖写到固定路径（路径主进程写死，渲染端给不了）
  voiceSelfTestWav(pcm) {
    return ipcRenderer.invoke('pet:voice-selftest-wav', { pcm });
  },
  // [local patch V] 语音链路日志：只上报"这一段听到了什么"，**路径由主进程写死**（渲染端给不了路径）
  voiceLog(entry) {
    return ipcRenderer.invoke('pet:voice-log', entry || {});
  },
  // [local patch T] 语音输出：合成一段 mp3（主进程合成，**不落盘**；这里把 Buffer 归一成精确字节的 Uint8Array）
  // 失败一律 resolve 成 {ok:false,error}，绝不把异常甩给渲染层；成功是 {ok:true, mp3}，可直接 decodeAudioData。
  ttsSpeak(text, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    return ipcRenderer.invoke('pet:tts-speak', { text: String(text === null || text === undefined ? '' : text), voice: o.voice, rate: o.rate }).then((r) => {
      const m = r && r.ok === true ? (r.mp3 || r.data) : null;
      if (!m) return { ok: false, error: (r && r.error) || 'TTS 没有返回音频' };
      // Buffer 常常是 buffer pool 的一片：byteOffset/byteLength 必须都算上，绝不能整个 .buffer 交出去
      const u8 = m instanceof ArrayBuffer ? new Uint8Array(m) : new Uint8Array(m.buffer, m.byteOffset, m.byteLength);
      return { ok: true, mp3: u8, bytes: u8.byteLength, ms: r.ms || 0, voice: r.voice || '' };
    });
  },
  // [local patch X] 清理缓存：只传一个 dryRun 布尔；**删什么完全由主进程写死的白名单决定**（渲染端给不了路径）
  cacheClean(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    return ipcRenderer.invoke('pet:cache-clean', { dryRun: p.dryRun === true });
  },
});
