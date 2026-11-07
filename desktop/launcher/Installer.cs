using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Closet
{
    /// <summary>A problem the person can do something about: shown as is, without a stack of detail.</summary>
    sealed class SetupProblem : Exception
    {
        public SetupProblem(string message) : base(message) { }
    }

    static class Installer
    {
        const string Payload = "payload.zip";
        const double Gigabyte = 1024L * 1024 * 1024;

        public static bool HasPayload
        {
            get { return Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains(Payload); }
        }

        public static int Run()
        {
            if (CurrentOrNewerInstalled())
            {
                Launch();
                return 0;
            }

            Exception failure = null;
            var window = new ProgressWindow("Setting up Closet");
            window.Shown += delegate
            {
                var worker = new Thread(() =>
                {
                    try { Install(window); }
                    catch (Exception e) { failure = e; }
                    window.Finish();
                });
                worker.IsBackground = true;
                worker.Start();
            };
            Application.Run(window);

            if (failure is OperationCanceledException) return 0;
            if (failure != null)
            {
                Dialogs.Problem(failure is SetupProblem ? failure.Message : "Closet couldn't be set up.\n\n" + failure.Message);
                return 1;
            }
            Launch();
            return 0;
        }

        /// <summary>Build ids are timestamps, so an old download never replaces a newer install.</summary>
        static bool CurrentOrNewerInstalled()
        {
            if (!File.Exists(Paths.Exe) || !File.Exists(Paths.Build)) return false;
            return string.CompareOrdinal(File.ReadAllText(Paths.Build).Trim(), BuildInfo.Id) >= 0;
        }

        static void Launch()
        {
            Process.Start(new ProcessStartInfo(Paths.Exe) { UseShellExecute = true });
        }

        /// <summary>
        /// Unpacks straight into place: antivirus keeps new files open long enough to block
        /// renaming their folder afterwards. build.txt goes in last, so a half-unpacked app
        /// never counts as installed and opening the download again finishes the job.
        /// </summary>
        static void Install(ProgressWindow window)
        {
            using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream(Payload))
            using (var zip = new ZipArchive(resource, ZipArchiveMode.Read))
            {
                window.Show("Checking your PC", null);
                long size = zip.Entries.Sum(e => e.Length);
                CheckThisPc(size);

                Directory.CreateDirectory(Paths.Root);
                window.Show("Closing the running copy", null);
                Instance.StopRunningCopy();

                DeleteFolder(Paths.App);
                Unpack(zip, size, Paths.App, window);
            }

            window.Show("Finishing up", null);
            File.WriteAllText(Paths.Build, BuildInfo.Id);
            Shell.Add();
        }

        static void CheckThisPc(long size)
        {
            if (Environment.OSVersion.Version.Major < 10)
                throw new SetupProblem("Closet needs Windows 10 or newer.");
            if (!Environment.Is64BitOperatingSystem)
                throw new SetupProblem("Closet needs a 64-bit version of Windows.");

            // Room for the app, plus some for the first photos.
            double needed = (size + Gigabyte / 2) / Gigabyte;
            var drive = new DriveInfo(Path.GetPathRoot(Paths.Root));
            double free = drive.AvailableFreeSpace / Gigabyte;
            if (free < needed)
                throw new SetupProblem(string.Format(
                    "Closet needs about {0:0.0} GB free on drive {1}, and only {2:0.0} GB is free.\n\nFree up some space, then open Closet again.",
                    needed, drive.Name, free));

            double memory = new Microsoft.VisualBasic.Devices.ComputerInfo().TotalPhysicalMemory / Gigabyte;
            if (memory < 3.5)
                MessageBox.Show(
                    string.Format("This PC has {0:0.#} GB of memory. Closet will work, but removing the background from a photo needs about 1 GB free, so that part may be slow.", memory),
                    "Closet", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        static void Unpack(ZipArchive zip, long size, string target, ProgressWindow window)
        {
            var buffer = new byte[1 << 20];
            long done = 0;
            foreach (var entry in zip.Entries)
            {
                // .NET Framework's zip writer separates folders with backslashes.
                string name = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                string path = Path.Combine(target, name);
                if (name.EndsWith(Path.DirectorySeparatorChar.ToString()))
                {
                    Directory.CreateDirectory(path);
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                using (var from = entry.Open())
                using (var to = File.Create(path))
                {
                    int read;
                    while ((read = from.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        if (window.Cancelled) throw new OperationCanceledException();
                        to.Write(buffer, 0, read);
                        done += read;
                        window.Show("Unpacking. This only happens once.", (double)done / size);
                    }
                }
            }
        }

        public static void DeleteFolder(string path)
        {
            if (Directory.Exists(path)) Retry(() => Directory.Delete(path, true));
        }

        /// <summary>Antivirus often holds a brand-new file for a moment.</summary>
        static void Retry(Action action)
        {
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    action();
                    return;
                }
                catch (Exception e)
                {
                    if (attempt == 20 || !(e is IOException || e is UnauthorizedAccessException)) throw;
                    Thread.Sleep(500);
                }
            }
        }
    }

    /// <summary>The Desktop and Start menu shortcuts, and the entry in Settings > Apps.</summary>
    static class Shell
    {
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Closet";

        static string[] Shortcuts
        {
            get
            {
                return new[]
                {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Closet.lnk"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Closet.lnk"),
                };
            }
        }

        public static void Add()
        {
            if (Paths.Sandboxed) return;
            // Handy rather than essential: never let these stop Closet from opening.
            try
            {
                dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                foreach (string path in Shortcuts)
                {
                    dynamic link = shell.CreateShortcut(path);
                    link.TargetPath = Paths.Exe;
                    link.WorkingDirectory = Paths.App;
                    link.Description = "Your wardrobe and outfits";
                    link.Save();
                }
                using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
                {
                    key.SetValue("DisplayName", "Closet");
                    key.SetValue("DisplayVersion", BuildInfo.Version);
                    key.SetValue("DisplayIcon", Paths.Exe);
                    key.SetValue("InstallLocation", Paths.Root);
                    key.SetValue("UninstallString", "\"" + Paths.Exe + "\" --uninstall");
                    key.SetValue("NoModify", 1);
                    key.SetValue("NoRepair", 1);
                }
            }
            catch (Exception e)
            {
                Trace.WriteLine(e);
            }
        }

        public static void Remove()
        {
            if (Paths.Sandboxed) return;
            foreach (string path in Shortcuts) File.Delete(path);
            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
        }
    }

    static class Uninstaller
    {
        public static int Run(bool quiet)
        {
            bool deleteData = false;
            if (!quiet)
            {
                if (!Dialogs.Ask("Remove Closet from this PC?", MessageBoxIcon.Question)) return 0;
                deleteData = Directory.Exists(Paths.Data) && Dialogs.Ask(
                    "Delete your clothes, outfits and photos too?\n\nThis can't be undone. Choose No to keep them for next time, in:\n" + Paths.Data,
                    MessageBoxIcon.Warning);
            }

            Instance.StopRunningCopy();
            Shell.Remove();

            // This program lives in the folder being removed, so cmd finishes up once it's gone.
            string steps = "ping -n 3 127.0.0.1 >nul";
            if (deleteData) steps += string.Format(" & rmdir /s /q \"{0}\"", Paths.Root);
            else
            {
                steps += string.Format(" & rmdir /s /q \"{0}\" & rmdir /s /q \"{1}\"", Paths.App, Paths.Logs);
                steps += string.Format(" & del /q \"{0}\" \"{1}\"", Paths.Port, Paths.PhonesOn);
                steps += string.Format(" & rmdir \"{0}\"", Paths.Root); // only if nothing's left
            }
            var cleanUp = new ProcessStartInfo("cmd.exe", "/c \"" + steps + "\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                WorkingDirectory = Path.GetTempPath(),
            };
            Process.Start(cleanUp);
            return 0;
        }
    }
}
