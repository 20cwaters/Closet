using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace Closet
{
    /// <summary>Runs Closet: starts the server and the cutout service, and lives in the tray.</summary>
    sealed class AppHost : ApplicationContext
    {
        const int DefaultPort = 8530;
        const int PortsToTry = 30;
        const int StartTimeoutMs = 90000;

        public static int Run()
        {
            bool first;
            using (var running = new Mutex(true, Instance.MutexName, out first))
            {
                if (!first)
                {
                    OpenRunningCopy();
                    return 0;
                }
                if (!File.Exists(Paths.Node))
                {
                    Dialogs.Problem("Some of Closet's files are missing. Download Closet again and open it to repair this.");
                    return 1;
                }
                using (var host = new AppHost()) Application.Run(host);
                GC.KeepAlive(running);
            }
            return 0;
        }

        static void OpenRunningCopy()
        {
            // No port yet means it's still starting, and it opens the browser itself when ready.
            if (File.Exists(Paths.Port)) OpenBrowser(int.Parse(File.ReadAllText(Paths.Port).Trim()));
        }

        static void OpenBrowser(int port)
        {
            if (Environment.GetEnvironmentVariable("CLOSET_NO_BROWSER") == "1") return;
            Process.Start("http://localhost:" + port);
        }

        readonly Control ui = new Control();
        readonly NotifyIcon tray = new NotifyIcon();
        readonly ProgressWindow window = new ProgressWindow("Starting Closet");
        readonly EventWaitHandle quitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Instance.QuitName);
        readonly IntPtr job = Native.CreateKillOnCloseJob();
        readonly Child server;
        readonly Child cutouts;
        PhoneWindow phoneWindow;
        int port;
        int cutoutPort;
        volatile bool up;
        volatile bool quitting;

        AppHost()
        {
            ui.CreateControl();
            var makeHandle = ui.Handle; // BeginInvoke needs it, before any window exists
            GC.KeepAlive(makeHandle);

            server = new Child("server", job, Path.Combine("dist", "index.js"), Path.Combine(Paths.App, "server"), ProcessPriorityClass.Normal);
            // Photos are worked on in the background, so the PC stays quick while they are.
            cutouts = new Child("cutouts", job, "server.mjs", Path.Combine(Paths.App, "cutouts"), ProcessPriorityClass.BelowNormal);
            server.Crashed += () => Recover(server, ServerEnvironment);
            cutouts.Crashed += () => Recover(cutouts, CutoutsEnvironment);

            tray.Icon = Theme.AppIcon(SystemInformation.SmallIconSize);
            tray.Text = "Closet";
            tray.ContextMenuStrip = BuildMenu();
            tray.DoubleClick += delegate { OpenBrowser(port); };

            ThreadPool.RegisterWaitForSingleObject(quitSignal, delegate { ui.BeginInvoke(new Action(Quit)); }, null, -1, true);

            window.FormClosed += delegate { if (window.Cancelled) Quit(); };
            window.Show();
            ThreadPool.QueueUserWorkItem(delegate { Start(); });
        }

        ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            var open = menu.Items.Add("Open Closet", null, delegate { OpenBrowser(port); });
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add("Use on your phone...", null, delegate { PhoneClicked(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open my closet's folder", null, delegate { Process.Start(Paths.Data); });
            menu.Items.Add("Show logs", null, delegate { Process.Start(Paths.Logs); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit Closet", null, delegate { Quit(); });
            return menu;
        }

        void Start()
        {
            try
            {
                bool firstTime = !File.Exists(Paths.Database);
                Settings.CreateIfMissing();
                port = FreePort(Settings.Port(DefaultPort));
                cutoutPort = FreePort(port + PortsToTry);
                cutouts.Start(CutoutsEnvironment());
                server.Start(ServerEnvironment());
                if (!WaitUntilUp()) throw new TimeoutException();
                up = true;
                File.WriteAllText(Paths.Port, port.ToString());

                ui.BeginInvoke(new Action(() =>
                {
                    window.Finish();
                    tray.Visible = true;
                    OpenBrowser(port);
                    if (firstTime)
                        tray.ShowBalloonTip(10000, "Closet is running",
                            "It keeps running here by the clock (you may need the ^ arrow to see it). Right-click its icon to quit or use it on your phone.",
                            ToolTipIcon.None);
                }));
            }
            catch (Exception e)
            {
                if (quitting) return;
                Trace.WriteLine(e);
                ui.BeginInvoke(new Action(() =>
                {
                    string why = e is TimeoutException ? "" : "\n\n" + e.Message;
                    if (Dialogs.Ask("Closet couldn't start." + why + "\n\nOpen the log files to see what happened?", MessageBoxIcon.Warning))
                        Process.Start(Paths.Logs);
                    Quit();
                }));
            }
        }

        bool WaitUntilUp()
        {
            var clock = Stopwatch.StartNew();
            while (clock.ElapsedMilliseconds < StartTimeoutMs)
            {
                if (quitting || server.GaveUp) return false;
                if (Healthy()) return true;
                Thread.Sleep(250);
            }
            return false;
        }

        bool Healthy()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                request.Proxy = null;
                request.Timeout = 5000;
                using (var response = (HttpWebResponse)request.GetResponse())
                    return response.StatusCode == HttpStatusCode.OK;
            }
            catch (WebException)
            {
                return false;
            }
        }

        static int FreePort(int from)
        {
            for (int candidate = from; candidate < from + PortsToTry; candidate++)
                if (PortFree(candidate)) return candidate;
            throw new InvalidOperationException("Every port Closet tried is in use.");
        }

        /// <summary>
        /// Binding alone isn't enough: Windows lets us bind 127.0.0.1 beside a program listening
        /// on every address, and then "localhost" in the browser reaches that program instead.
        /// So also ask whether anything answers where the browser will look. The bind is on
        /// loopback only, because listening more widely would set off the firewall prompt.
        /// </summary>
        static bool PortFree(int port)
        {
            if (Answers(IPAddress.Loopback, port) || Answers(IPAddress.IPv6Loopback, port)) return false;
            var probe = new TcpListener(IPAddress.Loopback, port);
            try
            {
                probe.Start();
                probe.Stop();
                return true;
            }
            catch (SocketException)
            {
                return false;
            }
        }

        /// <summary>A listener on this PC answers at once; a free port takes seconds to refuse.</summary>
        static bool Answers(IPAddress address, int port)
        {
            try
            {
                using (var client = new TcpClient(address.AddressFamily))
                    return client.BeginConnect(address, port, null, null).AsyncWaitHandle.WaitOne(100) && client.Connected;
            }
            catch (SocketException)
            {
                return false; // no IPv6 on this PC, say
            }
        }

        Dictionary<string, string> ServerEnvironment()
        {
            var env = Settings.Read();
            // A PC isn't a tablet in a closet: no idle reset, and let the screen sleep.
            if (!env.ContainsKey("KIOSK")) env["KIOSK"] = "0";
            env["PORT"] = port.ToString();
            env["HOST"] = File.Exists(Paths.PhonesOn) ? "0.0.0.0" : "127.0.0.1";
            env["DATA_DIR"] = Paths.Data;
            env["WEB_DIR"] = Path.Combine(Paths.App, "public");
            env["MIGRATIONS_DIR"] = Path.Combine(Paths.App, "server", "migrations");
            env["REMBG_URL"] = "http://127.0.0.1:" + cutoutPort;
            return env;
        }

        Dictionary<string, string> CutoutsEnvironment()
        {
            return new Dictionary<string, string>
            {
                { "PORT", cutoutPort.ToString() },
                { "CUTOUT_MODEL", Path.Combine(Paths.App, "cutouts", "isnet-general-use.onnx") },
            };
        }

        /// <summary>Quietly restart something that crashed, unless it keeps crashing.</summary>
        void Recover(Child child, Func<Dictionary<string, string>> environment)
        {
            if (quitting) return;
            Thread.Sleep(2000);
            if (quitting) return;
            if (!child.GaveUp)
            {
                child.Start(environment());
                return;
            }
            if (child == cutouts) return; // photos keep their backgrounds, and everything else works
            if (!up) return; // never got going: Start() is waiting for it, and reports that
            ui.BeginInvoke(new Action(() =>
            {
                if (Dialogs.Ask("Closet stopped working and couldn't restart.\n\nOpen the log files to see what happened?", MessageBoxIcon.Warning))
                    Process.Start(Paths.Logs);
                Quit();
            }));
        }

        void PhoneClicked()
        {
            if (File.Exists(Paths.PhonesOn))
            {
                ShowPhoneWindow();
                return;
            }
            bool yes = Dialogs.Ask(
                "Open Closet from phones and tablets on your Wi-Fi?\n\n" +
                "Closet has no passwords, so anyone on the same network could open it. Do this on your home Wi-Fi, not a public one.\n\n" +
                "Windows may ask about its firewall next: tick \"Private networks\" and choose Allow.",
                MessageBoxIcon.Question);
            if (yes) SetPhones(true);
        }

        void SetPhones(bool on)
        {
            if (on) File.WriteAllText(Paths.PhonesOn, "");
            else File.Delete(Paths.PhonesOn);
            ThreadPool.QueueUserWorkItem(delegate
            {
                server.Stop();
                server.Start(ServerEnvironment());
                WaitUntilUp();
                if (on) ui.BeginInvoke(new Action(ShowPhoneWindow));
            });
        }

        void ShowPhoneWindow()
        {
            if (phoneWindow != null)
            {
                phoneWindow.Activate();
                return;
            }
            phoneWindow = new PhoneWindow(LanAddresses().Select(a => "http://" + a + ":" + port).ToList());
            phoneWindow.StopSharing += delegate { SetPhones(false); };
            phoneWindow.FormClosed += delegate { phoneWindow = null; };
            phoneWindow.Show();
        }

        /// <summary>This PC's addresses on real networks. Virtual adapters have no gateway.</summary>
        static IEnumerable<string> LanAddresses()
        {
            return from nic in NetworkInterface.GetAllNetworkInterfaces()
                   where nic.OperationalStatus == OperationalStatus.Up
                         && nic.NetworkInterfaceType != NetworkInterfaceType.Loopback
                   let properties = nic.GetIPProperties()
                   where properties.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork
                                                              && !g.Address.Equals(IPAddress.Any))
                   from unicast in properties.UnicastAddresses
                   where unicast.Address.AddressFamily == AddressFamily.InterNetwork
                   select unicast.Address.ToString();
        }

        void Quit()
        {
            if (quitting) return;
            quitting = true;
            tray.Visible = false;
            if (phoneWindow != null) phoneWindow.Close();
            server.Stop();
            cutouts.Stop();
            if (File.Exists(Paths.Port)) File.Delete(Paths.Port);
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) tray.Dispose();
            base.Dispose(disposing);
        }
    }

    /// <summary>One bundled-Node process, with its output going to a log file.</summary>
    sealed class Child
    {
        const int MaxCrashes = 3;
        static readonly TimeSpan CrashWindow = TimeSpan.FromMinutes(2);

        readonly string name;
        readonly IntPtr job;
        readonly string script;
        readonly string folder;
        readonly ProcessPriorityClass priority;
        readonly StreamWriter log;
        readonly Queue<DateTime> crashes = new Queue<DateTime>();
        Process process;
        volatile bool stopping;

        public event Action Crashed;

        public Child(string name, IntPtr job, string script, string folder, ProcessPriorityClass priority)
        {
            this.name = name;
            this.job = job;
            this.script = script;
            this.folder = folder;
            this.priority = priority;
            Directory.CreateDirectory(Paths.Logs);
            string path = Path.Combine(Paths.Logs, name + ".log");
            if (File.Exists(path)) File.Copy(path, Path.Combine(Paths.Logs, name + ".previous.log"), true);
            log = new StreamWriter(new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
        }

        /// <summary>True once it has crashed too often to be worth restarting.</summary>
        public bool GaveUp
        {
            get { lock (crashes) return crashes.Count >= MaxCrashes; }
        }

        public void Start(Dictionary<string, string> environment)
        {
            var info = new ProcessStartInfo(Paths.Node, "\"" + script + "\"")
            {
                WorkingDirectory = folder,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            // Someone's developer settings shouldn't change how the app runs.
            info.EnvironmentVariables.Remove("NODE_OPTIONS");
            info.EnvironmentVariables.Remove("NODE_PATH");
            foreach (var pair in environment) info.EnvironmentVariables[pair.Key] = pair.Value;

            var started = new Process { StartInfo = info, EnableRaisingEvents = true };
            started.OutputDataReceived += (sender, line) => Log(line.Data);
            started.ErrorDataReceived += (sender, line) => Log(line.Data);
            started.Exited += delegate { OnExit(started); };
            process = started; // first, so a late exit from the last one can't look like a crash
            stopping = false;
            started.Start();
            Native.AddToJob(job, started);
            started.PriorityClass = priority;
            started.BeginOutputReadLine();
            started.BeginErrorReadLine();
        }

        public void Stop()
        {
            stopping = true;
            var running = process;
            if (running == null) return;
            try
            {
                if (!running.HasExited)
                {
                    running.Kill();
                    running.WaitForExit(5000);
                }
            }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }

        void OnExit(Process exited)
        {
            if (stopping || exited != process) return;
            Log(name + " stopped unexpectedly (exit code " + exited.ExitCode + ")");
            lock (crashes)
            {
                crashes.Enqueue(DateTime.UtcNow);
                while (crashes.Count > 0 && DateTime.UtcNow - crashes.Peek() > CrashWindow) crashes.Dequeue();
            }
            var handler = Crashed;
            if (handler != null) handler();
        }

        void Log(string line)
        {
            if (line == null) return;
            lock (log) log.WriteLine(line);
        }
    }

    /// <summary>
    /// settings.env, for the few things the app itself doesn't offer: API keys for the optional
    /// extras. Same names as the Docker setup's .env.
    /// </summary>
    static class Settings
    {
        const string Template =
            "# Closet's advanced settings. Most people never need this file.\r\n" +
            "# To use one, remove the # at the start of its line and fill it in, then quit Closet and open it again.\r\n" +
            "# What each one does: https://github.com/20cwaters/Closet#settings-env\r\n" +
            "\r\n" +
            "# \"Make it perfect\": AI product shots of each piece (openrouter.ai key).\r\n" +
            "#OPENROUTER_API_KEY=\r\n" +
            "\r\n" +
            "# Music from Spotify.\r\n" +
            "#SPOTIFY_CLIENT_ID=\r\n" +
            "#SPOTIFY_CLIENT_SECRET=\r\n" +
            "#SPOTIFY_REDIRECT_URI=\r\n" +
            "\r\n" +
            "# The port Closet tries first.\r\n" +
            "#PORT=8530\r\n" +
            "\r\n" +
            "# 1 makes large screens act like a tablet in the closet: back to the profiles\r\n" +
            "# after IDLE_TIMEOUT_SECONDS untouched, and the screen kept on.\r\n" +
            "#KIOSK=1\r\n" +
            "#IDLE_TIMEOUT_SECONDS=90\r\n";

        public static void CreateIfMissing()
        {
            Directory.CreateDirectory(Paths.Data);
            if (!File.Exists(Paths.Settings)) File.WriteAllText(Paths.Settings, Template);
        }

        public static Dictionary<string, string> Read()
        {
            var values = new Dictionary<string, string>();
            foreach (string raw in File.ReadAllLines(Paths.Settings))
            {
                string line = raw.Trim();
                int equals = line.IndexOf('=');
                if (line.StartsWith("#") || equals < 1) continue;
                string value = line.Substring(equals + 1).Trim();
                if (value != "") values[line.Substring(0, equals).Trim()] = value;
            }
            return values;
        }

        public static int Port(int fallback)
        {
            string text;
            int port;
            return Read().TryGetValue("PORT", out text) && int.TryParse(text, out port) && port > 0 && port < 65000 ? port : fallback;
        }
    }
}
