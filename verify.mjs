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
  app: { files: 594, bytes: 74565618, treeSha256: "27f0cec31a45b777f3f96d6790f75261927232e2e486a5c6136b959d4fe28377" },
  launcher: { files: 10, bytes: 400129, treeSha256: "5bbf55fd1bbdaf94044c639e45bd913c5db6e9172abbb06c4a4e6263ffc67c4d" },
  standalone: { files: 14, bytes: 106518, treeSha256: "704e11f2d4ea11dd5988947ccef86f21a935e2f1b8d7ac12d14801d132451b70" },
  defaults: { files: 4, bytes: 13967, treeSha256: "4f95360682c89202b714cbc8fca606fa6a29667c34397be08c5f081118d5229b" },
};

// 我们自己写的那些关键文件：大小 + sha256（不含 verify.mjs 自己 —— 它一改哈希就变）
const OURS = {
  'app/lib/index.js': [116727, 'c784e62935fb8fcbfa934afc6f937b363e773b002163c73c7b0616de14e2d919'],
  'app/runtime/electron-helper/main.js': [138421, '349604b088db422c629230ca0df6360a56071f42118fbf0f16e68a8c189412b4'],
  'app/runtime/electron-helper/sprite.js': [250704, '13e9fa11fab41d2f17e3ff924a4cb9ba5208abe38db9b3f1832314c87e14ed1c'],
  'app/runtime/electron-helper/targets.js': [9430, '039d0173387dfccc9d2eb6936d7f40dbc3b380eef702e590ff02b39b61712578'],
  'app/runtime/electron-helper/shared-core.js': [52708, '2f77b7a2de89bfe1fcdf8906b53babfb1e250fc87cc812727eb0843adc037e5d'],
  'app/runtime/electron-helper/events.js': [18069, 'b7a008788f51c6b68a9e5e1f25f8dcdfd9e6ed173394c409c44e30644ee0c96a'],
  'launcher/main.js': [40931, '62b475a2bcea506999852817c8f299c52d23200b8ff7f0206ec4cbf66e3c9b31'],
  'launcher/index.html': [118389, '803ccb8da32282846f7064d51d3f8a44c5ab4e8602efe23ae0077312c424b3b1'],
  'launcher/preload.js': [4365, '4a0f3cee3dc8b3053f7b6f18b299bb431dfdd1a15154032683e2c4b3188ec8dc'],
  'launcher/paths.js': [4103, '8c9d31cbef9bc151681faf49b67709e80d62a663779eb24b6cad0ac1ca9e1749'],
  'launcher/update.js': [27340, 'a734ea28cf220a9d6ac0a7115d3b7203e0c97351ba78debae6c7391cdffc151e'],
  'launcher/pet-api.js': [16659, '79584b3c285cb5883668c4a4ba534a82262451f1373e6de05986f2116c55ce7e'],
  'launcher/rec.js': [22702, 'b63c254334e3672218920ebba75b49e604602e3fd4fcd5130837ac0ff101bcd2'],
  'launcher/agent.js': [22851, '9a67364fb317724397bfa605c20692a7c9734e04d8b56562e02b828342d19651'],
  'launcher/pet.ico': [142521, 'b727ea4dcec32409cb6bc4709489276b5daaf90fe180184298e598b35bcfc6c0'],
  'launcher/package.json': [268, 'c63596ba82b51cf50002ae87a6f37673135070a86b9fd987b22a8fe4ceb7e4cc'],
  'standalone/main.mjs': [27034, '0ef47d97ea7bfa857c8e9e3d9d67e59a7a3f792a5c16e8518b2cdd28669f4dee'],
  'standalone/server.mjs': [8681, '07a7ca5c1e18fbb46693869603d1593b05b492f573184ac6473ab2497c85404d'],
  'standalone/context.mjs': [12059, 'ae85889600d9402743ef60bb781b7f17fcdd58f768ba42c639a1d119eaa823f8'],
  'standalone/detect.mjs': [15523, '30d78c0f459ba1226e864133da4ad02ed0c12785abd952dfcbc9587582f9e1bc'],
  'standalone/paths.mjs': [5781, '6197fa05773452fb30e8db0bf241c3fb04c3468fee74ee374106fd30d1c99847'],
  'standalone/online.mjs': [14228, '7ea52dfdd6d49df910222133ddd2b6036ebed64c2e3b31bc7095e6f5f690246e'],
  'standalone/ollama.mjs': [8793, '57420589a878591f9ba411f643975a238f9ebfdb3404f7008bf8a6f63218a1a8'],
  'standalone/check.mjs': [5714, '7defb820c9b1eef8c9de33b28a4453ca9e367287e4b3fff31c06d93735c5489a'],
  'standalone/stop-pet.mjs': [3294, 'c2ee5afc98472b013d8e64c50c0ff608ea2ecb334a08eb5594145fa19b315518'],
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
