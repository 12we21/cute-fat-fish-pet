/**
 * 可爱大肥鱼桌宠 · 发布版自校验
 *   node verify.mjs            （在安装目录里跑，比如 %LOCALAPPDATA%\BlueHairMaid）
 * 逐字节核对几棵树的整树指纹，再逐个核对关键文件的大小与 sha256，最后确认那些
 * **不该出现在包里**的开发期/运行期文件真的没有。退出码 0 = 全部一致。
 *
 * 这是独立仓库（源码即成品，没有「上游蓝本 + 补丁」那回事），所以期望值就是
 * 本仓库构建出来的样子；每趟重新打包后，用下面这条命令重算并写入：
 *     node build\check-release.mjs --emit --write      （在仓库里跑）
 * 它同时会证明 stage\ 与 src\ launcher\ standalone\ defaults\ assets\ 逐字节一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// >>>GENERATED 由 build\check-release.mjs --emit --write 生成，别手改这一段
const EXPECT = {
  app: { files: 598, bytes: 74676561, treeSha256: "44a22847a1280cb4be484a68ccf6ab59bfb120197f9ddb6ae15807ec786acff9" },
  launcher: { files: 10, bytes: 405599, treeSha256: "68872ad610cc5c21ec14d0be2cbcd678fe71e06fc128fbd1dabdf0c1d032c27d" },
  standalone: { files: 14, bytes: 109022, treeSha256: "2459e84d534456496bb6497d164a131895c51fc2d6cad3791a9b8c17e48b51db" },
  defaults: { files: 4, bytes: 14171, treeSha256: "5fbae451c060b9c19ca3f6171a06c756cca4b0c780244a2e23f58abc6f72bde7" },
};

// 我们自己写的那些关键文件：大小 + sha256（不含 verify.mjs 自己 —— 它一改哈希就变）
const OURS = {
  'app/lib/index.js': [120268, '17a89cc0f2cd608d4caa31bafd1d34542214c0b3998f1aa33f0b8532ea7c25ce'],
  'app/runtime/electron-helper/main.js': [141127, '4734ce2e6d179266ad681f2a3b4a22496eb7490cbe18fdff1ba8d9ccec065c1b'],
  'app/runtime/electron-helper/sprite.js': [255627, '1524decd2f2b8575bdae686970f0261e2b63af7ae16a44a0389d8b34da4e7fa1'],
  'app/runtime/electron-helper/targets.js': [9668, 'ada4e584ef64f707a59cd57deb06728784b12b77db99e8a218b617101b384704'],
  'app/runtime/electron-helper/shared-core.js': [54314, '7165bc24001c6233d04bd03aa7d35f6569ac933adba7ddeaaef127c1d393c4a7'],
  'app/runtime/electron-helper/events.js': [18438, '132eaa7ca1f612dcd33ceada3267ab0911668bf040fa5b6123ccc5cf92aad767'],
  'launcher/main.js': [41887, '90126152bdb18805a85bd4cd639e730105ce2b65ac644f7fb598b5d1c19f2837'],
  'launcher/index.html': [120643, '085a8cb545a057394878084546fd6b40d2e9906a01a03a7b3ab890ebf8b99cd5'],
  'launcher/preload.js': [4452, '26633162c436037f4a6c0e3a39712933a823423efbad4b79778b4cee06ec6bc5'],
  'launcher/paths.js': [4208, '1c23ca0d132691566e8ab2e2eb4666376d5927c409802cbc13ab80df370c3add'],
  'launcher/update.js': [28017, 'e91678dcdf1575117e42ec67317ce992413ff2d68ac199e2c04418316d47e72f'],
  'launcher/pet-api.js': [17069, '3bf7ebe011bc808ce1c33274e66cbfa16be02189f6433ab36f85800d438e4e1b'],
  'launcher/rec.js': [23203, 'a755a899855cae292d44ba08889032f7c1ea4426c63eb03557eccebdd2af7fa6'],
  'launcher/agent.js': [23331, '89a05e733b564fb75f677175657f3100efea82560eeeae708ebb7287d33e9fcf'],
  'launcher/pet.ico': [142521, 'b727ea4dcec32409cb6bc4709489276b5daaf90fe180184298e598b35bcfc6c0'],
  'launcher/package.json': [268, '7ff2ccd300455603d1e247b68020e5b707c086ce613e2a6f895a42673697b5de'],
  'standalone/main.mjs': [27668, '867d298236682270f7c34dd8bee06ec644ce7889be4af039d30fe9b308ff3aeb'],
  'standalone/server.mjs': [8923, '38322988bc9d8530726e94454a4942d8f2ef962e98ba68390c05142faae77c1d'],
  'standalone/context.mjs': [12377, 'e2ba0f1978f88875065f8b0f78e4dbe370d50f4853da2c1376a97542d7560c73'],
  'standalone/detect.mjs': [15888, '6567593dc77a8bd835c7b6ff6327bc1cef0d96cb21e6bb37382fdf032b39c219'],
  'standalone/paths.mjs': [5913, 'b043af4d9b5a8940a31cacc52b541b6bba21fcf6d035cc412d51197a3c8eb15a'],
  'standalone/online.mjs': [14534, '8b778fc40125a15e0bbac873beca248541041f4f35f77faf18211a559cf52a73'],
  'standalone/ollama.mjs': [8995, '2cfa93db138f04413eeae0be93b5a1cb5f53e0e2a9df103ef6f6ce9392683730'],
  'standalone/check.mjs': [5828, '5eb3cec8484a04efcb10661c46981f86190bb2f9f9efab7195bc9d3fe71bce2d'],
  'standalone/stop-pet.mjs': [3407, '401fb5e267494e5a067f74befed021c8047d07bddec48c7778891e9db0ee39e8'],
  'standalone/start-pet.vbs': [1252, '6567c05d4648696b3e0c7c59aabbabaacaf58612816dc1a96197952dfb90844a'],
  'standalone/stop-pet.vbs': [1194, '633b7c027793a4fef0cf1c148ec90708df51ae3b2c1b9fab50a85c8017096a75'],
};
// <<<GENERATED

// 开发期草稿 / 运行期数据：这些一旦出现在安装目录里就是事故（要么把作者私人路径带出去了，
// 要么把上一台机器的密钥、日志、记忆一起打包了）。
const MUST_NOT_EXIST = [
  'patched', // 老发布仓那棵草稿堆（早就不该有了）
  'launcher/cli-result.json', // 控制台跑完一次留下的私人记录（含本机 ollama.exe 绝对路径）
  'standalone/online.json', // 联网模型的 API Key
  'standalone/runtime.json', // 上一只桌宠的 pid/端口
  'standalone/pet-control.json',
  'dsh-pet', // 数据根（人设/记忆/聊天记录）绝不能跟着程序走
  'userdata',
  'launcher/userdata',
];

/** 整树指纹。算法与 build\filters.mjs 的 treeFingerprint 一致：路径 + \0 + 内容 sha + \n */
function fingerprint(dir) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(p);
    }
  })(dir);
  files.sort();
  const h = crypto.createHash('sha256');
  let total = 0;
  for (const f of files) {
    const b = fs.readFileSync(f);
    total += b.length;
    h.update(path.relative(dir, f).split(path.sep).join('/') + '\0' + crypto.createHash('sha256').update(b).digest('hex') + '\n');
  }
  return { files: files.length, bytes: total, treeSha256: h.digest('hex') };
}

let bad = 0;
console.log('可爱大肥鱼桌宠 · 发布版自校验  ' + new Date().toISOString());
console.log('安装目录：' + ROOT);
console.log('（源码：https://github.com/12we21/cute-fat-fish-pet —— MIT，作者 Mikolu）');

for (const [name, exp] of Object.entries(EXPECT)) {
  const dir = path.join(ROOT, name);
  if (!fs.existsSync(dir)) {
    console.log(`\n[${name}] 目录不存在（安装目录里少了 ${name}\\）`);
    bad++;
    continue;
  }
  const got = fingerprint(dir);
  const ok = got.files === exp.files && got.bytes === exp.bytes && got.treeSha256 === exp.treeSha256;
  if (!ok) bad++;
  console.log(`\n[${name}] ${ok ? 'OK' : 'DRIFT'}`);
  console.log(`  files ${got.files} (期望 ${exp.files})   bytes ${got.bytes} (期望 ${exp.bytes})`);
  console.log(`  tree-sha256 ${got.treeSha256}`);
  if (!ok) console.log(`  期望        ${exp.treeSha256}`);
}

console.log('\n[关键文件]');
for (const [rel, [expSize, expHash]] of Object.entries(OURS)) {
  const f = path.join(ROOT, rel.split('/').join(path.sep));
  if (!fs.existsSync(f)) { console.log(`  MISSING ${rel}`); bad++; continue; }
  const st = fs.statSync(f);
  const gotHash = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const okSize = st.size === expSize;
  const okHash = gotHash === expHash;
  if (!okSize || !okHash) bad++;
  console.log(
    `  ${okSize && okHash ? 'OK   ' : 'DRIFT'} ${rel}  ${st.size} (期望 ${expSize})` +
      (okHash ? '  sha256 对' : `  sha256 ${gotHash} 期望 ${expHash}`),
  );
}

console.log('\n[不该出现在包里的东西]');
for (const rel of MUST_NOT_EXIST) {
  const f = path.join(ROOT, rel.split('/').join(path.sep));
  const there = fs.existsSync(f);
  if (there) bad++;
  console.log(`  ${there ? 'DRIFT' : 'OK   '} ${rel}${there ? '  ← 居然在！' : '  不在'}`);
}

console.log(
  '\n结果：' +
    (bad === 0
      ? `全部一致 —— ${Object.keys(EXPECT).length} 棵树的整树指纹 + ${Object.keys(OURS).length} 个关键文件都对得上，开发期/私人文件一个都没混进来`
      : `${bad} 处漂移 —— 这份副本已被改动过`),
);
process.exit(bad === 0 ? 0 : 1);
