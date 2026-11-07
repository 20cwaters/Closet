// Closet for Windows: one double-click, no admin rights, nothing to install first.
//
// This source builds two programs. The small one runs the app: it starts the server, sits in
// the tray and stops everything on Quit. The big one (what people download, Closet.exe) is the
// same code with the whole app embedded as payload.zip: it unpacks that into the user's folder
// and hands over to the small one, so the download can be deleted afterwards.
//
// Written in C# 5 for the csc.exe that ships with Windows, so building needs no SDK and
// running needs only the .NET Framework that every Windows 10 and 11 PC already has.
using System;
using System.Linq;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Closet")]
[assembly: AssemblyProduct("Closet")]
[assembly: AssemblyDescription("Your wardrobe and outfits")]
[assembly: AssemblyInformationalVersion(Closet.BuildInfo.Version)]

namespace Closet
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                if (args.Contains("--uninstall")) return Uninstaller.Run(args.Contains("--yes"));
                if (Installer.HasPayload) return Installer.Run();
                return AppHost.Run();
            }
            catch (Exception e)
            {
                Dialogs.Problem("Something went wrong.\n\n" + e.Message);
                return 1;
            }
        }
    }

    /// <summary>Everything lives in one per-user folder, which is why no admin rights are needed.</summary>
    static class Paths
    {
        static readonly string Override = Environment.GetEnvironmentVariable("CLOSET_HOME");

        /// <summary>A trial install in another folder (CLOSET_HOME) leaves the rest of the PC alone.</summary>
        public static readonly bool Sandboxed = !string.IsNullOrEmpty(Override);

        public static readonly string Root = Sandboxed
            ? Path.GetFullPath(Override)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Closet");

        public static readonly string App = Path.Combine(Root, "app");
        public static readonly string Exe = Path.Combine(App, "Closet.exe");
        public static readonly string Build = Path.Combine(App, "build.txt");
        public static readonly string Node = Path.Combine(App, "node.exe");
        public static readonly string Data = Path.Combine(Root, "data");
        public static readonly string Database = Path.Combine(Data, "closet.db");
        public static readonly string Logs = Path.Combine(Root, "logs");
        public static readonly string Settings = Path.Combine(Root, "settings.env");
        public static readonly string Port = Path.Combine(Root, "port.txt");
        public static readonly string PhonesOn = Path.Combine(Root, "phones-on");
    }

    /// <summary>Keeps it to one running copy, and lets an update or uninstall ask it to stop.</summary>
    static class Instance
    {
        static readonly string Scope = Paths.Root.ToLowerInvariant().Replace('\\', '-').Replace(':', '-');
        public static readonly string MutexName = @"Local\Closet-running-" + Scope;
        public static readonly string QuitName = @"Local\Closet-quit-" + Scope;

        public static void StopRunningCopy()
        {
            EventWaitHandle quit;
            if (!EventWaitHandle.TryOpenExisting(QuitName, out quit)) return;
            using (quit) quit.Set();
            using (var running = new Mutex(false, MutexName))
            {
                try
                {
                    if (!running.WaitOne(30000)) throw new TimeoutException("Closet didn't close. Quit it from its icon by the clock, then try again.");
                    running.ReleaseMutex();
                }
                catch (AbandonedMutexException)
                {
                    // It stopped without saying goodbye, which is just as stopped.
                }
            }
        }
    }

    static class Dialogs
    {
        public static void Problem(string message)
        {
            MessageBox.Show(message, "Closet", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        public static bool Ask(string question, MessageBoxIcon icon)
        {
            return MessageBox.Show(question, "Closet", MessageBoxButtons.YesNo, icon, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        }
    }
}
