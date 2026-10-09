"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// 渲染进程只能通过这些口子碰外面。窗口开着 sandbox:true，所以哪怕页面被注入了东西，
// 能做的也只有下面这些明确列出的动作。
contextBridge.exposeInMainWorld("pet", {
	status: () => ipcRenderer.invoke("status"),
	start: () => ipcRenderer.invoke("start"),
	stop: () => ipcRenderer.invoke("stop"),
	options: () => ipcRenderer.invoke("options"),
	setState: (patch) => ipcRenderer.invoke("set-state", patch),
	setPet: (patch) => ipcRenderer.invoke("set-pet", patch),
	ask: (text) => ipcRenderer.invoke("ask", text),

	// 性格：内置两套 / 自定义文本 / 保存的性格库
	setPersona: (kind) => ipcRenderer.invoke("set-persona", kind),
	personas: () => ipcRenderer.invoke("personas-get"),
	savePersona: (name, text) => ipcRenderer.invoke("personas-save", { name, text }),
	deletePersona: (name) => ipcRenderer.invoke("personas-delete", name),
	setPersonaText: (text) => ipcRenderer.invoke("persona-text-set", text),

	// 桌宠自己那半边（权限 / 语音 / 活跃度 / 自主说话 / AI 导演 / 本地文本模型）
	control: () => ipcRenderer.invoke("control-state"),
	controlSet: (kind, value, reload) => ipcRenderer.invoke("control-set", { kind, value, reload }),
	controlPatch: (kind, patch, reload) => ipcRenderer.invoke("control-patch", { kind, patch, reload }),

	// 联网模型
	online: () => ipcRenderer.invoke("online-get"),
	saveOnline: (patch) => ipcRenderer.invoke("online-set", patch),
	testOnline: (extra) => ipcRenderer.invoke("online-test", extra),

	// 打开软件 / 文件 / 网页
	listApps: () => ipcRenderer.invoke("list-apps"),
	openTarget: (kind, target) => ipcRenderer.invoke("open-target", { kind, target }),

	// 录屏：软件 / 保存位置 / 起停
	recGet: () => ipcRenderer.invoke("rec-get"),
	recDetect: () => ipcRenderer.invoke("rec-detect"),
	recStatus: () => ipcRenderer.invoke("rec-status"),
	recSet: (patch) => ipcRenderer.invoke("rec-set", patch),
	recAction: (action, extra) => ipcRenderer.invoke("rec-action", Object.assign({ action }, extra || {})),
	recPickDir: () => ipcRenderer.invoke("rec-pick-dir"),

	// AI agent：让桌宠当前那个模型自己决定怎么动手
	agent: (text) => ipcRenderer.invoke("agent-run", { text }),
	say: (text) => ipcRenderer.invoke("say", text),

	// 音高（发布版补丁 T2）：写的是她的数据目录里那个 tts-pitch.txt，写完立刻生效
	ttsPitchGet: () => ipcRenderer.invoke("tts-pitch-get"),
	ttsPitchSet: (v) => ipcRenderer.invoke("tts-pitch-set", v),

	// 装完自动适配：看本机有什么显卡/显存/模型，挑一套配置
	appInfo: () => ipcRenderer.invoke("app-info"),
	detect: () => ipcRenderer.invoke("detect"),
	detectApply: (force) => ipcRenderer.invoke("detect-apply", { force }),
	probe: (models) => ipcRenderer.invoke("probe", { models }),
	ollamaStart: () => ipcRenderer.invoke("ollama-start"),
	ollamaPull: (model) => ipcRenderer.invoke("ollama-pull", { model }),
	openAppPath: (which) => ipcRenderer.invoke("open-app-path", which),
	onPullLine: (fn) => {
		const handler = (_e, text) => fn(text);
		ipcRenderer.on("pull-line", handler);
		return () => ipcRenderer.removeListener("pull-line", handler);
	},
	// 第一次运行时主进程会自己检测一遍，结果从这里推回来
	onDetectDone: (fn) => {
		const handler = (_e, r) => fn(r);
		ipcRenderer.on("detect-done", handler);
		return () => ipcRenderer.removeListener("detect-done", handler);
	},

	// 一键更新（1.2.0）：问 GitHub 有没有新版 → 下安装包（边下边校验）→
	// 关掉这个窗口，交给独立的 PowerShell 静默装回原目录，装完自己开回来
	updateCheck: () => ipcRenderer.invoke("update-check"),
	updateDownload: (req) => ipcRenderer.invoke("update-download", req || {}),
	updateApply: (req) => ipcRenderer.invoke("update-apply", req || {}),
	updateResult: () => ipcRenderer.invoke("update-result"),
	updateOpenPage: (url) => ipcRenderer.invoke("update-open-page", url),
	onUpdateProgress: (fn) => {
		const handler = (_e, p) => fn(p);
		ipcRenderer.on("update-progress", handler);
		return () => ipcRenderer.removeListener("update-progress", handler);
	},

	openHealth: (port) => ipcRenderer.invoke("open-health", port),
	openFolder: () => ipcRenderer.invoke("open-folder"),
});
