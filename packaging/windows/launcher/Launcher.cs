// SPDX-License-Identifier: AGPL-3.0-only
//
// Flashless launcher for GitHub Repo Manager. PowerShell is a console-
// subsystem app, so ANY direct shortcut to it flashes a console window
// (upstream wontfix); a GUI-subsystem parent that spawns it with
// CreateNoWindow is the only clean fix. All real logic stays in
// start.ps1/stop.ps1 — this stub only launches them invisibly and mirrors
// their exit code. Compiled at package time by the in-box .NET Framework 4.8
// csc.exe (scripts/package-windows.mjs), so the repo carries no toolchain
// and stock Windows 10/11 carries no new runtime dependency.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class Program
{
    [DllImport("shell32.dll", SetLastError = true)]
    static extern int SetCurrentProcessExplicitAppUserModelID(
        [MarshalAs(UnmanagedType.LPWStr)] string appId);

    [STAThread]
    static int Main(string[] args)
    {
        // Own taskbar identity: without this, pinned shortcuts group under
        // a generic host identity instead of the product.
        SetCurrentProcessExplicitAppUserModelID("BolaLabs.GitHubRepoManager");

        string root = AppDomain.CurrentDomain.BaseDirectory;
        int argStart = 0;
        bool stop = false;
        if (args.Length > 0 && args[0].Equals("stop", StringComparison.OrdinalIgnoreCase))
        {
            stop = true;
            argStart = 1;
        }
        else if (args.Length > 0 && args[0].Equals("start", StringComparison.OrdinalIgnoreCase))
        {
            argStart = 1;
        }

        string script = Path.Combine(root, stop ? "stop.ps1" : "start.ps1");
        string psArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"";
        for (int i = argStart; i < args.Length; i++)
        {
            if (args[i] == "--no-browser")
            {
                psArgs += " -NoBrowser";
            }
            else if (args[i] == "--data-dir" && i + 1 < args.Length)
            {
                i++;
                psArgs += " -DataDir \"" + args[i] + "\"";
            }
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "powershell.exe";
            psi.Arguments = psArgs;
            psi.WorkingDirectory = root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "GitHub Repo Manager could not start Windows PowerShell, which it needs to run.\r\n\r\n"
                + ex.Message + "\r\n\r\n"
                + "If PowerShell is restricted on this machine, see the Troubleshooting section of docs/windows.md in the project repository.",
                "GitHub Repo Manager",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }
}
