// SwCapture —— dsh-pet「实时监测桌面」的抓屏工具（替代原来的 capture.ps1）
//
// 为什么要写它：
//   capture.ps1 走 powershell.exe，每次调用实测约 900~1140 ms
//   （纯 PowerShell 冷启动 349 ms + Add-Type 124 ms + 全屏抓图 ~290 ms + 其余为缩放/JPEG 编码）。
//   监测开着时每 12 秒就要付一次这个代价，是「打开监测就卡」的固定开销之一。
//   本程序把同样的活做完，冷启动 + 抓屏实测约 100~200 ms。
//
// 用法（由 dsh-pet 宿主插件的 swCapture() 调用）：
//   SwCapture.exe --sig    只算 16x16 灰度签名，打印 512 个十六进制字符；不落盘。
//   SwCapture.exe --shot   额外把 1280 宽（上限）的 JPEG 写到 %DSH_PET_SHOT%；同样打印签名。
//   退出码 0 = 成功，1 = 失败（失败时 stdout 不打任何东西，与 capture.ps1 的约定一致）。
//
// 与 capture.ps1 的差异（有意为之）：
//   1. 用 GDI StretchBlt 从桌面 DC 直接缩到目标位图，不再先建一张全屏位图（省一次全分辨率拷贝）。
//   2. 缩放模式用 HALFTONE 而不是 HighQualityBicubic；两者都是平滑缩放，签名只用于变化检测，
//      阈值判等不受影响（切换后第一拍会因算法不同而判成"变了"，最多多发一次点评，无害）。
//   3. 平移/虚拟屏坐标一律用 GetSystemMetrics，不再加载 System.Windows.Forms。
//
// 编译（本机没有 dotnet SDK，用系统自带的 C# 5 编译器）：
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe /optimize+ ^
//     /reference:System.Drawing.dll /out:SwCapture.exe SwCapture.cs

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

internal static class SwCapture
{
    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern bool StretchBlt(IntPtr hdcDest, int xDest, int yDest, int wDest, int hDest,
                                          IntPtr hdcSrc, int xSrc, int ySrc, int wSrc, int hSrc, int rop);

    [DllImport("gdi32.dll")]
    private static extern int SetStretchBltMode(IntPtr hdc, int mode);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;
    private const int SRCCOPY = 0x00CC0020;
    private const int HALFTONE = 4;
    private const int MAX_WIDTH = 1280;

    private static int Main(string[] args)
    {
        bool wantShot = false;
        for (int i = 0; i < args.Length; i++)
        {
            if (string.Equals(args[i], "--shot", StringComparison.OrdinalIgnoreCase)) wantShot = true;
        }

        int vx, vy, vw, vh;
        try
        {
            vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
            vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
            vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        }
        catch (Exception e)
        {
            Fail(e);
            return 1;
        }
        if (vw <= 0 || vh <= 0)
        {
            Console.Error.WriteLine("dsh-pet SwCapture: virtual screen has no area");
            return 1;
        }

        IntPtr screenDc = IntPtr.Zero;
        try
        {
            screenDc = GetDC(IntPtr.Zero);
            if (screenDc == IntPtr.Zero)
            {
                Console.Error.WriteLine("dsh-pet SwCapture: GetDC failed");
                return 1;
            }

            string sig = Signature(screenDc, vx, vy, vw, vh);

            if (wantShot)
            {
                string target = Environment.GetEnvironmentVariable("DSH_PET_SHOT");
                if (string.IsNullOrEmpty(target))
                {
                    Console.Error.WriteLine("dsh-pet SwCapture: DSH_PET_SHOT is not set");
                    return 2;
                }
                Shot(screenDc, vx, vy, vw, vh, target);
            }

            Console.Out.Write(sig);
            Console.Out.Write("\n");
            Console.Out.Flush();
            return 0;
        }
        catch (Exception e)
        {
            Fail(e);
            return 1;
        }
        finally
        {
            if (screenDc != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screenDc);
        }
    }

    /// <summary>16x16 灰度签名（512 个十六进制字符）。只用于本地变化检测，永不发给模型。</summary>
    private static string Signature(IntPtr screenDc, int vx, int vy, int vw, int vh)
    {
        using (Bitmap tiny = new Bitmap(16, 16, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(tiny))
            {
                IntPtr hdc = g.GetHdc();
                try
                {
                    SetStretchBltMode(hdc, HALFTONE);
                    StretchBlt(hdc, 0, 0, 16, 16, screenDc, vx, vy, vw, vh, SRCCOPY);
                }
                finally
                {
                    g.ReleaseHdc(hdc);
                }
            }

            StringBuilder sb = new StringBuilder(512);
            for (int y = 0; y < 16; y++)
            {
                for (int x = 0; x < 16; x++)
                {
                    Color c = tiny.GetPixel(x, y);
                    int lum = (int)(0.299 * c.R + 0.587 * c.G + 0.114 * c.B);
                    if (lum < 0) lum = 0;
                    if (lum > 255) lum = 255;
                    sb.Append(lum.ToString("x2"));
                }
            }
            return sb.ToString();
        }
    }

    /// <summary>送给模型的那一帧：宽度上限 1280 的 JPEG（字节小、token 少）。</summary>
    private static void Shot(IntPtr screenDc, int vx, int vy, int vw, int vh, string target)
    {
        double scale = Math.Min(1.0, (double)MAX_WIDTH / vw);
        int ow = (int)(vw * scale);
        int oh = (int)(vh * scale);
        if (ow < 1) ow = 1;
        if (oh < 1) oh = 1;

        using (Bitmap frame = new Bitmap(ow, oh, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(frame))
            {
                IntPtr hdc = g.GetHdc();
                try
                {
                    SetStretchBltMode(hdc, HALFTONE);
                    StretchBlt(hdc, 0, 0, ow, oh, screenDc, vx, vy, vw, vh, SRCCOPY);
                }
                finally
                {
                    g.ReleaseHdc(hdc);
                }
            }
            frame.Save(target, ImageFormat.Jpeg);
        }
    }

    private static void Fail(Exception e)
    {
        Console.Error.WriteLine("dsh-pet SwCapture: " + e.Message);
    }
}
