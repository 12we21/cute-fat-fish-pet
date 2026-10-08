"""
试听样音生成（用来挑默认音色 / 调音高）
  python build\\mk-voice-samples.py [输出目录]
依赖：pip install edge-tts（只在本机开发时用，不进发布包）

输出目录不给就是 <仓库根>\\_accept\\voicesamples（仓库根 = 本文件上一级的上一级）。
验收/试听这类临时产物都收在 <仓库根>\\_accept\\ 下；也可以用环境变量
BLUEHAIRMAID_ACCEPT_ROOT 把这块临时区的根整个挪到别处（比如放到更快的盘）。

注意：应用里的 TTS 走的是同一个 Edge 端点、同一套 SSML，只是它的
`ttsBuildSsml()` 里音高被写死成 '+0Hz'；要启用音高得改那处代码。
"""
import asyncio
import os
import sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TEXT = "主人主人～我是你的小女仆，今天也要开开心心的哦～"

# (文件名, 音色, 相对基准语速, 音高Hz)
CASES = [
    ("1-xiaoyi-当前默认", "zh-CN-XiaoyiNeural", "+0%", "+0Hz"),
    ("2-xiaoyi-升调25", "zh-CN-XiaoyiNeural", "+0%", "+25Hz"),
    ("3-xiaoyi-升调35-语速8", "zh-CN-XiaoyiNeural", "+8%", "+35Hz"),
    ("4-xiaoxiao-温柔升调20", "zh-CN-XiaoxiaoNeural", "+0%", "+20Hz"),
    ("5-xiaoxiao-软萌升调40", "zh-CN-XiaoxiaoNeural", "+6%", "+40Hz"),
]


async def main(out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    for name, voice, rate, pitch in CASES:
        path = os.path.join(out_dir, f"{name}.mp3")
        comm = edge_tts.Communicate(TEXT, voice, rate=rate, pitch=pitch)
        await comm.save(path)
        print(f"  {os.path.basename(path):32s} {voice:26s} rate={rate:5s} pitch={pitch:6s} {os.path.getsize(path):>7d} B")


if __name__ == "__main__":
    accept = os.environ.get("BLUEHAIRMAID_ACCEPT_ROOT") or os.path.join(ROOT, "_accept")
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(accept, "voicesamples")
    asyncio.run(main(target))
