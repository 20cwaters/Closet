using System;
using System.Collections.Generic;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Closet
{
    /// <summary>The app's colours (web/src/styles/tokens.css), so these windows feel like part of it.</summary>
    static class Theme
    {
        public static readonly Color Paper = ColorTranslator.FromHtml("#f2f3f1");
        public static readonly Color Stage = ColorTranslator.FromHtml("#e6e8e5");
        public static readonly Color Ink = ColorTranslator.FromHtml("#191b1a");
        public static readonly Color Muted = ColorTranslator.FromHtml("#6a706c");

        public static Icon AppIcon(Size size)
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("closet.ico"))
                return new Icon(stream, size);
        }

        public static void Style(Form form, int width, int height)
        {
            form.Text = "Closet";
            form.Icon = AppIcon(new Size(32, 32));
            form.BackColor = Paper;
            form.ForeColor = Ink;
            form.Font = new Font("Segoe UI", 10f);
            form.FormBorderStyle = FormBorderStyle.FixedSingle;
            form.MaximizeBox = false;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.AutoScaleMode = AutoScaleMode.Dpi;
            form.AutoScaleDimensions = new SizeF(96f, 96f);
            form.ClientSize = new Size(width, height);
        }

        public static Label Heading(string text)
        {
            return new Label { Text = text, Font = new Font("Georgia", 19f), AutoSize = false };
        }
    }

    /// <summary>A thin bar: how far along, or a sliding block while there's no telling.</summary>
    sealed class Bar : Control
    {
        const int Block = 90;
        readonly Timer animation = new Timer { Interval = 30 };
        double? fraction;

        public Bar()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Theme.Stage;
            animation.Tick += delegate { Invalidate(); };
            animation.Start();
        }

        public double? Fraction
        {
            set
            {
                fraction = value;
                animation.Enabled = value == null;
                Invalidate();
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            using (var ink = new SolidBrush(Theme.Ink))
            {
                if (fraction != null)
                {
                    e.Graphics.FillRectangle(ink, 0, 0, (int)(Width * fraction.Value), Height);
                }
                else
                {
                    int travel = Width + Block;
                    e.Graphics.FillRectangle(ink, Environment.TickCount / 3 % travel - Block, 0, Block, Height);
                }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) animation.Dispose();
            base.Dispose(disposing);
        }
    }

    /// <summary>"Setting up" and "Starting": a title, a line of status, and a bar.</summary>
    sealed class ProgressWindow : Form
    {
        readonly Label status = new Label { ForeColor = Theme.Muted, AutoSize = false };
        readonly Bar bar = new Bar();
        bool finished;

        public ProgressWindow(string title)
        {
            Theme.Style(this, 420, 138);
            MinimizeBox = true;
            var heading = Theme.Heading(title);
            heading.SetBounds(24, 20, 372, 40);
            status.SetBounds(26, 66, 370, 24);
            bar.SetBounds(26, 102, 368, 4);
            status.Text = "One moment";
            Controls.AddRange(new Control[] { heading, status, bar });
        }

        /// <summary>Closing the window asks whatever's running to stop.</summary>
        public bool Cancelled { get; private set; }

        /// <summary>Safe from any thread.</summary>
        public void Show(string text, double? fraction)
        {
            if (!IsHandleCreated || IsDisposed) return;
            BeginInvoke(new Action(() =>
            {
                status.Text = text;
                bar.Fraction = fraction;
            }));
        }

        /// <summary>Safe from any thread.</summary>
        public void Finish()
        {
            if (!IsHandleCreated || IsDisposed) return;
            BeginInvoke(new Action(() =>
            {
                finished = true;
                Close();
            }));
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!finished) Cancelled = true;
            base.OnFormClosing(e);
        }
    }

    /// <summary>Where to point a phone's browser.</summary>
    sealed class PhoneWindow : Form
    {
        public event Action StopSharing;

        public PhoneWindow(List<string> addresses)
        {
            Theme.Style(this, 460, 268);
            MinimizeBox = false;
            var heading = Theme.Heading("Use Closet on your phone");
            heading.SetBounds(24, 20, 412, 40);

            bool found = addresses.Count > 0;
            var steps = new Label
            {
                AutoSize = false,
                Text = found
                    ? "Connect your phone to the same Wi-Fi as this PC, then type this into its browser:"
                    : "This PC doesn't seem to be on a network right now. Connect it to your Wi-Fi, then open this window again.",
            };
            steps.SetBounds(26, 66, 410, 46);
            Controls.AddRange(new Control[] { heading, steps });

            if (found)
            {
                var address = new TextBox
                {
                    Text = addresses[0],
                    ReadOnly = true,
                    BorderStyle = BorderStyle.None,
                    BackColor = Theme.Paper,
                    Font = new Font("Segoe UI Semibold", 15f),
                };
                address.SetBounds(26, 118, 410, 34);
                Controls.Add(address);

                var note = new Label
                {
                    AutoSize = false,
                    ForeColor = Theme.Muted,
                    Font = new Font("Segoe UI", 9f),
                    Text = "Your phone can reach Closet while this PC is on and Closet is running.",
                };
                note.SetBounds(26, 160, 410, 40);
                Controls.Add(note);

                var copy = PlainButton("Copy address", Theme.Ink, Theme.Paper);
                copy.SetBounds(26, 214, 130, 36);
                copy.Click += delegate
                {
                    Clipboard.SetText(address.Text);
                    copy.Text = "Copied";
                };
                Controls.Add(copy);
                ActiveControl = copy; // or the address opens selected
            }

            var stop = PlainButton("Stop sharing", Theme.Stage, Theme.Ink);
            stop.SetBounds(found ? 166 : 26, 214, 130, 36);
            stop.Click += delegate
            {
                var handler = StopSharing;
                if (handler != null) handler();
                Close();
            };
            Controls.Add(stop);
        }

        static Button PlainButton(string text, Color background, Color foreground)
        {
            var button = new Button { Text = text, FlatStyle = FlatStyle.Flat, BackColor = background, ForeColor = foreground };
            button.FlatAppearance.BorderSize = 0;
            return button;
        }
    }

    /// <summary>Windows job objects: our processes end with us, even if we're killed or crash.</summary>
    static class Native
    {
        const uint KillOnJobClose = 0x2000;
        const int ExtendedLimitInformation = 9;

        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimits
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters
        {
            public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimits
        {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int size);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        public static IntPtr CreateKillOnCloseJob()
        {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            var limits = new ExtendedLimits();
            limits.Basic.LimitFlags = KillOnJobClose;
            SetInformationJobObject(job, ExtendedLimitInformation, ref limits, Marshal.SizeOf(typeof(ExtendedLimits)));
            return job;
        }

        public static void AddToJob(IntPtr job, System.Diagnostics.Process process)
        {
            AssignProcessToJobObject(job, process.Handle);
        }
    }
}
