"use strict";
// AI agent —— 「让桌宠当前用的那个模型自己决定怎么做」。
//
// 为什么放在控制台这一侧：模型调用走的是桌宠自己的 /quip 通道（宿主 lib/index.js 的 [local patch 4]），
// 所以用的就是她此刻的模型与大脑档位（本地 Ollama / 联网 / 自动择优），不受控制台左右；
// 而真正动手（开软件、开网页、起停录屏、改保存位置）由控制台进程执行 —— 它有 Electron 的 shell，
// 也不必再往副本里塞第 3 条补丁。
//
// 协议：模型每轮只回一个 JSON：
//   {"tool":"open_url","args":{"url":"https://www.bilibili.com"},"say":"好，帮你打开"}
//   {"tool":"done","args":{"reply":"给主人的回答"}}
// 不是 JSON 就当最终回答（小模型经常会这样，不能因此报错）。

const rec = require("./rec");
const petApi = require("./pet-api");

const MAX_STEPS = 6;
// 本机 qwen3 这类「思考型」模型会先吐几百个思考 token 才写正文：预算给足它才不会把
// 预算全烧在思考上（桌宠的 /quip 现在最多收 3000）。联网 / DSH 模型很快，给 400 就够。
const LOCAL_BUDGET = 2000;
const ONLINE_BUDGET = 400;
// 每一次 think 允许桌宠生成多久。桌宠那边默认 45 秒，思考型本机模型常常不够 —— 传大一点。
const PET_TIMEOUT_MS = 120000;

// 常见站点短路表 —— 放进提示词里当参考资料，用不用由模型自己决定。
const SITES = [
	["B站 / bilibili / 哔哩哔哩", "https://www.bilibili.com"],
	["知乎", "https://www.zhihu.com"],
	["百度", "https://www.baidu.com"],
	["微博", "https://weibo.com"],
	["淘宝", "https://www.taobao.com"],
	["京东", "https://www.jd.com"],
	["抖音", "https://www.douyin.com"],
	["小红书", "https://www.xiaohongshu.com"],
	["豆瓣", "https://www.douban.com"],
	["网易云音乐", "https://music.163.com"],
	["GitHub", "https://github.com"],
	["YouTube", "https://www.youtube.com"],
	["Steam", "https://store.steampowered.com"],
	["12306", "https://www.12306.cn"],
];

const TOOLS = {
	list_recorders: {
		desc: "看看这台电脑上有哪些能录屏的软件（只读，不改任何东西）",
		args: "{}",
		perm: null,
		run: async () => rec.detectRecorders(),
	},
	use_recorder: {
		desc: "换一个录屏软件（名字或路径，先用 list_recorders 看）",
		args: '{"name":"OBS Studio"}',
		perm: "app",
		run: async (a) => {
			const q = String((a && (a.name || a.path)) || "").trim();
			if (!q) return { ok: false, reason: "empty", message: "没给软件名" };
			const det = rec.detectRecorders();
			const ql = q.toLowerCase();
			const hit =
				det.list.find((x) => x.path.toLowerCase() === ql) ||
				det.list.find((x) => x.name.toLowerCase() === ql) ||
				det.list.find((x) => x.name.toLowerCase().includes(ql) || ql.includes(x.name.toLowerCase()));
			const soft = hit || { name: q, path: /[\\/]/.test(q) ? q : "", kind: /obs/i.test(q) ? "obs" : "other" };
			const r = rec.writeRecord({ software: soft });
			return { ok: true, software: r.record.software, candidates: det.list.map((x) => x.name) };
		},
	},
	open_recorder: {
		desc: "把当前选定的录屏软件打开（需要「软件」权限）",
		args: "{}",
		perm: "app",
		run: async () => rec.recOpen(),
	},
	record: {
		desc: "录屏动作：开始 / 停止 / 看状态",
		args: '{"action":"start"}',
		perm: "app",
		run: async (a) => {
			const act = String((a && a.action) || "").toLowerCase();
			if (/^(start|开始|open|开)/.test(act)) return rec.recStart();
			if (/^(stop|停止|停|关)/.test(act)) return rec.recStop();
			return rec.recStatus();
		},
	},
	record_dir: {
		desc: "把录像保存位置改到某个文件夹（OBS 能真的改；别的软件只能记下来）",
		args: '{"dir":"E:\\\\录像"}',
		perm: "app",
		run: async (a) => rec.recSetDir((a && (a.dir || a.path)) || ""),
	},
	list_apps: {
		desc: "列出本机开始菜单里的软件（可以用 keyword 过滤，只读）",
		args: '{"keyword":"chrome"}',
		perm: null,
		run: async (a) => {
			const kw = String((a && a.keyword) || "").trim().toLowerCase();
			const apps = petApi.listApps(2000).apps || [];
			const hit = kw ? apps.filter((x) => x.name.toLowerCase().includes(kw)) : apps;
			return { ok: true, count: hit.length, apps: hit.slice(0, 30).map((x) => x.name) };
		},
	},
	open_app: {
		desc: "打开一个软件（需要「软件」权限）",
		args: '{"name":"Chrome"}',
		perm: "app",
		run: async (a) => rec.openApp((a && a.name) || ""),
	},
	open_file: {
		desc: "用默认程序打开一个文件或文件夹（需要「文件」权限）",
		args: '{"path":"C:\\\\Users\\\\<你>\\\\Documents"}',
		perm: "file",
		run: async (a) => petApi.openTarget("file", (a && (a.path || a.file)) || ""),
	},
	open_url: {
		desc: "用浏览器打开一个网址（需要「网页」权限）",
		args: '{"url":"https://www.bilibili.com"}',
		perm: "url",
		run: async (a) => rec.openUrl((a && (a.url || a.site)) || ""),
	},
	search: {
		desc: "在浏览器里搜一个词（不知道网址时用这个，需要「网页」权限）",
		args: '{"query":"B站"}',
		perm: "url",
		run: async (a) => rec.searchWeb((a && (a.query || a.q || a.word)) || ""),
	},
	speak: {
		desc: "让桌宠把一句话说出来（冒泡 + 语音，不走模型）",
		args: '{"text":"录上了哦"}',
		perm: null,
		run: async (a) => rec.say((a && a.text) || ""),
	},
	done: {
		desc: "收工，把结果告诉主人",
		args: '{"reply":"已经帮你打开 B 站了"}',
		perm: null,
		run: async (a) => ({ ok: true, reply: String((a && (a.reply || a.text)) || "") }),
	},
};

const PERM_CN = { app: "软件", file: "文件", url: "网页" };

// 一次就能办完的动作：办成之后直接收尾，别再让小模型接着瞎调工具绕圈。
const ONE_SHOT = new Set(["open_url", "open_app", "open_file", "use_recorder", "record_dir", "record", "search"]);
const WRAP_SYSTEM = "你是桌面上的「蓝毛小女仆」，说话简短、可爱、口语化，用中文。";

function stripThink(text) {
	return String(text == null ? "" : text)
		.replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, "")
		.replace(/<think\b[\s\S]*$/i, "")
		.trim();
}

/** 从一段话里抠出最后一个完整的 JSON 对象（小模型常带前后废话或 ```json 围栏）。 */
function pickJson(text) {
	const s = String(text || "");
	const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const cands = fenced ? [fenced[1], s] : [s];
	for (const c of cands) {
		const start = c.indexOf("{");
		if (start < 0) continue;
		let depth = 0;
		for (let i = start; i < c.length; i++) {
			if (c[i] === "{") depth++;
			else if (c[i] === "}") {
				depth--;
				if (depth === 0) {
					try {
						return JSON.parse(c.slice(start, i + 1));
					} catch {
						break;
					}
				}
			}
		}
	}
	return null;
}

/** 小模型不听话的兜底：从一段话里找出她「想调哪个工具」。
 *  ① 标准 JSON：{"tool":"open_url","args":{...}}
 *  ② 函数式写法：open_url({"url":"..."})、open_url(url="...") —— 3B 小模型很爱这么写
 *  ③ 只回了个工具名（甚至编了一个）：名字对不上就用 SITES 关键字 / 正文里的 URL 救回来。 */
function pickToolCall(text) {
	const s = String(text || "");
	const j = pickJson(s);
	if (j && typeof j.tool === "string" && TOOLS[j.tool]) return j;
	const fn = s.match(/([A-Za-z_][A-Za-z0-9_]{2,24})\s*\(\s*(\{[\s\S]*?\})\s*\)/);
	if (fn && TOOLS[fn[1]]) {
		try {
			return { tool: fn[1], args: JSON.parse(fn[2]) };
		} catch {}
	}
	const fn2 = s.match(/([A-Za-z_][A-Za-z0-9_]{2,24})\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"\s*\)/);
	if (fn2 && TOOLS[fn2[1]]) return { tool: fn2[1], args: { [fn2[2]]: fn2[3] } };
	// 到这儿说明工具名不认得 —— 但这幾种情况明显是想开网页，替她接住。
	const wantUrl = /https?:\/\/[^\s"'<>）)]+/.exec(s);
	if (wantUrl) return { tool: "open_url", args: { url: wantUrl[0] }, recovered: true };
	const nameHint = (j && typeof j.tool === "string" ? j.tool : "") + " " + s.slice(0, 120);
	// 只在「她基本只报了个站名」时才靠关键字救（避免闲聊里提到 B 站也被当成要打开）
	if (String(text || "").replace(/\s/g, "").length > 80) return null;
	for (const [keys, url] of SITES) {
		for (const k of String(keys).split("/").map((x) => x.trim()).filter(Boolean)) {
			if (k && nameHint.toLowerCase().includes(k.toLowerCase())) return { tool: "open_url", args: { url }, recovered: true, hint: k };
		}
	}
	return null;
}

/** 给快模型（联网 / 大模型）用的完整提示词。 */
function buildSystem(ctx) {
	const lines = [];
	lines.push("你是桌面上的「蓝毛小女仆」，现在一边跟主人聊天，一边通过工具替他操作电脑。");
	lines.push("你只能回一个 JSON 对象，不要解释、不要 Markdown 代码块（除非必要）、不要多余的话。");
	lines.push("");
	lines.push("两种回法：");
	lines.push('1) 要动手：{"tool":"工具名","args":{...},"say":"顺手跟主人说的一句话（可省）"}');
	lines.push('2) 干完了：{"tool":"done","args":{"reply":"给主人的回答"}}');
	lines.push("");
	lines.push("可用工具（args 必须是 JSON 对象）：");
	for (const [name, def] of Object.entries(TOOLS)) {
		lines.push(`- ${name}(${def.args}) —— ${def.desc}${def.perm ? `【需要「${PERM_CN[def.perm]}」权限】` : ""}`);
	}
	lines.push("");
	lines.push("规矩：");
	lines.push("1. 一次只调一个工具，看到结果再决定下一步。");
	lines.push("2. 权限关着的时候工具会失败，这时候别硬试，用 done 告诉主人去哪儿打开开关。");
	lines.push("3. 主人让你打开某个网站，用 open_url 直接开；不确定网址就用 search 搜一下（他说「打开B站」时两种都行）。");
	lines.push("4. 主人让你录屏，先看 record(action=\"status\")，再决定 record 开始还是停止。");
	lines.push("5. 干完活一定用 done 收尾，把「做了什么、结果怎么样」一句话说清楚。");
	lines.push("");
	lines.push("参考网址：");
	for (const [k, v] of SITES) lines.push(`- ${k} → ${v}`);
	lines.push("");
	lines.push(stateLine(ctx));
	// /no_think 是 qwen3 系认识的特判词：不加的话 400 个 token 全花在思考上，
	// 正文永远是空的（桌宠那边的 /quip 会把思考剥掉，于是报「只想了、没写正文」）。
	lines.push("/no_think");
	return lines.join("\n");
}

/** 本机小模型（qwen3:4b 这种）每步只有 45 秒预算，提示词短一点才不会超时。
 *  实测：提示词 ~1800 字 → 大概率超时/光想不写；~375 字 → 秒回。 */
function buildTerse(ctx) {
	const tools = Object.entries(TOOLS)
		.map(([name, def]) => `${name}(${def.args})`)
		.join("｜");
	return [
		"你是桌面上的蓝毛小女仆，用工具替主人办事。只回一个 JSON，不要思考、不要解释。",
		"工具：" + tools,
		stateLine(ctx),
	].join("\n");
}

function stateLine(ctx) {
	const p = ctx.perm || {};
	return (
		`当前状态：权限 软件【${p.app ? "开" : "关"}】文件【${p.file ? "开" : "关"}】网页【${p.url ? "开" : "关"}】` +
		`；录屏软件 ${ctx.recorder.name}；存到 ${ctx.recDir || "（没设）"}；浏览器 ${ctx.browser || "系统默认"}。`
	);
}

/** 把提示词停在 `{"tool":"` 上，让小模型顺着往下写（它自己起头容易变成写作文）。 */
const JSON_PREFIX = '{"tool":"';

function promptWithPrefix(transcript) {
	return transcript.join("\n\n") + "\n\n只输出一行 JSON，从这里接着写：" + JSON_PREFIX;
}

/** 模型时不时把参数套一层（args/params/parameters/arguments/input），或者干脆不套 args —— 都掰平。 */
const ARG_WRAPPERS = ["args", "params", "parameters", "arguments", "input", "kwargs"];
function unwrap(v) {
	if (!v || typeof v !== "object" || Array.isArray(v)) return v;
	const keys = Object.keys(v);
	if (keys.length === 1 && ARG_WRAPPERS.includes(String(keys[0]).toLowerCase())) return unwrap(v[keys[0]]);
	return v;
}
function normalizeArgs(obj) {
	if (obj.args !== undefined) return unwrap(obj.args) || {};
	const { tool, say, ...rest } = obj;
	return unwrap(rest) || {};
}

/** 兜底用的极简提示词：本地小模型被长提示词带偏时，换这套再来一次。 */
const TERSE_SYSTEM =
	"你是一个只输出 JSON 的桌面助手。不要思考、不要解释、不要写多余文字，直接输出一个 JSON 对象。\n" +
	'可用工具：{"tool":"open_url","args":{"url":"..."}}、{"tool":"search","args":{"q":"..."}}、' +
	'{"tool":"open_app","args":{"name":"..."}}、{"tool":"list_recorders","args":{}}、' +
	'{"tool":"use_recorder","args":{"name":"..."}}、{"tool":"record","args":{"action":"start|stop|status"}}、' +
	'{"tool":"record_dir","args":{"dir":"..."}}、{"tool":"open_recorder","args":{}}、' +
	'{"tool":"speak","args":{"text":"..."}}、{"tool":"done","args":{"reply":"..."}}。\n' +
	"/no_think";

/** 调桌宠当前那套模型（走她自己的 /quip，大脑档位/模型都是她的设置）。
 *  prefix 会把模型续写的内容拼回去 —— 提示词停在 `{"tool":"` 上时它只续写后半截。 */
async function think(system, prompt, timeoutMs, numPredict, prefix) {
	const { port, route } = rec.petRoute();
	const budget = Number(numPredict) || LOCAL_BUDGET;
	const petTimeout = Number(timeoutMs) || PET_TIMEOUT_MS;
	let res;
	try {
		res = await fetch(`http://127.0.0.1:${port}${route}/quip`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ prompt: String(prompt).slice(0, 4000), system: String(system).slice(0, 8000), numPredict: budget, timeoutMs: petTimeout }),
			signal: AbortSignal.timeout(petTimeout + 8000),
		});
	} catch (e) {
		return { ok: false, reason: "pet-offline", message: `桌宠没在跑（${(e && e.message) || e}），先启动她再说话` };
	}
	const obj = await res.json().catch(() => null);
	if (!obj) return { ok: false, reason: "bad-json", message: `桌宠返回的不是 JSON（HTTP ${res.status}）` };
	let text = stripThink(obj.text || "");
	if (text && prefix && !text.trimStart().startsWith("{")) text = prefix + text.trimStart();
	if (text) return { ok: true, text, model: obj.model || "", provider: obj.provider || obj.reason || "" };
	return {
		ok: false,
		reason: obj.reason || "no-text",
		message: obj.message || `她的模型没出话（${obj.reason || "unknown"}）`,
	};
}

/** 桌宠此刻用的是哪套模型（决定提示词要多短）。 */
async function currentModel() {
	const { port } = rec.petRoute();
	try {
		const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
		const o = await r.json();
		const m = o && o.model ? o.model : {};
		return { provider: String(m.provider || ""), model: String(m.model || "") };
	} catch {
		return { provider: "", model: "" };
	}
}

/** 模型中途掉线时，用已经完成的动作拼一句人话（别让主人以为失败了）。 */
function summarizeSteps(steps, why) {
	const last = [...steps].reverse().find((s) => !(s.result && s.result.ok === false));
	if (!last) return `没做成（${why || "模型掉线了"}）`;
	const a = last.args || {};
	const r = last.result || {};
	if (last.tool === "open_url") return `已经替你打开 ${a.url || r.opened || "网页"} 了。`;
	if (last.tool === "search") return `已经在浏览器里搜「${a.q || ""}」了。`;
	if (last.tool === "open_app") return `已经打开「${a.name || r.opened || "软件"}」了。`;
	if (last.tool === "open_file") return `已经打开 ${a.path || r.opened || "文件"} 了。`;
	if (last.tool === "record") return a.action === "stop" ? `录好了，文件在 ${r.path || "录像文件夹"}。` : a.action === "start" ? "开始录了。" : "录屏是空着的。";
	if (last.tool === "record_dir") return `保存位置改成 ${a.dir || ""} 了。`;
	if (last.tool === "use_recorder") return `录屏软件换成「${a.name || ""}」了。`;
	if (last.tool === "speak") return "话替你说了。";
	return `做完了（${last.tool}）。后面的收尾话没说出来：${why || ""}`;
}

/**
 * 跑一轮 agent。
 * 返回 {ok, reply, steps:[{tool,args,result,ms}], model, fallback?}
 */
async function runAgent(request, opts = {}) {
	const onStep = typeof opts.onStep === "function" ? opts.onStep : () => {};
	const text = String(request || "").trim();
	if (!text) return { ok: false, reply: "", steps: [], message: "没给要做的事" };

	const permRes = await rec.readPerm();
	const ctx = {
		perm: permRes.perm || { app: false, file: false, url: false },
		recorder: rec.readRecord().software,
		recDir: rec.readRecord().outDir,
		browser: rec.readRecord().browser,
	};
	if (!permRes.ok) ctx.permNote = `（权限状态暂时读不到：${permRes.reason}，可能是桌宠刚重启，稍等一下）`;
	// 本机 ollama 的 qwen3 是「先想后写」的模型：提示词越长它想得越久。本机就用紧凑那套；
	// 联网 / 大模型用完整提示词（工具说明和规矩都写全）。
	const cur = await currentModel();
	const localSmall = !cur.provider || cur.provider === "ollama";
	const system = localSmall ? buildTerse(ctx) : buildSystem(ctx);
	const retrySystem = localSmall ? TERSE_SYSTEM : buildTerse(ctx);
	const steps = [];
	const transcript = [`主人说：${text}`];
	let lastSig = "";
	let repeated = 0;
	// 预算：本机思考型模型给大预算（想完还有余量写 JSON）；联网模型很快，小预算即可。
	const budget = localSmall ? LOCAL_BUDGET : ONLINE_BUDGET;
	const petTimeout = Number(opts.timeoutMs) || PET_TIMEOUT_MS;

	for (let i = 0; i < MAX_STEPS; i++) {
		const t0 = Date.now();
		// 提示词直接停在 {"tool":" 上让她接着写（思考型模型这样最省 token）。
		let thinkRes = await think(system, promptWithPrefix(transcript), petTimeout, budget, JSON_PREFIX);
		const tried = [];
		if (!thinkRes.ok) {
			tried.push(thinkRes.message || thinkRes.reason);
			// 关键教训：超时的生成会在 ollama 里继续排队、把后面的请求全拖死 ——
			// 所以「慢失败」绝不重试；只有「几秒就回了但没正文」才值得换个更短的提示词再试一次。
			const fastFail = Date.now() - t0 < petTimeout * 0.6;
			if (fastFail && steps.length === 0) {
				thinkRes = await think(retrySystem, transcript.join("\n\n") + "\n\n只回一个 JSON：", petTimeout, budget, "");
				if (!thinkRes.ok) tried.push(thinkRes.message || thinkRes.reason);
			}
		}
		if (!thinkRes.ok) {
			const why = tried.join("；");
			if (steps.length === 0) return { ok: false, reply: "", steps, message: why, fallback: true };
			// 活已经干了一部分，模型却掉线了 —— 别把「做成了」说成失败，按已经发生的事给一句话。
			return { ok: true, reply: summarizeSteps(steps, why), steps, model: "", degraded: true };
		}
		const obj = pickToolCall(thinkRes.text);
		if (!obj || !obj.tool || !TOOLS[obj.tool]) {
			// 不是工具调用 —— 当最终回答
			const reply = stripThink(thinkRes.text).slice(0, 800);
			onStep({ type: "reply", text: reply, ms: Date.now() - t0 });
			return { ok: true, reply, steps, model: thinkRes.model, gave_up: !obj };
		}
		const name = obj.tool;
		const args = normalizeArgs(obj);
		const say = String(obj.say || "").trim();
		if (name === "done") {
			const reply = String(args.reply || args.text || say || "").trim();
			const r = await TOOLS.done.run(args);
			steps.push({ tool: name, args, result: r, ms: Date.now() - t0 });
			onStep({ type: "done", tool: name, text: reply, ms: Date.now() - t0 });
			if (say && say !== reply) rec.say(say).catch(() => {});
			return { ok: true, reply: reply || (say || "好了"), steps, model: thinkRes.model };
		}
		const sig = `${name}:${JSON.stringify(args)}`;
		repeated = sig === lastSig ? repeated + 1 : 0;
		lastSig = sig;
		// 兜底解析出来的调用（她其实只是又说了一遍站名）重复一次就当她已经办完了，别绕圈。
		if (repeated >= 1 && obj.recovered) {
			return { ok: true, reply: summarizeSteps(steps) || "已经办好了", steps, model: thinkRes.model };
		}
		if (repeated >= 2) {
			return { ok: true, reply: "这件事我绕来绕去没做成，主人换个说法或者自己看一下？", steps, model: thinkRes.model, looped: true };
		}

		const def = TOOLS[name];
		let result;
		if (def.perm && !ctx.perm[def.perm]) {
			result = {
				ok: false,
				reason: "permission-denied",
				message: `主人把「${PERM_CN[def.perm]}」权限关着，我没法做这个。请主人到控制台的「权限 · 打开东西」里打开。`,
			};
		} else {
			try {
				result = await def.run(args);
			} catch (e) {
				result = { ok: false, reason: "tool-error", message: String((e && e.message) || e) };
			}
			if (result && result.ok !== false) {
				rec.appendPermLog(`${name}：${JSON.stringify(args).slice(0, 60)}`).catch(() => {});
			}
			if (result && result.ok !== false && say) {
				rec.say(say).catch(() => {});
				result.said = say;
			}
		}
		steps.push({ tool: name, args, result, ms: Date.now() - t0 });
		onStep({ type: "tool", tool: name, args, result, ms: Date.now() - t0 });
		transcript.push(`你调用了 ${name}(${JSON.stringify(args)})`);
		transcript.push(`工具结果：${JSON.stringify(result).slice(0, 700)}`);
		if (transcript.length > 14) transcript.splice(0, transcript.length - 14);
		// 一次就能办完的动作（开网页 / 开软件 / 换录屏目录…）办成了就收尾 ——
		// 小模型很容易接着瞎调工具绕圈，不如直接问她结果怎么说。
		if (result && result.ok !== false && ONE_SHOT.has(name) && !(name === "record" && args.action === "status")) {
			const reply = await wrapUp(transcript, petTimeout);
			if (reply) rec.say(reply).catch(() => {});
			return { ok: true, reply: reply || summarizeSteps(steps) || "办好了", steps, model: "" };
		}
	}
	return { ok: true, reply: "步数用完了，先干到这儿。主人还要我继续吗？", steps, model: "", maxed: true };
}

/** 收尾：不再让它挑工具，只要一句中文（小模型写大白话比写 JSON 稳得多）。 */
async function wrapUp(transcript, petTimeout) {
	const prompt = transcript.slice(-8).join("\n\n") + "\n\n已经办完了。用一句中文（不超过 30 个字）告诉主人结果，不要 JSON、不要解释。";
	const r = await think(WRAP_SYSTEM, prompt, Math.min(petTimeout, 90000), 200, "");
	if (!r.ok) return "";
	const t = stripThink(r.text).replace(/^["'「]|["'」]$/g, "").trim();
	return t && t.length <= 200 ? t : "";
}

module.exports = { runAgent, TOOLS, SITES, buildSystem, buildTerse, stateLine, normalizeArgs, pickJson, pickToolCall, stripThink, MAX_STEPS };
