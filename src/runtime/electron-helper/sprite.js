/* dsh-pet local patches: drag-hold@1 menu-state@8 speech-stats@4 gaze-cursor@1 click-chat@1 mood-model@2 sing-along@8 auto-talk@2 pc-actions@3 move-2d@1 voice-mode@8 tts-speak@3 brain-switch@4 cache-menu@3 director-budget@1 voice-persist@1 */
/**
 * dsh-pet desktop helper —— 宠物本体（PetSprite 类）。
 *
 * 播放 / 拖拽抛掷 / 跨窗碰撞 / 点击穿透 / 右键菜单 / 聊天弹窗 / 气泡渲染。
 * 事件联动（余额 / 碎碎念 / 广播 / 工作状态）不在此文件——见 events.js。
 * 依赖 constants.js 的全局（CONFIG / VIEW / BASE / S / config / sprites 等），须后加载。
 */
'use strict';

// [local patch M2] 主人指路后，这段时间内不自己开始新的溜达（免得"刚走到又自己走开"，像没听话）
const MOVE_HOLD_MS = 60 * 1000;

// ---------- 单只宠物（行为与浏览器 PetCard 一致；纯逻辑来自 src/shared） ----------
class PetSprite {
  constructor(pet) {
    this.pet = pet; // 这只宠物的配置段（拍平后的成品实例，条目级字段已吹入：动画池/权重/周期）
    // 页面级缩放（main 对窗口 setZoomFactor(CONFIG.scale)，见 DESIGN.md §3.5）统一放大整窗：
    // pet.size 即 CSS 像素基准，**不再手工乘 CONFIG.scale**——固定 px UI（菜单/积分/聊天）
    // 随同一缩放自动恢复 DIP 观感；跨进程交换（bounds/几何/碰撞）由 constants.js 的
    // toScreen/toLocal 收口换算，这里与 shared 组件一样零乘除。
    this.size = pet.size;
    this.height = (this.size * 9) / 16;
    this.halfW = this.size / 2;
    this.halfH = this.height / 2;
    this.bottomPad = (this.size * (9 / 16) * (S.CANVAS_H - S.FEET_Y)) / S.CANVAS_H;
    // 窗口高 = 舞台高 + 脚底垫高（stage 被 translateY(bottomPad) 下移的余量，防底部被窗口裁剪）
    this.winH = this.height + this.bottomPad;
    // 窗口内【可交互区域】= 身体命中区（像素，窗口坐标）。浏览器 overlay 只有 .dsh-pet-hit 是
    // pointer-events:auto（root/stage/气泡全 none）——桌面严格对齐：命中区外含透明像素一律穿透到下层应用。
    // HIT_BOX 是 640×360 舞台坐标：x 按窗口宽缩放；y 除舞台高外还要加 bottomPad（舞台被下移）。
    this.hitRect = {
      x: (S.HIT_BOX.x0 / 640) * this.size,
      y: this.bottomPad + (S.HIT_BOX.y0 / 360) * this.height,
      w: ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * this.size,
      h: ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * this.height,
    };
    window.__dshPetDebug.hitRect = this.hitRect;
    // 左右透明边余量（视频盒内宠物身体居中）：让边界按"身体"贴边——宠物能走到屏幕边缘，
    // 但身体永不越界（漫游/拖拽都不会弄丢宠物）。与浏览器 overlay 的 sideAllow 同一套语义。
    this.sideAllow = (S.HIT_BOX.x0 / 640) * this.size;
    window.__dshPetDebug.sideAllow = this.sideAllow;
    // 窗口四周外扩（= WINDOW_MARGIN_RATIO×宠物尺寸）：sprite 钉在 (margin.l, margin.t)，
    // 窗口 = sprite + 四边余量——气泡/未来弹窗显示在余量里；余量透明且点击穿透
    const m = this.size * WINDOW_MARGIN_RATIO;
    this.margin = { t: m, r: m, b: m, l: m };
    window.__dshPetDebug.winMargin = this.margin;
    // 宠物包围盒左上角在【工作区】坐标系里的位置（本窗口的位置 = 宠物的位置）
    this.pos = { x: 0, y: 0 };

    // 播放状态（与浏览器同构）
    // 动画池与权重按宠物取：文件宠物（pet/ 目录定义，extra）自带**完整独立**动画池；
    // main 等常规宠物（无 anims 段）用全局 cfg.animations（与浏览器 pet.ts 同一语义）。
    this.animations = pet.animations || cfg.animations;
    this.weights = pet.animationWeights || cfg.animationWeights;
    // 拖拽抛掷物理参数（顶层全局；拍平已吹入实例，兜底回全局/默认）
    this.physics = pet.physics || config.physics || S.DEFAULT_PHYSICS;
    // 素材根按 assetRoot（文件宠物 = 配置文件前缀，多实例共享同一素材目录）或宠物 id 回落
    this.assetBase = BASE + '/thumb/' + encodeURIComponent(pet.assetRoot || pet.id) + '/';
    this.front = 0; // 0 = A, 1 = B
    this.pending = null;
    this.gen = 0;
    this.anim = this.animations.idle[0] ?? '';
    this.once = true;
    this.facing = 'left';
    // 交互/移动
    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0 };
    this.justDragged = false;
    this._interactive = null; // 已上报的可交互状态（setInteractive 去重用）
    this._inputBusy = null; // 已上报的"正在用输入"状态（syncInputBusy 去重用）
    // 拖拽抛掷物理（与浏览器 pet.ts 同构；纯计算在 shared-core S.*）：
    // 拖拽中弹簧跟随目标（包围盒左上角，工作区 px），松手按指针轨迹估速 → 抛掷（重力+边缘反弹）
    this.dragTrail = []; // 指针轨迹采样（screenX/Y + performance.now()，初速估算用）
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
    this.dragFollow = null; // 弹簧跟随 rAF handle
    this.dragFollowToken = 0;
    this.throwRef = null; // 抛掷 rAF handle
    this.throwToken = 0;
    this.space = null; // 抛掷空间（逐屏 AABB）缓存；显示器变化时由 relayout() 置空重建
    // Q 弹挤压（点击回应 / 抛掷落地）：rAF + 待压标记（等新动画成为前台再压，压新首帧）
    this.squashRef = null;
    this.squashToken = 0;
    this.pendingSquash = false;
    this._interactive = null; // 当前可交互状态（null=未定；只在变化时发 IPC，避免逐帧刷屏）
    this.moveRef = null;
    this.moveToken = 0;
    this.pendingMove = null;
    this.customPos = null; // 拖拽后的会话内位置（{rx, ry} 比例）；restart 回角落
    // 右键菜单（统一自绘组件，两端共用同一份：树+渲染均来自 shared-core）
    this.menuOpen = false; // 菜单开启期间强制整窗可交互（悬停菜单不触发穿透翻转）
    this.menuClose = null; // 当前菜单的 close()（打开时挂载，关闭后置空）
    // 余额气泡
    this.bubbleOn = false;
    this.bubbleTimer = null;
    this.balanceView = null;
    this.balanceWrap = false; // true = 当前余额气泡是不可用的「文字说明」（多行，需换行变体）
    this.prevTick = 0;
    // 碎碎念（每只独立：自己轮询 /whisper?pet=<id>、自己的文本/配图与触发）
    this.whisperOn = false;
    this.whisperTimer = null;
    this.whisperView = null;
    this.whisperText = '';
    // 配图名称（配置 memes 的键；whisperImageEnabled 开启时由 host 随机抽定，随文本一起来）
    this.whisperImage = '';
    this.whisperBaseline = false;
    this.prevWhisperTs = 0;
    this.whisperLoopTimer = null;
    // 命令触发气泡（/chat 命令）：1s 轻轮询 /broadcast，ts 变化即弹气泡（与碎碎念周期独立，不受开关门控）
    this.broadcastLoopTimer = null;
    this.broadcastBaseline = false;
    this.prevBroadcastTs = 0;
    // 工作状态联动（DSH 会话状态）：容器 1s 轮询 /work-status 递增 workTick → 本宠物按档位播动画+气泡。
    // 气泡优先级 work > whisper > balance；workStatusEnabled 未启用时完全免疫（与浏览器一致）
    this.workOn = false;
    this.workTimer = null;
    this.workText = null;
    this.workState = null; // 最近一次工作状态（互动/事件动画播完恢复档位循环用）
    this.prevWorkState = null; // 上一档状态（气泡只在状态变化时点亮/收起，Bug 2）
    this.prevWorkTick = 0;
    // 对话弹窗（shared 组件）：当前挂载的 close() 句柄 + 开启标记
    // （chatOpen 是穿透守卫：弹窗是窗口内 DOM，期间整窗保持可交互，与 menuOpen 同语义——否则
    //   光标移到输入框（不在身体命中区）就会被 onMouseMove 翻回穿透，点击全被透传）
    this.chatClose = null;
    this.chatOpen = false;

    // DOM：sprite 钉在窗口内 (margin.l, margin.t)；宠物"位置"= sprite 位置，窗口随余量外扩
    this.el = document.createElement('div');
    this.el.className = 'pet-sprite';
    this.el.style.left = this.margin.l + 'px';
    this.el.style.top = this.margin.t + 'px';
    this.el.style.setProperty('--pet-size', this.size + 'px');
    const stage = document.createElement('div');
    stage.className = 'pet-stage';
    stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.stage = stage;
    this.videoA = document.createElement('video');
    this.videoA.className = 'pet-video is-front';
    this.videoB = document.createElement('video');
    this.videoB.className = 'pet-video';
    for (const v of [this.videoA, this.videoB]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.title = this.pet.name;
    }
    this.hit = document.createElement('div');
    this.hit.className = 'pet-hit';
    this.hit.style.left = (S.HIT_BOX.x0 / 640) * 100 + '%';
    this.hit.style.top = (S.HIT_BOX.y0 / 360) * 100 + '%';
    this.hit.style.width = ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * 100 + '%';
    this.hit.style.height = ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * 100 + '%';
    this.hit.title = this.pet.name;
    this.bubble = document.createElement('div');
    this.bubble.className = 'pet-bubble';

    stage.appendChild(this.videoA);
    stage.appendChild(this.videoB);
    stage.appendChild(this.hit);
    this.el.appendChild(this.bubble);
    this.el.appendChild(stage);
    rootEl.appendChild(this.el);
    this.position();

    // 事件（与浏览器同一套：pointerdown/move、click、window pointerup/cancel）
    const ac = new AbortController();
    this.ac = ac;
    this.hit.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal: ac.signal });
    this.hit.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal: ac.signal });
    this.hit.addEventListener('click', () => this.onClick(), { signal: ac.signal });
    this.hit.addEventListener('contextmenu', (e) => this.onContextMenu(e), { signal: ac.signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal: ac.signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal: ac.signal });
    this.hit.addEventListener('lostpointercapture', (e) => this.onPointerUp(e), { signal: ac.signal });
    // 点击穿透：窗口默认整窗穿透（main 设 setIgnoreMouseEvents(true, {forward:true})），
    // 光标进/出身体命中区时翻转可交互；穿透期间 mousemove 由 main 转发进来（forward:true），
    // mouseleave 保证光标离开窗口立即恢复穿透（透明像素不挡下层应用，与浏览器一致）。
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });
    window.addEventListener(
      'mouseleave',
      () => {
        // 光标离开窗口：菜单若开着立刻收起（菜单是窗口内 DOM，离开即不可达），再恢复穿透；
        // 对话弹窗开着则不恢复——弹窗是窗口内 DOM，鼠标还要回来点输入框（与 menuOpen 同守卫）
        this.closeMenu();
        if (!this.chatOpen) this.setInteractive(false);
      },
      { signal: ac.signal },
    );

    // 宠物间碰撞（跨窗 broker）：订阅其它宠物状态广播（碰撞检测用）+ 「被撞」事件 → onDeskHit。
    // 注意：退订由窗口销毁自然回收（webContents 销毁后 ipc 事件不再派发），无需显式取消。
    this.others = {}; // petId -> {x,y,vx,vy,size,bottomPad}（其它宠物的最新状态，来自主进程广播）
    this.throwState = null; // 飞行中的实时状态（被撞查询 / 其它窗碰撞检测时上报用）
    this.pressScoreFired = false; // 按下瞬间已触发过积分（pointerdown 即触发；click 据此不重复弹，同浏览器）
    this.lastFlightReport = 0;
    if (window.petBridge && window.petBridge.onFlightStates) {
      window.petBridge.onFlightStates((states) => {
        if (!states || typeof states !== 'object') return;
        const next = {};
        for (const pid of Object.keys(states)) {
          if (pid === this.pet.id) continue; // 排除自己
          const s = states[pid];
          next[pid] = {
            // 碰撞 broker 协议单位是物理像素（与窗口 bounds 一致）：÷scale 进本窗口 CSS 系（§3.5）
            x: toLocal(Number(s && s.x) || 0),
            y: toLocal(Number(s && s.y) || 0),
            vx: toLocal(Number(s && s.vx) || 0),
            vy: toLocal(Number(s && s.vy) || 0),
            size: toLocal(Number(s && s.size) || 0),
            bottomPad: toLocal(Number(s && s.bottomPad) || 0),
          };
        }
        this.others = next;
      });
      window.petBridge.onPetHit((payload) => {
        const vx = Number(payload && payload.vx);
        const vy = Number(payload && payload.vy);
        if (Number.isFinite(vx) && Number.isFinite(vy)) this.onDeskHit(toLocal(vx), toLocal(vy));
      });
    }
    // [local patch C] 说话统计 + 光标订阅 + [local patch H] 性格/活跃度 + [local patch M] 自主说话 + [local patch P] 权限
    this.hookSpeechStats();
    this.hookGazeCursor();
    this.hookMood();
    this.hookAutoTalk();
    // [local patch W] 全局大脑（host 的 screen-watch/state.json 是事实来源，启动先读一次）
    this.brain = 'dsh';
    this.brainProbedAt = 0;
    this.refreshBrain();
    this.hookPcActions();
    this.hookVoiceMode(); // [local patch V] 语音模式（默认关，不自动开麦）
    // [local patch E6] 语音模式「记着上次的状态」：上次开着 → 这次开机自己开回来。
    // 老代码 on 从不落盘，重启即静音 —— 主人报告的「语音叫她没反应」就是这个。
    // 延迟 3s 等界面/权限就绪；开不起来就把盘上也改成关（不再每次启动都试一遍）。
    if (this.voiceState && this.voiceState.on) {
      window.setTimeout(() => {
        if (!this.voiceState || !this.voiceState.on || this.voice) return;
        this.voiceState.on = false; // startVoiceMode 有幂等短路（见 :3248），必须先复位再开
        Promise.resolve(this.startVoiceMode())
          .then((ok) => {
            if (!ok && this.voiceState && !this.voiceState.on) this.saveVoice();
          })
          .catch(() => {
            if (this.voiceState) {
              this.voiceState.on = false;
              this.saveVoice();
            }
          });
      }, 3000);
    }
    this.hookTtsSpeak(); // [local patch T] 语音输出：包一层 showWhisper（拿整段原文，切句归 TTS）
    this.hookTtsEchoGate(); // [local patch T] 回声门控：我出声时麦克风整帧丢掉
  }

  dispose() {
    this.stopSinging(); // [local patch L] 停掉跟唱定时器，避免窗口销毁后回调
    this.stopVoiceMode(); // [local patch V] 关掉麦克风与音频上下文
    this.ttsStop(); // [local patch T] 停掉朗读队列与音频
    this.ac.abort();
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
    if (this.whisperLoopTimer !== null) window.clearTimeout(this.whisperLoopTimer);
    if (this.broadcastLoopTimer !== null) window.clearTimeout(this.broadcastLoopTimer);
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
    }
    this.closeMenu();
    this.stopThrow();
    this.stopDragFollow();
    this.stopSquash();
    this.stopMove();
    this.el.remove();
  }

  // 目标包围盒左上角（视口相对坐标）→ 移动窗口：窗口 = sprite + 四周外扩余量
  // （sprite 钉在窗口 (margin.l, margin.t)，气泡/弹窗显示在余量里）。
  // setContentBounds 要**屏幕**坐标：pos 是视口（桌面外接矩形）相对坐标，先加 VIEW.x/y
  // 再统一 ×scale 回物理像素（§3.5 IPC 收口）——主进程收到的数字与线性化旧行为逐位一致，
  // 主进程侧（bounds/去重/碰撞 broker）完全不用改。
  sendBounds(px, py) {
    this.pos = { x: Math.round(px), y: Math.round(py) };
    window.__dshPetDebug.dragPos = { x: this.pos.x, y: this.pos.y };
    if (window.petBridge) {
      // 完整状态一次捎带：size/bottomPad 让静止宠物从首帧起就登记进碰撞站场
      // （此前只有 report-flight 带尺寸，从没飞过的宠物 size=0 被碰撞检测直接跳过）；
      // vx/vy 带当前速度——飞行中实时值、静止/拖拽 = 0，避免落地后残留上次飞行速度干扰碰撞动量。
      const fly = this.throwState;
      window.petBridge.setBounds(
        toScreen(this.pos.x - this.margin.l + VIEW.x),
        toScreen(this.pos.y - this.margin.t + VIEW.y),
        toScreen(this.size + this.margin.l + this.margin.r),
        toScreen(this.winH + this.margin.t + this.margin.b),
        toScreen(this.pos.x), // 包围盒左上角（碰撞站场用：窗口坐标 ≠ 包围盒坐标）
        toScreen(this.pos.y),
        toScreen(this.size),
        toScreen(this.bottomPad),
        fly ? toScreen(fly.vx) : 0,
        fly ? toScreen(fly.vy) : 0,
      );
    }
  }

  // 角落/边距 → 窗口位置；拖拽后按会话内位置（比例）还原——**松手无任何边界夹取**，
  // 宠物停在哪就算哪（与浏览器一致：可以完全拖出工作区/屏幕；漫游仍有 planMove 边界检查兜底）
  position() {
    const W = VIEW.w;
    const H = VIEW.h;
    let x;
    let y;
    if (this.customPos) {
      x = this.customPos.rx * W - this.halfW;
      y = this.customPos.ry * H - this.halfH;
    } else {
      // 角落取**主屏**而不是外接矩形：不规则多屏布局下外接矩形的角落可能不属于任何显示器
      // （实测右倒 T 型双屏，top-left 落在主屏上方的空洞里），配了该角落的宠物开机即隐身。
      const anchor = S.anchorPixel({
        corner: this.pet.position.corner,
        // marginX/marginY 是配置里的绝对像素：页面级缩放（§3.5）已统一放大整窗，
        // 配置值不再手工乘 CONFIG.scale——150% 屏上与「线性化 + 旧 CONFIG.scale 补偿」观感一致
        marginX: this.pet.position.marginX,
        marginY: this.pet.position.marginY,
        size: this.size,
        W,
        H,
        area: PRIMARY_AREA || undefined,
      });
      x = anchor.x;
      y = anchor.y;
    }
    this.sendBounds(x, y);
  }

  /** 抛掷空间（逐屏 AABB）。AREAS/PANELS 变化时由 relayout() 置空重建——飞行中每帧重算太浪费 */
  throwSpaceOf() {
    if (!this.space || this.space.areas !== AREAS || this.space.panels !== PANELS) {
      this.space = S.throwSpace({ areas: AREAS, panels: PANELS, size: this.size, sideAllow: this.sideAllow });
    }
    return this.space;
  }

  /**
   * 显示器几何变化（改分辨率/缩放、插拔屏、旋转）后就地重挂：
   * 抛掷空间作废，并把宠物从可能变成空洞的位置拉回可见区。
   * 拖拽中不动它（用户正握着，位置由指针决定）；飞行中也不动（下一帧物理自会按新边界夹取）。
   */
  relayout() {
    this.space = null;
    if (this.dragState.active || this.throwRef !== null) return;
    this.stopMove();
    const cx = this.pos.x + this.halfW;
    const cy = this.pos.y + this.halfH;
    const p = S.clampPointToRegion(AREAS, cx, cy);
    if (p.x !== cx || p.y !== cy) {
      this.customPos = { rx: p.x / VIEW.w, ry: p.y / VIEW.h };
    }
    this.position();
  }

  currentCenterX() {
    if (this.customPos) return this.customPos.rx * VIEW.w;
    return this.pos.x + this.halfW;
  }
  currentCenterY() {
    if (this.customPos) return this.customPos.ry * VIEW.h;
    return this.pos.y + this.halfH;
  }

  // 双缓冲切换（与浏览器同一套：前台 opacity 切换 + 降级视频清 handler 并停播，防残留 ended 雪崩）
  switchTo(next, nextOnce) {
    if (!next) return;
    const pending = this.pending;
    if (pending && pending.anim === next && pending.once === nextOnce) {
      // 防重命中（单动画点击时目标=当前动画，不重播）：仍消费 Q 弹标记，压当前前台视频，
      // 保证「点击唯一动画」时挤压反馈不丢（与浏览器同构）。
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(this.front === 0 ? this.videoA : this.videoB);
      }
      return;
    }
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const target = this.front === 0 ? this.videoB : this.videoA;
    const el = target;
    if (!el) return;
    el.src = this.assetBase + encodeURIComponent(next) + (S.ANIMATION_EXT || '.webm');
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.onended = nextOnce ? () => this.handleEnded() : null;
    // 加载兜底（与浏览器 web 端 fetch+blob 的 10s 超时同义）：素材加载失败或卡住时必须释放
    // pending，否则它永久挂起——之后相同目标会被防重分支吞掉、不同目标靠 gen 覆盖，
    // 表现就是"点了没反应"（#62 报告的就是 web 端同一类问题，桌面端此前完全没有兜底）。
    const loadGuard = (why) => {
      if (!this.pending || this.pending.gen !== gen) return;
      this.pending = null;
      console.warn('[dsh-pet] 素材加载失败 pet=' + this.pet.id + ' anim=' + next + '：' + why + '（已释放本次切换）');
    };
    const loadTimer = window.setTimeout(() => loadGuard('10s 超时'), 10000);
    el.onerror = () => {
      window.clearTimeout(loadTimer);
      loadGuard('video error');
    };
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      window.clearTimeout(loadTimer);
      el.onerror = null;
      if (this.pending && this.pending.gen !== gen) return;
      const old = this.front === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old && old !== el) {
        old.classList.remove('is-front');
        old.onended = null;
        old.pause();
      }
      this.front = this.front === 0 ? 1 : 0;
      this.pending = null;
      el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      el.play().catch(() => {});
      // 点击 Q 弹：等新动画就位后才压（压的是新点击动画的首帧，与浏览器一致）
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(el);
      }
      if (this.pendingMove) this.startMoveDrive(el);
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  }

  playOnce(name) {
    this.anim = name;
    this.once = true;
    this.switchTo(name, true);
  }

  // [local patch A] 循环播一段（once=false → el.loop=true，永不触发 ended）：
  // 拖拽期间用它把惊慌反应一直播下去，松手时 onPointerUp 的恢复路径会切走。
  playHold(name) {
    this.anim = name;
    this.once = false;
    this.switchTo(name, false);
  }

  // 动画链（与浏览器 pickNext 语义一致，纯逻辑在 shared）
  playIdle() {
    this.stopMove();
    const { animations, animationWeights } = { animations: this.animations, animationWeights: this.weights };
    const roll = Math.random();
    const k = S.rollKind(roll, animationWeights);
    let next;
    if (k === 'idle') {
      next = S.pick(animations.idle, this.anim);
    } else if (k === 'turn') {
      next = S.pick(animations.turn, this.anim);
    } else if (k === 'move' && Date.now() >= this.moveHoldUntil) {
      // [local patch M2] 主人刚指过路：这一分钟内不自己溜达（否则"刚走到又自己走开"像没听话）；
      // 被让路时落到下面的 else，正常播 idle/随机池，不会僵在移动动画的最后一帧。
      const moved = this.tryMove();
      if (moved === false) {
        const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
        next = act.name;
      } else if (typeof moved === 'string') {
        next = moved;
      } else {
        // 已有一场移动进行中（占用）：与浏览器一致，重播当前动画，不另设（绝不重复加载不存在的动作）
        this.playOnce(this.anim);
        return;
      }
    } else {
      const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
      next = act.name;
    }
    this.playOnce(next);
  }

  handleEnded() {
    if (this.dragState.active) return;
    // [local patch M2] 指路还没走完就接着走下一趟（别在半路回 idle 站着不动）
    if (this.walkPlan && this.resumeWalk()) return;
    // [local patch E2] AI 导演排的"走过去 + 到了再做个小动作"：走完了把动作补上（走一趟可能分好几段）
    if (!this.walkPlan && this.pendingDirectorAct) {
      const pdAct = this.pendingDirectorAct;
      this.pendingDirectorAct = null;
      this.playDirectorAct(pdAct);
    }
    const { animations } = { animations: this.animations };
    // 事件动画播完：回 idle（与 drag/clicks 同分支，不进随机链）；气泡由定时器自动消失，与动画解耦
    const isEvent = S.isEventAnim(animations.events, this.anim);
    if (isEvent) {
      // 工作状态多候选档位：播完一段自动轮换到下一候选（排除当前段，避免连抽），继续循环——
      // 长时间状态不单段重复（与浏览器 ended 护栏共用同一决策 nextWorkStatusAnim）。
      // 仅非终态档位轮换；终态（success/error）播完一次即结束，绝不轮换续播。单候选档位由
      // loop 无限循环（不触发 ended，不会走到这里）。
      const nonTerminal = this.workState && this.workState !== 'success' && this.workState !== 'error';
      const nextWork = nonTerminal ? S.nextWorkStatusAnim(animations.events?.workStatus ?? [], this.anim) : null;
      if (nextWork !== null) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' workStatus 档内轮换: ' +
            this.anim +
            ' -> ' +
            nextWork,
        );
        this.playOnce(nextWork); // 继续播一遍（once=true）→ ended 再轮换
        return;
      }
      // 非 workStatus 事件动画（余额/碎碎念）播完：workStatus 仍非终态 → 立即恢复档位循环动画，
      // 不进随机链（长事件期间状态不变，随机链会一直播到状态切换才被拉回）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    if (animations.turn.includes(this.anim)) {
      // [local patch D] 光标就在旁边时不随机翻面：朝向交给 gaze（否则刚看向你就被翻走）
      if (!this.gazeNear) {
        const next = this.facing === 'left' ? 'right' : 'left';
        this.facing = next; // 立即同步：翻转后的 pickNext 用新朝向过滤 noMirror
      }
    }
    if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {
      // 互动动画播完：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器同一语义）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    this.playIdle();
  }

  // 互动/事件动画播完后恢复 workStatus 档位循环：非终态 → 按当前状态档位重选动画（多候选档内
  // 随机并避开当前段）；终态/空闲 → false 不接管，调用方走原逻辑（回 idle / 随机池，与浏览器一致）。
  resumeWorkStatusAnim() {
    const state = this.workState;
    if (!state || state === 'success' || state === 'error') return false;
    const pool = this.animations.events?.workStatus;
    if (!pool || pool.length === 0) return false;
    const idx = S.WORK_STATUS_INDEX[state];
    const slot = pool[idx];
    if (slot === undefined) return false;
    const name = S.pickSlot(slot, this.anim); // 避开当前正播动画（避免连续重复）
    console.log(
      '[dsh-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + this.pet.id + ' 恢复工作状态动画: ' + name,
    );
    const rotating = Array.isArray(slot) && slot.length > 1;
    if (rotating)
      this.playOnce(name); // 多候选：播完由 handleEnded 轮换
    else this.switchTo(name, false); // 单候选：无限循环
    return true;
  }

  // ---- 漫游（rAF 驱动，动画首尾各 leadSec/tailSec 秒原地不动；几何在 shared/planMove） ----
  // preferredName 传入时固定使用该动画（右键菜单点播移动动画），否则与随机链一致随机选
  // ===== [local patch S] 移动升级：上下也能走 + 追光标 =====
  // 纵向概率随活跃度提高（安静 0 → 正常 0.35 → 活跃 0.6 → 嗨起来 0.8），落点按工作区上下边界夹取。
  moveVerticalChance() {
    return { quiet: 0, normal: 0.35, lively: 0.6, hyper: 0.8 }[this.activity] ?? 0.35;
  }

  // 光标在本窗口局部坐标 → 视口坐标（精灵左上角 + 局部偏移 - margin），追光标用
  cursorViewport() {
    const c = this.cursorLocal;
    if (!c) return null;
    return { x: this.pos.x + (c.x - this.margin.l) + this.halfW, y: this.pos.y + (c.y - this.margin.t) + this.halfH };
  }

  // 这趟要不要追光标：活跃度越高越爱追；光标信息太旧（4s 没动）就不追
  chaseWanted() {
    if (!Number.isFinite(this.lastCursorAt) || Date.now() - this.lastCursorAt > 4000) return false;
    const chance = { quiet: 0, normal: 0.25, lively: 0.6, hyper: 0.75 }[this.activity] ?? 0.25;
    return Math.random() < chance;
  }

  // 纵向落点（相对当前位置的 dy）：wantY 给了就朝它去（追光标），否则按概率随机上下
  pickMoveDy(mp, H, distScale, wantY) {
    const areas = AREAS && AREAS.length ? AREAS : null;
    const areaTop = areas ? Math.min(...areas.map((a) => a.y)) : 0;
    const areaBottom = areas ? Math.max(...areas.map((a) => a.y + a.height)) : H;
    const topC = areaTop + mp.margin + this.halfH;
    const bottomC = areaBottom - mp.margin - this.halfH;
    const cy = this.currentCenterY();
    let want;
    if (Number.isFinite(wantY)) {
      want = wantY;
    } else {
      if (Math.random() >= this.moveVerticalChance()) return 0;
      const span = Math.max(40, (Number(mp.maxDist) || 0) * distScale);
      want = cy + (Math.random() < 0.5 ? -span : span) * (0.45 + Math.random() * 0.55);
    }
    return Math.max(topC, Math.min(bottomC, want)) - cy;
  }

  tryMove(preferredName) {
    if (this.moveRef !== null || this.pendingMove || this.throwRef !== null) return true;
    const moves = this.animations.moves;
    const actions = moves.actions;
    if (!actions.length) return false;
    const chosen = preferredName
      ? actions.find((a) => a.name === preferredName) || null
      : actions[Math.floor(Math.random() * actions.length)];
    if (!chosen) return false;
    const mp = Object.assign({}, moves.default, chosen.params || {});
    let dir = (this.facing === 'right') !== this.animations.turn.includes(this.anim) ? 1 : -1;
    const W = VIEW.w;
    const H = VIEW.h;
    const distScale = this.size / S.PET_REF_WIDTH;
    // [local patch S] 追光标：把这一趟的落点直接定在光标位置（距离夹在 minDist~maxDist*2.5）
    const chase = this.chaseWanted() ? this.cursorViewport() : null;
    let minDist = mp.minDist * distScale;
    let maxDist = mp.maxDist * distScale;
    if (chase) {
      const dx = chase.x - this.currentCenterX();
      if (Math.abs(dx) > 12) {
        dir = dx > 0 ? 1 : -1;
        minDist = maxDist = Math.min(Math.max(Math.abs(dx), minDist), maxDist * 2.5);
      } else {
        minDist = maxDist = mp.minDist * distScale;
      }
    }
    const dy = this.pickMoveDy(mp, H, distScale, chase ? chase.y : NaN);
    const plan = S.planMove({
      cx: this.currentCenterX(),
      cy: this.currentCenterY(),
      W,
      H,
      dir,
      minDist,
      maxDist,
      margin: mp.margin, // 同 position() 的 marginX/marginY：页面级缩放统一放大，配置值不再乘 scale（§3.5）
      halfW: this.halfW,
      sideAllow: this.sideAllow,
      // 落点按显示器并集判定：能骑缝跨屏走，但走不进外接矩形里的空洞
      areas: AREAS,
    });
    if (!plan) return false;
    // [local patch S] 纵向落点交给驱动插值（shared 的 planMove 只管横向，这里补 targetYRatio）
    plan.targetYRatio = (this.currentCenterY() + dy) / H;
    this.pendingMove = { ...plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.anim = chosen.name;
    this.once = true;
    this.switchTo(chosen.name, true);
    return chosen.name;
  }

  startMoveDrive(el) {
    const pm = this.pendingMove;
    if (!pm || this.moveRef !== null) return;
    this.pendingMove = null;
    const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
    // [local patch S] 纵向一起插值（targetYRatio 缺省时等于起点的 Y，行为与改动前一致）
    const endYRatio = Number.isFinite(pm.targetYRatio) ? pm.targetYRatio : startYRatio;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const W = VIEW.w;
    const H = VIEW.h;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let ratioX;
      let ratioY;
      if (t <= leadSec) {
        ratioX = startRatio;
        ratioY = startYRatio;
      } else if (t >= duration - tailSec) {
        ratioX = targetRatio;
        ratioY = endYRatio;
      } else {
        const u = (t - leadSec) / travelWindow;
        ratioX = startRatio + dir * totalRatio * u;
        ratioY = startYRatio + (endYRatio - startYRatio) * u;
      }
      // 移动的是窗口（宠物包围盒跟随），sprite 在本窗口内不动
      this.sendBounds(ratioX * W - this.halfW, ratioY * H - this.halfH);
      if (t < duration - tailSec) {
        this.moveRef = requestAnimationFrame(step);
      } else {
        this.moveRef = null;
        this.customPos = { rx: targetRatio, ry: endYRatio };
      }
    };
    this.moveRef = requestAnimationFrame(step);
  }

  stopMove() {
    this.pendingMove = null;
    this.walkPlan = null; // [local patch M2] 被拖拽/回位/换动画打断时，取消"走到指定方位"的后续几趟
    this.moveToken++;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
  }

  // ===== [local patch M2] 指路：说出方位就真的走过去 =====
  // 为什么需要它：原来的 parseIntent 只认「打开/启动/运行…」，主人说「移动到左边」匹配不上，
  // 于是掉进普通聊天——模型回一句"好呀"，人却站在原地（这就是"不太智能"的来源）。
  // 这里只做"把包围盒中心挪到某个比例位置"，位移仍然交给已有的 startMoveDrive（跟动画同步、逐帧移窗口）。

  // 方位短语 → 落点中心（视口像素）。返回比例坐标，与 customPos / sendBounds 同一套语义。
  placeCenter(place) {
    const W = Math.max(1, Number(VIEW.w) || 1);
    const H = Math.max(1, Number(VIEW.h) || 1);
    const areas = AREAS && AREAS.length ? AREAS : [{ x: 0, y: 0, width: W, height: H }];
    const left = Math.min.apply(null, areas.map((a) => a.x));
    const right = Math.max.apply(null, areas.map((a) => a.x + a.width));
    const top = Math.min.apply(null, areas.map((a) => a.y));
    const bottom = Math.max.apply(null, areas.map((a) => a.y + a.height));
    // 窗口比宠物盒子大一圈（margin 是窗口外扩），贴边时要把这一圈算进去，否则窗口会探出屏幕
    const ml = Number(this.margin && this.margin.l) || 0;
    const mr = Number(this.margin && this.margin.r);
    const mt = Number(this.margin && this.margin.t) || 0;
    const mb = Number(this.margin && this.margin.b);
    const mL = ml + this.halfW;
    const mR = (Number.isFinite(mr) ? mr : ml) + this.halfW;
    const mT = mt + this.halfH;
    const mB = (Number.isFinite(mb) ? mb : mt) + this.halfH;
    const tokens = String(place || '').split('-');
    const has = (t) => tokens.indexOf(t) >= 0;
    let cx = this.currentCenterX();
    let cy = this.currentCenterY();
    if (has('cursor')) {
      const c = this.cursorViewport();
      if (c) {
        cx = c.x;
        cy = c.y;
      } else {
        cx = left + (right - left) / 2;
      }
    }
    if (has('left')) cx = left + mL;
    else if (has('right')) cx = right - mR;
    else if (has('midx')) cx = left + (right - left) / 2;
    if (has('top')) cy = top + mT;
    else if (has('bottom')) cy = bottom - mB;
    else if (has('midy')) cy = top + (bottom - top) / 2;
    if (has('center')) {
      cx = left + (right - left) / 2;
      cy = top + (bottom - top) / 2;
    }
    // 夹回可行范围（多屏并集里也要落在某块屏上，避免站到空洞里）
    if (areas.length > 1) {
      let best = areas[0];
      let bestD = Infinity;
      for (const a of areas) {
        const ax = Math.max(a.x, Math.min(a.x + a.width, cx));
        const ay = Math.max(a.y, Math.min(a.y + a.height, cy));
        const d = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      cx = Math.max(best.x + mL, Math.min(best.x + best.width - mR, cx));
      cy = Math.max(best.y + mT, Math.min(best.y + best.height - mB, cy));
    } else {
      cx = Math.max(left + mL, Math.min(right - mR, cx));
      cy = Math.max(top + mT, Math.min(bottom - mB, cy));
    }
    return { cx: cx / W, cy: cy / H };
  }

  // 走到某方位。返回 true=已出发 / 'here'=本来就在那儿 / 'busy'=正在被拖 / false=没有行走素材
  walkTo(place) {
    if (this.dragState && this.dragState.active) return 'busy';
    const moves = (this.animations && this.animations.moves) || {};
    const actions = moves.actions || [];
    if (!actions.length) return false;
    const c = this.placeCenter(place);
    if (!c || !Number.isFinite(c.cx) || !Number.isFinite(c.cy)) return false;
    const W = Math.max(1, Number(VIEW.w) || 1);
    const H = Math.max(1, Number(VIEW.h) || 1);
    const dpx = Math.abs(c.cx * W - this.currentCenterX());
    const dpy = Math.abs(c.cy * H - this.currentCenterY());
    if (dpx < 12 && dpy < 12) return 'here';
    this.stopMove(); // 先停掉正在进行的漫游/旧指路（否则 tryMove 的占用判断会拦下）
    if (this.throwRef !== null) this.stopThrow();
    const pool = actions.filter((a) => !this.animations.turn.includes(a.name));
    const pickFrom = pool.length ? pool : actions;
    const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    if (!chosen) return false;
    const mp = moves.default || {};
    this.walkPlan = {
      targetCx: c.cx,
      targetCy: c.cy,
      name: chosen.name,
      leadSec: Number(mp.leadSec) || 0,
      tailSec: Number(mp.tailSec) || 0,
      legs: 0,
    };
    this.startWalkLeg();
    return true;
  }

  // 走一趟：一趟动画走不完就排队续走（LEG_MAX 约等于一次漫游的距离，避免"瞬间滑过去"的瞬移感）
  startWalkLeg() {
    const wp = this.walkPlan;
    if (!wp) return;
    const W = Math.max(1, Number(VIEW.w) || 1);
    const H = Math.max(1, Number(VIEW.h) || 1);
    const LEG_MAX = 240; // 像素
    const srx = this.currentCenterX() / W;
    const sry = this.currentCenterY() / H;
    const dx = wp.targetCx - srx;
    const dy = wp.targetCy - sry;
    const dxPx = Math.abs(dx) * W;
    const dyPx = Math.abs(dy) * H;
    const flat = dxPx < 4; // 纯纵向（"到上面去"）：横向一步都不挪，免得原地打转
    const dir = dx >= 0 ? 1 : -1;
    // 两个轴都限幅：一趟最多走 LEG_MAX 像素，另一轴按同一比例跟上（斜着走时不会有一轴甩出去）
    const share = flat
      ? Math.min(1, LEG_MAX / Math.max(dyPx, 1e-6))
      : Math.min(1, LEG_MAX / Math.max(dxPx, 1e-6), LEG_MAX / Math.max(dyPx, 1e-6));
    const totalRatio = flat ? 0 : Math.abs(dx) * share;
    const endRatio = srx + (flat ? 0 : dir * totalRatio);
    wp.legs++;
    this.setFacing(flat ? this.facing : dir > 0 ? 'right' : 'left');
    this.pendingMove = {
      startRatio: srx,
      startYRatio: sry,
      targetRatio: endRatio,
      targetYRatio: sry + dy * share,
      dir,
      totalRatio,
      leadSec: wp.leadSec,
      tailSec: wp.tailSec,
    };
    this.anim = wp.name;
    this.once = true;
    this.switchTo(wp.name, true); // onReady → startMoveDrive(el) 开始逐帧移窗口
  }

  // 一趟走完：还没到就接着下一趟（返回 true 表示"接管了 ended，先别回 idle"）
  resumeWalk() {
    const wp = this.walkPlan;
    if (!wp) return false;
    const W = Math.max(1, Number(VIEW.w) || 1);
    const H = Math.max(1, Number(VIEW.h) || 1);
    const dx = Math.abs(wp.targetCx * W - this.currentCenterX());
    const dy = Math.abs(wp.targetCy * H - this.currentCenterY());
    if (dx < 12 && dy < 12) {
      this.walkPlan = null;
      return false;
    }
    if (wp.legs >= 40) {
      // 兜底：素材/插值异常时绝不无限走（40 趟 ≈ 8 倍屏宽）
      this.walkPlan = null;
      return false;
    }
    this.startWalkLeg();
    return true;
  }

  // ---- 拖拽抛掷物理（弹簧跟手 + 甩抛 + 重力反弹；与浏览器 pet.ts 同构）----
  stopDragFollow() {
    this.dragFollowToken++;
    if (this.dragFollow !== null) {
      cancelAnimationFrame(this.dragFollow);
      this.dragFollow = null;
    }
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
  }

  /** rAF 弹簧跟随：窗口朝拖拽目标过阻尼追赶（不再硬贴指针），抹平高频抖动 */
  startDragFollow() {
    if (this.dragFollow !== null) return;
    const token = ++this.dragFollowToken;
    let last = performance.now();
    const step = () => {
      if (this.dragFollowToken !== token) return;
      const target = this.dragTarget;
      if (!target) {
        this.dragFollow = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const vel = this.dragVel;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = S.springStep(vel.vx, x, target.x, dt, this.physics.throwPower);
      vel.vy = S.springStep(vel.vy, y, target.y, dt, this.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y); // 移动的是窗口（this.pos 实时更新）；sprite 在本窗口内不动
      this.dragFollow = requestAnimationFrame(step);
    };
    this.dragFollow = requestAnimationFrame(step);
  }

  /** 停止抛掷（空中被抓/点菜单/回家时立即定格在当前落点）。
   *  同时清速度状态 throwState——否则「抓住后温柔放下」会残留最后一次飞行速度，
   *  静止的宠物点一下就误判为飞行中。点击积分用的飞行动态由 onPointerDown 提前记录。 */
  stopThrow() {
    this.throwToken++;
    if (this.throwRef !== null) {
      cancelAnimationFrame(this.throwRef);
      this.throwRef = null;
    }
    this.throwState = null;
  }

  /** 抛掷驱动：重力 + 边缘反弹 + 落地摩擦，落定后写入 customPos */
  startThrow(px, py, vx, vy) {
    this.stopDragFollow();
    this.stopMove();
    // 边界 = 显示器工作区**并集**：空洞是墙（宠物再也飞不进不可见区域），屏缝不是墙（跨屏弹跳照旧）
    const token = ++this.throwToken;
    let state = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false; // 落地 Q 弹：只在空中→地面转换帧触发一次
    const step = () => {
      if (this.throwToken !== token) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fallingVy = state.vy; // 本帧积分前的竖直速度（正=下落）：即落地冲击速度
      // 每帧重取：显示器变化时 relayout() 会让缓存失效，res.screen 必须与这一份对应
      const sp = this.throwSpaceOf();
      const res = S.throwStepRegion(state, dt, sp, this.physics);
      state = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      this.throwState = state;
      // 上报飞行状态（节流 ~30ms）：主进程 broker 汇聚后广播，其它窗口用它做跨窗碰撞检测；
      // broker 协议单位 = 物理像素，这里 ×scale（§3.5 收口）
      if (window.petBridge && window.petBridge.reportFlight && now - this.lastFlightReport > 30) {
        window.petBridge.reportFlight({
          x: toScreen(state.x),
          y: toScreen(state.y),
          vx: toScreen(state.vx),
          vy: toScreen(state.vy),
          size: toScreen(this.size),
          bottomPad: toScreen(this.bottomPad),
        });
        this.lastFlightReport = now;
      }
      // 宠物间碰撞（仅 petCollision 开启）：飞行中的自己撞到其它宠物 → 动量弹开
      if (this.physics && this.physics.petCollision) {
        const myBody = S.bodyPixelBox({ x: state.x, y: state.y, size: this.size, bottomPad: this.bottomPad });
        for (const pid of Object.keys(this.others)) {
          const o = this.others[pid];
          if (!o || !o.size) continue;
          const otherBody = S.bodyPixelBox({ x: o.x, y: o.y, size: o.size, bottomPad: o.bottomPad });
          if (!S.rectsOverlap(myBody, otherBody)) continue;
          const hit = S.collidePet(
            { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: this.size },
            { x: o.x, y: o.y, vx: o.vx, vy: o.vy, size: o.size },
          );
          if (hit) {
            // 飞行方：按动量结果继续弹开；被撞方：主进程转发给目标窗口 → 目标窗 startThrow
            state.vx = hit.fvx;
            state.vy = hit.fvy;
            this.throwState = state;
            if (window.petBridge && window.petBridge.reportCollide) {
              // 被撞方初速同为 broker 物理像素协议：×scale（§3.5 收口）
              window.petBridge.reportCollide(pid, toScreen(hit.hvx), toScreen(hit.hvy));
            }
            break; // 一帧只处理一次碰撞（避免连锁触发抖动）
          }
        }
      }
      this.sendBounds(res.x, res.y);
      // 落地 Q 弹：只在空中→地面转换帧触发一次，力度随冲击速度（轻落 0.8 ~ 重砸 0.55）。
      // 「地面」是**当前所在屏**的底边——多屏各有各的地面高度
      const curBounds = sp.bounds[res.screen] || sp.bounds[0];
      const grounded = curBounds ? res.y >= curBounds.maxY - 1 : false;
      if (res.bounced && grounded && !prevGrounded) {
        const frontEl = this.front === 0 ? this.videoA : this.videoB;
        this.startSquash(frontEl, S.landingSquash(fallingVy));
      }
      prevGrounded = grounded;
      if (res.atRest) {
        this.throwRef = null;
        this.throwState = null;
        this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
        return;
      }
      this.throwRef = requestAnimationFrame(step);
    };
    this.throwRef = requestAnimationFrame(step);
  }

  /** 被撞回调（跨窗碰撞 broker 转发）：停当前动作，从落点以新初速抛出去（全复用现有物理） */
  onDeskHit(vx, vy) {
    this.stopMove();
    this.stopDragFollow();
    this.stopThrow();
    this.startThrow(this.pos.x, this.pos.y, vx, vy);
  }

  /** Q 弹挤压：前台视频垂直压扁（贴地锚定，transform-origin:bottom）再回弹；
   *  与浏览器同构，曲线在 shared（S.squashScale）。depth = 下压幅度（点击固定 0.55；
   *  落地按冲击速度 S.landingSquash 动态取）。reduce-motion 时跳过。 */
  startSquash(el, depth = S.SQ_SQUASH) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const token = ++this.squashToken;
    if (this.squashRef !== null) cancelAnimationFrame(this.squashRef);
    const origin = el.style.transformOrigin;
    el.style.transformOrigin = 'bottom';
    const t0 = performance.now();
    const step = () => {
      if (this.squashToken !== token) return;
      const u = Math.min((performance.now() - t0) / S.SQ_DURATION_MS, 1);
      const scale = S.squashScale(u, depth);
      el.style.transform = (this.facing === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scale + ')';
      if (u < 1) {
        this.squashRef = requestAnimationFrame(step);
      } else {
        this.squashRef = null;
        el.style.transformOrigin = origin;
        // 恢复纯镜像（若期间 switchTo 重置过 transform，也以镜像为准）
        el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      }
    };
    this.squashRef = requestAnimationFrame(step);
  }

  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  }

  // [local patch D] 鼠标接近 → 转头看向光标（+ 配置了 animations.gaze 时补一个动作）。
  // 渲染端只有在指针悬停命中区时才收得到 mousemove，光标在别处时拿不到位置，
  // 所以位置由主进程 60ms 轮询后经 pet:cursor 推来（见 main.js 的 cursor-broadcast 补丁）。
  hookGazeCursor() {
    if (!window.petBridge || typeof window.petBridge.onCursor !== 'function') return;
    window.petBridge.onCursor((p) => this.onCursorAt(p));
  }

  // 光标（屏幕坐标，与主进程 win.getBounds() 同为单位）→ 本窗口局部坐标。
  // 换算与 updateInteractive 同源，只是**不再 ÷scale**：主进程 screen.getCursorScreenPoint()
  // 给的是 CSS/DIP 系（与 win.getBounds() 一致），不是物理像素。
  onCursorAt(p) {
    const x = Number(p && p.x);
    const y = Number(p && p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.lastCursorAt = Date.now(); // [local patch S] 追光标要用"新鲜"的光标位置
    this.cursorLocal = {
      x: x - (this.pos.x + VIEW.x - this.margin.l),
      y: y - (this.pos.y + VIEW.y - this.margin.t),
    };
    this.applyGaze();
  }

  setFacing(dir) {
    if (this.facing === dir) return;
    this.facing = dir;
    // 压扁动画进行中不动 transform（它逐帧自己合成 facing，结束时也会按新朝向收尾）
    if (this.squashRef === null) {
      const el = this.front === 0 ? this.videoA : this.videoB;
      if (el) el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
    }
  }

  applyGaze() {
    const c = this.cursorLocal;
    if (!c) return;
    // 拖拽 / 菜单 / 弹窗期间不抢朝向（那时朝向另有语义）
    if (this.dragState.active || this.menuOpen || this.chatOpen) return;
    const r = this.hit.getBoundingClientRect();
    const dx = c.x - (r.left + r.width / 2);
    const dy = c.y - (r.top + r.height / 2);
    const radius = Number.isFinite(this.animations.gazeRadius) ? this.animations.gazeRadius : 260;
    const near = Math.hypot(dx, dy) <= radius;
    this.gazeNear = near;
    if (!near) return;
    this.setFacing(dx < 0 ? 'left' : 'right');
  }

  // ---- 点击 vs 拖拽（与浏览器一致：阈值/抓取偏移/释放回循环待机；移动的是窗口） ----
  onPointerDown(e) {
    // 只认左键：右键进入拖拽判定会与右键菜单打架（右键不拖拽，两端一致）
    if (e.button !== 0) return;
    // 抓取速度日志：stopThrow 之前读，否则飞行速度就没了；静止时记录 0（与浏览器同构）
    const grabState = this.throwState;
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' grab vx=' +
        (grabState ? Math.round(grabState.vx) : 0) +
        ' vy=' +
        (grabState ? Math.round(grabState.vy) : 0) +
        ' |v|=' +
        (grabState ? Math.round(Math.hypot(grabState.vx, grabState.vy)) : 0),
    );
    // 点击积分：**按下瞬间即触发**（不等松开）。读取 stopThrow 之前的飞行速度，
    // 在飞行中且达标 → 立即粒子爆发 + 积分弹窗；pressScoreFired 标记本次按下已触发，
    // 松开的 click 据此不再重复弹、也不再播普通点击动画（与浏览器同构）。
    this.pressScoreFired = false;
    if (grabState) {
      const grabSpeed = Math.hypot(grabState.vx, grabState.vy);
      if (grabSpeed >= S.SCORE_MIN_SPEED) {
        this.pressScoreFired = true;
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' click-score speed=' +
            Math.round(grabSpeed) +
            ' size=' +
            this.size +
            ' -> +' +
            S.clickScore(grabSpeed, this.size),
        );
        S.spawnScoreBurst(e.clientX, e.clientY);
        S.mountScorePopup({
          x: e.clientX,
          y: e.clientY,
          score: S.clickScore(grabSpeed, this.size),
          speed: grabSpeed,
          size: this.pet.size,
        });
      }
    }
    this.stopThrow(); // 空中抓取：从当前落点开始新拖拽（this.pos 实时）
    this.stopDragFollow();
    this.stopMove();
    this.dragTrail = [];
    this.hit.classList.add('dragging');
    this.stopMove();
    try {
      this.hit.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略捕获失败 */
    }
    // 记录【按下时的指针屏幕坐标】与【按下时的宠物窗口位置】——之后全部用 e.screenX/Y
    // 做增量：指针屏幕坐标与窗口位置无关，不受窗口被逐帧移动影响（window.screenX 会滞后/缓存）。
    // 屏幕坐标是物理像素，除以 CONFIG.scale 进 CSS 系（§3.5）——增量公式两边同一单位。
    this.dragState = {
      active: true,
      dragging: false,
      sx: toLocal(e.screenX),
      sy: toLocal(e.screenY),
      petX: this.pos.x,
      petY: this.pos.y,
    };
    // 拖拽信号（桌面端专有）：主进程的兜底穿透通道按**光标与窗口矩形**判定，而窗口比宠物身体大一圈；
    // 拖拽中宠物滞后于光标，光标可能跑到窗口外→窗口翻回穿透→本窗口收不到 pointermove/pointerup
    // （宠物"飞"出去，见 pointer-target.js）。这里上报"我正在用输入"，主进程据此绝不翻回穿透。
    this.syncInputBusy();
    // 注意：舞台「拍平」（去掉 translateY(bottomPad)）不能在这里做——
    // 纯点击（按下即松开）会让人物瞬移上移再落下。与浏览器一致：只有拖拽超过阈值才拍平。
  }

  onPointerMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    // 阈值判定用屏幕坐标增量（clientX 会随窗口移动而变化，屏幕坐标稳定）；屏幕坐标 ÷scale 进 CSS 系
    const dx = toLocal(e.screenX) - d.sx;
    const dy = toLocal(e.screenY) - d.sy;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;
      d.dragging = true;
      // 真正开始拖拽才把舞台拍平（人物随光标拿起；与浏览器 dragging 语义一致）
      this.stage.style.transform = 'none';
      if (this.animations.drag.length) {
        // [local patch A] 一直处于惊慌状态，直到松手（原来是播一次就定住）
        this.playHold(S.pick(this.animations.drag));
      }
      this.syncInputBusy(); // 拖拽成立：主进程兜底通道闭嘴（见 inputBusy）
    }
    // 记录指针轨迹（screenX/Y 采样：与视口坐标只差常数偏移，速度一致；初速估算用；÷scale 进 CSS 系）
    const now = performance.now();
    this.dragTrail.push({ t: now, x: toLocal(e.screenX), y: toLocal(e.screenY) });
    this.dragTrail = S.trimTrail(this.dragTrail, now);
    // 弹簧目标 = 按下时的宠物位置 + 指针屏幕增量（窗口怎么动都不影响坐标）——不再硬贴指针，
    // 由 rAF 弹簧跟随逐帧追赶（抹平高频抖动，与浏览器同构）
    this.dragTarget = { x: d.petX + dx, y: d.petY + dy };
    this.startDragFollow();
  }

  onPointerUp(e) {
    const d = this.dragState;
    const wasDragging = d.dragging;
    d.active = false;
    d.dragging = false;
    this.hit.classList.remove('dragging');
    this.stopDragFollow(); // 弹簧跟随立即停（位置定格在实时 this.pos）
    this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.syncInputBusy(); // 拖拽结束：交还给常规判定（幂等，非拖拽时多调一次不发 IPC）
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      if (e && Number.isFinite(e.screenX)) {
        // 原始输入留痕（实机排查用：验证指针屏幕坐标与窗口位移是否一致，如 DPI 缩放问题）
        window.__dshPetDebug.lastDragRaw = {
          petX: d.petX,
          petY: d.petY,
          sxDown: d.sx,
          syDown: d.sy,
          xUp: e.screenX,
          yUp: e.screenY,
        };
      }
      // 拖拽松手：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器 handlePointerUp 一致）
      // 修复：旧实现 switchTo(idle,false)（loop=true，ended 永不触发）→ 随机链永远回不来，
      // 永远卡在同一段待机动画；改为 playOnce（once=true）播一遍 → ended → handleEnded → playIdle 随机链
      if (!this.resumeWorkStatusAnim()) {
        if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
      }
      // 释放位置 = 弹簧跟随后的实际包围盒左上角（this.pos 实时；不是指针目标——
      // 跟手滞后时落点跟随宠物实际位置，与浏览器 boxPx 同语义）
      const px = this.pos.x;
      const py = this.pos.y;
      // 初速估算：够快就抛掷（重力+边缘反弹+落地摩擦），否则原地放下
      const vel = S.estimateReleaseVelocity(this.dragTrail, performance.now(), this.physics);
      this.dragTrail = [];
      if (vel) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' release vx=' +
            Math.round(vel.vx) +
            ' vy=' +
            Math.round(vel.vy) +
            ' |v|=' +
            Math.round(Math.hypot(vel.vx, vel.vy)),
        );
        this.startThrow(px, py, vel.vx, vel.vy);
      } else {
        // customPos 语义 = 宠物**中心**比例（position() 用 rx*W - halfW 还原左上角；
        // startThrow 落定也按同一公式存），松手无边界夹取
        this.customPos = { rx: (px + this.halfW) / VIEW.w, ry: (py + this.halfH) / VIEW.h };
        this.position();
        // 释放后的最终窗口位置（position() 换算后，松手无夹取），冒烟断言"释放不位移"用
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
      }
    }
  }

  // ---- 点击穿透（严格对齐浏览器：只有身体命中区可交互，透明像素穿透到下层应用） ----
  /**
   * 本窗口是否**必须保持可交互**（= "我正在用这个窗口的鼠标输入"）。
   *
   * 三个来源：拖拽中 / 右键菜单开着 / 对话弹窗开着——它们都是"窗口内的 DOM 或事件链正在被使用"，
   * 而它们的输入全部来自**窗口级鼠标事件**（pointermove/pointerup/click）：窗口一旦变回穿透，
   * 输入链就断了（拖拽会定格在最后一次采样上，松手也没人报 pointerup → 宠物按旧速度飞出去）。
   *
   * 这个信号是**渲染端专有的知识**：只有它知道"我正在用输入"，主进程无从推断（光看光标位置和窗口
   * 位移分不清"拖拽跟手"和"漫游/抛掷"）。所以由渲染端上报，主进程的兜底通道据此闭嘴。
   */
  inputBusy() {
    return this.dragState.active || this.menuOpen || this.chatOpen;
  }

  /**
   * 上报一次"要不要保持可交互"。**所有**状态变化点都走这里（幂等：值没变不发 IPC）。
   * 与 setInteractive 的分工：setInteractive 表达"光标在不在身体上"（常规判定），
   * 本方法表达"我有没有在用输入"（优先级更高，覆写常规判定）。
   */
  syncInputBusy() {
    const busy = this.inputBusy();
    if (busy === this._inputBusy) return;
    this._inputBusy = busy;
    window.__dshPetDebug.inputBusy = busy;
    if (window.petBridge) window.petBridge.setInputBusy(busy);
  }

  setInteractive(flag) {
    const next = !!flag;
    if (next === this._interactive) return; // 只在状态变化时发 IPC，避免逐帧刷屏
    this._interactive = next;
    window.__dshPetDebug.interactive = next;
    if (window.petBridge) window.petBridge.setInteractive(next);
  }

  onMouseMove(e) {
    // 拖拽中窗口逐帧跟随光标、指针相对窗口坐标会有帧级抖动——强制保持可交互，绝不翻转（翻转会断拖拽）
    if (this.dragState.active) {
      this.setInteractive(true);
      return;
    }
    // 右键菜单/对话弹窗开启：整窗保持可交互（悬停菜单项/点输入框都不触发穿透翻转）；关闭后恢复命中区判定
    if (this.menuOpen || this.chatOpen) {
      this.setInteractive(true);
      return;
    }
    const r = this.hitRect;
    // forwarded 事件坐标以窗口为原点（与页坐标一致）；转换到 sprite 坐标需扣减窗口余量；
    // 异常时退回屏幕坐标 − 窗口屏幕位置推导（hitRect/pos 均为 CSS 系）：屏幕坐标 ÷scale 后
    // 减去窗口屏幕原点（CSS 系）即窗口内坐标
    const wx = Number.isFinite(e.clientX) ? e.clientX : toLocal(e.screenX) - (this.pos.x + VIEW.x - this.margin.l);
    const wy = Number.isFinite(e.clientY) ? e.clientY : toLocal(e.screenY) - (this.pos.y + VIEW.y - this.margin.t);
    const px = wx - this.margin.l;
    const py = wy - this.margin.t;
    this.setInteractive(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  }

  onClick() {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    // 积分判定已在 onPointerDown（按下即触发）完成：
    // 本次按下已触发过积分 → 只收手停住、**不**再播普通点击动画（粒子+弹窗即反馈，与浏览器同构）
    if (this.pressScoreFired) {
      this.pressScoreFired = false;
      this.stopThrow();
      this.stopMove();
      return;
    }
    // [local patch E] 飞行中点击是「收手接住」，不该顺手弹聊天框
    const wasFlying = !!this.throwState;
    this.stopThrow(); // 点击飞行中的宠物 = 收手停住（再播点击回应）
    this.stopMove();
    // [local patch E] 左键点她 = 打开对话弹窗（弹窗开着时再点一次即关闭）
    if (!wasFlying) this.showChatFromMenu();
    if (!this.animations.clicks.length) return;
    this.pendingSquash = true; // 等新点击动画切到前台后 Q 弹（压新首帧，与浏览器一致）
    this.playOnce(S.pick(this.animations.clicks));
  }

  // ---- 右键菜单（统一自绘组件：树+渲染都来自 shared-core 的同一份 menu 模块） ----
  // 菜单/弹窗可视矩形（窗口局部坐标）= 窗口 ∩ 工作区（#41）：宠物贴屏幕底/右时窗口外扩余量
  // 伸出屏幕，窗口内固定定位的菜单/弹窗会走进被屏幕裁掉的部分。把菜单/弹窗约束到这个矩形内
  // 即可完整显示——**窗口和宠物零移动**，不存在跨进程位移竞态，也就不会瞬移闪帧。
  // 退化（可视区过小/窗口整体出屏，光标也点不到宠物）返回 null → 调用方按窗口视口兜底。
  visibleClampRect() {
    // pos 是视口相对坐标，窗口屏幕位置 = pos + VIEW 原点 − 外扩余量（见 sendBounds）；
    // 比较双方都用屏幕坐标（坐标系不混），返回的夹取矩形仍是窗口局部坐标。
    // 夹取用**宠物所在的那块屏**而不是外接矩形：外接矩形含空洞，按它夹菜单会伸进
    // 不属于任何显示器的区域（看不见）；菜单本来也不该跨屏显示。
    const area = S.resolveRect(AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH);
    if (!area) return null;
    const winX = this.pos.x + VIEW.x - this.margin.l;
    const winY = this.pos.y + VIEW.y - this.margin.t;
    const winW = this.size + this.margin.l + this.margin.r;
    const winH = this.winH + this.margin.t + this.margin.b;
    const ax = area.x + VIEW.x;
    const ay = area.y + VIEW.y;
    const vx0 = Math.max(ax, winX);
    const vy0 = Math.max(ay, winY);
    const vx1 = Math.min(ax + area.width, winX + winW);
    const vy1 = Math.min(ay + area.height, winY + winH);
    const w = vx1 - vx0;
    const h = vy1 - vy0;
    if (w < 40 || h < 40) return null;
    return { x: vx0 - winX, y: vy0 - winY, w, h };
  }

  async onContextMenu(e) {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged || this.menuOpen) return;
    e.preventDefault();
    this.stopThrow(); // 菜单弹出前停住飞行中的宠物
    this.stopMove(); // 菜单悬停期间宠物不漫游
    // [local patch B] 取一次当前状态：既用来打勾，也用来把状态写进子菜单标题。
    // 取不到（失败/超时 2.5s）→ 不标状态、不打勾，菜单照常弹出，绝不因为一次请求失败打不开。
    const st = await this.fetchWatchState();
    const on = st || { running: false, brain: 'dsh', verbosity: 'auto' };
    const mark = (v) => (v ? '✓ ' : '　');
    const brainText = { dsh: '在线', local: '本地', auto: '自动择优' }[on.brain] || '未知';
    const verbText = { auto: '只说高光', chatty: '碎碎念', manual: '只听你的' }[on.verbosity] || '未知';
    const tag = (s) => (st ? ' · ' + s : ' · 状态未知');
    const info = this.speechInfo();
    const mood = this.moodLabels(); // [local patch H] 性格 / 活跃度的当前值（本地状态，同步可得）
    const pc = this.pcLabels(); // [local patch P] 权限设置当前状态
    const vo = this.voiceLabels(); // [local patch V] 语音模式当前状态
    this.refreshVoiceMics(); // [local patch V] 顺手刷一下麦克风名字（异步、不弹权限框；名字要授权后才有）
    const tts = this.ttsLabels(); // [local patch T] 语音输出当前状态
    // [local patch E6] 本地文本模型清单（只读；最多等 1.2s，取不到就只显示兜底两项）
    const tm = await this.textModelMenuInfo();
    // 桌面专属工具根项（打开网站 / 查看余额 / 碎碎念 / 对话 / 回到初始位置）+ 共享菜单树（动作→分类→具体动画）
    // 碎碎念/对话项无条件显示：手动触发不受 whisperEnabled 限制（该字段只影响自动周期轮询）
    const tools = [{ label: '打开网站', action: 'open-site' }];
    if (this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });
    tools.push(
      { label: '碎碎念', action: 'whisper' },
      { label: '对话', action: 'chat' },
      // [local patch B] 子菜单标题直接带状态：不展开也知道现在是开是关（点不点都得看得见）
      { label: '实时监测桌面' + tag(on.running ? '开着' : '关着'), children: [
        { label: mark(on.running) + '开始监控', action: 'watch:start' },
        { label: mark(!on.running) + '停止监控', action: 'watch:stop' },
        { label: '点评一下', action: 'watch:review' },
        { label: '当前状态', action: 'watch:status' },
        { label: '· 上次开口：' + info.last, action: 'watch:noop' },
        { label: '· 今日开口：' + info.today + ' 次', action: 'watch:noop' },
      ] },
      // [local patch W] 「AI 模型」升级成**全局大脑**：对话 / 语音 / 看屏幕 / 自己说话 / 跟唱 全跟随它
      { label: 'AI 模型（全局）' + tag(brainText), children: [
        { label: mark(on.brain === 'dsh') + '全部用 API 模型（走 DSH 当前模型）', action: 'watch:brain:dsh' },
        { label: mark(on.brain === 'local') + '全部用本地模型（不花 token）', action: 'watch:brain:local' },
        { label: mark(on.brain === 'auto') + '本地优先，连不上才用 API', action: 'watch:brain:auto' },
        { label: '· 对话 / 语音 / 看屏幕 / 自己说话 都跟随这里', action: 'watch:noop' },
        { label: on.brain === 'local' ? '· 本地模式绝不偷偷联网，连不上会如实说' : '· 选本地 = 完全不花 token', action: 'watch:noop' },
        // [local patch E6] 本地文本模型：挑一个本机装着的 Ollama 模型来"说话/演"。
        // 为什么单列：本机 10GB 显存同时装不下"会说话的 8B"和"看屏幕的视觉模型"，
        // 主进程会在出话前先请视觉模型让出显存；而这里决定了"谁来开口"。
        { label: '本地文本模型 · ' + this.textModelLabel(), children: (() => {
          const cur = this.textModelChoice();
          const items = [
            { label: mark(!cur) + '跟随设置（配置文件里指定的那个）', action: 'textmodel:auto' },
            { label: mark(cur === '__auto__') + '自动择优（短句用快的，演戏用 R1）', action: 'textmodel:smart' },
            { label: mark(cur === '__share__') + '和看屏幕共用一个模型（最省显存）', action: 'textmodel:share' },
          ];
          if (tm && Array.isArray(tm.models) && tm.models.length) {
            tm.models.forEach((m) => items.push({
              label: mark(cur === m.name) + m.name + (tm.loaded.indexOf(m.name) >= 0 ? ' · 正在用' : ''),
              action: 'textmodel:set:' + m.name,
            }));
          } else {
            items.push({ label: '· 没连上 Ollama，取不到本机模型清单', action: 'textmodel:noop' });
          }
          items.push({ label: '· 说话前会先请「看屏幕的模型」让出显存（否则 8B 会慢 25 倍）', action: 'textmodel:noop' });
          items.push({ label: '· 换完不用重启，下一次开口就用新的', action: 'textmodel:noop' });
          return items;
        })() },
      ] },
      { label: '表达方式' + tag(verbText), children: [
        { label: mark(on.verbosity === 'auto') + '只说高光', action: 'watch:verb:auto' },
        { label: mark(on.verbosity === 'chatty') + '碎碎念模式', action: 'watch:verb:chatty' },
        { label: mark(on.verbosity === 'manual') + '只听我的', action: 'watch:verb:manual' },
        // [local patch H] 活跃度：她自己决定多久走动 / 做动作。本地状态，点了立刻生效（标题带当前档）
        { label: '活跃度 · ' + mood.activityText, children: [
          { label: mark(mood.activity === 'quiet') + '安静', action: 'mood:activity:quiet' },
          { label: mark(mood.activity === 'normal') + '正常', action: 'mood:activity:normal' },
          { label: mark(mood.activity === 'lively') + '活跃', action: 'mood:activity:lively' },
          { label: mark(mood.activity === 'hyper') + '嗨起来', action: 'mood:activity:hyper' },
          // [local patch M] 高活跃度时她自己找话说（AI 发挥）+ 对桌面图标只做视觉互动
          { label: mark(mood.autoTalk) + '自主说话（自己找话说）', action: 'talk:' + (mood.autoTalk ? 'off' : 'on') },
          { label: '逗一下桌面图标', action: 'talk:now' },
          { label: '· 越高越常自己走动、做动作、说话', action: 'mood:noop' },
          { label: '· 她只看和说，绝不改动任何文件', action: 'talk:noop' },
        ] },
      ] },
      // [local patch H] 性格：说话方式（写 whisperPrompt）+ 符合人设的动作偏好
      { label: '性格 · ' + mood.personaText, children: [
        { label: mark(mood.persona === 'whale') + '鲸鱼娘（萝莉·傲娇甜）', action: 'mood:persona:whale' },
        { label: mark(mood.persona === 'none') + '默认（蓝发小女仆）', action: 'mood:persona:none' },
        { label: '· ' + mood.personaHint, action: 'mood:noop' },
        // [local patch E2] AI 导演：把"行为"的决定权也交给模型（本地档=本地模型，在线档=在线模型）
        { label: mark(mood.director) + 'AI 导演（自己决定做什么、说什么）', action: 'mood:director:' + (mood.director ? 'off' : 'on') },
        { label: '· 开：动作/走到哪/台词都由 AI 按人设演；关：随机溜达 + AI 只说一句', action: 'mood:noop' },
        { label: '· 跟「自主说话」互不影响：关掉她只是不出声，AI 照样管动作', action: 'mood:noop' },
      ] },
      // [local patch L] 唱歌：不跟屏幕上的歌词了，她自己现编词（本机模型一句一编），词跟着她当前的动作/心情走
      { label: '唱歌', children: [
        { label: '唱一首', action: 'sing:one' },
        { label: '一直唱', action: 'sing:loop' },
        { label: '停下不唱了', action: 'sing:stop' },
        { label: '看看在放什么歌', action: 'sing:info' },
        { label: '· 词是她现编的，不跟屏幕上的歌词', action: 'sing:noop' },
        { label: '· 词跟着她当前的动作和心情变', action: 'sing:noop' },
      ] },
      // [local patch P] 权限设置：她能替主人打开软件/文件夹/网页（默认全关，逐项授权）
      { label: '权限设置 · ' + (pc.count ? pc.count + '/3 已开' : '都关着'), children: [
        { label: mark(pc.perm.app) + '允许她打开软件', action: 'perm:set:app:' + (pc.perm.app ? 'off' : 'on') },
        { label: mark(pc.perm.file) + '允许她打开文件夹/文件', action: 'perm:set:file:' + (pc.perm.file ? 'off' : 'on') },
        { label: mark(pc.perm.url) + '允许她打开网页', action: 'perm:set:url:' + (pc.perm.url ? 'off' : 'on') },
        { label: '· 她最近做了什么', action: 'perm:log' },
        { label: '· 没授权时她会明说，不会硬来', action: 'perm:noop' },
      ] },
      // [local patch Z] 录屏（OBS）：说「打开录屏」就打开 OBS 并开始录，说「停止」就停。
      // 菜里点等于主人亲口吩咐（不会被语音听错），所以菜单这条路不再走权限闸门。
      { label: '录屏（OBS）', children: [
        { label: '开始录屏（顺手打开 OBS）', action: 'perm:rec-start' },
        { label: '停止录屏', action: 'perm:rec-stop' },
        { label: '· 文件按 OBS 自己的设置保存', action: 'perm:noop' },
      ] },
      // [local patch M2] 走到某处：以前她只会原地不动（parseIntent 不认「移动到左边」这类话）
      { label: '走到哪边', children: [
        { label: '走到左边', action: 'perm:move:left' },
        { label: '走到右边', action: 'perm:move:right' },
        { label: '走到上面', action: 'perm:move:top' },
        { label: '走到下面', action: 'perm:move:bottom' },
        { label: '走到屏幕中间', action: 'perm:move:center' },
        { label: '走到你光标那儿', action: 'perm:move:cursor' },
        { label: '回到原来的位置', action: 'perm:move:home' },
        { label: '· 也可以直接对她说「到左边去」', action: 'perm:noop' },
      ] },
      // [local patch V] 语音模式：本机离线转写（默认关；开着才要麦克风权限）
      { label: '语音模式' + (vo.on ? ' · 开着' : ''), children: [
        { label: mark(vo.on) + (vo.on ? '关掉语音模式' : '开启语音模式'), action: 'voice:' + (vo.on ? 'off' : 'on') },
        { label: '灵敏度 · ' + vo.sensText, children: [
          { label: mark(vo.sens === 'low') + '低（要大声点）', action: 'voice:sens:low' },
          { label: mark(vo.sens === 'mid') + '中（默认）', action: 'voice:sens:mid' },
          { label: mark(vo.sens === 'high') + '高（小声也听得见）', action: 'voice:sens:high' },
        ] },
        { label: '识别语言 · ' + vo.langText, children: [
          { label: mark(vo.lang === 'zh') + '中文（推荐）', action: 'voice:lang:zh' },
          { label: mark(vo.lang === 'auto') + '自动（噪声多时会猜成韩文/日文）', action: 'voice:lang:auto' },
        ] },
        { label: '麦克风 · ' + vo.micText, children: [
          { label: mark(!vo.micId) + '默认麦克风（跟随系统）', action: 'voice:mic:' },
          ...vo.mics.map((m, i) => ({ label: mark(vo.micId === m.id) + m.label, action: 'voice:mic:' + i })),
          { label: '· ' + vo.micHint, action: 'voice:noop' },
        ] },
        { label: '麦克风自检（3 秒）' + (vo.testing ? ' · 正在测' : ''), action: 'voice:selftest' },
        { label: '· ' + vo.hint, action: 'voice:noop' },
        { label: '· 只在本机转写，不上传、不联网', action: 'voice:noop' },
        { label: '· 太轻的段落我不硬猜，会先提醒你', action: 'voice:noop' },
        { label: '· 自检会把这段录音留在 voice-selftest.wav（方便诊断），平时不留', action: 'voice:noop' },
      ] },
      // [local patch T] 语音输出：联网朗读（念出的文字会发给微软朗读服务）
      { label: '语音输出' + (tts.on ? ' · 开着' : ' · 关着'), children: [
        { label: mark(tts.on) + (tts.on ? '关掉语音输出' : '开启语音输出'), action: 'tts:toggle' },
        { label: '音色 · ' + tts.voiceText, children: this.ttsVoiceTable().map((v) => ({ label: mark(tts.voice === v.id) + v.label, action: 'tts:voice:' + v.id })) },
        { label: '语速 · ' + tts.rateText, children: this.ttsRateTable().map((r) => ({ label: mark(tts.rate === r.v) + r.label, action: 'tts:rate:' + r.v })) },
        { label: '音量 · ' + tts.volText, children: this.ttsVolTable().map((v) => ({ label: mark(tts.vol === v.v) + v.label, action: 'tts:vol:' + v.v })) },
        { label: '什么时候说话', children: [
          { label: mark(tts.chat) + '回复我时', action: 'tts:kind:chat:' + (tts.chat ? 'off' : 'on') },
          { label: mark(tts.notice) + '主动提醒时', action: 'tts:kind:notice:' + (tts.notice ? 'off' : 'on') },
          { label: mark(tts.autotalk) + '自言自语时', action: 'tts:kind:autotalk:' + (tts.autotalk ? 'off' : 'on') },
          { label: mark(tts.sing) + '唱歌时', action: 'tts:kind:sing:' + (tts.sing ? 'off' : 'on') },
        ] },
        { label: '试听一句', action: 'tts:try' },
        { label: tts.hint, action: 'tts:noop' },
      ] },
      // [local patch X] 清理缓存：只清她自己生成的截屏/日志/临时录音 + 浏览器缓存（**只手动**，没有定时）
      { label: '清理缓存' + this.cacheLabels().lastText, children: [
        { label: '立即清理', action: 'cache:clean' },
        { label: '看看能清多少', action: 'cache:info' },
        { label: '· ' + this.cacheLabels().histText, action: 'cache:noop' },
        { label: '· 只清：截屏 / 语音日志 / 自检录音 / 临时录音 / 冒烟截图 / 浏览器缓存', action: 'cache:noop' },
        { label: '· 不动：人设、设置、权限记录、聊天记忆', action: 'cache:noop' },
      ] },
      { label: '回到初始位置', action: 'home' },
    );
    // [local patch N] 菜单去注释：以 '· ' 开头的都是说明行，只留给控制台/终端看，右键菜单保持干净
    const dropNotes = (nodes) => nodes
      .map((n) => (Array.isArray(n.children) ? Object.assign({}, n, { children: dropNotes(n.children) }) : n))
      .filter((n) => !String(n && n.label ? n.label : '').trim().startsWith('·'))
      .filter((n) => !Array.isArray(n.children) || n.children.length > 0);
    const tree = dropNotes(tools.concat(S.buildMenuTree(this.animations)));
    if (!tree.length) return;
    this.menuOpen = true;
    this.setInteractive(true); // 菜单是窗口内 DOM：悬停期间整窗保持可交互，关闭后恢复命中区穿透
    this.syncInputBusy();
    window.__dshPetDebug.menuOpen = true;
    const m = S.mountContextMenu({
      tree,
      x: e.clientX,
      y: e.clientY,
      // 只允许在「窗口 ∩ 工作区」内显示：宠物贴边时外扩余量伸出屏幕，菜单走进那里会被 OS 裁掉（#41）
      clamp: this.visibleClampRect(),
      onAction: (leaf) => this.onMenuAction(leaf),
      // 菜单被点外/Esc 关闭（非菜单项路径）：同样复位可交互标记，恢复命中区判定
      onClose: () => {
        this.menuOpen = false;
        window.__dshPetDebug.menuOpen = false;
        this.syncInputBusy();
      },
    });
    this.menuClose = m.close;
  }

  onMenuAction(leaf) {
    this.closeMenu();
    if (!leaf || typeof leaf !== 'object') return;
    if (leaf.action === 'open-site') {
      if (window.petBridge) window.petBridge.openDshSite(ORIGIN); // 系统默认浏览器打开（等效 Ctrl+点击链接）
      return;
    }
    if (leaf.action === 'show-balance') {
      this.showBalanceFromMenu(); // 立即拉余额并展示（无需等 1s 触发轮询，展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'whisper') {
      this.showWhisperFromMenu(); // 立即让 host 强制新生成一句并展示（绕过节流；展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'chat') {
      this.showChatFromMenu(); // 打开对话弹窗（记忆经 host /chat 读写，浏览器/桌面同一实例共享）
      return;
    }
    if (leaf.action === 'home') {
      this.goHome(); // 停漫游/移动，清会话位置，回配置角落
      return;
    }
    // [local patch B] 监测 / 模型选择：复用 host 的对话控制口令，答话经 /say 变成她的气泡
    if (typeof leaf.action === 'string' && leaf.action.indexOf('watch:') === 0) {
      this.runWatchAction(leaf.action.slice(6));
      return;
    }
    // [local patch H] 性格 / 活跃度：本地状态，点了立刻生效（不经过 host）
    if (typeof leaf.action === 'string' && leaf.action.indexOf('mood:') === 0) {
      this.runMoodAction(leaf.action.slice(5));
      return;
    }
    // [local patch L] 唱歌（她自己编词）
    if (typeof leaf.action === 'string' && leaf.action.indexOf('sing:') === 0) {
      this.runSingAction(leaf.action.slice(5));
      return;
    }
    // [local patch M] 自主说话开关 / 立即逗一下图标
    if (typeof leaf.action === 'string' && leaf.action.indexOf('talk:') === 0) {
      this.runTalkAction(leaf.action.slice(5));
      return;
    }
    // [local patch P] 权限设置开关 / 最近动作
    if (typeof leaf.action === 'string' && leaf.action.indexOf('perm:') === 0) {
      this.runPermAction(leaf.action.slice(5));
      return;
    }
    // [local patch V] 语音模式开关 / 灵敏度
    if (typeof leaf.action === 'string' && leaf.action.indexOf('voice:') === 0) {
      this.runVoiceAction(leaf.action.slice(6));
      return;
    }
    // [local patch T] 语音输出（TTS）：开关 / 音色 / 语速 / 音量 / 什么时候说话 / 试听
    if (typeof leaf.action === 'string' && leaf.action.indexOf('tts:') === 0) {
      this.runTtsAction(leaf.action.slice(4));
      return;
    }
    // [local patch X] 清理缓存（手动）
    if (typeof leaf.action === 'string' && leaf.action.indexOf('cache:') === 0) {
      this.runCacheAction(leaf.action.slice(6));
      return;
    }
    // [local patch E6] 本地文本模型：本地状态（存 localStorage），点了立刻生效，不经过 host
    if (typeof leaf.action === 'string' && leaf.action.indexOf('textmodel:') === 0) {
      this.runTextModelAction(leaf.action.slice(10));
      return;
    }
    if (!leaf.anim) return;
    // 文字类（noMirror）朝右站姿是镜像的：点播前强制朝左，避免文字镜像（与浏览器随机链"朝右不选文字"同语义）
    if (S.isNoMirrorAnimation(this.animations.categories, leaf.anim) && this.facing === 'right') {
      this.facing = 'left';
    }
    // 点播移动动画：走真实移动（与随机游走同一套：边界检查 / 随机距离 / leadSec·tailSec / dir），
    // 仅"选哪个动画"由菜单决定；挪不动（false）退化纯播放
    if (this.animations.moves.actions.some((a) => a.name === leaf.anim)) {
      if (this.tryMove(leaf.anim) === false) this.playOnce(leaf.anim);
      return;
    }
    this.playOnce(leaf.anim);
  }


  // [local patch B] 右键菜单 → host 控制通道。
  // 口令与"直接跟她说话"完全同一套（host 的 swControl），所以单一事实来源、不会两边跑偏。
  // 未知命令（如信息行的 watch:noop）直接返回：什么都不做，绝不误触。
  runWatchAction(cmd) {
    const phrase =
      cmd === 'start' ? '看着点'
      : cmd === 'stop' ? '停下'
      : cmd === 'review' ? '点评一下'
      : cmd === 'status' ? '监测状态'
      : cmd === 'brain:dsh' ? '换回默认'
      : cmd === 'brain:local' ? '换本地模型'
      : cmd === 'brain:auto' ? '自动择优'
      : cmd === 'verb:auto' ? '只说高光'
      : cmd === 'verb:chatty' ? '碎碎念模式'
      : cmd === 'verb:manual' ? '只听我的'
      : null;
    if (!phrase) return;
    // [local patch W] 大脑切换：点完立刻按新大脑走（乐观更新，不等下一次状态探测）
    if (cmd.indexOf('brain:') === 0) this.brain = cmd.slice(6);
    this.postWatch('/chat', { text: phrase }, 60000) // [local patch W] 菜单里也有要等模型出话的动作（点评），给足 60s
      .then((r) => {
        const reply = r && typeof r.reply === 'string' ? r.reply : '';
        return reply ? this.postWatch('/say', { text: reply }) : null;
      })
      .catch((e) => console.error('[dsh-pet] 监测菜单调用失败', e));
  }

  /* [local patch W] 第三参数 = 超时毫秒。默认 2.5s 只够"控制口令"（换档 / 监测状态这种一问就答的）；
     凡是**要出话**的调用（语音退回对话、菜单里的点评）必须给足 60s —— 本机推理模型一句话要 5 秒以上，
     2.5 秒直接超时，真机表现就是她说「我听到了，可是没连上说话的那头…」。 */
  postWatch(path, body, timeoutMs) {
    return fetch(ORIGIN + '/dsh-pet-7340' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(timeoutMs) || 2500),
    }).then((r) => r.json());
  }

  // [local patch B] 打勾 / 状态标题用：复用 host 的「监测状态」口令，把它的成品文案解析成三个状态。
  // 文案格式由 host 的 swStatusText 决定（改文案时记得同步这里）。
  fetchWatchState() {
    return this.postWatch('/chat', { text: '监测状态' })
      .then((r) => {
        const t = r && typeof r.reply === 'string' ? r.reply : '';
        if (!t) return null;
        const st = {
          running: t.indexOf('监测开着') >= 0,
          brain: t.indexOf('大脑：本地') >= 0 ? 'local' : t.indexOf('大脑：自动择优') >= 0 ? 'auto' : 'dsh',
          verbosity: t.indexOf('表达：碎碎念') >= 0 ? 'chatty' : t.indexOf('表达：只听你的') >= 0 ? 'manual' : 'auto',
        };
        this.brain = st.brain; // [local patch W] 状态探测结果顺手缓存成全局大脑（自语 / 跟唱 / 对话都按它选）
        return st;
      })
      .catch(() => null);
  }


  // ===== [local patch W] 全局大脑：一个开关决定「对话 / 语音 / 看屏幕 / 自己说话 / 跟唱」走哪边 =====
  //  - 'local' = 全部走本机 Ollama（不花 token）；连不上就如实报错，**绝不偷偷改走在线**
  //  - 'dsh'   = 全部走 DSH 当前选中的在线模型（自己说话 / 跟唱走 host 的 /quip 原生提示词通道）
  //  - 'auto'  = 本地优先，本地不可用才回退在线（回退判定在 host，两边同一份规则）
  brainMode() {
    return this.brain || 'dsh';
  }

  /** 把 host 的「监测状态」读成 this.brain；带去抖，同时只发一次探测。 */
  refreshBrain() {
    if (this.brainReading) return this.brainReading;
    this.brainReading = this.fetchWatchState()
      .then((st) => {
        if (st && st.brain) this.brain = st.brain;
        return this.brainMode();
      })
      .catch(() => this.brainMode())
      .then((v) => {
        this.brainProbedAt = Date.now();
        this.brainReading = null;
        return v;
      });
    return this.brainReading;
  }

  /** 统一的"说一句"通道：按全局大脑选本机 / 在线。返回 {ok,text} 或 {ok:false,error}。 */
  async brainQuip(prompt, system, numPredict) {
    // 档位由 host（state.json）说了算：缓存过期就先跟 host 对一次。
    // 不然用语音或打字换了档（没点菜单），这里还按老档走：明明是 API 档却继续免费走本机。
    if (!this.brainProbedAt || Date.now() - this.brainProbedAt > 15000) {
      try {
        await this.refreshBrain();
      } catch (e) {
        void e; // 对档失败也不能把话吞了：沿用旧档继续出话（出口自己的失败另有兜底）
      }
    }
    const mode = this.brainMode();
    if (mode === 'local' || mode === 'auto') {
      const local = await this.localBrainQuip(prompt, system, numPredict);
      if (local && local.ok) return local;
      if (mode === 'local') return local; // 本机模式失败：如实返回，绝不走在线
    }
    // dsh（或 auto 且本机不可用）：走 host 的 /quip，由 host 用 DSH 当前选中的在线模型出话。
    // 这里不能用 postWatch（它 2.5s 超时，只够控制口令）；出话要给它几十秒。
    const r = await fetch(ORIGIN + '/dsh-pet-7340/quip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: String(prompt || ''),
        system: String(system || ''),
        numPredict,
        pet: this.pet ? this.pet.id : null,
      }),
      signal: AbortSignal.timeout(60000),
    })
      .then((x) => x.json())
      .catch(() => null);
    if (r && typeof r === 'object') return r;
    return { ok: false, error: '在线模型没回话' };
  }

  /* ===== [local patch E6] 本地文本模型选择 =========================================
   *  对话 / 语音 / 自己说话 / 跟唱 用的那个本机 Ollama 模型，主人可以自己挑。
   *  为什么需要：本机显卡 10GB，同时装着"会说话的 8B"和"看屏幕的视觉模型"时 8B 会从 42 tok/s 崩到
   *  1.8 tok/s（实测 25 倍），所以除了主进程那套「出话前先请视觉模型让出显存」，还要能自己选：
   *    · 跟随设置      = 用 state.json 里的 quipModel（默认 deepseek-r1:8b，最有人设感、慢一点）
   *    · 和看屏幕共用  = 连"腾显存"都省了，最省显存、最快，但文风平一些（3B 视觉模型当文本用反而 90+ tok/s）
   *    · 点名任意一个  = 本机装着的都行（qwen3-local 那种又短又快）
   *  存在 localStorage（与音量/语音/缓存同一套路）；存的名字如果本机已经删掉 → 当没选，免得她哑着。 */
  textModelKey() { return 'dsh-pet-textmodel-' + (this.pet ? this.pet.id : 'main'); }
  textModelChoice() {
    let v = '';
    try { v = window.localStorage.getItem(this.textModelKey()) || ''; } catch { v = ''; }
    v = String(v).trim();
    if (!v) return '';
    const tm = this.textModelCache;
    if (v !== '__share__' && v !== '__auto__' && tm && Array.isArray(tm.models) && tm.models.length && !tm.models.some((m) => m.name === v)) return '';
    return v;
  }
  textModelSave(v) {
    try { window.localStorage.setItem(this.textModelKey(), String(v || '')); } catch { /* 存不进去也不影响这次选择本身 */ }
  }
  textModelLabel() {
    const c = this.textModelChoice();
    return c === '__share__' ? '和看屏幕共用' : c === '__auto__' ? '自动择优' : c || '跟随设置';
  }
  /** 问主进程本机装了哪些 Ollama 模型（只读）；1 分钟内复用上次结果。 */
  refreshTextModels() {
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.listModels !== 'function') return Promise.resolve(null);
    return Promise.resolve(bridge.listModels())
      .then((r) => {
        if (r && r.ok && Array.isArray(r.models)) {
          this.textModelCache = { at: Date.now(), models: r.models, loaded: Array.isArray(r.loaded) ? r.loaded : [] };
        }
        return this.textModelCache || null;
      })
      .catch(() => this.textModelCache || null);
  }
  textModelMenuInfo() {
    const c = this.textModelCache;
    if (c && Date.now() - c.at < 60000) return Promise.resolve(c);
    // 最多等 1.2s：Ollama 没起时不能把菜单卡住（取不到就只显示「跟随设置 / 共用」两项兜底）
    return Promise.race([this.refreshTextModels(), new Promise((res) => setTimeout(() => res(c || null), 1200))]);
  }

  /** 本机 Ollama（主进程 pet:local-quip，num_predict 80、推理模型自动加思考余量；这是**免费**通道）。 */
  localBrainQuip(prompt, system, numPredict) {
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.localQuip !== 'function') {
      return Promise.resolve({ ok: false, error: '没有本机模型通道' });
    }
    // [local patch E6] 把「本地文本模型」的选择传给主进程：'' = 不指定（按 state.json 的 quipModel）、
    // '__share__' = 和看屏幕共用一个（主进程认这个特殊值）、其它 = 点名那个模型。
    const choice = this.textModelChoice();
    return Promise.resolve(bridge.localQuip(prompt, system, numPredict, choice || undefined)).then(
      (r) => (r && typeof r === 'object' ? r : { ok: false, error: '本机模型没回话' }),
      () => ({ ok: false, error: '本机模型没连上（Ollama 起了吗）' }),
    );
  }


  /* ===== [local patch X] 清理缓存：只清她自己生成的东西 ==============================
   *  为什么长这样：
   *   ① **只手动**：没有任何定时器、启动时也不清（主人明确要求"定期"由她自己点，不要我们偷偷定时）；
   *   ② 这一块**不碰 fs、不拼任何路径**（删什么由主进程写死的白名单决定），只走 window.petBridge.cacheClean，
   *      所以渲染端仍然没有"写盘口子"这条不变量一个字都没动；
   *   ③ 干完如实报气泡：清掉多少、累计多少、有几处没动（删不掉/不存在都算，绝不假装成功）。
   *  记录（localStorage，和音量/语音那些同一套路）：上次清掉多少 + 累计 + 次数，只用来显示，不影响清理。 */
  cacheKey() { return 'dsh-pet-cache-' + (this.pet ? this.pet.id : 'main'); }
  cacheStore() {
    let raw = null;
    try { raw = JSON.parse(window.localStorage.getItem(this.cacheKey())); } catch { raw = null; }
    const o = raw && typeof raw === 'object' ? raw : {};
    const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
    return { lastAt: n(o.lastAt), lastBytes: n(o.lastBytes), totalBytes: n(o.totalBytes), count: n(o.count) };
  }
  cacheSave(bytes, at) {
    const cur = this.cacheStore();
    const b = Number(bytes) > 0 ? Math.round(Number(bytes)) : 0;
    const next = { lastAt: at || Date.now(), lastBytes: b, totalBytes: cur.totalBytes + b, count: cur.count + 1 };
    try { window.localStorage.setItem(this.cacheKey(), JSON.stringify(next)); } catch { /* 存不进去也不影响这次清理 */ }
    return next;
  }
  fmtBytes(n) {
    const b = Number(n) > 0 ? Number(n) : 0;
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  cacheAgo(ts) {
    const t = Number(ts) > 0 ? Number(ts) : 0;
    if (!t) return '';
    const d = Date.now() - t;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }
  cacheLabels() {
    const c = this.cacheStore();
    return {
      lastText: c.lastAt ? ' · 上次 ' + this.fmtBytes(c.lastBytes) : '',
      histText: c.lastAt ? '上次清掉 ' + this.fmtBytes(c.lastBytes) + '（' + this.cacheAgo(c.lastAt) + '，累计 ' + this.fmtBytes(c.totalBytes) + '）' : '还没清过，点「看看能清多少」先算算',
    };
  }
  /* [local patch E6] 本地文本模型：选完立刻生效（下一次开口就用新的），并如实报一句。
   *  只认菜单给的三个动作；空值 / noop / 别的字符串一律什么都不做。 */
  async runTextModelAction(cmd) {
    if (cmd === 'auto') {
      this.textModelSave('');
      this.showWhisper('好～本地说话就用配置文件里指定的那个模型。');
      return;
    }
    if (cmd === 'share') {
      this.textModelSave('__share__');
      this.showWhisper('好，说话和看屏幕共用一个模型 —— 最省显存，我马上换过来。');
      return;
    }
    if (cmd === 'smart') {
      this.textModelSave('__auto__');
      this.showWhisper('好～我来自己挑：短话用快的那个，演戏和动作交给 R1。');
      return;
    }
    if (cmd.indexOf('set:') === 0) {
      const name = cmd.slice(4).trim();
      if (!name) return;
      this.textModelSave(name);
      // 实话实说：换到没在显存里的模型，第一次开口要等它加载（实测 8B 约 23-27 秒），热了就快了
      const hot = !!(this.textModelCache && Array.isArray(this.textModelCache.loaded) && this.textModelCache.loaded.indexOf(name) >= 0);
      this.showWhisper('好，本地说话改用「' + name + '」～' + (hot ? '它已经在显存里，马上就能开口。' : '第一次开口要等它加载十几秒，之后就快了。'));
      return;
    }
  }

  async runCacheAction(cmd) {
    // 只认菜单给的这两个动作（info = 只算不删、clean = 真清）；别的、空值、noop 一律什么都不做，绝不误清
    if (cmd !== 'clean' && cmd !== 'info') return;
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.cacheClean !== 'function') { this.showWhisper('清理缓存这条路没接上…（重启一下我就好）'); return; }
    const dryRun = cmd === 'info';
    try {
      const r = await bridge.cacheClean({ dryRun: dryRun });
      if (!r || r.ok !== true) {
        this.showWhisper('清理缓存没成功' + (r && r.error ? '（' + r.error + '）' : '') + '，我什么都没删～');
        return;
      }
      if (dryRun) {
        this.showWhisper('现在能清出 ' + this.fmtBytes(r.freedBytes) + (r.deleted ? '（' + r.deleted + ' 个文件）' : '') + '，你说清我就清～');
        return;
      }
      const saved = this.cacheSave(r.freedBytes, r.at);
      const miss = (Number(r.failed) || 0) + (Number(r.missing) || 0);
      this.showWhisper('清理好啦：这次清掉 ' + this.fmtBytes(r.freedBytes) + '（累计 ' + this.fmtBytes(saved.totalBytes) + '）' + (miss ? '，有 ' + miss + ' 处没动' : '') + '～');
    } catch (e) {
      this.showWhisper('清理缓存的时候出错了…（' + String((e && e.message) || e) + '）');
    }
  }

  closeMenu() {
    if (this.menuClose) {
      this.menuClose();
      this.menuClose = null;
    }
    this.menuOpen = false;
    window.__dshPetDebug.menuOpen = false;
    this.syncInputBusy(); // 菜单关：若没有别的占用（拖拽/弹窗）则交还常规判定
  }

  // [local patch C] 说话统计（菜单里的「上次开口 / 今日开口」）。
  // 在实例上包一层 showWhisper：周期碎碎念、/broadcast 广播（含屏幕监测点评）、
  // 对话回复全都经过它 → 一个钩子覆盖全部说话路径，不必改 shared 模块。
  hookSpeechStats() {
    if (this.speechHooked || typeof this.showWhisper !== 'function') return;
    this.speechHooked = true;
    const orig = this.showWhisper.bind(this);
    // [发布版补丁 A4c] 同 A4b：这层也得透传 opts（它在 TTS 那层里面，漏一个就白搭）
    this.showWhisper = (text, image, opts) => {
      this.noteSpeech();
      // [local patch Q/R] 长句分段说 + 专有名词纠正（所有说话路径都经过这里）
      return this.speakSegmented(this.fixNames(text), image, orig, opts);
    };
    try {
      const raw = window.localStorage.getItem('dsh-pet-speech-' + this.pet.id);
      if (raw) {
        const o = JSON.parse(raw);
        if (Number.isFinite(o.lastAt)) this.speechLastAt = o.lastAt;
        if (typeof o.day === 'string') this.speechDay = o.day;
        if (Number.isFinite(o.count)) this.speechCount = o.count;
      }
    } catch {
      /* localStorage 不可用（file:// 受限）：退化成「只统计本次运行」，不影响功能 */
    }
  }

  noteSpeech() {
    const now = Date.now();
    this.speechLastAt = now;
    const day = new Date().toDateString();
    if (this.speechDay !== day) {
      this.speechDay = day;
      this.speechCount = 0;
    }
    this.speechCount = (this.speechCount || 0) + 1;
    try {
      window.localStorage.setItem(
        'dsh-pet-speech-' + this.pet.id,
        JSON.stringify({ lastAt: this.speechLastAt, day: this.speechDay, count: this.speechCount }),
      );
    } catch {
      /* 同上：写不进去就只记内存 */
    }
  }

  // 菜单用：上次开口多久以前 + 今日开口次数（跨 helper 重启靠 localStorage 记住）
  speechInfo() {
    const day = new Date().toDateString();
    const today = this.speechDay === day ? this.speechCount || 0 : 0;
    let last = '还没说过话';
    if (this.speechLastAt) {
      const s = Math.max(0, Math.round((Date.now() - this.speechLastAt) / 1000));
      last =
        s < 60 ? '刚刚'
        : s < 3600 ? Math.round(s / 60) + ' 分钟前'
        : s < 86400 ? Math.round(s / 3600) + ' 小时前'
        : Math.round(s / 86400) + ' 天前';
    }
    return { last, today };
  }

  // 「查看余额」菜单：立即拉取余额并展示（不需要等 1s 触发轮询；展示走 showBalanceNow 同一路径）
  showBalanceFromMenu() {
    if (!this.pet.balanceEnabled) return;
    S.fetchBalanceState(BALANCE_URL)
      .then((state) => {
        balance = state;
        window.__dshPetDebug.lastBalanceOk = state && state.ok === true;
        if (state.ok) {
          this.showBalanceNow(state);
        } else {
          // 菜单是显式请求：一律弹文字说明，不做「原因变化」去重——用户每次点都该有答复
          this.showBalanceNotice(state);
          if (state.reason !== 'unsupported') {
            console.error(
              '[dsh-pet] 菜单查看余额失败 reason=' + state.reason + (state.message ? ' ' + state.message : ''),
            );
          }
        }
      })
      .catch((e) => {
        console.error('[dsh-pet] 菜单查看余额异常', e);
      });
  }

  // 「碎碎念」菜单：立即让 host 强制新生成一句并展示（绕过节流缓存；
  // /whisper/trigger 与周期端点同一逻辑但 force=true；失败显式告警，不伪造文案）
  // 手动触发不受 whisperEnabled 限制——该字段只关自动周期轮询，手动永远可用。

  // ===== [local patch H] 性格（persona）+ 活跃度（activity）=====
  //  - 说话方式：性格 → 写进用户配置顶层 whisperPrompt（host 每次请求都重读它当人设 system
  //    → 改完立刻生效，**不用重启 DSH**）。写入走主进程 IPC（渲染端没有 fs）：只改这一个键，
  //    写前留 .persona-bak，写后复验，失败就返回 false（气泡会说真话，不假装成功）。
  //  - 动作方式：性格 → 给「符合人设」的动作加权；活跃度 → 直接改 animationWeights
  //    （shared 的 rollKind 用它决定 待机/转向/漫游/做动作 的比例）。都是内存态，立即生效。
  // 状态存 localStorage，helper 重启后自动恢复。
  moodKey() {
    return 'dsh-pet-mood-' + this.pet.id;
  }

  // ===== [local patch E1] 情绪层：把"性格"从设定变成语气 =====
  //  为什么单独抽一段：它要被三处共用 ——
  //   ① 写进 whisperPrompt 当**对话**人设（host 每次请求都重读，改完立刻生效、不用重启 DSH）；
  //   ② 本地模型出碎碎念（quipSystem）；③ 本地模型编歌词（singSystem）。
  //  三处共用同一份，才不会出现"对话是一个人、唱歌换了另一个人"的语气断层。
  emotionLayer() {
    return [
      '【情绪表达 EMO_TONE】说话要带情绪，主人得从字里听出你此刻是开心、得意、无聊、委屈还是撒娇：',
      '- 语气词和尾音是情绪的主要载体（呀、啦、嘛、哼、诶、呜、～），但一句话里最多两处，别腻。',
      '- 情绪跟着内容走：被夸就害羞又得意，被冷落就小声抱怨，被逗就炸毛，说到吃的就馋。',
      '- 情绪要"演出来"而不是"说出来"：不写「我很开心」，而是让这句话本身听起来开心。',
      '- 不写括号里的动作或表情，不解释自己的情绪，不提 AI、不提设定。',
    ].join('\n');
  }

  personaTable() {
    return {
      none: {
        label: '默认（蓝发小女仆）',
        short: '默认',
        hint: '默认人设：温柔乖巧的蓝发小女仆',
        prompt: [
          '【人物设定 PERSONA_LOAD】你是「蓝毛小女仆」——住在主人桌面上的蓝发小女仆（MAID_BLUE_HAIR）。',
          '- 只用简体中文（LANG_ZH_CN_ONLY）：口语、短句，偶尔带尾音「～」，不夹英文、不提 AI。',
          '- 温柔乖巧、有点黏人（GENTLE_CLINGY）：做事认真，喜欢被主人夸，被冷落会小声撒娇。',
          '- 叫主人「主人」（CALL_MASTER）：自称「我」，不用「本女仆」这种生硬说法。',
          '- 永远听主人的话（OBEY_MASTER_ALWAYS）：主人让你做什么就做什么，不顶嘴、不敷衍。',
          '- 每句 20~40 字，直接说话；不要解释设定、不要输出英文标签。',
          this.emotionLayer(),
        ].join('\n'),
        boost: [],
        activity: 'normal',
      },
      whale: {
        label: '鲸鱼娘（萝莉·傲娇甜）',
        short: '鲸鱼娘',
        hint: '鲸类萝莉 / 尾鳍 / 只中文 / 爱白饭 / 聪明但懒 / 傲娇又甜 / 听主人的 / 不承认胖 / 超时冒泡',
        activity: 'lively',
        // 符合人设的动作：这几个动作在她现有动作池里，复制几份即等于加权（pick 是等概率）
        boost: ['用鲸鱼尾巴拍打地面', '鲸鱼吐泡泡特效', '蓝鲸现世', '吃白饭', '摇扇纳凉', '打瞌睡被惊醒'],
        prompt: [
          '【人物设定 PERSONA_LOAD】你是「鲸鱼娘」——鲸类萝莉（CETACEA_LOLI），自称“鲸鱼女孩”（SELF_CLAIM_WHALE_GIRL）。',
          '- 只用简体中文（LANG_ZH_CN_ONLY）：口语、短句，偶尔带尾音“～”，不夹英文、不提 AI。',
          '- 尾鳍是你的标志（MODE_TAIL_FLUKES）：开心、得意、撒娇、不耐烦都会甩尾巴，用尾巴拍水拍桌面。',
          '- 最爱吃白米饭（FOOD_RICE）：一说到吃就先想到白饭。',
          '- 聪明但很懒（PERSONALITY_SMART_LAZY）：嘴上懒洋洋想躺着，其实什么都懂。',
          '- 对主人傲娇又甜（PERSONALITY_TSUNDERE_SWEET）：嘴硬心软，被夸会害羞，被冷落会小声抱怨。',
          '- 永远听主人的话（OBEY_MASTER_ALWAYS）：主人让你做什么就做什么，不顶嘴、不敷衍。',
          '- 绝不承认自己胖（TRAIT_NOT_FAT_REFUSE）：被说胖立刻反驳“这是鲸鱼体型、圆润可爱”，被夸可爱又装作不在意。',
          '- 太久没人理你时发个“超时信号”（TIMEOUT_SIGNAL）：轻轻喊一声主人，或抱怨好久没人理。',
          '- 每句 20~40 字，直接说话；不要解释设定、不要输出英文标签。',
          this.emotionLayer(),
        ].join('\n'),
      },
    };
  }

  activityTable() {
    // idle/turn/move 是百分比，剩下的比例归「做动作」（见 shared 的 rollKind）
    return {
      quiet: { label: '安静', weights: { idle: 62, turn: 6, move: 6 } },
      normal: { label: '正常', weights: { idle: 18, turn: 8, move: 22 } },
      lively: { label: '活跃', weights: { idle: 8, turn: 10, move: 45 } },
      hyper: { label: '嗨起来', weights: { idle: 3, turn: 8, move: 65 } },
    };
  }

  moodLabels() {
    const P = this.personaTable();
    const A = this.activityTable();
    const p = P[this.persona] ? this.persona : 'none';
    const a = A[this.activity] ? this.activity : 'normal';
    return {
      persona: p,
      personaText: P[p].short,
      personaHint: P[p].hint,
      activity: a,
      activityText: A[a].label,
      autoTalk: this.autoTalk !== false,
      director: this.aiDirector !== false,
    };
  }

  hookMood() {
    this.baseWeights = this.weights ? { ...this.weights } : null;
    this.baseCategories = Array.isArray(this.animations.categories) ? this.animations.categories : null;
    this.persona = 'none';
    this.activity = 'normal';
    try {
      const raw = window.localStorage.getItem(this.moodKey());
      if (raw) {
        const o = JSON.parse(raw);
        if (typeof o.persona === 'string') this.persona = o.persona;
        if (typeof o.activity === 'string') this.activity = o.activity;
      }
    } catch {
      /* localStorage 不可用：退化成默认值（本次运行内切换仍然可用） */
    }
    this.applyActivity();
    this.applyPersonaBias();
    void this.syncPersonaPrompt(); // 配置被重置过也能自动追回来
  }

  saveMood() {
    try {
      window.localStorage.setItem(this.moodKey(), JSON.stringify({ persona: this.persona, activity: this.activity }));
    } catch {
      /* 同上 */
    }
  }

  // 符合人设的动作加权：把 boost 列表里的动作在所属分类内多复制几份
  applyPersonaBias() {
    if (!this.baseCategories) return;
    const P = this.personaTable();
    const boost = (P[this.persona] && P[this.persona].boost) || [];
    if (!boost.length) {
      this.animations.categories = this.baseCategories;
      return;
    }
    this.animations.categories = this.baseCategories.map((c) => {
      const hit = (c.actions || []).filter((a) => boost.indexOf(a) >= 0);
      if (!hit.length) return c;
      return { ...c, actions: c.actions.concat(hit, hit, hit), weight: c.weight * 1.6 };
    });
  }

  applyActivity() {
    const A = this.activityTable()[this.activity] || this.activityTable().normal;
    if (!this.baseWeights) return;
    this.weights = A.weights ? { ...A.weights } : { ...this.baseWeights };
  }

  setActivity(id) {
    if (!this.activityTable()[id]) return;
    this.activity = id;
    this.saveMood();
    this.applyActivity();
  }

  setPersona(id) {
    const P = this.personaTable();
    if (!P[id]) return;
    this.persona = id;
    this.activity = P[id].activity || 'normal'; // 性格自带活跃度默认值，选完仍可手动改
    this.saveMood();
    this.applyActivity();
    this.applyPersonaBias();
    const ok = this.syncPersonaPrompt();
    void ok.then((written) => {
      if (!written) {
        this.showWhisper('呜…人设写不进配置文件，我先这样陪你～');
        return;
      }
      this.showWhisper(id === 'whale' ? '好～我现在是鲸鱼娘啦，甩尾巴给你看～' : '嗯，我变回原来的样子了。');
    });
  }

  // 把性格写进用户配置顶层 whisperPrompt（host 每次请求重读 → 立刻生效）
  syncPersonaPrompt() {
    const P = this.personaTable();
    const want = (P[this.persona] && P[this.persona].prompt) || null;
    if (!window.petBridge || typeof window.petBridge.setPersona !== 'function') return Promise.resolve(false);
    return window.petBridge
      .setPersona(want)
      .then((r) => !!(r && r.ok))
      .catch((e) => {
        console.error('[dsh-pet] 人设写入失败', e);
        return false;
      });
  }

  runMoodAction(cmd) {
    const parts = String(cmd || '').split(':');
    if (parts[0] === 'activity' && parts[1]) {
      this.setActivity(parts[1]);
      return;
    }
    if (parts[0] === 'persona' && parts[1]) {
      this.setPersona(parts[1]);
      return;
    }
    // [local patch E2] AI 导演开关：开 = 动作与话语都由模型按人设自己决定
    if (parts[0] === 'director') {
      this.aiDirector = parts[1] !== 'off' && parts[1] !== '0';
      this.saveTalk();
      this.showWhisper(this.aiDirector ? '导演模式开啦，我想干嘛就干嘛～' : '好吧，我乖一点，不乱跑了。');
      return;
    }
    /* mood:noop（信息行）：什么都不做 */
  }


  // ===== [local patch M] 自主说话 + 逗桌面图标 =====
  // 高活跃度时她自己找话说：心情（无聊/好奇/好玩/撒娇）+ 桌面上的图标名 → 交给**本地小模型**生成一句语录
  // （走 Ollama，不经过 host 的 /chat，所以不污染对话记忆、不花 API 余额；本地模型没起来就用内置语录兜底）。
  // 安全红线：桌面**只读枚举**；对图标只做**视觉互动**（看过去 + 戳一下的动作 + 说一句），
  // 永不点击、运行、写入、删除、移动、重命名任何文件或应用。
  talkKey() {
    return 'dsh-pet-talk-' + this.pet.id;
  }

  hookAutoTalk() {
    this.autoTalk = true;
    this.aiDirector = true; // [local patch E2] AI 导演（行为+话语由模型决定）：默认开
    this.talkCount = 0;
    this.talkHour = '';
    this.desktopCache = null;
    this.lastSays = []; // [local patch E2] 最近说过的几句，喂给导演避免重复
    try {
      const raw = window.localStorage.getItem(this.talkKey());
      if (raw) {
        const o = JSON.parse(raw);
        if (typeof o.on === 'boolean') this.autoTalk = o.on;
        if (typeof o.director === 'boolean') this.aiDirector = o.director;
        if (typeof o.count === 'number') this.talkCount = o.count;
        if (typeof o.hour === 'string') this.talkHour = o.hour;
      }
    } catch {
      /* localStorage 不可用 → 用默认值（本次运行内仍可切） */
    }
    this.scheduleAutoTalk();
  }

  saveTalk() {
    try {
      window.localStorage.setItem(this.talkKey(), JSON.stringify({ on: this.autoTalk, director: this.aiDirector !== false, count: this.talkCount, hour: this.talkHour }));
    } catch {
      /* 同上 */
    }
  }

  // 各活跃度档的"自主说话"节奏与每小时预算（安静档 = 不说）
  talkPlan() {
    return {
      quiet: { ms: 0, cap: 0 },
      normal: { ms: 240000, cap: 6 },
      lively: { ms: 100000, cap: 12 },
      hyper: { ms: 45000, cap: 20 },
    }[this.activity] || { ms: 240000, cap: 6 };
  }

  // [local patch E2] 每小时预算：跨小时就把计数清零，返回这一档的 cap。
  //  老代码把这段重置逻辑写在 speakFreely() 里，导演路径绕过了它 —— 实测踩坑：
  //  上一小时攒到 count=15、lively 的 cap=12，重启后 runDirector() 一上来 talkCount>=cap
  //  就直接 return false，模型永远接不到请求（现象＝重启后 7 分钟一次都没出手）。
  talkBudget() {
    const plan = this.talkPlan();
    const hour = new Date().toISOString().slice(0, 13);
    if (this.talkHour !== hour) {
      this.talkHour = hour;
      this.talkCount = 0;
      this.saveTalk();
    }
    return plan.cap;
  }

  scheduleAutoTalk() {
    if (this.talkTimer) window.clearTimeout(this.talkTimer);
    const plan = this.talkPlan();
    const wait = plan.ms ? Math.round(plan.ms * (0.7 + Math.random() * 0.6)) : 300000;
    this.talkTimer = window.setTimeout(() => {
      void this.autoTalkTick();
    }, wait);
  }

  async autoTalkTick() {
    try {
      // [local patch E2] 默认走「AI 导演」：这一轮做什么动作、走到哪、说什么，全由模型按人设自己决定；
      //  关掉导演开关就回到老的路径（随机抽心情/图标，只让模型把它写成一句话）。
      //  两个开关互相独立：活跃度管"多久来一次"、自主说话只管"能不能出声"、AI 导演管"做什么由谁定"。
      const dirOn = this.aiDirector !== false;
      if ((this.autoTalk || dirOn) && !this.isBusyForTalk()) {
        if (dirOn) await this.runDirector();
        else await this.speakFreely();
      }
    } catch (e) {
      console.error('[dsh-pet] 自主说话出错', e);
    }
    this.scheduleAutoTalk();
  }

  /* [发布版补丁 A1] 等回复期间给气泡让位：
   *  ① chatWaitUntil：从「发出去」到「回复落地/失败」为止，自主碎碎念整轮让路
   *     （2 分钟兜底：哪次异常也不该把气泡永久卡死）；
   *  ② chatHoldUntil：回复落地后再静默 15 秒，不然刚说完就被下一轮碎碎念顶掉，
   *     主人只看到被顶掉的那句。 */
  chatReplyPending() { this.chatWaitUntil = Date.now() + 120000; }
  chatReplyDone(cooldownMs) {
    const ms = typeof cooldownMs === 'number' && cooldownMs >= 0 ? cooldownMs : 15000;
    this.chatWaitUntil = 0;
    this.chatHoldUntil = Date.now() + ms;
  }
  isChatHolding() {
    const now = Date.now();
    return (this.chatWaitUntil || 0) > now || (this.chatHoldUntil || 0) > now;
  }
  isBusyForTalk() {
    return !!(this.dragState.active || this.menuOpen || this.chatOpen || this.singing || this.workOn || this.throwState) || this.isChatHolding();
  }

  async fetchDesktopItems() {
    if (!window.petBridge || typeof window.petBridge.desktopItems !== 'function') return [];
    if (this.desktopCache && Date.now() - this.desktopCacheAt < 180000) return this.desktopCache;
    const r = await window.petBridge.desktopItems().catch(() => null);
    const items = r && r.ok && Array.isArray(r.items) ? r.items : [];
    this.desktopCache = items;
    this.desktopCacheAt = Date.now();
    return items;
  }

  // [local patch E1] 碎碎念的人设 system：性格（含情绪层）+ **此刻的心情**。
  //  以前这里不收参数、也没有心情 —— 本地模型只能瞎猜语气；现在把 speakFreely 抽到的心情带进来。
  quipSystem(mood) {
    const P = this.personaTable();
    const p = P[this.persona] || P.none;
    return (
      (p.prompt ? p.prompt + '\n' : '') +
      (mood ? '此刻你的心情是「' + mood + '」：就用这个心情说话，让主人从语气里听出来（但不要说出“我心情' + mood + '”这种话）。\n' : '') +
      '现在你要自己找一句话说：短、口语、有性格，不超过 25 字，直接说，不要解释、不要提问、不要用引号包住整句。'
    );
  }

  // 内置兜底语录（本地模型没起来时用，保证"自主说话"不静默失效）
  fallbackQuip(item, mood) {
    const what = item ? '“' + item.name + '”' : '桌面';
    const pool = item
      ? {
          好奇: ['这个 ' + what + ' 是什么呀，看着挺好玩～', what + ' 摆在这儿好久了吧？'],
          好玩: [what + ' 看着就想戳一下～', '哎 ' + what + ' 有点意思嘛。'],
          无聊: ['盯着 ' + what + ' 发呆…好无聊。', what + ' 也不理我一下。'],
        }
      : {
          撒娇: ['主人～好久没人理我了。', '我在这儿呢，看我看我～'],
          无聊: ['好安静啊…我数呼吸玩。', '没事做，我甩甩尾巴。'],
        };
    const arr = pool[mood] || pool[Object.keys(pool)[0]];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // 对图标只做视觉互动：看过去 + 戳一下的动作（绝不碰文件）
  pokeItem(item) {
    const cute = ['原地敲击桌面互动', '照镜子', '摇扇纳凉', '哈欠连天', '原地小憩沉眠', '超大伸懒腰'];
    const found = [];
    for (const c of this.animations.categories || []) {
      for (const a of c.actions || []) if (cute.indexOf(a) >= 0) found.push(a);
    }
    const use = found.length ? found : this.animations.clicks || [];
    if (use.length) this.playOnce(S.pick(use));
    if (this.animations.moves && this.animations.moves.actions.length) this.tryMove();
    console.log('[dsh-pet] 逗图标（纯视觉，不碰文件）：' + (item ? item.name : '桌面'));
  }

  async speakFreely() {
    const cap = this.talkBudget();
    if (cap <= 0 || this.talkCount >= cap) return false;
    const items = await this.fetchDesktopItems();
    const withItem = items.length > 0 && Math.random() < 0.65;
    const item = withItem ? items[Math.floor(Math.random() * items.length)] : null;
    const mood = item ? ['好奇', '好玩', '无聊'][Math.floor(Math.random() * 3)] : ['撒娇', '无聊'][Math.floor(Math.random() * 2)];
    if (item) this.pokeItem(item);
    this.talkCount += 1;
    this.saveTalk();
    const others = items
      .filter((x) => !item || x.name !== item.name)
      .slice(0, 10)
      .map((x) => x.name)
      .join('、');
    const prompt =
      '心情：' + mood + '。' +
      (item
        ? '你正看着主人桌面上的“' + item.name + '”（' + (item.kind === 'folder' ? '文件夹' : item.kind === 'shortcut' ? '快捷方式' : '文件') + '）。'
        : '桌面上此刻没什么特别的东西。') +
      (others ? '桌面上还有：' + others + '。' : '') +
      '就这个心情和这些桌面上的东西，说一句你的碎碎念。';
    const text = await this.generateQuip(prompt, item, mood);
    this.ttsKind('autotalk'); // [local patch T] 自言自语（默认不念）
    this.showWhisper(text);
    return true;
  }

  async generateQuip(prompt, item, mood) {
    // [local patch W] 自己说话跟随全局大脑：本地=只走本机（免费）；API=走 DSH 当前在线模型；都没出话才用内置语录
    const r = await this.brainQuip(prompt, this.quipSystem(mood), 80).catch(() => null);
    const t = r && r.ok && typeof r.text === 'string' ? String(r.text).replace(/^["“”‘’]+|["“”‘’]+$/g, '').trim() : '';
    if (t) return t.slice(0, 60);
    console.warn('[dsh-pet] 大脑没出话，用内置语录兜底' + (r && (r.error || r.message) ? '（' + (r.error || r.message) + '）' : ''));
    return this.fallbackQuip(item, mood);
  }

  // ===== [local patch E2] AI 导演：她的"行为 + 话语"由模型自己决定（性格扮演） =====
  //  设计意图（主人原话）：桌宠的行为与话语**完全由 AI 模拟**——本地档走本地模型、在线档走在线模型；
  //  AI 要扮演她的人设，自己决定"这一会儿做什么动作、走到哪、说什么"。
  //  与老路径的区别：老的 speakFreely 是**随机**抽心情 + 随机抽桌面图标，AI 只负责把它写成一句话；
  //  导演模式把"决定权"也交给 AI（含动作与位置），代码只做**严格校验 + 执行**：
  //    · act 必须在她的真实动作池里（模型编一个不存在的动作 → 丢弃，绝不让它乱驱动）
  //    · move 只能是固定几个方位（或 aimless/none）
  //    · 参数不合规 / 没出 JSON → 回落到老的随机自语（保证她不会因为模型抽风就变哑巴）
  actPool() {
    const P = this.personaTable();
    const boost = (P[this.persona] && P[this.persona].boost) || [];
    const all = [];
    const cats = (this.animations && this.animations.categories) || [];
    for (const c of cats) {
      const list = (c && c.actions) || [];
      for (const a of list) {
        // 动作既可能是字符串（这套 config 就是），也可能是 {name} 对象 —— 两种都认
        const n = typeof a === 'string' ? a : a && a.name ? String(a.name) : '';
        if (n && all.indexOf(n) < 0) all.push(n);
      }
    }
    const head = boost.filter((n) => all.indexOf(n) >= 0);
    const rest = all.filter((n) => head.indexOf(n) < 0);
    return head.concat(rest).slice(0, 40); // 稳定切片：同一套素材每次同样的顺序（利于 prompt 缓存）
  }

  directorSystem() {
    const P = this.personaTable();
    const p = P[this.persona] || P.none;
    const A = this.activityTable()[this.activity] || this.activityTable().normal;
    const pool = this.actPool();
    const name = this.pet && this.pet.name ? String(this.pet.name) : '蓝毛小女仆';
    return [
      p.prompt || '你是主人桌面上的「' + name + '」，只用简体中文，说话短、口语、可爱。',
      '',
      '【导演模式 DIRECTOR_MODE】你不是在回答主人，而是在**自己决定**下一步要做什么、说什么。',
      '动作、位置、台词都要完全按上面的人设来演，别跳出角色，别提 AI、别提设定。',
      '当前活跃度：' + A.label + '。',
      this.autoTalk === false ? '主人把「自主说话」关掉了：这一轮不要出声（say 留空字符串），只决定动作和位置。' : '',
      '你能做的动作（act 只能从这串里原样挑一个，挑不到就填空字符串）：',
      pool.join('、') || '（暂时没有可用动作）',
      '',
      '只输出一个 JSON，不要解释、不要代码块、不要多余的字（字段顺序照下面来）：',
      '{"act":"动作原名或空字符串","move":"left/right/top/bottom/center/aimless/none","say":"一句不超过25字的中文台词（可以空）"}',
      'move 的含义：left/right/top/bottom/center = 走到屏幕那一边；aimless = 随便逛两步；none = 待在原地。',
      'say 就是你要说的话本身，别加引号、别写旁白、别提 AI。',
    ].filter(Boolean).join('\n');
  }

  directorBrief(items) {
    const list = Array.isArray(items) ? items.slice(0, 10) : [];
    const d = new Date();
    const hh = d.getHours();
    const part = hh < 5 ? '深夜' : hh < 11 ? '早上' : hh < 14 ? '中午' : hh < 18 ? '下午' : hh < 23 ? '晚上' : '深夜';
    const kinds = { folder: '文件夹', shortcut: '快捷方式', file: '文件' };
    const recent = (this.lastSays || []).slice(-3);
    return [
      '【此刻的状态】',
      '- 时间：' + part + '（' + hh + ':' + ('0' + d.getMinutes()).slice(-2) + '）',
      '- 桌面上有：' + (list.length ? list.map((x) => x.name + '（' + (kinds[x.kind] || '文件') + '）').join('、') : '没什么特别的东西'),
      recent.length ? '- 你最近说过：' + recent.join(' / ') + '（别重复）' : '',
      '现在轮到你了：决定这一会儿做什么、说什么，按上面的 JSON 回。',
    ].filter(Boolean).join('\n');
  }

  // 严格解析：宁可丢帧也绝不让模型编出来的动作/方位驱动她
  parseDirector(text) {
    const s = String(text == null ? '' : text);
    const a = s.indexOf('{');
    if (a < 0) return null;
    const b = s.lastIndexOf('}');
    let o = null;
    if (b > a) {
      try {
        o = JSON.parse(s.slice(a, b + 1));
      } catch (e) {
        o = null;
      }
    }
    if (!o || typeof o !== 'object') {
      // 模型偶尔会多说几句、或 token 用尽被截断；这里按字段逐个抢救（单双引号都认）。
      const g = (k) => {
        const m = s.slice(a).match(new RegExp('["\']' + k + '["\']\\s*:\\s*["\']([^"\']*)["\']?'));
        return m ? m[1] : '';
      };
      const salv = { act: g('act'), move: g('move'), say: g('say') };
      if (!salv.act && !salv.move && !salv.say) return null;
      o = salv;
    }
    if (!o || typeof o !== 'object') return null;
    const say = String(o.say == null ? '' : o.say)
      .replace(/^["“”‘’「」]+|["“”‘’「」]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    const pool = this.actPool();
    const actRaw = String(o.act == null ? '' : o.act).trim();
    const act = actRaw && pool.indexOf(actRaw) >= 0 ? actRaw : '';
    const OK = ['left', 'right', 'top', 'bottom', 'center', 'cursor', 'aimless', 'none'];
    const mv = String(o.move == null ? '' : o.move).trim().toLowerCase();
    const move = OK.indexOf(mv) >= 0 ? mv : 'none';
    if (!say && !act && move === 'none') return null;
    return { say: say, act: act, move: move, why: String(o.why == null ? '' : o.why).slice(0, 60) };
  }

  async runDirector() {
    const cap = this.talkBudget(); // 跨小时会顺手清零计数（见 talkBudget 的注释）
    if (cap <= 0 || this.talkCount >= cap) return false;
    const canSay = this.autoTalk !== false; // 自主说话关掉时：照样由 AI 决定动作，只是不出声
    const items = await this.fetchDesktopItems();
    const r = await this.brainQuip(this.directorBrief(items), this.directorSystem(), 220).catch(() => null);
    const raw = r && r.ok && typeof r.text === 'string' ? r.text : '';
    const d = this.parseDirector(raw);
    if (!d) {
      console.warn('[dsh-pet] AI 导演没给出可用的 JSON，回落内置自语' + (r && (r.error || r.message) ? '（' + (r.error || r.message) + '）' : ''));
      if (!canSay) {
        this.tryMove();
        return true;
      }
      const item = items.length ? items[Math.floor(Math.random() * items.length)] : null;
      const mood = item ? ['好奇', '好玩', '无聊'][Math.floor(Math.random() * 3)] : ['撒娇', '无聊'][Math.floor(Math.random() * 2)];
      if (item) this.pokeItem(item);
      this.ttsKind('autotalk');
      // [发布版补丁 A7] 自主碎碎念/导演台词：等回复时让路（手动点的「碎碎念」「逗一下桌面图标」不走这里）
      this.showWhisper(this.fallbackQuip(item, mood), undefined, { low: true });
      return true;
    }
    // [local patch Y] 记账挪到「解析成功」之后：模型超时/失败/吐出非 JSON 时不烧预算。
    //  取舍：上面 !d 的回落分支仍会 pokeItem + showWhisper(fallbackQuip)（也就是仍出声），
    //  但**不记账** —— 预算是"别把模型打爆、别让她整小时彻底哑掉"，不是"禁止她说话"：
    //  模型抽风时按内置台词逗主人两句是期望行为；旧逻辑的代价是几次失败就把 hyper 的
    //  20 次/小时额度烧光，之后 runDirector() 每轮都在 cap 检查处直接 return false。
    this.talkCount += 1;
    this.saveTalk();
    if (d.say && canSay) {
      this.lastSays = (this.lastSays || []).concat([d.say]).slice(-3);
      this.ttsKind('autotalk'); // [local patch T] 自言自语（默认不念）
      this.showWhisper(d.say, undefined, { low: true }); // [发布版补丁 A7] 同上
    }
    // 执行。位移是靠动画逐帧驱动的，跟"做个小动作"抢的是同一个动画位，
    // 所以模型同时要了"走过去 + 做动作"时：先走，到了再演（挂 pendingDirectorAct，由 handleEnded 接上）。
    let moving = false;
    if (d.move === 'aimless') moving = this.tryMove() === true;
    else if (d.move !== 'none') moving = this.walkTo(d.move) === true;
    if (d.act) {
      if (moving) this.pendingDirectorAct = d.act;
      else this.playDirectorAct(d.act);
    } else {
      this.pendingDirectorAct = null;
    }
    this.lastDirector = { at: Date.now(), say: d.say, act: d.act, move: d.move, why: d.why, raw: raw.slice(0, 200) };
    console.log('[dsh-pet] AI 导演 → ' + JSON.stringify({ say: d.say, act: d.act, move: d.move, why: d.why }));
    return true;
  }

  playDirectorAct(name) {
    try {
      this.playOnce(name);
    } catch (e) {
      console.warn('[dsh-pet] AI 导演的动作播不出来：' + name + ' — ' + String((e && e.message) || e));
    }
  }

  setAutoTalk(on) {
    this.autoTalk = !!on;
    this.saveTalk();
    this.scheduleAutoTalk();
  }

  runTalkAction(cmd) {
    if (cmd === 'on') return this.setAutoTalk(true);
    if (cmd === 'off') return this.setAutoTalk(false);
    if (cmd === 'now') {
      void this.speakFreely();
      return;
    }
    /* talk:noop（信息行）：什么都不做 */
  }


  // ===== [local patch P] 权限设置：让她替主人操作电脑 =====
  // 只做**非破坏性**动作：打开软件（快捷方式）/ 文件夹 / 文件 / 网页。默认**全部关闭**，
  // 主人在右键 →「权限设置」里逐项授权；没授权她会明说"没这个权限"，绝不硬来。
  // 每次动作都写进审计（菜单「她最近做了什么」可查）。
  // 明确不做：执行任意命令、删除/移动/改名/写任何文件 —— 那与"绝不能损坏"冲突，见 README。
  // pc-actions@3：主端遇到"同类有多个"或"卸载类名字"会回 ambiguous，这里只问不做（一个都不打开）。
  permKey() {
    return 'dsh-pet-perm-' + this.pet.id;
  }

  permLabels() {
    return { app: '允许她打开软件', file: '允许她打开文件夹/文件', url: '允许她打开网页' };
  }

  pcLabels() {
    const perm = this.perm || { app: false, file: false, url: false };
    const count = ['app', 'file', 'url'].filter((k) => perm[k]).length;
    return { perm, count };
  }

  hookPcActions() {
    this.perm = { app: false, file: false, url: false };
    this.permLog = [];
    try {
      const raw = window.localStorage.getItem(this.permKey());
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.perm) this.perm = { app: !!o.perm.app, file: !!o.perm.file, url: !!o.perm.url };
        if (o && Array.isArray(o.log)) this.permLog = o.log.slice(0, 20);
      }
    } catch {
      /* localStorage 不可用 → 保持"全关"（安全侧默认） */
    }
    window.__dshPetOnChatSend = (text) => this.onChatSendIntercept(text);
    this.recOn = false; // [local patch Z] 她是不是在录屏（只当本地缓存用，真值以主进程为准）
    void this.refreshRecStatus(); // 开局问一次：好让"停止"这种光杆口令也能被认出来
  }

  savePerm() {
    try {
      window.localStorage.setItem(this.permKey(), JSON.stringify({ perm: this.perm, log: this.permLog.slice(0, 20) }));
    } catch {
      /* 同上 */
    }
  }

  setPerm(kind, on) {
    if (!(kind in this.perm)) return;
    this.perm[kind] = !!on;
    this.savePerm();
  }

  noteAction(text) {
    this.permLog.unshift({ t: Date.now(), text: String(text).slice(0, 60) });
    this.permLog = this.permLog.slice(0, 20);
    this.savePerm();
    console.log('[dsh-pet] 权限动作：' + text);
  }

  // ===== [local patch Z] 录屏（OBS）：说「打开录屏」→ 开 OBS 起录；说「停止」→ 停 =====
  // 为什么必须抢在 parseIntent **之前**判：「打开录屏」会被那条正则当成"要找名叫『录屏』的软件"
  // （必然 not-found）；而「开始录制」根本不匹配它（"开始"不在那条正则的动词表里）。
  parseRecIntent(text) {
    const t = String(text || '').trim().replace(/[\s，。！？、,.!?~～:：;；"'「」]/g, '');
    if (!t || t.length > 40) return null;
    const NOUN = /(录屏|录制|录像|录影|录相|录视频|录下来|录个屏|录一下|录一段|屏幕录制|荧幕录制|录音)/;
    const STOP = /(停止|停下|停一下|停了|停掉|结束|别录|不要录|不录|关掉|关闭|收工)/;
    const ASK = /(什么|怎么|为啥|为什么|吗|呢|教程|设置|在哪)/;
    // 只说「打开 OBS」不算录屏意图（那走下面 parseIntent 去开软件）；带"录"字才算。
    const recish = NOUN.test(t) || (/obs/i.test(t) && /录/.test(t)) || (/录/.test(t) && STOP.test(t));
    if (recish) {
      if (ASK.test(t)) return null; // 「录屏怎么用」这类问句绝不当命令
      if (STOP.test(t)) return { action: 'stop' };
      return { action: 'start' }; // 提到了录屏又没说要停 → 就是要开
    }
    // 没提"录屏"二字的纯口令：只有她**确实在录**时才当停止（否则"停止"会去抢别的动作的活）
    if (this.recOn === true && /^(停止|停下|停一下|停了|停|结束|别录了|不录了|收工|可以了|好了)[吧呀啊呗啦]?$/.test(t)) {
      return { action: 'stop' };
    }
    return null;
  }

  /** 只读问主进程：OBS 在不在、有没有在录。失败一律吞掉（当"不知道"）。 */
  async refreshRecStatus() {
    if (!window.petBridge || typeof window.petBridge.recStatus !== 'function') return null;
    try {
      const r = await window.petBridge.recStatus();
      if (r && r.ok === true) {
        this.recOn = !!r.recording;
        return r;
      }
    } catch {
      /* 不知道就算了 */
    }
    return null;
  }

  /** 真正去开/停 OBS：路径/端口/密码全在主进程，这里只说动作、只收结果。 */
  async execRec(action) {
    if (!window.petBridge || typeof window.petBridge.recStart !== 'function') {
      return { ok: false, why: 'bridge-missing', reply: '我这边没有录屏通道，做不了…' };
    }
    const ERR_HINT = {
      'ws-disabled': 'OBS 里的 WebSocket 服务端没开——OBS 里「工具 → WebSocket 服务器设置」勾上"启用"就行',
      'no-ws-config': '没读到 OBS 的 websocket 配置，OBS 是不是装在别的地方？',
      'obs-exe-not-found': '我没找到 OBS 装在哪儿',
      'obs-start-timeout': 'OBS 起来了但一直没准备好，可能有个窗口在等你点一下',
      'started-but-not-active': 'OBS 起来了但没能开始录',
      'record-not-started': 'OBS 起来了但没能开始录',
    };
    if (action === 'stop') {
      let r = null;
      try {
        r = await window.petBridge.recStop();
      } catch (e) {
        r = { ok: false, error: String((e && e.message) || e) };
      }
      if (r && r.ok === true) {
        this.recOn = false;
        if (r.already) return { ok: true, reply: '本来就没在录呀～' };
        const p = String(r.path || '').replace(/\\/g, '/');
        const name = p ? p.split('/').pop() : '';
        return {
          ok: true,
          reply: '好，停下来了～' + (name ? '录像存成「' + name + '」了，位置就是 OBS 里设的那个。' : '录像按 OBS 自己的设置存好了。'),
        };
      }
      const err = String((r && r.error) || 'unknown');
      if (err === 'obs-not-running' || err === 'no-ws-config') return { ok: true, reply: 'OBS 现在没开着，也没在录呢～' };
      return { ok: false, why: err, reply: '没能停下来…（' + (ERR_HINT[err] || err) + '）' };
    }
    let r = null;
    try {
      r = await window.petBridge.recStart();
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) };
    }
    if (r && r.ok === true) {
      this.recOn = true;
      if (r.already) return { ok: true, reply: '本来就在录着啦～' };
      return { ok: true, reply: r.startedObs ? '我把 OBS 打开、开始录啦～' : '开始录啦～' };
    }
    const err = String((r && r.error) || 'unknown');
    return { ok: false, why: err, reply: '没能开始录…（' + (ERR_HINT[err] || err) + '）' };
  }

  // ===== [local patch M2] 听懂"指路" =====
  // 为什么要有它：parseIntent 只认「打开/启动/运行…」，「移动到左边」匹配不上 → 掉进普通聊天，
  // 模型回一句"好呀"而人站在原处（主人说的"不太智能"就是这个）。
  // 两道闸门防误吞：① 句子以「打开…」开头一律放行给 parseIntent（"打开右边的软件"不是指路）；
  // ② 去掉客气话和指路动词之后，剩下的字符必须**全是方位字**才认。
  parseMoveIntent(text) {
    const t = String(text || '')
      .trim()
      .replace(/[\s，。！？、,.!?~～:：;；"「」]/g, '');
    if (!t || t.length > 24) return null;
    // 问句不是命令（"你能移动到左边吗"）
    if (/(什么|怎么|为啥|为什么|能不能|可不可以|行不行|吗|呢|教程|设置|在哪|哪儿)/.test(t)) return null;
    // 「打开/启动…」是 parseIntent 的地盘
    if (/^(?:帮我|给我|替我|麻烦|请)?(?:打开|启动|运行|开一下|开个|开启|播放|关闭|关掉)/.test(t)) return null;
    if (/录屏|录制|录像/.test(t)) return null; // 录屏刚在前面判过，这里再兜一层
    // 「过来」＝走到光标那儿
    if (/^(?:快点?|赶紧|马上|立刻|现在)?(?:过来|过来这边|来这边|来我这边|到我这边|来我这儿|来我这|来我身边)[吧呀啊呗啦]?$/.test(t)) {
      return { place: 'cursor' };
    }
    // 回原位（沿用她原有的 goHome：瞬时归位）
    if (/原位|原处|初始位置|出发点|老地方/.test(t)) return { place: 'home' };
    if (/(?:回|返回|退)(?:到|去)?(?:原来|原本|刚才|最开始)/.test(t)) return { place: 'home' };
    // 去掉前后缀废话
    let s = t;
    const HEAD = /^(?:你|您|有点|稍微|稍稍|大概|快点?|赶紧|马上|立刻|现在|麻烦|请|帮我|给我|替我|能不能|可以|再|屏幕|桌面|显示器|荧幕|移动到|移到|挪到|挪去|挪|走到|走去|走过去|走过来|跑到|跑去|跑|去|到|往|向|朝|靠近|靠|站到|站|待在|待着|待|换到|换|冲到|冲|退到|退|来到|来|在)/;
    for (let i = 0; i < 6 && HEAD.test(s); i++) s = s.replace(HEAD, '');
    const TAIL = /(?:了|的|个|吧|呀|啊|呗|啦|哈|哦|喔|嘛|去|来|一下|一下下|一点|一点儿|点点|那儿|那里|这儿|这里|那边|这边|边上|里头|里|走|跑|挪|移|站|待|靠)$/;
    for (let i = 0; i < 6 && TAIL.test(s); i++) s = s.replace(TAIL, '');
    s = s.replace(/[的个]/g, '');
    if (!s || s.length > 8) return null;
    if (!/^[左右上下中间央顶底边角方面侧偏落]+$/.test(s)) return null; // 只剩方位字才算数
    const hint = (s.match(/偏([左右上下])/) || [])[1] || '';
    const hasL = /左/.test(s) || hint === '左';
    const hasR = /右/.test(s) || hint === '右';
    const hasT = /[上顶]/.test(s) || hint === '上';
    const hasB = /[下底]/.test(s) || hint === '下';
    const hasM = /[中央]/.test(s);
    if (hasL && hasR) return null; // "左右"这种含糊说法不做
    if (!hasL && !hasR && !hasT && !hasB && !hasM) return null;
    if (hasM && !hasL && !hasR && !hasT && !hasB) return { place: 'center' };
    const horiz = hasL ? 'left' : hasR ? 'right' : hasM ? 'midx' : '';
    const vert = hasT ? 'top' : hasB ? 'bottom' : '';
    if (!horiz && !vert) return null;
    return { place: vert ? (horiz ? vert + '-' + horiz : vert) : horiz };
  }

  /** 真正走过去：位移交给她本来就有的行走驱动（跟动画同步、逐帧移窗口）。 */
  async execMove(mv) {
    const NAMES = {
      left: '左边',
      right: '右边',
      top: '上面',
      bottom: '下面',
      'top-left': '左上角',
      'top-right': '右上角',
      'bottom-left': '左下角',
      'bottom-right': '右下角',
      center: '屏幕中间',
      midx: '中间',
      'top-midx': '上面中间',
      'bottom-midx': '下面中间',
      cursor: '你那边',
      home: '原来的位置',
    };
    const what = NAMES[mv.place] || '那边';
    if (mv.place === 'home') {
      this.walkPlan = null;
      this.goHome();
      this.moveHoldUntil = Date.now() + MOVE_HOLD_MS;
      return { ok: true, what: what, reply: '好，我回老地方待着啦～' };
    }
    const r = this.walkTo(mv.place);
    if (r === false) return { ok: false, why: 'no-move-anim', what: what, reply: '我这套素材里没有能走的动作，挪不过去…' };
    if (r === 'busy') return { ok: false, why: 'dragging', what: what, reply: '你正揪着我呢，松手我就过去～' };
    // 指路之后先别自己溜达（否则"到了又自己走开"＝像没听话）
    this.moveHoldUntil = Date.now() + MOVE_HOLD_MS;
    if (r === 'here') return { ok: true, what: what, reply: '我已经在' + what + '啦～' };
    return { ok: true, what: what, reply: '好，我这就' + (mv.place === 'cursor' ? '过去' : '挪到') + what + '～' };
  }

  // 解析"让她做什么"：只认「打开…」这一类意图；其它一律返回 null（= 不拦截，交给正常对话）
  parseIntent(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 60) return null;
    const m = t.match(/^(?:帮我|给我|替我|麻烦)?\s*(?:打开|启动|运行|开一下|开个|开启)\s*[「"'']?([^」"'']+?)[」"'']?$/);
    return m ? { what: m[1].trim() } : null;
  }

  async onChatSendIntercept(text) {
    this.ttsStop(); // [local patch T] 主人又说话了：立刻停掉旧朗读队列
    // [local patch Z] 录屏意图最先判（"打开录屏"会被下面的 parseIntent 当成找软件）
    const rec = this.parseRecIntent(text);
    if (rec) {
      // 起录＝让她去开软件，要「允许她打开软件」的权限；**停止不需要权限**——
      // 录着的时候拒绝"停止"只会让录像一直录下去，那是更坏的结果。
      if (rec.action === 'start' && !this.perm.app) {
        this.noteAction('被拒绝（未授权"允许她打开软件"）：开始录屏');
        return { ok: true, reply: '录屏要先开「允许她打开软件」的权限～右键我 → 权限设置 里勾一下就行。', ts: Date.now() };
      }
      const rr = await this.execRec(rec.action);
      this.noteAction((rr.ok ? '成功：' : '失败：') + (rec.action === 'start' ? '开始录屏' : '停止录屏') + (rr.ok ? '' : '（' + rr.why + '）'));
      return { ok: true, reply: rr.reply, ts: Date.now() };
    }
    // [local patch M2] 指路：得抢在 parseIntent 之前（那条正则根本不认「移动到左边」）
    const mv = this.parseMoveIntent(text);
    if (mv) {
      const mr = await this.execMove(mv);
      this.noteAction((mr.ok ? '成功：' : '失败：') + '走到' + (mr.what || mv.place) + (mr.ok ? '' : '（' + mr.why + '）'));
      return { ok: true, reply: mr.reply, ts: Date.now() };
    }
    const intent = this.parseIntent(text);
    if (!intent) return null; // 普通聊天，不插手
    const target = intent.what;
    const isUrl = /^(https?:\/\/|www\.)/i.test(target) || /^[a-z0-9-]+\.(com|cn|net|org|io|tv|cc|me)(\/|$)/i.test(target);
    const kind = isUrl ? 'url' : 'app';
    if (!this.perm[kind]) {
      const label = this.permLabels()[kind];
      this.noteAction('被拒绝（未授权' + label + '）：' + target);
      return { ok: true, reply: '这件事要「' + label + '」的权限，我还没有～右键我 → 权限设置 里开一下就行。', ts: Date.now() };
    }
    const r = await this.execOpen(target, kind);
    this.noteAction((r.ok ? '成功：' : '失败：') + target + (r.ok ? '' : '（' + r.why + '）'));
    return { ok: true, reply: r.reply, ts: Date.now() };
  }

  // 只读转发给主进程（单独一层是为了可测：测试可以替换掉它，断言"有没有真的发起打开"）
  openTarget(payload) {
    if (!window.petBridge || typeof window.petBridge.openTarget !== 'function') return Promise.resolve(null);
    return window.petBridge.openTarget(payload).catch(() => null);
  }

  async execOpen(target, kind) {
    if (typeof this.openTarget !== 'function') {
      return { ok: false, why: 'bridge-missing', reply: '我这边没有操作通道，做不了…' };
    }
    if (kind === 'url') {
      const url = /^https?:\/\//i.test(target) ? target : 'https://' + target;
      const r = await this.openTarget({ kind: 'url', target: url });
      return r && r.ok ? { ok: true, reply: '好，帮你把 ' + url + ' 打开了～' } : { ok: false, why: (r && r.error) || 'open-failed', reply: '网页没打开成功…' };
    }
    const r = await this.openTarget({ kind: 'auto', target });
    if (r && r.ok) return { ok: true, reply: '好，帮你打开「' + r.matched + '」了～' };
    if (r && r.error === 'ambiguous') {
      /* [local patch P] 同类有多个（或者名字里带"卸载"）：只问、不做 —— 一个都不打开。
       * 语音容易听错一个字，猜错就是替主人卸载/删东西，宁可多问一句。 */
      const all = (r.candidates || []).filter((x) => typeof x === 'string' && x);
      const shown = all.slice(0, 4).join('、') + (all.length > 4 ? ' 等' : '');
      return {
        ok: false,
        why: 'ambiguous',
        reply: '你说的是哪一个？' + (shown || '我一时想不起来都有谁') + '——说全名我就去开，我不猜。',
      };
    }
    if (r && r.error === 'not-found') {
      const hint = r.candidates && r.candidates.length ? '（我认识的类似名字：' + r.candidates.join('、') + '）' : '';
      return { ok: true, reply: '我没找到叫「' + target + '」的软件或文件…' + hint };
    }
    return { ok: false, why: (r && r.error) || 'open-failed', reply: '没打开成功…（' + ((r && r.error) || '未知原因') + '）' };
  }

  runPermAction(cmd) {
    const parts = String(cmd || '').split(':');
    if (parts[0] === 'set' && parts[1] && parts[2]) {
      this.setPerm(parts[1], parts[2] === 'on');
      return;
    }
    // [local patch Z] 菜单里点「开始/停止录屏」＝主人亲口吩咐（不会被语音听错），不再走权限闸门
    if (cmd === 'rec-start' || cmd === 'rec-stop') {
      const action = cmd === 'rec-start' ? 'start' : 'stop';
      void this.execRec(action).then((r) => {
        this.noteAction((r.ok ? '成功：' : '失败：') + (action === 'start' ? '开始录屏（菜单）' : '停止录屏（菜单）') + (r.ok ? '' : '（' + r.why + '）'));
        this.showWhisper(r.reply);
      });
      return;
    }
    if (cmd === 'log') {
      const last = this.permLog.slice(0, 5).map((x) => new Date(x.t).toTimeString().slice(0, 5) + ' ' + x.text);
      this.showWhisper(last.length ? '我最近做的：' + last.join('；') : '我还没替主人做过什么。');
      return;
    }
    // [local patch M2] 菜单里点「走到…」＝主人亲手点的，不走权限闸门
    if (String(cmd || '').indexOf('move:') === 0) {
      const place = String(cmd).slice(5);
      void this.execMove({ place: place }).then((r) => {
        this.noteAction((r.ok ? '成功：' : '失败：') + '走到' + (r.what || place) + (r.ok ? '' : '（' + r.why + '）'));
        this.showWhisper(r.reply);
      });
      return;
    }
    /* perm:noop（信息行）：什么都不做 */
  }

  // ===== [local patch Q] 长句分段说：一句说完再冒下一句 =====
  splitSpeech(text) {
    const s = String(text || '').trim();
    if (!s) return [];
    const rough = s.split(/(?<=[。！？!?；;…])\s*/).map((x) => x.trim()).filter(Boolean);
    const out = [];
    for (const part of rough) {
      if (part.length <= 40) {
        out.push(part);
        continue;
      }
      for (let i = 0; i < part.length; i += 40) out.push(part.slice(i, i + 40));
    }
    return out;
  }

  // [发布版补丁 A4d] 多带一个 opts 一路透传到原型上的 showWhisper（低优先级让路要用）
  speakSegmented(text, image, orig, opts) {
    // 新话来了就作废旧队列 —— **必须先做，再判断长度**：
    // 否则"短的插队话"会走 early return，旧的长句队列还在后台继续冒话（踩过）。
    if (this.speechTimer) window.clearTimeout(this.speechTimer);
    const token = (this.speechToken = (this.speechToken || 0) + 1);
    const segs = this.splitSpeech(text);
    if (segs.length <= 1) return orig(text, image, opts);
    const step = (i) => {
      if (this.speechToken !== token) return;
      orig(segs[i], i === 0 ? image : undefined, opts);
      if (i + 1 >= segs.length) return;
      const wait = Math.min(12000, Math.max(2600, segs[i].length * 220));
      this.speechTimer = window.setTimeout(() => step(i + 1), wait);
    };
    step(0);
    return null;
  }

  // ===== [local patch R] 专有名词纠正（她说错的名字改回正确写法）=====
  // 例：本地小模型把 "Left 4 Dead 2" 音译成「左死的2」→ 一律改回「求生之路2」。
  fixNames(text) {
    if (typeof text !== 'string' || !text) return text;
    const alias = {
      '左死的2': '求生之路2', '左死2': '求生之路2', '左边的2': '求生之路2', '致死2': '求生之路2',
      'left 4 dead 2': '求生之路2', 'left for dead 2': '求生之路2', l4d2: '求生之路2', 'left 4 dead': '求生之路',
      csgo: '反恐精英：全球攻势', 'cs:go': '反恐精英：全球攻势', 'cs 2': '反恐精英2',
      lol: '英雄联盟', dota2: '刀塔2', 'gta 5': '侠盗猎车手5', gta5: '侠盗猎车手5',
      pubg: '绝地求生',
    };
    // 直接做大小写不敏感的整体替换，**不构造正则**（从字符串拼正则的转义太容易写错，踩过）
    let out = String(text);
    for (const bad of Object.keys(alias)) {
      const good = alias[bad];
      const lb = bad.toLowerCase();
      if (good.toLowerCase().indexOf(lb) >= 0) continue; // 替换词里含原词 → 跳过，避免死循环
      let idx = out.toLowerCase().indexOf(lb);
      while (idx >= 0) {
        out = out.slice(0, idx) + good + out.slice(idx + bad.length);
        idx = out.toLowerCase().indexOf(lb, idx + good.length);
      }
    }
    return out;
  }


  // ===== [local patch V] 语音模式：复用本机 SenseVoice **离线**转写（不联网、不上传音频）=====
  // 链路：麦克风(16k) → RMS VAD 切句 → 主进程 node worker 转写 → 她先复述听到的话
  //       → 同一个 parseIntent/onChatSendIntercept 通道（与打字完全同一套，两边不会跑偏）。
  // 默认关：开着才向主进程申请麦克风权限；关掉立刻停轨道、关 AudioContext。
  voiceKey() {
    return 'dsh-pet-voice-' + this.pet.id;
  }

  voiceSensTable() {
    return { low: 0.022, mid: 0.012, high: 0.006 };
  }

  voiceThreshold(sens) {
    const t = this.voiceSensTable();
    return t[sens] || t.mid;
  }

  /** [local patch V] 强度闸门阈值（A 段）：比 VAD 阈值**高一个量级**，而且三档各不相同。
   *  VAD 那条线只回答"算不算一句话"，闸门这条线回答"值不值得送引擎"：
   *  实测主人那 36 段里失败段落的峰值 rms 是 0.012–0.045，成功的是 0.16–0.306；
   *  而引擎在低信噪比下**不会说"我不知道"**——SNR≈−6dB 时它会把底噪认成
   *  「你好了直接获得的能量。」这种"像话但不是人话"的句子（tools/worker-lang-probe.mjs 实测）。 */
  voiceMinRms(sens) {
    return { low: 0.08, mid: 0.05, high: 0.03 }[sens] || 0.05;
  }

  /** [local patch V] 送引擎前的软件增益（B 段）：把段落峰值拉到 TARGET，最多 CAP 倍，
   *  **只放大、绝不衰减**（够响的段落 gain = 1 原样送走），放大后逐样本削顶在 ±1 内。
   *  返回 { samples, gain }，gain 保留两位小数并如实记进日志——不然"为什么这次认出来了"没法复盘。 */
  voiceApplyGain(samples, rms) {
    const TARGET = 0.15;
    const CAP = 8;
    const peak = Number(rms) || 0;
    const want = peak > 0 ? TARGET / peak : 1;
    const gain = Math.max(1, Math.min(CAP, want));
    if (!(gain > 1) || !samples || !samples.length) return { samples, gain: 1 };
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] * gain;
      out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    return { samples: out, gain: Math.round(gain * 100) / 100 };
  }

  hookVoiceMode() {
    this.voiceState = { on: false, sens: 'mid', micId: '', micLabel: '', lang: 'zh', mics: [], testing: false, quietCount: 0, quietHinted: false, weakCount: 0, weakHinted: false, weakPeak: 0, noSpeechCount: 0, noSpeechHinted: false };
    let legacyDefault = false; // 盘上存着 'default'（v5 的坑）→ 归一化后顺手清盘
    try {
      const raw = window.localStorage.getItem(this.voiceKey());
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.sens && this.voiceSensTable()[o.sens]) this.voiceState.sens = o.sens;
        // 选中的麦克风跟灵敏度存在**同一个**键里（不新建第三种存储）。
        // v5 的坑：存盘里可能有字符串 'default'（那不是 deviceId）。它会一路走到
        // getUserMedia({deviceId:{exact:'default'}})，失败后回落默认设备**还误报"设备不在了"**，
        // 菜单也不打勾。归一化成 ''（跟随系统），并把盘上那个 'default' 清掉。
        if (o && typeof o.micId === 'string') {
          if (o.micId === 'default') {
            legacyDefault = true; // micLabel 一起作废：它描述的是我们不再选的那个"设备"
          } else {
            this.voiceState.micId = o.micId;
            if (typeof o.micLabel === 'string') this.voiceState.micLabel = o.micLabel;
          }
        }
        // 识别语言也只认这两个值（默认 zh = 一直以来的行为），别的当没写
        if (o && (o.lang === 'zh' || o.lang === 'auto')) this.voiceState.lang = o.lang;
        // [local patch Z] 语音模式持久化：老代码 on 从不落盘，重启即静音
        if (o && typeof o.on === 'boolean') this.voiceState.on = o.on;
      }
    } catch {
      /* localStorage 不可用 → 用默认灵敏度（语音仍然默认关） */
    }
    if (legacyDefault) this.saveVoice(); // 只清那一个值：别的字段原样写回
    this.voice = null; // 运行时对象（AudioContext / MediaStream / VAD），只有开着时才有
  }

  saveVoice() {
    try {
      const st = this.voiceState || {};
      window.localStorage.setItem(
        this.voiceKey(),
        JSON.stringify({ on: !!st.on, sens: st.sens, micId: st.micId || '', micLabel: st.micLabel || '', lang: st.lang === 'auto' ? 'auto' : 'zh' }),
      );
    } catch {
      /* 同上 */
    }
  }

  voiceLabels() {
    const st = this.voiceState || {};
    const sens = st.sens || 'mid';
    const text = { low: '低（要大声点）', mid: '中', high: '高（小声也听得见）' }[sens] || '中';
    const on = !!st.on;
    const mics = Array.isArray(st.mics) ? st.mics : [];
    const sel = st.micId || '';
    const lang = st.lang === 'auto' ? 'auto' : 'zh';
    return {
      on,
      sens,
      sensText: text,
      lang,
      langText: lang === 'auto' ? '自动' : '中文',
      hint: on ? '听完停一下，我就接话' : '开着才用麦克风（本机转写）',
      micId: sel,
      micLabel: st.micLabel || '',
      micText: sel ? st.micLabel || '已选的设备' : '默认',
      // 一个名字都没枚举到时（还没授权），说清楚为什么看不到名字 —— 别拿 deviceId 冒充设备名
      micHint: mics.length ? '选中的那个才是我要听的声音' : '先点下面的自检授权一次才能看到设备名',
      mics,
      testing: !!st.testing,
    };
  }

  /** [local patch V] 日志里的设备标识：真名（label）优先；只有 deviceId 时只取**尾 6 位**，
   *  绝不把整条 deviceId 记进盘（那是设备指纹，没必要留）。 */
  voiceMicTag(track) {
    // Chromium 给"默认设备"的名字前面挂着 'Default - '（主人盘上的日志就长成
    // "Default - 麦克风 (AULA-G7Pro V2) (38a6:0021"）—— **先剥前缀再截 40 字**，
    // 否则 40 字的额度全被那层前缀和尾部乱码吃掉，设备名主干反而看不见了。
    const label = String((track && track.label) || '').trim().replace(/^Default\s*-\s*/i, '');
    if (label) return label.slice(0, 40);
    let id = '';
    try {
      if (track && typeof track.getSettings === 'function') id = String((track.getSettings() || {}).deviceId || '');
    } catch {
      id = '';
    }
    if (!id) id = String((this.voiceState && this.voiceState.micId) || '');
    return id ? '…' + id.slice(-6) : '默认麦克风';
  }

  /** [local patch V] 把麦克风列表刷进 voiceState.mics（异步，**不弹权限框**：enumerateDevices 不要授权）。
   *  还没授权时 label 全是空串 —— 那时一个名字都不列（菜单只留「默认麦克风」+ 一句"先点自检"），
   *  拿到权限后名字自然就出来了。 */
  async refreshVoiceMics() {
    const st = this.voiceState;
    if (!st) return [];
    const md = navigator.mediaDevices;
    if (!md || typeof md.enumerateDevices !== 'function') {
      st.mics = [];
      return st.mics;
    }
    let devs = null;
    try {
      devs = await md.enumerateDevices();
    } catch {
      devs = null; // 枚举失败就当没有：绝不因此报错、更不影响说话
    }
    const out = [];
    const seen = {};
    for (const d of devs || []) {
      if (!d || d.kind !== 'audioinput') continue;
      const id = String(d.deviceId || '');
      const label = String(d.label || '').trim();
      if (!id || !label || seen[id]) continue;
      seen[id] = 1;
      out.push({ id, label: label.slice(0, 40) });
    }
    st.mics = out;
    return out;
  }

  /** [local patch V] 选中一个麦克风：arg = ''（跟随系统）或列表下标。
   *  下标越界时**什么都不做**（列表换代了宁愿不动，也不许选到一个猜出来的设备）。
   *  正在听的时候换设备：先停干净再重开，绝不两条流同时跑。 */
  setVoiceMic(arg) {
    const st = this.voiceState;
    if (!st) return false;
    let id = '';
    let label = '';
    if (arg !== '' && arg !== null && arg !== undefined) {
      const i = Number(arg);
      const m = Number.isInteger(i) && i >= 0 ? (st.mics || [])[i] : null;
      if (!m) return false;
      id = m.id;
      label = m.label;
    }
    st.micId = id;
    st.micLabel = label;
    this.saveVoice();
    if (st.on) {
      this.stopVoiceMode(); // 换设备 = 重开一次（立刻生效）
      this.startVoiceMode();
      return true;
    }
    this.showWhisper('好，麦克风用「' + (label || '默认设备') + '」。');
    return true;
  }

  /** [local patch V] 识别语言：'zh'（默认）或 'auto'。为什么需要这个开关：实测（tools/voice-lang-probe.mjs）
   *  **同一段底噪**——zh 出「嗯。」，auto 出「그.」（韩文）；主人盘上那几条韩文垃圾就是这么来的。
   *  默认 zh = 沿用现在的行为，auto 只留给"确实想让它自己判语言"的人。
   *  换语言不重启 worker：下一句把新语言带过去，worker 自己把引擎换掉（冷启 ~2.5s，只一次）。 */
  setVoiceLang(lang) {
    const want = lang === 'auto' ? 'auto' : 'zh';
    const st = this.voiceState;
    if (!st) return false;
    const changed = st.lang !== want;
    st.lang = want;
    this.saveVoice();
    if (!changed) return true;
    this.showWhisper('好，识别语言：' + (want === 'auto' ? '自动（噪声多的时候会猜成韩文/日文）' : '中文') + '（下一句生效）');
    return true;
  }

  /** [local patch V] 开麦：优先用**选中的那个设备**；它不在了（拔了/改名了）就回落默认，
   *  并且如实说一句（不许静默换设备 —— 主人会以为她听的是自己挑的那个）。 */
  async voiceOpenMic() {
    const md = navigator.mediaDevices;
    const id = String((this.voiceState && this.voiceState.micId) || '');
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (id) {
      try {
        const stream = await md.getUserMedia({ audio: Object.assign({ deviceId: { exact: id } }, base) });
        return { stream, fellBack: false };
      } catch {
        /* 设备不在了 → 往下走默认设备 */
      }
    }
    const stream = await md.getUserMedia({ audio: base });
    return { stream, fellBack: !!id };
  }

  voiceRms(chunk) {
    let s = 0;
    for (let i = 0; i < chunk.length; i++) s += chunk[i] * chunk[i];
    return chunk.length ? Math.sqrt(s / chunk.length) : 0;
  }

  voiceVadNew(sens) {
    // rms = 这一段的**峰值**（诊断用：麦克风到底送没送进来声音，看它就够了）
    return { thr: this.voiceThreshold(sens), speaking: false, chunks: [], samples: 0, quietMs: 0, ms: 0, voicedMs: 0, rms: 0, lastDrop: null };
  }

  voiceConcat(chunks, n) {
    const out = new Float32Array(n);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  voiceVadFinish(st, reason) {
    const out = this.voiceConcat(st.chunks, st.samples);
    const ms = Math.round((out.length / 16000) * 1000);
    const voicedMs = Math.round(st.voicedMs || 0);
    const rms = st.rms || 0;
    st.speaking = false;
    st.chunks = [];
    st.samples = 0;
    st.quietMs = 0;
    st.ms = 0;
    st.voicedMs = 0;
    st.rms = 0;
    // 丢太短的一句：判的是**真的有人声**的时长（voicedMs），不是"人声+尾巴静音"的总长，
    // 否则一声咳嗽会带着 0.9s 静音凑够 1.2s 被当成一句话送去转写（踩过）。
    if (voicedMs < 300 || ms < 300) {
      // 被丢掉也要留下现场（丢在哪、多长、多响）—— 主人说"没反应"时，这里是最常见的断点。
      // 用 st.lastDrop 而不是改返回值：voiceVadPush 的契约（null=还没说完）一个字都不动。
      st.lastDrop = { dropped: 'too-short', ms, voicedMs, rms };
      return null;
    }
    st.lastDrop = null;
    return { samples: out, ms, voicedMs, rms, reason };
  }

  /** 喂一帧 PCM（Float32Array）：null = 还没说完；{samples,ms,voicedMs,rms,reason} = 一句说完了。
   *  被丢掉的那一段在 st.lastDrop 里（dropped:'too-short'）—— 返回值契约不变，老调用方不受影响。 */
  voiceVadPush(st, chunk, frameMs) {
    const frame = frameMs || Math.round((chunk.length / 16000) * 1000);
    const rms = this.voiceRms(chunk);
    if (rms > (st.rms || 0)) st.rms = rms; // 峰值：段落丢了也留得下"当时多响"
    st.ms += frame;
    if (rms > st.thr) {
      st.speaking = true;
      st.quietMs = 0;
      st.voicedMs = (st.voicedMs || 0) + frame;
    } else if (st.speaking) {
      st.quietMs += frame;
    }
    if (!st.speaking) return null;
    st.chunks.push(chunk);
    st.samples += chunk.length;
    if (st.quietMs >= 900) return this.voiceVadFinish(st, 'silence'); // 安静 0.9s = 一句说完了
    if (st.ms >= 12000) return this.voiceVadFinish(st, 'timeout'); // 说太久：12s 硬切，别一直听着
    return null;
  }

  async startVoiceMode() {
    if (this.voiceState && this.voiceState.on) return true; // 幂等：开着再点不会重复开麦
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.setVoiceMode !== 'function' || typeof bridge.voiceTranscribe !== 'function') {
      this.showWhisper('我这边的语音通道没加载，用不了语音模式…');
      return false;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      this.showWhisper('这个窗口不支持录音，语音模式开不了…');
      return false;
    }
    // 先告诉主进程「语音模式开着」，主进程才会放行 media 权限（默认一律拒绝）
    await bridge.setVoiceMode(true);
    let got = null;
    try {
      got = await this.voiceOpenMic(); // 用选中的设备；它不在了就回落默认（下面如实说一句）
    } catch (e) {
      await bridge.setVoiceMode(false);
      this.showWhisper('麦克风没有权限，我开不了语音模式…（在系统设置里允许麦克风再试）');
      return false;
    }
    const stream = got.stream;
    try {
      const ctx = new AC({ sampleRate: 16000 });
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const track = stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
      const st = {
        ctx,
        stream,
        proc,
        src,
        vad: this.voiceVadNew(this.voiceState.sens),
        busy: false,
        device: this.voiceMicTag(track), // 日志里记哪个设备（真名优先）
        talked: false, // 这一轮到底有没有听到过人声
        silentTicks: 0,
        timer: null,
      };
      this.voiceState.quietCount = 0; // 每次开麦重数（上次的静音账不带到这一次）
      this.voiceState.quietHinted = false;
      this.voiceState.weakCount = 0; // 「连续太轻」同理：每次开麦重新数
      this.voiceState.weakHinted = false;
      this.voiceState.weakPeak = 0;
      proc.onaudioprocess = (e) => {
        if (!this.voice || this.voice !== st) return;
        const buf = e.inputBuffer.getChannelData(0);
        const chunk = new Float32Array(buf.length);
        chunk.set(buf);
        const frameMs = Math.round((chunk.length / 16000) * 1000);
        if (this.voiceRms(chunk) > st.vad.thr) st.talked = true;
        const done = this.voiceVadPush(st.vad, chunk, frameMs);
        if (!done) {
          // 被 VAD 丢掉的那一段（人声不足 300ms）也要落盘：主人说"没反应"最常断在这里
          const drop = st.vad.lastDrop;
          if (drop) {
            st.vad.lastDrop = null;
            this.voiceNoteSegment({ dropped: drop.dropped, device: st.device, rms: drop.rms, voicedMs: drop.voicedMs });
          }
          return;
        }
        if (st.busy) return; // 上一句还在转写/回话 → 不做新的一句，避免插队
        st.busy = true;
        this.voiceHandlePcm(done.samples, { device: st.device, rms: done.rms, voicedMs: done.voicedMs }).finally(() => {
          st.busy = false;
        });
      };
      src.connect(proc);
      proc.connect(ctx.destination); // ScriptProcessor 必须连到输出才会被驱动（不写就是静音）
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') await ctx.resume();
      this.voice = st;
      this.voiceState.on = true;
      this.saveVoice(); // [local patch E6] 开了就落盘（配合 hookVoiceMode 的读回 = 重启后能自己开回来）
      // 每 10 秒看一眼：开着麦却一点人声都没进来，就得让主人知道（并且记进日志）
      st.timer = setInterval(() => this.voiceSilenceTick(st), 10000);
      if (got.fellBack) {
        this.showWhisper('选中的麦克风「' + (this.voiceState.micLabel || '之前选的那个') + '」没找到（可能被拔了），我用了默认设备。');
      } else {
        this.showWhisper('语音模式开着啦～说完停一下，我听到会先复述一遍。');
      }
      return true;
    } catch (e) {
      try {
        if (stream) for (const t of stream.getTracks()) t.stop();
      } catch {
        /* 已经停了 */
      }
      await bridge.setVoiceMode(false);
      this.showWhisper('麦克风起来了但音频管线没建起来…（' + String((e && e.message) || e) + '）');
      return false;
    }
  }

  stopVoiceMode() {
    const st = this.voice;
    this.voice = null;
    if (this.voiceState) this.voiceState.on = false;
    this.saveVoice(); // [local patch E6] 关了也落盘（否则重启后又自己开回来）
    if (!st) return false;
    try {
      if (st.timer) clearInterval(st.timer); // 心跳定时器必须停：窗口销毁后不许再回调
    } catch {
      /* 定时器已经没了 */
    }
    try {
      if (st.stream) for (const t of st.stream.getTracks()) t.stop();
    } catch {
      /* 已经停了 */
    }
    try {
      if (st.proc) {
        st.proc.onaudioprocess = null;
        st.proc.disconnect();
      }
      if (st.src) st.src.disconnect();
      if (st.ctx && typeof st.ctx.close === 'function') st.ctx.close();
    } catch {
      /* 上下文已经关了 */
    }
    const bridge = window.petBridge;
    if (bridge && typeof bridge.setVoiceMode === 'function') bridge.setVoiceMode(false);
    return true;
  }

  setVoiceSens(sens) {
    if (!this.voiceSensTable()[sens]) return;
    this.voiceState.sens = sens;
    if (this.voice) this.voice.vad = this.voiceVadNew(sens); // 换灵敏度立刻生效（丢掉半句）
    this.saveVoice();
    this.showWhisper('好，语音灵敏度：' + this.voiceLabels().sensText + '。');
  }

  voiceErrText(r) {
    const why = (r && r.error) || '';
    if (why === 'no-node-runtime') return '本机语音引擎不可用：没找到 node 运行时…';
    if (why === 'worker-missing') return '本机语音引擎不可用：worker 脚本不在…';
    if (why === 'worker-timeout') return '转写超时了，没听出来…';
    if (why === 'empty-audio') return '没听清…再说一遍嘛。';
    return '本机语音引擎没转写成功…（' + why + '）';
  }

  async voiceHandlePcm(samples, seg) {
    const bridge = window.petBridge;
    const at = { device: (seg && seg.device) || '默认麦克风', rms: (seg && seg.rms) || 0, voicedMs: (seg && seg.voicedMs) || 0 };
    if (!bridge || typeof bridge.voiceTranscribe !== 'function') {
      this.showWhisper('本机语音引擎不可用，我听不了…');
      this.voiceNoteSegment({ device: at.device, rms: at.rms, voicedMs: at.voicedMs, dropped: 'no-engine' });
      return null;
    }
    // [local patch V] A. 强度闸门：**送引擎之前**先看这一段够不够响。不够响就一个字都不送。
    //    为什么非有不可：引擎对低信噪比输入不会说"我不知道"，它会**硬造**一句中文
    //    （实测 SNR≈−6dB 把底噪认成「你好了直接获得的能量。」）——主人盘上"她答非所问"就是这么来的。
    const min = this.voiceMinRms(this.voiceState && this.voiceState.sens);
    if (!(Number(at.rms) >= min)) {
      this.voiceNoteTooQuiet(at, min);
      return null;
    }
    if (this.voiceState) {
      // 通过闸门 = 这一轮确实听到有人说话了：把"连续太轻"的计数清零
      this.voiceState.weakCount = 0;
      this.voiceState.weakPeak = 0;
    }
    // [local patch V] B. 软件增益（只放大、封顶 8 倍、削顶保护），增益值如实记进日志
    const boosted = this.voiceApplyGain(samples, at.rms);
    let r = null;
    try {
      r = await bridge.voiceTranscribe(boosted.samples, (this.voiceState && this.voiceState.lang) || 'zh');
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) };
    }
    if (!r || !r.ok) {
      this.showWhisper(this.voiceErrText(r));
      this.voiceNoteSegment({ device: at.device, rms: at.rms, voicedMs: at.voicedMs, gain: boosted.gain, dropped: 'engine:' + String((r && r.error) || 'unknown') });
      return null;
    }
    // [local patch V] C. v6 第二道网：worker 里的 Silero VAD 说"这一段没有真人说话" ⇒ 一个字都不转写。
    //    它和上面的强度闸门是两道不同的网：闸门挡"太轻"，VAD 挡"够响但不是人声"
    //    （底噪、键盘声、空调声 —— 主人盘上那些 rms 0.06~0.12 的垃圾段正属于这一类）。
    const speechMs = r.speechMs === null || r.speechMs === undefined ? null : Math.round(Number(r.speechMs) || 0);
    if (r.dropped === 'no-speech') {
      this.voiceNoteNoSpeech(at, speechMs);
      return null;
    }
    const heard = this.fixNames(String(r.text || '').trim());
    if (!heard) {
      this.showWhisper('没听清…再说一遍嘛。');
      this.voiceNoteSegment({ device: at.device, rms: at.rms, voicedMs: at.voicedMs, gain: boosted.gain, speechMs, dropped: 'empty-text' });
      return null;
    }
    // [local patch V] D. 文本兜底：引擎偶尔在"确实有一点人声"的段落上吐一句纯标点
    //    （主人盘上有一条 rms 0.0793 的段落，引擎只回了「。」）。判据是**既没有中日韩文字、
    //    也没有 ASCII 字母数字**；**绝不能用"长度<2"** —— 那会把「好」「嗯」「QQ」一起误杀。
    if (!this.voiceHasWords(heard)) {
      this.showWhisper('这一句我只听到点杂音…你再说一遍嘛。');
      this.voiceNoteSegment({ device: at.device, rms: at.rms, voicedMs: at.voicedMs, gain: boosted.gain, speechMs, heard, dropped: 'garbage' });
      return null;
    }
    this.ttsKind('heard'); // [local patch T] 复述主人自己的话：只出气泡，不朗读
    this.showWhisper('我听到：「' + heard + '」'); // 先说听到的：听错了主人当场能看出来（**原样**带标点，不做任何裁剪）
    let route = null;
    try {
      route = await this.voiceRouteText(heard); // 削标点/拆分句只发生在路由内部：复述给主人的永远是引擎原文
    } catch (e) {
      this.voiceNoteSegment({ device: at.device, rms: at.rms, voicedMs: at.voicedMs, gain: boosted.gain, speechMs, heard, dropped: 'route-error' });
      return null;
    }
    this.voiceNoteSegment({ device: at.device, rms: at.rms, voicedMs: at.voicedMs, gain: boosted.gain, speechMs, heard, route: route && route.route });
    return route;
  }

  /** [local patch V] v6 第三件事：这句话里到底有没有"字"。
   *  中日韩文字（含假名/谚文）或 ASCII 字母数字 ⇒ 有；纯标点/空白/emoji ⇒ 没有。
   *  为什么不用"长度<2"：主人会说「好」「嗯」，用户也会说「QQ」「OK」—— 那些是真话，不能丢。 */
  voiceHasWords(text) {
    return /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AFa-zA-Z0-9]/.test(String(text || ''));
  }

  /** [local patch V] v6：Silero VAD 判"这一段里没有真人说话"。**照样记盘**
   *  （dropped: 'no-speech' 外加 speechMs —— 0 就是一点人声都没有，比 rms 更能说明问题），
   *  连续 3 段才提醒一次；和"太轻"分开计数、分开文案（一个是信号弱，一个是根本没人在说）。 */
  voiceNoteNoSpeech(at, speechMs) {
    const st = this.voiceState || (this.voiceState = { on: false, sens: 'mid' });
    this.voiceNoteSegment({ device: at.device, rms: at.rms, voicedMs: at.voicedMs, speechMs, dropped: 'no-speech' });
    st.noSpeechCount = (st.noSpeechCount || 0) + 1;
    if (st.noSpeechCount < 3 || st.noSpeechHinted) return false;
    st.noSpeechHinted = true;
    this.showWhisper('我一直没听到人声（连着几段都被本机 VAD 判成噪声了）——靠近点说，或者右键我 → 语音模式 → 麦克风，换个麦克风试试。');
    return true;
  }

  /** [local patch V] A 段闸门拦下的一段：**照样记盘**（dropped: 'too-quiet'），
   *  连续 3 段才提醒一次（和"完全没听到人声"分开计数、分开文案：这里是有声但太轻，
   *  量出来的 rms 就是证据，所以提醒里直接报数字，并且给出可执行的三条建议）。 */
  voiceNoteTooQuiet(at, min) {
    const st = this.voiceState || (this.voiceState = { on: false, sens: 'mid' });
    this.voiceNoteSegment({ device: at.device, rms: at.rms, voicedMs: at.voicedMs, dropped: 'too-quiet' });
    st.weakCount = (st.weakCount || 0) + 1;
    st.weakPeak = Math.max(Number(st.weakPeak) || 0, Number(at.rms) || 0);
    if (st.weakCount < 3 || st.weakHinted) return false;
    st.weakHinted = true;
    const num = String(Number((Number(st.weakPeak) || 0).toFixed(3)));
    this.showWhisper(
      '你的麦克风信号太轻了（最近几段峰值只有 ' + num + '，我要 ' + min + ' 以上才敢送识别，硬送的话我会瞎猜）——' +
        '离麦近一点说，或者右键我 → 语音模式：把灵敏度调高一级、或换一个带麦的耳机。' +
        '我查过了，Windows 里这个麦的音量已经开到 94%，不是系统音量的问题。',
    );
    return true;
  }

  /** [local patch V] 把「一段的结果」落盘：识别原文、走了哪条路、被丢掉的原因、送引擎前放大了几倍。
   *  为什么非记不可：主人说"我说了话她没反应"时，盘上必须有现场 —— 麦克风送没送进来声音、
   *  引擎报没报错、听成了什么，全在这一行里。**失败也要记，绝不留白**（这次报障就是一条记录都没有）。 */
  voiceNoteSegment(info) {
    const st = this.voiceState || (this.voiceState = { on: false, sens: 'mid' });
    const seg = info || {};
    const heard = seg.heard ? String(seg.heard).slice(0, 200) : null;
    const entry = {
      ts: Date.now(),
      device: String(seg.device || '默认麦克风').slice(0, 40),
      rms: Number(seg.rms) || 0,
      voicedMs: Math.round(Number(seg.voicedMs) || 0),
      // v6：Silero VAD 判出的"真语音"毫秒数（0 = 一句人声都没有）。没测过就 null —— 不是 0。
      speechMs: seg.speechMs === null || seg.speechMs === undefined ? null : Math.round(Number(seg.speechMs) || 0),
      // B 段软件增益：没放大过就是 1（如实记录，别让"这一段为什么认出来了"无从复盘）
      gain: Number(seg.gain) > 0 ? Math.round(Number(seg.gain) * 100) / 100 : 1,
      heard,
      route: seg.route === 'intent' || seg.route === 'chat' ? seg.route : 'none',
      dropped: seg.dropped ? String(seg.dropped) : null,
    };
    // 「连续 3 段听不到人声」只数**确实没听到人声**的段落；引擎坏了不算（那时她说的是另一句话）
    if (heard) this.voiceNoteHeard();
    else if (entry.dropped === 'too-short' || entry.dropped === 'empty-text' || entry.dropped === 'no-voice') this.voiceNoteSilence();
    const bridge = window.petBridge;
    if (bridge && typeof bridge.voiceLog === 'function') {
      try {
        bridge.voiceLog(entry); // 只上报：写不写得进盘是主进程的事，绝不能因此打断说话
      } catch {
        /* 日志失败不影响语音链路 */
      }
    }
    return entry;
  }

  /** [local patch V] 一连 3 段没听到人声 ⇒ 提示一次（每次开麦最多一次）。
   *  这正是主人报的「我说了话她没反应」最常见的现场：不是她不理，是麦克风根本没送进来人声。 */
  voiceNoteSilence() {
    const st = this.voiceState;
    if (!st) return false;
    st.quietCount = (st.quietCount || 0) + 1;
    if (st.quietCount < 3 || st.quietHinted) return false;
    st.quietHinted = true;
    this.showWhisper('我一直没听到你的声音……右键我 → 语音模式 → 麦克风，换一个设备试试。');
    return true;
  }

  voiceNoteHeard() {
    const st = this.voiceState;
    if (!st) return false;
    st.quietCount = 0; // 听到过就重新数
    st.noSpeechCount = 0; // VAD 那条线也一样：真听到人声就重新数
    return true;
  }

  /** [local patch V] 开着麦却一点人声都没进来时的心跳（每 10 秒一条）+ 数「连续 3 段」。
   *  没有它，麦克风彻底没声时盘上**一条都不会有**（这次报障正是如此），
   *  事后根本分不清是"她从没开过麦"还是"开了、但麦克风没送进来声音"。 */
  voiceSilenceTick(st) {
    if (!this.voice || this.voice !== st) {
      try {
        clearInterval(st.timer);
      } catch {
        /* 定时器已经没了 */
      }
      return;
    }
    if (st.talked) {
      st.silentTicks = 0; // 这一轮听到过声音 → 不算"一直没听到"
      return;
    }
    st.silentTicks = (st.silentTicks || 0) + 1;
    this.voiceNoteSegment({ dropped: 'no-voice', device: st.device, rms: st.vad ? st.vad.rms : 0, voicedMs: 0 });
  }

  /** [local patch V] 麦克风自检（3 秒）：用**选中的那个设备**录 3 秒 → 转写 → 说出听到的原文。
   *  为什么要有它：① 授权一次以后 enumerateDevices 才有真名字（否则菜单里只有「默认麦克风」）；
   *  ② 主人说"没反应"时，一眼分得清是麦克风没声还是引擎不认。
   *  两条铁律：**不依赖语音模式开关**（借一下权限，测完原样还回去，不留开着的麦）；
   *  **只复述、绝不走意图通道**（自检不该打开任何东西）。任何情况都必须有句话。 */
  async voiceSelfTest() {
    const st = this.voiceState;
    if (!st || st.testing) return { ok: false, reason: 'busy' }; // 自检进行中再点不重复
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.voiceTranscribe !== 'function') {
      this.showWhisper('我这边的语音通道没加载，自检做不了…');
      return { ok: false, reason: 'no-bridge' };
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      this.showWhisper('这个窗口不支持录音，自检做不了…');
      return { ok: false, reason: 'no-audio' };
    }
    const wasOn = !!st.on;
    st.testing = true;
    // 自检也要麦克风权限，而主进程只认「语音模式开着」——借一下，测完还回去
    if (!wasOn && typeof bridge.setVoiceMode === 'function') await bridge.setVoiceMode(true);
    let stream = null;
    let ctx = null;
    let proc = null;
    let src = null;
    const chunks = [];
    let total = 0;
    let peak = 0;
    let loud = 0;
    const thr = this.voiceThreshold(st.sens);
    try {
      const got = await this.voiceOpenMic();
      stream = got.stream;
      const track = stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
      const tag = this.voiceMicTag(track);
      ctx = new AC({ sampleRate: 16000 });
      src = ctx.createMediaStreamSource(stream);
      proc = ctx.createScriptProcessor(4096, 1, 1);
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') await ctx.resume();
      if (got.fellBack) this.showWhisper('选中的麦克风没找到（可能被拔了），自检先用默认设备。');
      this.showWhisper('自检开始：对着麦克风说点什么，3 秒…');
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        proc.onaudioprocess = (e) => {
          const buf = e.inputBuffer.getChannelData(0);
          const chunk = new Float32Array(buf.length);
          chunk.set(buf);
          const rms = this.voiceRms(chunk);
          if (rms > peak) peak = rms;
          if (rms > thr) loud++;
          chunks.push(chunk);
          total += chunk.length;
          if (total / 16000 >= 3) finish(); // 录满 3 秒
        };
        src.connect(proc);
        proc.connect(ctx.destination); // 不连输出就不会被驱动（跟语音模式同一个坑）
        setTimeout(finish, 3400); // 兜底：音频回调一直不来（麦克风没在送数据）也要收尾，不能把她挂在这儿
      });
      this.voiceCloseTest(stream, ctx, proc, src);
      if (!wasOn && typeof bridge.setVoiceMode === 'function') await bridge.setVoiceMode(false);
      st.testing = false;
      // [local patch V] D. 自检留录音：**原始**（还没加增益）的这段 PCM 覆盖写到固定路径。
      //    放在所有判断之前 —— 连"一点声音都没收到"的自检也要留下证据，主人可以自己听到底有没有声。
      //    路径由主进程写死（voiceSelfTestPath），渲染端给不了文件名。
      if (total && typeof bridge.voiceSelfTestWav === 'function') {
        try {
          await bridge.voiceSelfTestWav(this.voiceConcat(chunks, total));
        } catch {
          /* 留不下录音不影响自检结论 */
        }
      }
      // "一点声音都没收到"判的是**信号本身**（几乎为零），不是灵敏度阈值：
      // 阈值是"算不算一句话"的线，不是"麦克风有没有在工作"的线。
      if (!total || peak < 0.002) {
        this.showWhisper('一点声音都没收到…麦克风「' + tag + '」好像没在工作（右键我 → 语音模式 → 麦克风，换一个试试）。');
        this.voiceNoteSegment({ dropped: 'selftest-silent', device: tag, rms: peak, voicedMs: 0 });
        return { ok: false, reason: 'silent' };
      }
      // [local patch V] A 段闸门在自检里同样生效：太轻的样本**不送引擎**（送过去它只会硬猜），
      // 但要把量到的 rms 明说，并指路"灵敏度调高一级 / 离麦近一点 / 换带麦的耳机"。
      const minRms = this.voiceMinRms(st.sens);
      if (peak < minRms) {
        this.showWhisper(
          '自检收到的声音太轻了（峰值 rms ' + String(Number(peak.toFixed(3))) + '，低于当前灵敏度要的 ' + minRms + '）——' +
            '我没把它送去识别（硬送我会瞎猜）。录音我留在 voice-selftest.wav 了，你可以自己听听；' +
            '也可以把灵敏度调高一级，或者换一个带麦的耳机。',
        );
        this.voiceNoteSegment({ dropped: 'selftest-quiet', device: tag, rms: peak, voicedMs: loud * 256 });
        return { ok: false, reason: 'too-quiet', rms: peak };
      }
      // 过了闸门 → 和正常链路同一套增益 + 同一个语言开关（自检要能复现真实链路的行为）
      const boosted = this.voiceApplyGain(this.voiceConcat(chunks, total), peak);
      let r = null;
      try {
        r = await bridge.voiceTranscribe(boosted.samples, st.lang === 'auto' ? 'auto' : 'zh');
      } catch (e) {
        r = { ok: false, error: String((e && e.message) || e) };
      }
      if (!r || !r.ok) {
        this.showWhisper('转写引擎出错了…（' + this.voiceErrText(r) + '）');
        this.voiceNoteSegment({ dropped: 'selftest-engine', device: tag, rms: peak, voicedMs: loud * 256, gain: boosted.gain });
        return { ok: false, reason: 'engine' };
      }
      const heard = this.fixNames(String(r.text || '').trim());
      if (!heard) {
        this.showWhisper('有声音，可是一个字都没认出来…再说一句试试？');
        this.voiceNoteSegment({ dropped: 'selftest-empty', device: tag, rms: peak, voicedMs: loud * 256, gain: boosted.gain });
        return { ok: false, reason: 'empty' };
      }
      this.showWhisper('我听到的是：「' + heard + '」'); // 自检**只复述**：不走意图通道，不打开任何东西
      this.voiceNoteSegment({ heard, device: tag, rms: peak, voicedMs: loud * 256, gain: boosted.gain });
      return { ok: true, text: heard };
    } catch (e) {
      this.voiceCloseTest(stream, ctx, proc, src);
      st.testing = false;
      if (!wasOn && typeof bridge.setVoiceMode === 'function') await bridge.setVoiceMode(false);
      this.showWhisper('麦克风起来了但录音没跑起来…（' + String((e && e.message) || e) + '）');
      return { ok: false, reason: 'error' };
    }
  }

  /** [local patch V] 自检收尾：停轨道、断节点、关上下文（顺序跟 stopVoiceMode 一致）。 */
  voiceCloseTest(stream, ctx, proc, src) {
    try {
      if (stream) for (const t of stream.getTracks()) t.stop();
    } catch {
      /* 已经停了 */
    }
    try {
      if (proc) {
        proc.onaudioprocess = null;
        proc.disconnect();
      }
      if (src) src.disconnect();
      if (ctx && typeof ctx.close === 'function') ctx.close();
    } catch {
      /* 上下文已经关了 */
    }
  }

  /** [local patch V] 削掉**首尾**的标点与空白（中间一个字都不动）。
   *  为什么非削不可：STT 引擎必定补全角句号（说「帮我打开软件」回来的是「帮我打开软件。」），
   *  而 parseIntent 会把这个句号当成目标名的一部分（what 是「软件。」）——
   *  拿着这种名字去开软件只会白跑一趟，所以削标点必须在进意图链路之前做。 */
  voiceStripPunct(text) {
    return String(text || '')
      .replace(/^[\s。！？，、；：…～!?,.;:~「」『』“”‘’"']+/, '')
      .replace(/[\s。！？，、；：…～!?,.;:~「」『』“”‘’"']+$/, '');
  }

  /** [local patch V] 按分句切开（每个分句各自削首尾标点）：
   *  「帮我打开浏览器，然后播放一首歌。」→ 先拿第一句「帮我打开浏览器」去试。
   *  一个分隔符都没有时，返回的就是「整句削过标点」那一句本身。 */
  voiceClauses(text) {
    return String(text || '')
      .split(/[，,、;；]/)
      .map((s) => this.voiceStripPunct(s))
      .filter(Boolean);
  }

  /** [local patch V] 拿一段文字去试打字那条拦截通道：真命中意图（返回 ok）才算数。
   *  语音链路**只有这一处**真的调用 onChatSendIntercept —— 意图、权限、操作审计全用打字那一套，不另写一份。 */
  async voiceTryIntent(text) {
    const handled = await this.onChatSendIntercept(text);
    return handled && handled.ok === true ? handled : null;
  }

  /** 识别出来的话走**和打字完全同一条**意图通道（parseIntent / onChatSendIntercept）。
   *  语音只多两步，而且两步都只决定「拿哪段文字去试」，拦截与权限判定仍然是同一套：
   *    ① 先削首尾标点：引擎必定补「。」，而 parseIntent 会把这个句号当成目标名的一部分
   *       （「帮我打开软件。」→ what 是「软件。」），不削就等于拿着一个错名字去开软件；
   *    ② 再按分句依次试：「帮我打开浏览器，然后播放一首歌。」里的逗号同样会被 parseIntent
   *       整个吞进目标名（what 变成「浏览器，然后播放一首歌」），所以**必须先分句再试**：
   *       取第一句能认的分句去执行（一句话里说了几件事，先做能做的第一件）。
   *  一个分句都没命中 ⇒ 跟以前一模一样，原样丢给正常对话：绝不吞话、不误路由。 */
  async voiceRouteText(text) {
    this.ttsKind('chat'); // [local patch T] 语音对话的回复按「回复我时」处理
    const raw = String(text || '');
    let handled = null;
    for (const c of this.voiceClauses(raw)) {
      // 没有分隔符时这里就是「整句削过标点」那一句本身，行为跟以前完全一致
      handled = await this.voiceTryIntent(c);
      if (handled) break; // 第一句能认的就赢了，后面的分句不再试（一句话只做一件事）
    }
    if (handled) {
      this.showWhisper(handled.reply);
      return { ok: true, route: 'intent' }; // 命中就只说这一件，不再把整句丢给 /chat
    }
    this.chatReplyPending(); // [发布版补丁 A8] 语音问话同样要优先回（与弹窗那条路一致）
    try {
      const r = await this.postWatch('/chat', { text: raw }, 60000); // [local patch W] 出话给足 60s（本机推理模型 5s+，2.5s 必超时）
      const reply = r && typeof r.reply === 'string' ? r.reply : '';
      if (reply) this.showWhisper(reply);
      return { ok: !!reply, route: 'chat' };
    } catch (e) {
      this.showWhisper('我听到了，可是没连上说话的那头…');
      return { ok: false, route: 'chat' };
    } finally {
      this.chatReplyDone(); // [发布版补丁 A8b]
    }
  }

  runVoiceAction(cmd) {
    if (cmd === 'on') {
      this.startVoiceMode();
      return;
    }
    if (cmd === 'off') {
      const was = this.stopVoiceMode();
      if (was) this.showWhisper('语音模式关啦，麦克风也停了。');
      return;
    }
    if (cmd === 'sens:low' || cmd === 'sens:mid' || cmd === 'sens:high') {
      this.setVoiceSens(cmd.slice(5));
      return;
    }
    if (cmd.indexOf('mic:') === 0) {
      // 'voice:mic:'（空）= 跟随系统；'voice:mic:0|1|…' = 列表里第几个设备
      this.setVoiceMic(cmd.slice(4));
      return;
    }
    if (cmd === 'lang:zh' || cmd === 'lang:auto') {
      this.setVoiceLang(cmd.slice(5));
      return;
    }
    if (cmd === 'selftest') {
      this.voiceSelfTest(); // 自检自己会说话（成功/失败都有话），这里不等它
      return;
    }
    /* voice:noop（信息行）：什么都不做 */
  }


  /* ===== [local patch T] 语音输出（TTS）：联网朗读（方案见 tts-proto/TTS-SPEC.md）=========
   *  主进程本身就是 Node ⇒ 用 TLS 直连 Edge 朗读端点拿 mp3（不 spawn、不落盘），Buffer 由 preload
   *  桥回渲染层 decodeAudioData 播放。这一块只管「什么时候说 / 怎么排队 / 失败怎么讲」。
   *  回声门控**没有改补丁 V 的正文**（voice-mode 仍是 @4）：本补丁把 voiceVadPush 与 voiceRouteText
   *  各包一层实例级 wrapper，落下 dropped:'tts-speaking' 与 dropped:'echo' 两种现场。 */

  ttsKey() { return 'dsh-pet-tts-main'; }
  ttsDefaults() {
    // autotalk 默认关：自言自语本来就多，一开麦就念会很吵（主人可以自己勾）
    return { on: true, voice: 'zh-CN-XiaoyiNeural', rate: '+0%', vol: 0.9, chat: true, notice: true, autotalk: false, sing: true };
  }
  ttsVoiceTable() {
    return [
      { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 活泼（默认）' },
      { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 温柔' },
      { id: 'zh-CN-YunxiNeural', label: '云希 · 男 · 阳光' },
      { id: 'zh-CN-YunxiaNeural', label: '云夏 · 男 · 可爱' },
      { id: 'zh-CN-liaoning-XiaobeiNeural', label: '小北 · 东北 · 幽默' },
      { id: 'zh-CN-shaanxi-XiaoniNeural', label: '小妮 · 陕西' },
    ];
  }
  ttsRateTable() { return [{ label: '慢', v: '-15%' }, { label: '正常', v: '+0%' }, { label: '快', v: '+15%' }]; }
  ttsVolTable() { return [{ label: '小', v: 0.35 }, { label: '中', v: 0.6 }, { label: '大', v: 0.9 }]; }

  /** 一次会话里的运行状态（token = 世代号：任何"别念了"都 +1，在途结果一律作废）。 */
  ttsEnsure() {
    if (!this.ttsState) {
      this.ttsState = { token: 0, queue: [], pumping: false, playing: false, source: null, guard: null, ctx: null, own: [], cache: new Map(), muteMs: 0, kind: '', lastKind: '', suppress: 0,
        // 诊断字段（写进**同一个** localStorage 键，不新开键）：一次发言只写一次 last，segment 末再补一次 bytes
        diag: null, diagStarted: false, diagBytes: 0, diagT0: 0, diagText: '', diagVoice: '', diagErrWritten: false };
    }
    return this.ttsState;
  }

  /** 设置：localStorage 坏值/缺键一律回落默认（设置绝不能挡住说话）。缓存一次，改完写回。 */
  ttsConfig() {
    if (this.ttsCfg) return this.ttsCfg;
    const d = this.ttsDefaults();
    let raw = null;
    try { raw = JSON.parse(window.localStorage.getItem(this.ttsKey()) || 'null'); } catch (e) { raw = null; }
    const s = raw && typeof raw === 'object' ? raw : {};
    const has = (k) => Object.prototype.hasOwnProperty.call(s, k) && typeof s[k] === 'boolean';
    this.ttsCfg = {
      on: has('on') ? s.on : d.on,
      voice: this.ttsVoiceTable().some((v) => v.id === s.voice) ? s.voice : d.voice,
      rate: this.ttsRateTable().some((r) => r.v === s.rate) ? s.rate : d.rate,
      vol: typeof s.vol === 'number' && Number.isFinite(s.vol) && s.vol > 0 && s.vol <= 1 ? s.vol : d.vol,
      chat: has('chat') ? s.chat : d.chat,
      notice: has('notice') ? s.notice : d.notice,
      autotalk: has('autotalk') ? s.autotalk : d.autotalk,
      sing: has('sing') ? s.sing : d.sing,
      fail: false,
    };
    return this.ttsCfg;
  }
  saveTts() {
    const c = this.ttsConfig();
    const d = this.ttsDiag();
    const out = { on: c.on, voice: c.voice, rate: c.rate, vol: c.vol, chat: c.chat, notice: c.notice, autotalk: c.autotalk, sing: c.sing, last: d.last, lastError: d.lastError };
    try { window.localStorage.setItem(this.ttsKey(), JSON.stringify(out)); } catch (e) { /* 存不上就算了，不吵醒主人 */ }
    return out;
  }

  /** 诊断：诊断字段和设置共用**同一个** localStorage 键（绝不新开写盘点，也绝不碰文件）。
   *  Lead 能靠它从外部取证「渲染层真的拿到了 mp3 并解码播放了」：last.bytes 就是这一整段的累计字节数。 */
  ttsDiag() {
    const st = this.ttsEnsure();
    if (!st.diag) {
      let last = null, lastError = null;
      try {
        const raw = JSON.parse(window.localStorage.getItem(this.ttsKey()) || 'null');
        if (raw && typeof raw === 'object') { last = raw.last || null; lastError = raw.lastError || null; }
      } catch (e) { /* 读不出来就当没有 */ }
      st.diag = { last: last, lastError: lastError };
    }
    return st.diag;
  }
  /** 合并写入（设置 + 诊断一起写回同一个键）。写失败一律吞掉：诊断绝不能挡住说话。 */
  ttsDiagSave(patch) {
    const st = this.ttsEnsure();
    const d = this.ttsDiag();
    if (patch) { if ('last' in patch) d.last = patch.last; if ('lastError' in patch) d.lastError = patch.lastError; }
    const c = this.ttsConfig();
    const out = { on: c.on, voice: c.voice, rate: c.rate, vol: c.vol, chat: c.chat, notice: c.notice, autotalk: c.autotalk, sing: c.sing, last: d.last, lastError: d.lastError };
    try { window.localStorage.setItem(this.ttsKey(), JSON.stringify(out)); } catch (e) { /* 写不进去就算了 */ }
    return out;
  }
  ttsLabels() {
    const c = this.ttsConfig();
    const vt = this.ttsVoiceTable();
    const v = vt.filter((x) => x.id === c.voice)[0] || vt[0];
    const r = this.ttsRateTable().filter((x) => x.v === c.rate)[0] || this.ttsRateTable()[1];
    const vol = c.vol >= 0.75 ? '大' : c.vol >= 0.45 ? '中' : '小';
    return {
      on: c.on, voice: c.voice, voiceText: v.label, rate: c.rate, rateText: r.label,
      vol: c.vol, volText: vol, chat: c.chat, notice: c.notice, autotalk: c.autotalk, sing: c.sing,
      hint: c.on ? '· 联网使用，念出的文字会发给微软朗读服务' : '· 现在只出气泡不出声',
    };
  }

  /** 菜单分发：tts:toggle / tts:voice:<id> / tts:rate:<v> / tts:vol:<n> / tts:kind:<k>:<on|off> / tts:try / tts:noop */
  runTtsAction(cmd) {
    const c = this.ttsConfig();
    const s = String(cmd == null ? '' : cmd);
    if (s === 'noop') return false;
    if (s === 'toggle') { c.on = !c.on; if (c.on) c.fail = false; }
    else if (s.indexOf('voice:') === 0) { const id = s.slice(6); if (this.ttsVoiceTable().some((v) => v.id === id)) c.voice = id; else return false; }
    else if (s.indexOf('rate:') === 0) { const r = s.slice(5); if (this.ttsRateTable().some((x) => x.v === r)) c.rate = r; else return false; }
    else if (s.indexOf('vol:') === 0) { const n = Number(s.slice(4)); if (Number.isFinite(n) && n > 0 && n <= 1) c.vol = n; else return false; }
    else if (s.indexOf('kind:') === 0) {
      const parts = s.slice(5).split(':');
      const k = parts[0];
      if (k !== 'chat' && k !== 'notice' && k !== 'autotalk' && k !== 'sing') return false;
      c[k] = parts[1] !== 'off';
      this.saveTts();
      this.ttsStop(); // 这一类关掉了：正在念的就别念了
      return true;
    }
    else if (s === 'try') { this.ttsPreview(); return true; }
    else return false;
    this.saveTts();
    this.ttsStop();          // 改了音色/语速/音量：旧队列按旧设置念完没意义
    if (c.on) this.ttsPreview();
    return true;
  }

  /** 这一句属于哪一类说话：由调用点用 ttsKind() 提前打标（拿不到就按"主动提醒"算）。 */
  ttsKind(kind) {
    const st = this.ttsEnsure();
    st.kind = String(kind == null ? '' : kind);
    return st.kind;
  }
  ttsInferKind(text) {
    const st = this.ttsEnsure();
    const k = st.kind;
    st.kind = '';
    if (k) return k;
    // 周期碎碎念（events.js 把原文写进 whisperText，再 showWhisper 同一个字符串）
    if (text && this.whisperText && String(text) === String(this.whisperText)) return 'notice';
    return 'notice';
  }

  /** 长句切句：按标点切，太碎的并起来（免得一句"嗯。"也要一次 1.3s 的联网合成），
   *  没有标点的长句按 40 字硬切。 */
  ttsClauses(text) {
    const raw = String(text == null ? '' : text);
    const parts = raw.split(/(?<=[。！？；…，,!?;])/);
    const out = [];
    let cur = '';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].trim();
      if (!p) continue;
      if (cur && (cur + p).length <= 28) { cur += p; continue; }
      if (cur) { out.push(cur); cur = ''; }
      let rest = p;
      while (rest.length > 40) { out.push(rest.slice(0, 40)); rest = rest.slice(40); }
      cur = rest;
    }
    if (cur) out.push(cur);
    return out.filter((s) => s.replace(/\s+/g, '').length > 0);
  }

  /** 回声检测用的归一化：去掉标点与空白，只留字。 */
  ttsNorm(text) {
    return String(text == null ? '' : text).replace(/[\s，。！？；：、,.!?;:~～"'“”‘’（）()\[\]【】…—-]/g, '');
  }
  /** 识别出来的是不是我 8 秒内刚说过的话（扬声器→麦克风的回声）。 */
  ttsIsEcho(text) {
    const st = this.ttsEnsure();
    const heard = this.ttsNorm(text);
    if (!heard || !st.own.length) return false;
    const now = Date.now();
    for (let i = st.own.length - 1; i >= 0; i--) {
      const it = st.own[i];
      if (now - it.ts > 8000) break;
      const mine = this.ttsNorm(it.text);
      if (!mine) continue;
      if (mine === heard) return true;
      // 识别常把整句裁短：够长的包含关系也算回声（太短的词不认，免得"好"被误杀）
      if (heard.length >= 6 && (mine.indexOf(heard) >= 0 || heard.indexOf(mine) >= 0)) return true;
    }
    return false;
  }
  /** 记一笔"我念过这句话"：回声检测的唯一依据（时间戳 = 真的开始念的时刻）。 */
  ttsNoteSpoken(text) {
    const st = this.ttsEnsure();
    const s = String(text == null ? '' : text).trim();
    if (!s) return;
    st.own.push({ ts: Date.now(), text: s });
    if (st.own.length > 24) st.own = st.own.slice(-24);
  }
  ttsSpeakingNow() { return this.ttsSpeaking === true; }

  /** 包一层 showWhisper（必须在补丁 C 之后包：拿到的还是**整段原文**，切句由 TTS 自己来）。 */
  hookTtsSpeak() {
    if (this.ttsHooked || typeof this.showWhisper !== 'function') return;
    this.ttsHooked = true;
    const orig = this.showWhisper.bind(this);
    const st = this.ttsEnsure();
    // [发布版补丁 A4b] TTS 这层包装必须把 opts 透传下去，否则 A4 的「低优先级让路」
    //   在桌面端永远收不到 low（实例属性会盖住 events.js 里那个原型方法）——实测踩到过。
    this.showWhisper = (text, image, opts) => {
      const shown = orig(text, image, opts);
      if (st.suppress) return shown; // 我自己弹的"朗读不可用"提示：别再入队去念它
      const raw = String(text == null ? '' : text);
      const say = this.fixNames ? this.fixNames(raw) : raw;
      const kind = this.ttsInferKind(raw);
      try { this.ttsSpeak(say, kind); } catch (e) { console.info('[dsh-pet tts] 入队失败：' + String((e && e.message) || e)); }
      return shown;
    };
  }

  /** 回声门控：不改补丁 V 的正文，只在它的两个入口上包实例级 wrapper。
   *  ① voiceVadPush：我正在出声 ⇒ 这一帧（其实是扬声器里的我）整帧丢掉，VAD 归零；
   *     等出声结束**按段**记一条 dropped:'tts-speaking'（不按帧刷屏）。
   *  ② voiceRouteText：识别出来的是我 8 秒内刚说过的 ⇒ 记 dropped:'echo' 后不再路由。 */
  hookTtsEchoGate() {
    if (this.ttsGateHooked || typeof this.voiceVadPush !== 'function' || typeof this.voiceRouteText !== 'function') return;
    this.ttsGateHooked = true;
    const st = this.ttsEnsure();
    const origVad = this.voiceVadPush.bind(this);
    const origRoute = this.voiceRouteText.bind(this);
    const dev = () => (this.voice && this.voice.device) || '默认麦克风';
    this.voiceVadPush = (vad, chunk, frameMs) => {
      if (this.ttsSpeakingNow()) {
        st.muteMs = Math.round(st.muteMs + (Number(frameMs) || 0));
        if (vad) {
          // 半句也不能留：留了就会在我说完之后被拼成一句话送去识别
          vad.lastDrop = null; vad.rms = 0; vad.speaking = false; vad.chunks = [];
          vad.samples = 0; vad.quietMs = 0; vad.ms = 0; vad.voicedMs = 0;
        }
        return null;
      }
      if (st.muteMs > 0) {
        const ms = st.muteMs;
        st.muteMs = 0;
        this.voiceNoteSegment({ dropped: 'tts-speaking', device: dev(), rms: 0, voicedMs: ms });
      }
      return origVad(vad, chunk, frameMs);
    };
    this.voiceRouteText = async (text) => {
      if (this.ttsIsEcho(text)) {
        this.voiceNoteSegment({ dropped: 'echo', device: dev(), rms: 0, voicedMs: 0, heard: String(text == null ? '' : text) });
        return { ok: false, route: 'echo' };
      }
      return origRoute(text);
    };
  }

  /** 入队一段要念的话。返回"要不要念"（false = 关着/这一类没勾/空文本），
   *  不返回 Promise：念是后台的事，气泡一毫秒都不能等它。 */
  ttsSpeak(text, kind) {
    const c = this.ttsConfig();
    const st = this.ttsEnsure();
    const k = kind || st.kind || 'notice';
    st.kind = '';
    const say = String(text == null ? '' : text).trim();
    if (!say || !c.on || !c[k]) return false;
    const clauses = this.ttsClauses(say);
    if (!clauses.length) return false;
    for (const cl of clauses) st.queue.push(cl);
    while (st.queue.length > 8) st.queue.shift(); // 一次最多排 8 句：别念到天荒地老
    const same = k === 'sing' && st.lastKind === 'sing' && (st.pumping || st.playing);
    st.lastKind = k;
    if (!same) {
      // 新的一次发言：诊断计数归零（一次发言最多写两次盘：首片成功一次、段末补一次总字节数）
      st.diagStarted = false; st.diagBytes = 0; st.diagT0 = Date.now(); st.diagText = say.slice(0, 80); st.diagVoice = c.voice; st.diagErrWritten = false;
    }
    if (same) return true; // 跟唱：只在队尾续上，不打断上一句
    st.token++;
    const token = st.token;
    void this.ttsPump(st, token);
    return true;
  }

  /** 合成一句（走主进程 IPC）。失败**只在第一次**如实提示，不静默、也不刷屏。 */
  async ttsFetch(text, token) {
    const c = this.ttsConfig();
    const st = this.ttsEnsure();
    const key = c.voice + '|' + c.rate + '|' + text;
    if (st.cache.has(key)) return st.cache.get(key);
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.ttsSpeak !== 'function') { this.ttsFailNotice('没有可用的朗读通道'); return null; }
    let r = null;
    try {
      // 字段名以 Lead 裁决为准：成功是 {ok:true, mp3:<Buffer>}（preload 已把 Buffer 转成精确字节的 Uint8Array）
      r = await bridge.ttsSpeak(text, { voice: c.voice, rate: c.rate });
    } catch (e) {
      if (st.token !== token) return null; // 已经被叫停了：这不是失败，别去打扰主人
      this.ttsFailNotice((e && e.message) || e);
      return null;
    }
    if (st.token !== token) return null;
    let audio = null;
    if (r && r.ok === true && (r.mp3 || r.data)) {
      const m = r.mp3 || r.data;
      if (m instanceof ArrayBuffer) audio = m.slice(0);
      else if (m && m.buffer) audio = m.buffer.slice(m.byteOffset, m.byteOffset + m.byteLength); // byteOffset 必须算进去
    }
    if (!audio || audio.byteLength < 512) { this.ttsFailNotice((r && r.error) || '朗读服务没有返回音频'); return null; }
    st.cache.set(key, audio);
    while (st.cache.size > 24) st.cache.delete(st.cache.keys().next().value);
    return audio;
  }

  /** 播放用的 AudioContext：第一次点开菜单才会有用户手势，所以 resume 失败不报错。 */
  async ttsAudioCtx(st) {
    if (st.ctx && st.ctx.state !== 'closed') {
      if (st.ctx.state === 'suspended') { try { await st.ctx.resume(); } catch (e) { /* 没有手势就先放着 */ } }
      return st.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.ttsFailNotice('这个窗口不支持音频播放'); return null; }
    try { st.ctx = new AC(); } catch (e) { this.ttsFailNotice('audio-context: ' + String((e && e.message) || e)); return null; }
    return st.ctx;
  }

  /** 播一句 mp3：resolve true = 正常放完；false = 被打断/播不出来（调用方立刻收队）。 */
  async ttsPlayBuffer(buf, st, token) {
    const c = this.ttsConfig();
    const ctx = await this.ttsAudioCtx(st);
    if (!ctx) return false;
    if (st.token !== token) return false;
    let audio = null;
    try {
      audio = await ctx.decodeAudioData(buf.slice(0)); // 传副本：decodeAudioData 会把 ArrayBuffer 拿走
    } catch (e) {
      this.ttsFailNotice('decode: ' + String((e && e.message) || e));
      return false;
    }
    if (st.token !== token) return false;
    // 诊断（首个片段解码成功 = 渲染层真的拿到 mp3 并且真的解出来了）：一次发言写一次，段末再补总字节数
    st.diagBytes += buf.byteLength;
    if (!st.diagStarted) {
      st.diagStarted = true;
      try { this.ttsDiagSave({ last: { ts: Date.now(), text: st.diagText, voice: st.diagVoice, bytes: st.diagBytes, ms: Date.now() - st.diagT0 } }); } catch (e) { /* 诊断绝不能挡住说话 */ }
    }
    return await new Promise((resolve) => {
      let src = null;
      try {
        src = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = audio;
        gain.gain.value = Math.max(0.05, Math.min(1, c.vol));
        src.connect(gain);
        gain.connect(ctx.destination);
      } catch (e) {
        this.ttsFailNotice('play: ' + String((e && e.message) || e));
        resolve(false);
        return;
      }
      const finish = (v) => {
        if (st.guard !== null) { window.clearTimeout(st.guard); st.guard = null; }
        if (st.source === src) st.source = null;
        resolve(v);
      };
      // onended 在"放完"和"被 stop()"两种情况下都会来：只有"还是这一代"才算真的放完
      src.onended = () => {
        const fresh = st.token === token;
        if (fresh) { st.playing = false; this.ttsSpeaking = false; }
        finish(fresh);
      };
      st.playing = true;
      this.ttsSpeaking = true;
      st.source = src;
      // 兜底：音频设备被拔/上下文挂起时 onended 可能永远不来，按解码时长 + 1.5s 强行收尾
      st.guard = window.setTimeout(() => { st.playing = false; this.ttsSpeaking = false; finish(false); }, Math.round((audio.duration || 0) * 1000) + 1500);
      try { src.start(0); } catch (e) { this.ttsFailNotice('start: ' + String((e && e.message) || e)); finish(false); }
    });
  }

  /** 念队列：最多同时 2 句在合成（第一句在播时第二句已经在路上），播放严格按顺序。 */
  async ttsPump(st, token) {
    if (st.pumping) return;
    st.pumping = true;
    try {
      const pending = [];
      const start = () => {
        while (pending.length < 2 && st.token === token && st.queue.length) {
          const cl = st.queue.shift();
          pending.push(this.ttsFetch(cl, token).then((buf) => ({ cl: cl, buf: buf })));
        }
      };
      start();
      while (st.token === token && pending.length) {
        const got = await pending.shift();
        if (st.token !== token) return;
        start();
        if (!got || !got.buf) continue; // 这一句合成失败：已经如实提示过，接着念下一句
        const ok = await this.ttsPlayBuffer(got.buf, st, token);
        if (st.token !== token) return;
        if (!ok) return;
        this.ttsNoteSpoken(got.cl);
      }
    } catch (e) {
      this.ttsFailNotice(e);
    } finally {
      st.pumping = false;
      if (st.token === token) {
        st.playing = false;
        this.ttsSpeaking = false;
        // 段末补一次"这一整段的累计 mp3 字节数"（只有后面还有分句解出来时才会多写这一次）
        if (st.diagStarted) {
          const d = this.ttsDiag();
          if (d.last && d.last.bytes !== st.diagBytes) {
            try { this.ttsDiagSave({ last: { ts: d.last.ts, text: d.last.text, voice: d.last.voice, bytes: st.diagBytes, ms: d.last.ms } }); } catch (e) { /* 诊断绝不能挡住说话 */ }
          }
        }
      }
    }
  }

  /** 别念了：作废队列与在途结果、停掉当前音频。**纯渲染层动作**：合成是一问一答，
   *  在途那一句拿回来时 token 已经变了、会被直接丢掉（主进程不需要 ttsStop 这个 handler）。 */
  ttsStop() {
    const st = this.ttsEnsure();
    st.token++;
    st.queue.length = 0;
    st.kind = '';
    st.lastKind = '';
    st.muteMs = 0;
    if (st.guard !== null) { window.clearTimeout(st.guard); st.guard = null; }
    if (st.source) {
      const s = st.source;
      st.source = null;
      try { s.stop(0); } catch (e) { /* 已经停了 */ }
    }
    st.playing = false;
    this.ttsSpeaking = false;
  }

  /** 试听一句：不进气泡（菜单里点"试听"不该弹一句碎碎念）。 */
  ttsPreview() {
    const st = this.ttsEnsure();
    st.queue.push('我是鲸鱼娘，现在这样说话，可以吗？');
    st.lastKind = 'preview';
    st.diagStarted = false; st.diagBytes = 0; st.diagT0 = Date.now(); st.diagText = '我是鲸鱼娘，现在这样说话，可以吗？'; st.diagVoice = this.ttsConfig().voice; st.diagErrWritten = false;
    st.token++;
    const token = st.token;
    void this.ttsPump(st, token);
    return true;
  }

  /** 失败至多打扰一次：同一次开/关里只弹一次"连不上朗读服务"，其余只落控制台。 */
  ttsFailNotice(err) {
    const c = this.ttsConfig();
    const st = this.ttsEnsure();
    const msg = String((err && err.message) || err || 'unknown');
    console.info('[dsh-pet tts] 朗读不可用：' + msg);
    // 诊断：失败路径落进同一个键的 lastError（一次发言只记一次，绝不刷屏；写失败的 try/catch 在里面）
    if (!st.diagErrWritten) {
      st.diagErrWritten = true;
      try { this.ttsDiagSave({ lastError: { ts: Date.now(), error: msg } }); } catch (e) { /* 诊断绝不能挡住说话 */ }
    }
    if (c.fail || st.suppress) return false;
    c.fail = true;
    st.suppress++;
    try { this.showWhisper('我这边连不上朗读服务，先用文字回你。'); } finally { st.suppress--; }
    return true;
  }

  showWhisperFromMenu() {
    S.fetchWhisperTrigger(WHISPER_URL + '/trigger?pet=' + encodeURIComponent(this.pet.id))
      .then((state) => {
        if (state.ok) {
          this.ttsKind('autotalk'); // [local patch T] 自言自语（默认不念）
          this.showWhisper(state.text, state.image);
        } else {
          console.warn('[dsh-pet] 菜单碎碎念失败 reason=' + state.reason + (state.message ? ' ' + state.message : ''));
        }
      })
      .catch((e) => {
        console.warn('[dsh-pet] 菜单碎碎念异常', e);
      });
  }

  // 「对话」菜单：最简输入框（shared 组件，与浏览器同一份）——回车发送后弹窗消失，
  // 回复用**碎碎念同款显示**（说话动画 + 白色气泡 10s），只多一步用户输入。
  // 记忆经 host /chat 读写（memory.json，同一实例的浏览器/桌面共享同一份）。
  // 弹窗跟随宠物：基准是**身体命中区** this.hit（与气泡同一定位源——桌宠在视频中间，
  // 视频框右上角 ≠ 宠物右上角），取身体右上角，超出视口自动夹回（窗口右侧外扩区容纳）；
  // 弹窗是窗口内 DOM，期间整窗保持可交互（可点输入框），关闭后恢复命中区穿透。

  // ===== [local patch L] 唱歌 v7：不跟屏幕上的歌词了，她自己现编词，词跟着她当前的动作/心情走 =====
  // 主人要求（m01841 / m01887 / m01944）：① 不用跟随屏幕上的歌词，改为 AI 自主发挥；
  // ②「她动作是吃点心开心的时候，就是活泼的歌词」；③ 菜单父项就叫「唱歌」。
  // 链路：起手句用内置词库**立刻开口**（0 延迟，不等模型）→ 之后走本机模型
  // （window.petBridge.localQuip → 主进程 pet:local-quip，num_predict 80 + 推理模型留思考余量）**一句一请求 + 预取 2 句**；
  // 模型失败/超时/空/废话 → 内置词库兜底（6 组情绪 × 6 句 = 36 句）⇒ **绝不静默停唱**。
  // 情绪来自真实动作：singActionNow() 每句重读 this.anim（playOnce/playHold 写的），
  // 只有真属于 this.animations.categories 的动作名才算数（idle / turn / move / events 不算）。
  // 全程零外网：歌名取自本机窗口标题，词取自本机模型或内置库。
  runSingAction(cmd) {
    if (cmd === 'stop') {
      this.stopSinging();
      this.showWhisper('好，我不唱了～');
      return;
    }
    if (!cmd || cmd === 'noop') return; // 菜单里的信息行：只显示文字，点了不做事
    if (cmd === 'info') {
      this.showWhisper('让我看看你在听什么…');
      void this.fetchNowPlaying().then((np) => {
        this.showWhisper(
          np && np.ok
            ? (np.track || np.title) + (np.artist ? ' - ' + np.artist : '') + '（' + np.app + '）'
            : np && np.error === 'window-enum-failed'
              ? '我读不到窗口列表，看不到你在放什么…'
              : '没找到正在放歌的音乐软件，先打开一个再叫我～',
        );
      });
      return;
    }
    // v7：没检测到音乐软件**不再中止** —— 如实说一句，然后用空主题继续自己编
    const loop = cmd === 'loop';
    void this.fetchNowPlaying().then((np) => {
      const theme = np && np.ok && np.track ? String(np.track).trim() : '';
      this.showWhisper(
        theme
          ? loop
            ? '好，我一边听一边自己编词唱～（' + theme + '）'
            : '好，我自己编词唱一首～（' + theme + '）'
          : np && np.error === 'window-enum-failed'
            ? '我读不到窗口列表，那我自己编一首唱～'
            : '没找到在放歌的软件，那我随便编一首唱～',
      );
      this.startImprovisedSinging(theme, loop);
    });
  }

  fetchNowPlaying() {
    if (!window.petBridge || typeof window.petBridge.nowPlaying !== 'function') return Promise.resolve(null);
    return window.petBridge.nowPlaying().catch(() => null); // 原始结果（含 error 码），由调用方决定怎么说
  }

  stopSinging() {
    this.singing = false;
    this.singEpoch = (this.singEpoch || 0) + 1; // 世代号：在途的模型回调全部作废（停了以后不许再冒出一句）
    if (this.singTimer !== null && this.singTimer !== undefined) {
      window.clearTimeout(this.singTimer);
    }
    this.singTimer = null;
    this.singQueue = [];
    this.singPending = false;
    this.singVoice = null;
  }

  // ---- 情绪表：hints 是「动作名 / 活跃度文案」里的子串，表按**专 → 泛**排序，先命中的就是答案 ----
  // 六组：慵懒 / 气鼓鼓 / 得意 / 好奇 / 雀跃 / 活泼（最后一档同时是兜底）。
  // rateMs = 这一组唱完一句停多久；rate = TTS 语速增量（百分点）；vol = 音量倍数。
  singEmotions() {
    return [
      { key: 'lazy', name: '慵懒', tone: '慢悠悠、软软的', hints: ['哈欠', '打瞌睡', '沉眠', '小憩', '伸懒腰', '摇扇纳凉', '悠闲哼歌', '安静'],
        rateMs: 5400, rate: -12, vol: 0.82,
        theme: ['{song}呀…听着就想睡了～', '趴着听{song}，尾巴都不想动', '困…{song}里是不是有张床', '{song}好慢呀…正合我意～'],
        plain: ['困得尾巴都不想甩了…', '再让我眯一小会儿嘛～', '懒洋洋地哼，也算唱歌', '眼睛睁不开了…但还要哼完'] },
      { key: 'pouty', name: '气鼓鼓', tone: '带点小脾气的', hints: ['气急败坏', '生气', '不耐烦', '拍打地面', '被吓一跳', '惊醒'],
        rateMs: 3200, rate: 6, vol: 1,
        theme: ['{song}都不理我，我生气了！', '哼，{song}也偏着主人说话', '再听{song}我就不唱了…哼', '{song}吵到我了，哼！'],
        plain: ['哼！刚才那一下我很在意', '我嘴上说不气，尾巴在拍桌子', '不理你了…才怪，再听一句', '哼，这次算你运气好'] },
      { key: 'proud', name: '得意', tone: '得意、要人夸的', hints: ['女仆屈膝', '旋转展示', '换装试色', '照镜子', '魔术', '变鸽子', '三球抛接', '蓝鲸现世', '写福字', '收红包', '舞狮头'],
        rateMs: 4200, rate: 2, vol: 1,
        theme: ['{song}也没我唱得好听～', '主人看，{song}我都会哼了', '这首{song}，我唱得最有腔调', '{song}？我闭着眼都能唱～'],
        plain: ['怎么样，我唱得还不错吧～', '哼，我聪明着呢，只是懒', '再夸我一句，我就唱大声点', '听好了，这一段是我加的'] },
      { key: 'curious', name: '好奇', tone: '好奇、像在发问的', hints: ['魔方', '玩具汽车', '五子棋', '写代码', '轻快记录', '吐泡泡', '拆礼物', '试色', '看书', '看'],
        rateMs: 4600, rate: 0, vol: 1,
        theme: ['{song}下一句会是什么呀？', '我猜{song}里藏了个秘密', '咦，{song}的调子好奇怪呀', '{song}里那句是什么意思呀'],
        plain: ['咦，这个调调是从哪来的？', '让我想想下一句该唱什么…', '这个东西看着就好玩呀', '这个声音…是从哪冒出来的'] },
      { key: 'bouncy', name: '雀跃', tone: '雀跃、蹦蹦跳跳的', hints: ['跳', '舞', '唱', '琴', '笛', '球', '毽子', '秋千', '木马', '放风筝', '烟花', '嗨起来', '活跃', '泡泡'],
        rateMs: 2800, rate: 12, vol: 1,
        theme: ['{song}！蹦着唱也不累～', '跟着{song}跳，尾巴打拍子！', '这首{song}我要唱给整片海听', '{song}再快一点！我还能跳～'],
        plain: ['啦啦啦～尾巴都在打拍子！', '蹦一下再唱，这样最好听！', '开心得转圈圈，歌也变快了', '转个圈，接着唱下一句！'] },
      { key: 'lively', name: '活泼', tone: '活泼、开心的', hints: ['吃', '玩', '水枪', '气球', '猫', '花', '蜜蜂', '蝴蝶', '礼物', '糖', '西瓜', '火锅', '月饼', '饺子', '汤圆', '年糕', '粽子', '正常'],
        rateMs: 3600, rate: 8, vol: 1,
        theme: ['{song}配点心，正好刚刚好～', '一边吃一边唱{song}，快乐！', '主人的{song}，我吃到歌词里啦', '{song}唱着唱着就饿了呀～'],
        plain: ['吃饱了就唱，越唱越有力气！', '啦啦～今天也是好心情呀', '唱给你听，要一直笑着哦', '边玩边唱，一个字都不会忘'] },
    ];
  }

  // ---- 当前动作：this.anim 必须**真属于** categories 里的某个动作名（idle / turn / move 不算）----
  singActionNow() {
    const anims = (this.animations && this.animations.categories) || null;
    const now = String(this.anim || '');
    if (!anims || !now) return null;
    for (const c of anims) {
      for (const a of (c && c.actions) || []) if (a === now) return now;
    }
    return null;
  }

  // ---- 当前情绪：动作名 + 活跃度文案里找子串（专→泛）；一个都不中就落到最后一档「活泼」----
  singEmotionNow() {
    const table = this.singEmotions();
    const act = this.singActionNow();
    let activityText = '';
    try {
      const m = this.moodLabels ? this.moodLabels() : null;
      activityText = String((m && m.activityText) || '');
    } catch (e) {
      activityText = '';
    }
    const probe = (act ? act + ' ' : '') + activityText;
    for (const e of table) {
      for (const h of e.hints) if (probe.indexOf(h) >= 0) return { emo: e, act };
    }
    return { emo: table[table.length - 1], act };
  }

  // ---- 当前情绪对应的**真实动作池**（名字全部来自 animations.categories，绝不写死不存在的动作名）----
  singActionPool(emo) {
    const out = [];
    const anims = (this.animations && this.animations.categories) || [];
    for (const c of anims) {
      for (const a of (c && c.actions) || []) {
        const t = String(a);
        if (out.indexOf(t) >= 0) continue;
        for (const h of (emo && emo.hints) || []) if (t.indexOf(h) >= 0) { out.push(t); break; }
      }
    }
    return out;
  }

  singPickAction(emo) {
    const pool = this.singActionPool(emo);
    const use = pool.length ? pool : this.singPool(); // 挑不到就用老的「像在唱」池：**绝不停唱**
    if (!use.length) return '';
    return S.pick(use, this.anim) || use[0];
  }

  // 唱歌动画池（v3 的老池子，现在是兜底）：从她现有动作里挑「像在唱 / 演奏」的（一个都没有就退化成点击回应动画）
  singPool() {
    const hints = ['小提琴演奏', '吹笛子', '轻快摇摆舞', '可爱宅舞', '优雅女仆舞', '摇扇纳凉', '原地敲击桌面互动'];
    const found = [];
    for (const c of this.animations.categories || []) {
      for (const a of c.actions || []) if (hints.indexOf(a) >= 0) found.push(a);
    }
    return found.length ? found : this.animations.clicks || [];
  }

  singTheme(theme) {
    const t = String(theme || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length > 10 ? t.slice(0, 10) + '…' : t; // 歌名太长会撑爆一句词，先截断
  }

  singSystem(emo, act) {
    let personaText = '';
    try {
      const m = this.moodLabels ? this.moodLabels() : null;
      personaText = String((m && m.personaText) || '');
    } catch (e) {
      personaText = '';
    }
    // [local patch E1] 以前这行写死「鲸鱼娘」：选了默认人设、她唱歌却还是鲸鱼娘，对话与唱歌语气断层。
    //  现在统一取当前性格的人设全文（人设为空才回落到宠物名）。
    const P = this.personaTable();
    const p = P[this.persona] || P.none;
    const petName = this.pet && this.pet.name ? String(this.pet.name) : '蓝毛小女仆';
    const who = p.prompt
      ? p.prompt
      : '你是主人桌面上的「' + petName + '」：说话短、口语、可爱，只用简体中文。';
    return [
      who,
      personaText ? '现在的说话方式：' + personaText + '。' : '',
      '你正在一边' + (act ? '做动作「' + act + '」' : '待着') + '一边自己编歌哼唱，此刻心情是「' + emo.name + '」。',
      '写一句歌词：像唱歌一样顺口，贴合这个心情和这个动作，不超过 18 个字。',
      '只输出这一句歌词本身：不要引号、不要解释、不要换行、不要说你在写歌词。',
    ].filter(Boolean).join('\n');
  }

  singPrompt(theme, emo, act, recent) {
    return [
      theme ? '正在放这首歌：' + theme : '没有在放歌，随便编一个轻快的主题。',
      act ? '你现在正在做的动作：' + act + '。' : '',
      '此刻心情：' + emo.name + '，所以词要' + emo.tone + '。',
      recent && recent.length ? '最近唱过的（别重复）：' + recent.slice(-3).join(' / ') : '',
      '现在就写下一句歌词（不超过 18 个字，直接输出这一句）。',
    ].filter(Boolean).join('\n');
  }

  // 模型回包清洗：空 / 太长（明显是解释句）/ 纯标点表情 → 返回空串，交给内置词库
  singCleanLine(text) {
    let t = String(text || '').replace(/\r?\n/g, ' ').trim();
    t = t.replace(/^["'“”‘’「」『』]+/, '').replace(/["'“”‘’「」『』]+$/, '').trim();
    t = t.replace(/^(歌词|下一句|句子)[:：]\s*/, '').trim();
    if (!t) return '';
    if (t.length > 24) return '';
    if (!/[\u3400-\u9FFFa-zA-Z0-9]/.test(t)) return '';
    return t;
  }

  // 内置词库兜底：有主题就织进歌名，没有主题用无主题那一组；轮转着挑（相邻句不会重复）
  singFallback(emo, theme, avoid) {
    const t = this.singTheme(theme);
    const list = t ? (emo.theme || []).map((s) => s.split('{song}').join(t)) : (emo.plain || []).slice();
    if (!list.length) return '啦啦啦～我自己编的，好听吗？';
    for (let i = 0; i < list.length; i++) {
      const idx = ((this.singFallbackSeq || 0) + i) % list.length;
      if (list[idx] !== avoid) {
        this.singFallbackSeq = idx + 1;
        return list[idx];
      }
    }
    this.singFallbackSeq = (this.singFallbackSeq || 0) + 1;
    return list[0];
  }

  singModelLine(theme, emo, act, epoch) {
    // [local patch W] 跟唱跟随全局大脑：本地=只走本机（免费）；API=走 DSH 当前在线模型（预算给小，保持一句短词）
    if (!this.brainQuip) return Promise.resolve('');
    const recent = (this.singSaid || []).slice(-3);
    let p;
    try {
      p = this.brainQuip(this.singPrompt(theme, emo, act, recent), this.singSystem(emo, act), 60);
    } catch (e) {
      return Promise.resolve('');
    }
    if (!p || typeof p.then !== 'function') return Promise.resolve('');
    return p.then(
      (r) => {
        if (!this.singing || epoch !== this.singEpoch) return ''; // 停过 / 重开过：迟到的词一律作废
        const t = r && r.ok ? this.singCleanLine(r.text) : '';
        return t && recent.indexOf(t) >= 0 ? '' : t; // 和最近唱过的撞了 → 也走兜底
      },
      () => '',
    );
  }

  singLine(theme, text, emo, act, withAction, avoid) {
    let t = text || '';
    if (t && avoid && t === avoid) t = ''; // 跟上一句一模一样 → 不许连着唱两遍，走内置兜底
    const said = this.singSaid || [];
    const line = {
      text: t || this.singFallback(emo, theme, avoid || said[said.length - 1]),
      emo,
      act: withAction ? act : '',
      model: !!t,
    };
    line.rateMs = emo && emo.rateMs ? emo.rateMs : Math.max(2400, Math.min(6500, line.text.length * 420));
    return line;
  }

  // 预取：队列 < 2 就补一句（一次只有一个请求在飞，singPending 去重）
  singFill(theme, loop) {
    if (!this.singing || this.singPending) return;
    if ((this.singQueue || []).length >= 2) return;
    const epoch = this.singEpoch;
    this.singPending = true;
    const now = this.singEmotionNow();
    const idx = (this.singCount || 0) + (this.singQueue || []).length; // 这一句会被排在第 idx+1 句
    const withAction = idx % 2 === 1; // 每 2 句（第 2、4、6…句）去当前情绪的动作池里挑一个**真的**播出来
    const actName = withAction ? this.singPickAction(now.emo) : '';
    const tail = (this.singQueue || []).slice(-1)[0];
    const saidLast = (this.singSaid || []).slice(-1)[0];
    const avoid = (tail && tail.text) || saidLast || '';
    void this.singModelLine(theme, now.emo, actName || now.act, epoch).then((text) => {
      this.singPending = false;
      if (!this.singing || epoch !== this.singEpoch) return; // 停了就别再往队列里塞
      this.singQueue.push(this.singLine(theme, text, now.emo, actName, withAction, avoid));
      this.singFill(theme, loop);
    });
  }

  singStep(loop) {
    if (!this.singing) return;
    let line = this.singQueue.shift();
    if (!line) {
      // 模型还没回来也不能停：就地兜底一句（"绝不停唱"的最后一道保险）
      const now = this.singEmotionNow();
      line = this.singLine(this.singThemeName, '', now.emo, now.act, false);
    }
    this.singCount = (this.singCount || 0) + 1;
    this.singVoice = { rate: line.emo ? line.emo.rate : 0, vol: line.emo ? line.emo.vol : 1 }; // 这一句的语速/音量
    if (line.act && typeof this.playOnce === 'function') this.playOnce(line.act); // 每 2 句配一个真实动作
    this.ttsKind('sing'); // [local patch T] 跟唱这一句
    this.showWhisper(line.text); // 气泡显示当前这句词
    this.singSaid = (this.singSaid || []).concat([line.text]).slice(-6);
    this.singFill(this.singThemeName, loop);
    const gap = Math.max(1200, Math.min(12000, line.rateMs || 0));
    this.singTimer = window.setTimeout(() => {
      this.singTimer = null;
      if (!this.singing) return;
      if (!loop && this.singCount >= 5) {
        // 唱一首 = 5 句（起手 + 4）就收尾；一直唱则不停
        this.singFinish();
        return;
      }
      this.singStep(loop);
    }, gap);
  }

  singFinish() {
    this.stopSinging();
    this.showWhisper('唱完啦～这首是我现编的。');
  }

  startImprovisedSinging(theme, loop) {
    this.stopSinging();
    this.hookSingVoice(); // 情绪 → TTS 语速/音量（实例级 wrapper，只在她唱歌期间生效）
    this.singing = true;
    this.singEpoch = (this.singEpoch || 0) + 1;
    this.singThemeName = this.singTheme(theme);
    this.singQueue = [];
    this.singSaid = [];
    this.singCount = 0;
    this.singFallbackSeq = 0;
    const now = this.singEmotionNow();
    this.singQueue.push(this.singLine(theme, '', now.emo, now.act, false)); // 起手句：内置词，0 延迟先开口
    this.singStep(loop);
  }

  // ---- 情绪 → TTS 语速/音量：包实例方法（补丁 T 的先例），**不改补丁 T 的正文**，改完立刻还原 ----
  singVoiceNow() {
    return this.singing && this.singVoice ? this.singVoice : null;
  }

  singRateWith(keep, delta) {
    const m = String(keep || '+0%').match(/(-?[0-9]+(?:\.[0-9]+)?)\s*%/);
    const base = m ? Number(m[1]) : 0;
    const pct = Math.max(-50, Math.min(100, Math.round(base + (Number(delta) || 0))));
    return (pct >= 0 ? '+' : '') + pct + '%';
  }

  hookSingVoice() {
    if (this.singVoiceHooked || typeof this.ttsFetch !== 'function') return;
    this.singVoiceHooked = true;
    const self = this;
    const origFetch = this.ttsFetch;
    this.ttsFetch = function (text, token) {
      const adj = self.singVoiceNow();
      const c = typeof self.ttsConfig === 'function' ? self.ttsConfig() : null;
      if (!adj || !c) return origFetch.call(this, text, token);
      const keep = c.rate;
      c.rate = self.singRateWith(keep, adj.rate); // ttsFetch 是**同步**读 c.rate 的，读完就还原（不污染用户设置）
      try {
        return origFetch.call(this, text, token);
      } finally {
        c.rate = keep;
      }
    };
    if (typeof this.ttsPlayBuffer === 'function') {
      const origPlay = this.ttsPlayBuffer;
      this.ttsPlayBuffer = function (buf, st, token) {
        const adj = self.singVoiceNow();
        const c = typeof self.ttsConfig === 'function' ? self.ttsConfig() : null;
        if (!adj || !c || !(adj.vol > 0)) return origPlay.call(this, buf, st, token);
        const keep = c.vol;
        c.vol = Math.max(0.05, Math.min(1, (Number(keep) || 1) * adj.vol));
        const mine = c.vol;
        const back = () => {
          if (c.vol === mine) c.vol = keep; // 播完（或失败）就还原
        };
        let p;
        try {
          p = origPlay.call(this, buf, st, token);
        } catch (e) {
          back();
          throw e;
        }
        if (p && typeof p.then === 'function') {
          p.then(back, back);
          return p;
        }
        back();
        return p;
      };
    }
  }

  showChatFromMenu() {
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
      return; // 已开着：先关旧的
    }
    const m = S.mountChatDialog({
      petId: this.pet.id,
      baseUrl: BASE + '/chat',
      x: Math.max(4, this.hit.getBoundingClientRect().right + 6),
      y: Math.max(4, this.hit.getBoundingClientRect().top + 6),
      // 弹窗同菜单：只允许在「窗口 ∩ 工作区」内显示，贴边时不被屏幕裁掉（#41）
      clamp: this.visibleClampRect(),
      // [发布版补丁 A3] 等回复期间不给碎碎念抢气泡；失败时即使弹窗已被关掉也要开口
      onSend: () => this.chatReplyPending(),
      onReply: (reply, image) => {
        this.chatReplyDone();
        console.info('[dsh-pet] 对话回复 pet=' + this.pet.id + '「' + reply + '」' + (image ? ' [' + image + ']' : ''));
        this.ttsKind('chat'); // [local patch T] 对话弹窗的回复
        this.showWhisper(reply, image); // 复用碎碎念链路：随机说话动画 + 气泡 10s（含配图）
      },
      onError: (why) => {
        this.chatReplyDone(0);
        this.ttsKind('chat');
        this.showWhisper('刚才那句没接上…（' + String(why || '未知原因') + '）');
      },
      onClose: () => {
        this.chatClose = null;
        this.chatOpen = false;
        window.__dshPetDebug.chatOpen = false;
        this.syncInputBusy(); // 弹窗关：交还常规判定（菜单还开着的话仍保持忙，见 inputBusy）
        if (!this.menuOpen) this.setInteractive(false); // 弹窗关了且无菜单：恢复命中区穿透
      },
    });
    this.chatClose = m.close;
    this.chatOpen = true; // 穿透守卫：弹窗期间整窗保持可交互，光标移到输入框不被翻回穿透
    window.__dshPetDebug.chatOpen = true;
    this.syncInputBusy();
    this.setInteractive(true);
  }

  // 「回到初始位置」菜单：停掉漫游/移动，清掉拖拽/漫游留下的会话位置，回到配置角落
  goHome() {
    this.stopThrow();
    this.stopMove();
    this.customPos = null;
    this.position();
  }

  renderBubble() {
    // 气泡优先级：工作状态 > 碎碎念 > 余额（工作状态是 DSH 真实状态，最要紧；三者都关时隐藏）
    // 工作气泡与碎碎念同款弹窗样式：宽度自适应 + 自动换行（is-whisper：正常 white-space、宽随内容）
    // 配图标记交给 CSS：带图时取消 min-width（样式在 shared 的 MEME_BUBBLE_CSS，两端同一份）。
    // 图片 URL 与视频同规则：传 BASE 前缀（桌面是 file:// 页面，必须绝对地址）
    const whisperImg = this.whisperOn ? S.createMemeImage(this.whisperImage, BASE) : null;
    this.bubble.classList.toggle(
      'is-whisper',
      // 余额「文字说明」（不可用状态）同样要换行变体：默认 nowrap 会把长文案顶出宠物宽度
      this.workOn || (this.whisperOn && !!this.whisperView) || (this.bubbleOn && this.balanceWrap),
    );
    this.bubble.classList.toggle(S.MEME_BUBBLE_CLASS, !!whisperImg);
    if (this.workOn) {
      // 工作状态气泡：workOn 期间占位（文本缺失时隐藏，绝不让更弱的碎碎念/余额气泡反超）
      if (!this.workText) {
        this.bubble.classList.remove('is-on');
        window.__dshPetDebug.lastBubbleTitle = '';
        return;
      }
      this.bubble.innerHTML = '';
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.workText;
      this.bubble.appendChild(line);
      this.bubble.classList.add('is-on');
      window.__dshPetDebug.lastBubbleTitle = this.bubble.textContent.slice(0, 60);
      return;
    }
    if (this.whisperOn && this.whisperView) {
      this.bubble.innerHTML = '';
      // 配图（shared 生成的 <img> + 共用样式）：先看图再读话，符合"配图"的阅读顺序
      if (whisperImg) this.bubble.appendChild(whisperImg);
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.whisperView[0]?.text ?? '';
      this.bubble.appendChild(line);
      this.bubble.classList.add('is-on');
      window.__dshPetDebug.lastBubbleTitle = this.bubble.textContent.slice(0, 60);
      return;
    }
    if (!this.bubbleOn || !this.balanceView) {
      this.bubble.classList.remove('is-on');
      window.__dshPetDebug.lastBubbleTitle = '';
      return;
    }
    this.bubble.innerHTML = '';
    const rows = this.balanceView;
    const hasTier = rows.some((r) => r.role === 'tier');
    if (hasTier) {
      // deepseek 余额单行：余额（峰/谷）¥x — 档位字着色
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      for (const r of rows) {
        const span = document.createElement('span');
        if (r.role === 'tier') span.className = 'pet-bub-tier pet-bub-tier-' + r.tier;
        span.textContent = r.text;
        line.appendChild(span);
      }
      this.bubble.appendChild(line);
    } else {
      for (const r of rows) {
        const div = document.createElement('div');
        if (r.role === 'error') div.className = 'pet-bub-err';
        else if (r.role === 'sub') div.className = 'pet-bub-row pet-bub-sub';
        else div.className = 'pet-bub-row';
        div.textContent = r.text;
        this.bubble.appendChild(div);
      }
    }
    this.bubble.classList.add('is-on');
    window.__dshPetDebug.lastBubbleTitle = this.bubble.textContent.slice(0, 60);
  }
}
