// SPDX-License-Identifier: AGPL-3.0-only
//
// Native launcher + system-tray controller for GitHub Repo Manager.
//
// PowerShell is a console-subsystem app, so ANY direct shortcut to it flashes a
// console window (upstream wontfix); this GUI-subsystem exe spawns start.ps1 /
// stop.ps1 with CreateNoWindow so the server runs hidden. All server logic
// stays in the .ps1 scripts — this stub only launches them and, in tray mode,
// stays resident to show a running indicator with Open / Logs / Restart /
// Start-with-Windows / Quit. Compiled at package time by the in-box .NET
// Framework 4.8 csc.exe (scripts/package-windows.mjs), so the repo carries no
// toolchain and stock Windows 10/11 carries no new runtime dependency.
//
// Modes (first positional arg / flags):
//   (none) / --no-browser  -> tray mode: start the server, stay resident with a
//                             tray icon. --no-browser skips the initial browser
//                             open (used by the login autostart shortcut and the
//                             installer's /UPDATED relaunch).
//   stop                   -> spawn stop.ps1 and exit (graceful shutdown).
//   --start-only           -> spawn start.ps1 [-NoBrowser], wait, mirror its
//                             exit code, then exit. The blocking "start the
//                             server and return" path CI/automation relies on;
//                             never shows a tray icon.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    const string AppUserModelId = "BolaLabs.GitHubRepoManager";
    const string AppDisplayName = "GitHub Repo Manager";
    internal const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    internal const string RunValueName = "GitHubRepoManager";
    const int DefaultPort = 3001;

    [DllImport("shell32.dll", SetLastError = true)]
    static extern int SetCurrentProcessExplicitAppUserModelID(
        [MarshalAs(UnmanagedType.LPWStr)] string appId);

    [STAThread]
    static int Main(string[] args)
    {
        // Own taskbar/tray identity: without this, pinned shortcuts and toasts
        // group under a generic host identity instead of the product.
        SetCurrentProcessExplicitAppUserModelID(AppUserModelId);

        string root = AppDomain.CurrentDomain.BaseDirectory;

        bool stop = false;
        bool startOnly = false;
        bool noBrowser = false;
        string dataDirArg = null;

        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (i == 0 && a.Equals("stop", StringComparison.OrdinalIgnoreCase)) stop = true;
            else if (i == 0 && a.Equals("start", StringComparison.OrdinalIgnoreCase)) { /* alias for default */ }
            else if (a.Equals("--start-only", StringComparison.OrdinalIgnoreCase)) startOnly = true;
            else if (a == "--no-browser") noBrowser = true;
            else if (a == "--data-dir" && i + 1 < args.Length) { i++; dataDirArg = args[i]; }
        }

        if (stop) return RunScriptBlocking(root, "stop.ps1", noBrowser, dataDirArg);
        if (startOnly) return RunScriptBlocking(root, "start.ps1", noBrowser, dataDirArg);

        return RunTray(root, dataDirArg, noBrowser);
    }

    // ---- Blocking script spawn (stop, --start-only) -------------------------

    static int RunScriptBlocking(string root, string scriptName, bool noBrowser, string dataDir)
    {
        try
        {
            using (Process p = SpawnScript(root, scriptName, noBrowser, dataDir))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            ShowPowerShellError(ex);
            return 1;
        }
    }

    static Process SpawnScript(string root, string scriptName, bool noBrowser, string dataDir)
    {
        string script = Path.Combine(root, scriptName);
        string psArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + QuoteArg(script);
        if (noBrowser) psArgs += " -NoBrowser";
        if (!string.IsNullOrEmpty(dataDir)) psArgs += " -DataDir " + QuoteArg(dataDir);

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = "powershell.exe";
        psi.Arguments = psArgs;
        psi.WorkingDirectory = root;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        return Process.Start(psi);
    }

    static void ShowPowerShellError(Exception ex)
    {
        MessageBox.Show(
            "GitHub Repo Manager could not start Windows PowerShell, which it needs to run.\r\n\r\n"
            + ex.Message + "\r\n\r\n"
            + "If PowerShell is restricted on this machine, see the Troubleshooting section of docs/windows.md in the project repository.",
            AppDisplayName, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    // ---- Tray mode ----------------------------------------------------------

    static int RunTray(string root, string dataDirArg, bool noBrowser)
    {
        // Single tray instance: a second launch (e.g. clicking the shortcut
        // again) must not stack a second icon — it just reopens the browser.
        bool createdNew;
        using (Mutex mutex = new Mutex(true, "Local\\BolaLabs.GitHubRepoManager.Tray", out createdNew))
        {
            if (!createdNew)
            {
                // A human re-clicking the shortcut wants the browser; an
                // autostart double-launch (--no-browser) must NOT pop a tab.
                if (!noBrowser)
                {
                    string dd = ResolveDataDir(root, dataDirArg);
                    OpenBrowser(ReadPort(dd));
                }
                return 0;
            }

            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (TrayContext ctx = new TrayContext(root, dataDirArg, noBrowser))
                {
                    Application.Run(ctx);
                }
            }
            catch (Exception ex)
            {
                ShowPowerShellError(ex);
                return 1;
            }
            return 0;
        }
    }

    // ---- Shared helpers (also used by TrayContext) --------------------------

    // Mirror start.ps1's data-dir resolution so the tray's Open/Logs actions
    // point at the same directory the server actually uses: explicit arg ->
    // GRM_DATA_DIR env -> install-config.txt marker next to the exe (installed)
    // -> portable ".\data".
    internal static string ResolveDataDir(string root, string dataDirArg)
    {
        if (!string.IsNullOrEmpty(dataDirArg)) return dataDirArg;

        string env = Environment.GetEnvironmentVariable("GRM_DATA_DIR");
        if (!string.IsNullOrEmpty(env)) return env;

        string marker = Path.Combine(root, "install-config.txt");
        if (File.Exists(marker))
        {
            try
            {
                foreach (string line in File.ReadAllLines(marker))
                {
                    string t = line.Trim();
                    if (t.StartsWith("DATA_DIR=", StringComparison.OrdinalIgnoreCase))
                    {
                        string val = t.Substring("DATA_DIR=".Length).Trim();
                        return Environment.ExpandEnvironmentVariables(val);
                    }
                }
            }
            catch { /* fall through to portable default */ }
        }
        return Path.Combine(root, "data");
    }

    internal static int ReadPort(string dataDir)
    {
        try
        {
            string portFile = Path.Combine(dataDir, ".grm.port");
            if (File.Exists(portFile))
            {
                string text = File.ReadAllText(portFile).Trim();
                int port;
                if (int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out port)
                    && port > 0 && port <= 65535)
                {
                    return port;
                }
            }
        }
        catch { /* fall through to default */ }
        return DefaultPort;
    }

    internal static void OpenBrowser(int port)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(
                "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture));
            psi.UseShellExecute = true;
            Process.Start(psi);
        }
        catch { /* best effort */ }
    }

    internal static bool IsHealthy(int port)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(
                "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/api/health/live");
            req.Timeout = 2000;
            req.Method = "GET";
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            {
                return resp.StatusCode == HttpStatusCode.OK;
            }
        }
        catch { return false; }
    }

    // Win32 argv quoting: backslashes are literal except before a quote or the
    // closing quote, where they must be doubled; embedded quotes are backslash-
    // escaped. Without this, a data dir like D:\ eats the closing quote and
    // corrupts the rest of the command line.
    internal static string QuoteArg(string value)
    {
        System.Text.StringBuilder sb = new System.Text.StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { backslashes++; continue; }
            if (c == '"')
            {
                sb.Append(new string('\\', backslashes * 2 + 1));
                sb.Append('"');
            }
            else
            {
                sb.Append(new string('\\', backslashes));
                sb.Append(c);
            }
            backslashes = 0;
        }
        sb.Append(new string('\\', backslashes * 2));
        sb.Append('"');
        return sb.ToString();
    }
}

// Resident tray controller. Owns the NotifyIcon, its menu, and a health-poll
// timer; the server itself runs detached via start.ps1 (so it survives this
// process exiting), and Quit asks it to stop gracefully via stop.ps1.
class TrayContext : ApplicationContext
{
    readonly string _root;
    readonly string _dataDir;
    readonly string _trayPidPath;
    readonly bool _noBrowser;
    readonly NotifyIcon _icon;
    readonly ToolStripMenuItem _statusItem;
    readonly ToolStripMenuItem _autostartItem;
    readonly SynchronizationContext _ui;
    System.Threading.Timer _healthTimer;
    int _polling;   // 0/1 guard so overlapping health ticks can't stack
    bool _busy;     // guards Restart/Quit re-entry (set/read on the UI thread)

    public TrayContext(string root, string dataDirArg, bool noBrowser)
    {
        _root = root;
        _dataDir = Program.ResolveDataDir(root, dataDirArg);
        _trayPidPath = Path.Combine(_dataDir, ".grm.tray.pid");
        _noBrowser = noBrowser;

        // All blocking work (spawning powershell, WaitForExit, health HTTP) runs
        // on background threads; UI mutations are marshalled back here via _ui so
        // the message loop never freezes and the icon never ghosts as
        // "(Not Responding)". WinForms installs its sync context lazily, so make
        // sure one exists on this (the UI) thread before Application.Run.
        if (SynchronizationContext.Current == null)
            SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        _ui = SynchronizationContext.Current;

        ContextMenuStrip menu = new ContextMenuStrip();

        _statusItem = new ToolStripMenuItem("Starting…");
        _statusItem.Enabled = false;
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem open = new ToolStripMenuItem("Open in browser");
        open.Click += delegate { Program.OpenBrowser(Program.ReadPort(_dataDir)); };
        menu.Items.Add(open);

        ToolStripMenuItem logs = new ToolStripMenuItem("View server logs");
        logs.Click += delegate { OpenLogs(); };
        menu.Items.Add(logs);

        ToolStripMenuItem restart = new ToolStripMenuItem("Restart server");
        restart.Click += delegate { Restart(); };
        menu.Items.Add(restart);

        menu.Items.Add(new ToolStripSeparator());

        _autostartItem = new ToolStripMenuItem("Start with Windows");
        _autostartItem.Click += delegate { ToggleAutostart(); };
        menu.Items.Add(_autostartItem);

        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem quit = new ToolStripMenuItem("Quit GitHub Repo Manager");
        quit.Click += delegate { Quit(); };
        menu.Items.Add(quit);

        menu.Opening += delegate { _autostartItem.Checked = IsAutostartEnabled(); };

        _icon = new NotifyIcon();
        _icon.Icon = LoadAppIcon();
        _icon.Text = AppTooltip("Starting…");
        _icon.Visible = true;
        _icon.ContextMenuStrip = menu;
        _icon.DoubleClick += delegate { Program.OpenBrowser(Program.ReadPort(_dataDir)); };

        // Record this tray's PID so an update (installer /UPDATED or
        // apply-update.ps1) can stop it — a resident tray holds a lock that
        // blocks replacing the exe, and holds the single-instance mutex.
        WriteTrayPid();

        // Start the server off the UI thread so the icon is responsive
        // immediately; the completion callback opens the browser and shows the
        // balloon once the loop is running.
        ThreadPool.QueueUserWorkItem(delegate { StartServerWork(); });

        _healthTimer = new System.Threading.Timer(delegate { HealthTick(); }, null, 4000, 4000);
    }

    static string AppTooltip(string state) { return "GitHub Repo Manager — " + state; }

    Icon LoadAppIcon()
    {
        try
        {
            // The exe embeds bolalabs.ico via /win32icon at compile time, so its
            // own associated icon is the brand icon — no separate asset to ship.
            return Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }
        catch
        {
            return SystemIcons.Application;
        }
    }

    void WriteTrayPid()
    {
        try
        {
            Directory.CreateDirectory(_dataDir);
            File.WriteAllText(_trayPidPath,
                Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture));
        }
        catch { /* best effort — update fallbacks (taskkill by image) still work */ }
    }

    void RemoveTrayPid()
    {
        try { if (File.Exists(_trayPidPath)) File.Delete(_trayPidPath); }
        catch { /* best effort */ }
    }

    // Background: spawn the server, then marshal the browser-open + balloon +
    // first status onto the UI thread.
    void StartServerWork()
    {
        try
        {
            using (Process p = SpawnHidden("start.ps1")) { p.WaitForExit(); }
        }
        catch { /* first health tick will report "not responding" */ }

        _ui.Post(delegate
        {
            if (!_noBrowser) Program.OpenBrowser(Program.ReadPort(_dataDir));
            _icon.ShowBalloonTip(3000, "GitHub Repo Manager",
                "Running in the background — click the tray icon for options.",
                ToolTipIcon.Info);
        }, null);

        HealthTick();
    }

    Process SpawnHidden(string scriptName)
    {
        string script = Path.Combine(_root, scriptName);
        // Forward the resolved data dir so the server the tray manages uses the
        // exact same directory the tray reads for Open/Logs/port.
        string psArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "
            + Program.QuoteArg(script) + " -NoBrowser -DataDir " + Program.QuoteArg(_dataDir);

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = "powershell.exe";
        psi.Arguments = psArgs;
        psi.WorkingDirectory = _root;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        return Process.Start(psi);
    }

    // Background timer callback: the HTTP health probe runs here (off the UI
    // thread), and only the resulting label update is marshalled back.
    void HealthTick()
    {
        if (Interlocked.Exchange(ref _polling, 1) == 1) return;
        try
        {
            int port = Program.ReadPort(_dataDir);
            bool up = Program.IsHealthy(port);
            _ui.Post(delegate { UpdateStatusUi(up, port); }, null);
        }
        finally
        {
            Interlocked.Exchange(ref _polling, 0);
        }
    }

    void UpdateStatusUi(bool up, int port)
    {
        if (_busy) return;   // Restart owns the label while it runs
        string p = port.ToString(CultureInfo.InvariantCulture);
        _statusItem.Text = up ? "● Running on port " + p : "○ Not responding";
        _icon.Text = AppTooltip(up ? "Running on port " + p : "Not responding");
    }

    void OpenLogs()
    {
        try
        {
            string logs = Path.Combine(_dataDir, "logs");
            if (!Directory.Exists(logs)) logs = _dataDir;
            ProcessStartInfo psi = new ProcessStartInfo("explorer.exe", Program.QuoteArg(logs));
            psi.UseShellExecute = true;
            Process.Start(psi);
        }
        catch { /* best effort */ }
    }

    void Restart()
    {
        if (_busy) return;
        _busy = true;
        _statusItem.Text = "Restarting…";
        _icon.Text = AppTooltip("Restarting…");
        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                using (Process s = SpawnHidden("stop.ps1")) { s.WaitForExit(); }
                using (Process r = SpawnHidden("start.ps1")) { r.WaitForExit(); }
            }
            catch { /* health tick reports the resulting state */ }
            _ui.Post(delegate { _busy = false; HealthTick(); }, null);
        });
    }

    void Quit()
    {
        if (_busy) return;
        _busy = true;
        if (_healthTimer != null) { _healthTimer.Dispose(); _healthTimer = null; }
        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                using (Process s = SpawnHidden("stop.ps1")) { s.WaitForExit(); }
            }
            catch { /* exiting regardless */ }
            _ui.Post(delegate
            {
                RemoveTrayPid();
                _icon.Visible = false;
                _icon.Dispose();
                ExitThread();
            }, null);
        });
    }

    // Autostart via the HKCU Run key (self-contained, no COM shortcut).
    // start.ps1's single-instance guard, and the tray's own single-instance
    // mutex, keep it safe if the installer's optional {userstartup} shortcut
    // also exists — the second login launch just no-ops.
    bool IsAutostartEnabled()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(Program.RunKeyPath))
            {
                return key != null && key.GetValue(Program.RunValueName) != null;
            }
        }
        catch { return false; }
    }

    void ToggleAutostart()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(Program.RunKeyPath))
            {
                if (key == null) return;
                if (key.GetValue(Program.RunValueName) != null)
                {
                    key.DeleteValue(Program.RunValueName, false);
                }
                else
                {
                    key.SetValue(Program.RunValueName,
                        Program.QuoteArg(Application.ExecutablePath) + " --no-browser");
                }
            }
        }
        catch { /* best effort; menu re-reads state on next open */ }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (_healthTimer != null) { _healthTimer.Dispose(); _healthTimer = null; }
            RemoveTrayPid();
            if (_icon != null) { _icon.Visible = false; _icon.Dispose(); }
        }
        base.Dispose(disposing);
    }
}
