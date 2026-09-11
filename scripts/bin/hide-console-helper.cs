using System;
using System.Runtime.InteropServices;

public class Program {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public const int SW_HIDE = 0;

    public static int Main(string[] args) {
        try {
            IntPtr hWnd = GetConsoleWindow();
            if (hWnd != IntPtr.Zero) {
                ShowWindow(hWnd, SW_HIDE);
                return 0;
            }
            return 1;
        } catch {
            return 2;
        }
    }
}
