using System.Diagnostics;
using System.Xml.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using AgentControl.Core;
using Path = Avalonia.Controls.Shapes.Path;

namespace AgentControl.Ui;

/// <summary>
/// Kit visual do Agent Control: tokens clamoryst escuro (marca: hexágono laranja, olhos em pílula),
/// fontes da marca embutidas (Sora, Instrument Sans, JetBrains Mono: iguais em Windows, Linux e macOS),
/// ícones vetoriais próprios e o movimento do app (anime.js: outExpo, entrada escalonada, mola).
/// </summary>
public static class K
{
    public static Color C(string h) => Color.Parse(h);
    static SolidColorBrush B(string h) => new(C(h));

    public static readonly IBrush Bg = B("#090909"), Surface = B("#111111"), Raised = B("#181818"), Line = B("#252525"), LineHi = B("#333333"), Side = B("#0C0C0C");
    public static readonly IBrush Text = B("#F5F5F5"), Text2 = B("#E4E4E7"), Muted = B("#A1A1AA"), Faint = B("#71717A");
    public static readonly IBrush Brand = B("#F97316"), BrandHi = B("#FB8A3C"), BrandText = B("#FDBA74"), BrandSoft = B("#1A120C"), OnBrand = B("#0A0A0A");
    public static readonly IBrush Ok = B("#22C55E"), Warn = B("#F59E0B"), Err = B("#EF4444");

    /// <summary>Fontes da marca embutidas (o Windows publica como JarvisLauncher.exe, Linux/macOS como AgentControl).</summary>
    static readonly string Fonts = Program.Res + "Fonts#";
    public static readonly FontFamily Ui = new(Fonts + "Instrument Sans");
    public static readonly FontFamily Display = new(Fonts + "Sora");
    public static readonly FontFamily Mono = new(Fonts + "JetBrains Mono");

    public static BoxShadows Shadow(double blur = 28, double y = 4, double alpha = .55) => new(new BoxShadow { Blur = blur, OffsetY = y, Color = Color.FromArgb((byte)(alpha * 255), 0, 0, 0) });

    // ---------------- ícones (traço 2 px numa caixa 24×24; "F:" = preenchido) ----------------
    public const string IHome = "M3 11 12 4l9 7 M5 10v10h5v-6h4v6h5V10", IChat = "M4 5h16v11H9l-5 4z",
        IPhone = "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z",
        IGoal = "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 11.6v.8", IHealth = "M3 12h4l3-7 4 14 3-7h4",
        IMic = "M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 11a7 7 0 0 0 14 0 M12 18v3", ISend = "M4 12 20 4l-6 16-3-7z M11 13l9-9",
        IPlay = "F:M7 4v16l13-8z", IPause = "F:M6 4h4v16H6z M14 4h4v16h-4z", IClose = "M6 6l12 12 M18 6 6 18", IOpen = "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
        IWarn = "M12 3 2 20h20z M12 9v5 M12 17v.5", ICheck = "M5 12.5l4.5 4.5L19 7", IStop = "F:M6 6h12v12H6z", IUp = "M6 15l6-6 6 6", IDown = "M6 9l6 6 6-6",
        IPeople = "M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 14.5a6 6 0 0 1 3.5 5.5",
        IHide = "M3 3l18 18 M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.6 3.2 M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a8.7 8.7 0 0 0 4.4-1.2 M9.9 9.9a3 3 0 0 0 4.2 4.2",
        IUsage = "M5 20V12 M12 20V5 M19 20v-9", ISettings = "M4 7h10 M18 7h2 M16 5v4 M4 17h4 M12 17h8 M10 15v4", IPower = "M12 3v8 M6.3 6.8a8 8 0 1 0 11.4 0",
        IFolder = "M3 6h6l2 2h10v11H3z", IFile = "M6 3h8l4 4v14H6z M14 3v4h4", IRefresh = "M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7",
        IApps = "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z", IBook = "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11",
        ILogs = "M9 6h11 M9 12h11 M9 18h11 M4 6h1 M4 12h1 M4 18h1", IChip = "M7 7h10v10H7z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4",
        IAdd = "M12 5v14 M5 12h14", IShield = "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", ITerminal = "M4 5h16v14H4z M8 10l3 2-3 2 M13 15h3", IMore = "F:M5 10.5h3v3H5z M10.5 10.5h3v3h-3z M16 10.5h3v3h-3z";

    /// <summary>Ícone vetorial (cor trocável depois por <see cref="Ico.Color"/>).</summary>
    public static Ico Icon(string data, double size = 15, IBrush? c = null) => new(data, size, c ?? Text);

    public sealed class Ico : Viewbox
    {
        readonly Path path;
        readonly bool filled;
        public Ico(string data, double size, IBrush color)
        {
            filled = data.StartsWith("F:");
            path = new Path { Data = Geometry.Parse(filled ? data[2..] : data), StrokeThickness = filled ? 0 : 2, StrokeLineCap = PenLineCap.Round, StrokeJoin = PenLineJoin.Round };
            Width = size; Height = size; Stretch = Stretch.Uniform; VerticalAlignment = VerticalAlignment.Center; HorizontalAlignment = HorizontalAlignment.Center;
            Child = new Canvas { Width = 24, Height = 24, Children = { path } };
            Color = color;
        }
        public IBrush Color { set { if (filled) path.Fill = value; else path.Stroke = value; } }
    }

    // ---------------- movimento ----------------
    public static readonly bool Reduced = Platform.ReducedMotion();
    public static double OutExpo(double t) => t >= 1 ? 1 : 1 - Math.Pow(2, -10 * t);
    /// <summary>Mola curta (passa um pouco do ponto e volta), igual ao BackEase 0,45 do WPF.</summary>
    public static double Spring(double t) { var u = 1 - t; return 1 - (u * u * u - u * .45 * Math.Sin(Math.PI * u)); }
    public static double InQuad(double t) => t * t;
    public static double Sine(double t) => -(Math.Cos(Math.PI * t) - 1) / 2;

    sealed class Job { public required Action<double> Set; public double From, To; public double Ms; public required Func<double, double> Ease; public long Start; public Action? Done; public bool Started; public Func<double>? Get; }
    static readonly Dictionary<(object, string), Job> jobs = [];
    static readonly Stopwatch clock = Stopwatch.StartNew();
    static DispatcherTimer? ticker;

    /// <summary>
    /// Anima um valor (qualquer propriedade, por get/set). Uma animação nova no mesmo alvo+chave substitui a anterior,
    /// como o BeginAnimation do WPF. Com "reduzir animações" ligado, pula direto para o fim.
    /// </summary>
    public static void Anim(object target, string key, Func<double> get, Action<double> set, double to, int ms, Func<double, double>? ease = null, double? from = null, int delay = 0, Action? done = null)
    {
        if (Reduced || ms <= 0 && delay <= 0) { jobs.Remove((target, key)); set(to); done?.Invoke(); return; }
        if (from is { } f) set(f);
        jobs[(target, key)] = new Job { Set = set, Get = from is null ? get : null, From = from ?? 0, To = to, Ms = Math.Max(1, ms), Ease = ease ?? OutExpo, Start = clock.ElapsedMilliseconds + delay, Done = done };
        if (ticker is null) { ticker = new DispatcherTimer(TimeSpan.FromMilliseconds(15), DispatcherPriority.Render, (_, _) => Tick()); }
        ticker.Start();
    }

    public static void Stop(object target, string key) => jobs.Remove((target, key));

    static void Tick()
    {
        var now = clock.ElapsedMilliseconds;
        foreach (var (k, j) in jobs.ToList())
        {
            if (now < j.Start) continue;
            if (!j.Started) { j.Started = true; if (j.Get is not null) j.From = j.Get(); }
            var t = Math.Clamp((now - j.Start) / j.Ms, 0, 1);
            j.Set(j.From + (j.To - j.From) * j.Ease(t));
            if (t >= 1) { if (jobs.TryGetValue(k, out var cur) && cur == j) jobs.Remove(k); j.Done?.Invoke(); }
        }
        if (jobs.Count == 0) ticker?.Stop();
    }

    public static void Fade(Visual v, double to, int ms, Func<double, double>? ease = null, double? from = null, int delay = 0, Action? done = null) =>
        Anim(v, "op", () => v.Opacity, x => v.Opacity = x, to, ms, ease, from, delay, done);

    public static void AnimColor(SolidColorBrush b, Color to, int ms = 180)
    {
        var from = b.Color;
        Anim(b, "color", () => 0, t => b.Color = Lerp(from, to, t), 1, ms, OutExpo, 0);
    }

    static Color Lerp(Color a, Color b, double t) => Color.FromArgb((byte)(a.A + (b.A - a.A) * t), (byte)(a.R + (b.R - a.R) * t), (byte)(a.G + (b.G - a.G) * t), (byte)(a.B + (b.B - a.B) * t));

    public static TranslateTransform Shift(Visual el)
    {
        if (el.RenderTransform is TranslateTransform t) return t;
        var n = new TranslateTransform(); el.RenderTransform = n; return n;
    }

    public static ScaleTransform Scale(Visual el)
    {
        if (el.RenderTransform is ScaleTransform s) return s;
        el.RenderTransformOrigin = RelativePoint.Center;
        var n = new ScaleTransform(1, 1); el.RenderTransform = n; return n;
    }

    /// <summary>Entrada escalonada: sobe [dy] px e aparece, [delay] ms depois.</summary>
    public static void EnterUp(Visual el, int delay = 0, double dy = 12)
    {
        var t = Shift(el);
        Fade(el, 1, 420, OutExpo, 0, delay);
        Anim(t, "y", () => t.Y, y => t.Y = y, 0, 560, OutExpo, dy, delay);
    }

    /// <summary>Pisca contínuo (anel de quem está trabalhando).</summary>
    public static void Pulse(Visual el, double low = .3, int ms = 900)
    {
        if (Reduced) return;
        var on = false;
        void Go(bool down) { if (on) Anim(el, "pulse", () => el.Opacity, x => el.Opacity = x, down ? low : 1, ms, Sine, done: () => Go(!down)); }
        el.AttachedToVisualTree += (_, _) => { on = true; Go(true); };
        el.DetachedFromVisualTree += (_, _) => { on = false; Stop(el, "pulse"); };
    }

    // ---------------- peças ----------------
    public static TextBlock T(string s, double size = 13, IBrush? c = null, FontWeight w = FontWeight.Normal, FontFamily? f = null) =>
        new() { Text = s, FontSize = size, Foreground = c ?? Text, FontWeight = w, FontFamily = f ?? Ui, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };

    public static TextBlock Wrap(string s, double size = 13, IBrush? c = null, int maxLines = 0, double lineHeight = double.NaN, FontWeight w = FontWeight.Normal, FontFamily? f = null) =>
        new() { Text = s, FontSize = size, Foreground = c ?? Text, FontWeight = w, FontFamily = f ?? Ui, TextWrapping = TextWrapping.Wrap, MaxLines = maxLines, TextTrimming = maxLines > 0 ? TextTrimming.WordEllipsis : TextTrimming.None, LineHeight = lineHeight };

    public static TextBlock Label(string s) => new() { Text = s.ToUpperInvariant(), FontSize = 10.5, Foreground = Muted, FontWeight = FontWeight.SemiBold, FontFamily = Ui, LetterSpacing = .6, Margin = new Thickness(0, 0, 0, 8) };

    public static Border Card(Control child, double radius = 14, Thickness? pad = null) =>
        new() { Background = Surface, BorderBrush = Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(radius), Padding = pad ?? new Thickness(14), Child = child };

    /// <summary>Botão: hover clareia, toque afunda com mola. primary = laranja (uma ação principal por tela).</summary>
    public static Border Button(string text, string? icon, Action onClick, bool primary = true, bool danger = false, double height = 38)
    {
        var bgBase = primary ? C("#F97316") : C("#181818");
        var bgHover = primary ? C("#FB8A3C") : C("#212121");
        var bg = new SolidColorBrush(bgBase);
        var fg = primary ? OnBrand : danger ? B("#FCA5A5") : Text;
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        if (icon is not null) row.Children.Add(Icon(icon, 14, fg));
        row.Children.Add(T(text, 13, fg, FontWeight.SemiBold));
        var b = new Border
        {
            Background = bg, CornerRadius = new CornerRadius(10), Height = height, Padding = new Thickness(15, 0), Child = row,
            BorderThickness = new Thickness(primary ? 0 : 1), BorderBrush = danger ? B("#5A1F1F") : LineHi,
        };
        Pressable(b, onClick, () => AnimColor(bg, bgHover), () => AnimColor(bg, bgBase));
        return b;
    }

    /// <summary>Hover + toque com mola em qualquer elemento.</summary>
    public static void Pressable(Control el, Action onClick, Action? hoverIn = null, Action? hoverOut = null)
    {
        var s = Scale(el);
        el.Cursor = new Cursor(StandardCursorType.Hand);
        void To(double v, int ms, Func<double, double> e) { Anim(s, "sx", () => s.ScaleX, x => s.ScaleX = x, v, ms, e); Anim(s, "sy", () => s.ScaleY, y => s.ScaleY = y, v, ms, e); }
        var down = false;
        el.PointerEntered += (_, _) => hoverIn?.Invoke();
        el.PointerExited += (_, _) => { hoverOut?.Invoke(); if (down) { down = false; To(1, 260, Spring); } };
        el.PointerPressed += (_, e) =>
        {
            if (!e.GetCurrentPoint(el).Properties.IsLeftButtonPressed) return;
            down = true; To(.96, 90, OutExpo); e.Handled = true;
        };
        el.PointerReleased += (_, e) =>
        {
            if (!down || e.InitialPressMouseButton != MouseButton.Left) return;
            down = false; To(1, 380, Spring); e.Handled = true;
            if (el.IsPointerOver) onClick();
        };
    }

    /// <summary>Barra de progresso que enche (outExpo). value 0..1.</summary>
    public static Grid Bar(double value, IBrush? fill = null, double height = 5, bool animate = true)
    {
        var track = new Border { Background = Raised, CornerRadius = new CornerRadius(height / 2), Height = height };
        var bar = new Border { Background = fill ?? Brand, CornerRadius = new CornerRadius(height / 2), Height = height, HorizontalAlignment = HorizontalAlignment.Left, Width = 0 };
        var g = new Grid { Children = { track, bar }, VerticalAlignment = VerticalAlignment.Center };
        g.SizeChanged += (_, e) =>
        {
            if (e.NewSize.Width <= 0) return;
            var w = Math.Clamp(value, 0, 1) * e.NewSize.Width;
            if (animate) Anim(bar, "w", () => bar.Width, x => bar.Width = x, w, 1100, OutExpo); else bar.Width = w;
        };
        return g;
    }

    public static IBrush StatusBrush(string? status)
    {
        var s = (status ?? "").ToUpperInvariant();
        if (s is "IDLE") return Ok;          // loop vivo, pronto para a próxima ordem
        if (s is "OFF") return Faint;        // loop desligado
        if (s is "PAUSED" or "WAIT_RAM") return Warn;
        if (s.StartsWith("DONE") || s.StartsWith("APPROVED")) return Ok;
        if (s.StartsWith("WORKING") || s.StartsWith("ACK")) return Brand;
        if (new[] { "BLOCKED", "FAILED", "STOPPED", "VIOLATION", "REJECTED", "AWAITING" }.Any(s.StartsWith)) return Err;
        if (new[] { "REVIEW", "QUEUED", "ASSIGNED", "NOT_RUN", "NEEDS" }.Any(s.StartsWith)) return Warn;
        return Muted;
    }

    /// <summary>Status em palavras (ao vivo do loop, ou o que o agente escreveu no STATUS).</summary>
    public static string StatusText(string? status) => (status ?? "").ToUpperInvariant() switch
    {
        "" => "sem status",
        "WORKING" => "trabalhando agora",
        "IDLE" => "pronto, esperando ordem",
        "PAUSED" => "pausado",
        "WAIT_RAM" => "esperando memória livre",
        "OFF" => "loop desligado",
        var x => x.ToLowerInvariant().Replace('_', ' '),
    };

    public static Border Pill(string text, IBrush fg)
    {
        var c = ((ISolidColorBrush)fg).Color;
        return new Border { Background = new SolidColorBrush(Color.FromArgb(30, c.R, c.G, c.B)), CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 2, 8, 3), Child = T(text, 10.5, fg, FontWeight.SemiBold), VerticalAlignment = VerticalAlignment.Center };
    }

    public static string Ago(string ts)
    {
        // A sala grava hora local sem fuso ("2026-09-28T08:56:00").
        if (!DateTime.TryParse(ts, null, System.Globalization.DateTimeStyles.AssumeLocal, out var t)) return "";
        var d = DateTime.Now - t;
        return d.TotalMinutes < 1 ? "agora" : d.TotalHours < 1 ? $"{(int)d.TotalMinutes} min" : d.TotalDays < 1 ? $"{(int)d.TotalHours} h" : $"{(int)d.TotalDays} d";
    }

    public static T Also<T>(this T x, Action<T> f) { f(x); return x; }

    public static Control Tip(this Control c, string? tip) { if (!string.IsNullOrEmpty(tip)) ToolTip.SetTip(c, tip); return c; }

    // ---------------- AgentC (o logo é o mascote) ----------------

    /// <summary>Hexágono (ponta em cima) centrado num quadrado de lado [size].</summary>
    public static List<Point> Hexagon(double size, double inset = 2)
    {
        double cx = size / 2, cy = size / 2, r = size / 2 - inset;
        return Enumerable.Range(0, 6).Select(i => { var a = Math.PI / 180 * (60 * i - 90); return new Point(cx + r * Math.Cos(a), cy + r * Math.Sin(a)); }).ToList();
    }

    public static Polygon Hex(double size, IBrush fill, IBrush stroke, double thickness = 2) =>
        new() { Points = Hexagon(size, thickness / 2 + 1), Fill = fill, Stroke = stroke, StrokeThickness = thickness, StrokeJoin = PenLineJoin.Round };

    /// <summary>AgentC parado (logo): hexágono laranja e dois olhos em pílula.</summary>
    public static Grid Face(double size, IBrush? stroke = null, double eyesScale = 1)
    {
        var g = new Grid { Width = size, Height = size };
        g.Children.Add(Hex(size, Surface, stroke ?? Brand, Math.Max(1.5, size * .055)));
        var eyes = new Canvas { Width = size, Height = size, RenderTransformOrigin = RelativePoint.Center, RenderTransform = new ScaleTransform(1, eyesScale) };
        foreach (var x in new[] { .33, .57 })
        {
            var w = size * .1;
            var e = new Rectangle { Width = w, Height = size * .22, RadiusX = w / 2, RadiusY = w / 2, Fill = Text };
            Canvas.SetLeft(e, size * x); Canvas.SetTop(e, size * .39); eyes.Children.Add(e);
        }
        g.Children.Add(eyes);
        return g;
    }

    // ---------------- fotos dos agentes ----------------
    static readonly Dictionary<string, DrawingImage?> photos = [];

    /// <summary>Foto do agente: o vetor res/drawable/agent_&lt;nome&gt;.xml do app Android (embutido). null = sem foto.</summary>
    public static DrawingImage? Photo(string name)
    {
        var key = name.ToLowerInvariant();
        if (photos.TryGetValue(key, out var img)) return img;
        try
        {
            using var st = typeof(K).Assembly.GetManifestResourceStream($"avatar.agent_{key}.xml");
            if (st is null) return photos[key] = null;
            XNamespace a = "http://schemas.android.com/apk/res/android";
            var group = new DrawingGroup();
            group.Children.Add(new GeometryDrawing { Brush = Brushes.Transparent, Geometry = new RectangleGeometry(new Rect(0, 0, 48, 48)) });
            foreach (var path in XDocument.Load(st).Descendants("path"))
                group.Children.Add(new GeometryDrawing { Brush = new SolidColorBrush(AndroidColor((string)path.Attribute(a + "fillColor")!)), Geometry = Geometry.Parse((string)path.Attribute(a + "pathData")!) });
            return photos[key] = new DrawingImage(group);
        }
        catch { return photos[key] = null; }
    }

    /// <summary>Cor do Android: #RRGGBB ou #AARRGGBB (o Avalonia lê igual).</summary>
    static Color AndroidColor(string s) => Color.Parse(s);

    /// <summary>Foto do agente (ou iniciais com cor derivada do nome, mesma regra do app e da web).</summary>
    public static Control Avatar(string name, double size = 26, string? mark = null)
    {
        if (name.Equals("JARVIS", StringComparison.OrdinalIgnoreCase) || name.Equals("AGENTC", StringComparison.OrdinalIgnoreCase)) return Face(size);
        if (Photo(name) is { } photo) return new Image { Source = photo, Width = size, Height = size, Stretch = Stretch.Uniform }.Tip(Nice(name));
        var h = 0; foreach (var ch in name) h = (h * 31 + ch) % 360;
        var ini = mark ?? new string(name.Where(char.IsLetterOrDigit).Take(2).ToArray()).ToUpperInvariant();
        return new Border
        {
            Width = size, Height = size, CornerRadius = new CornerRadius(size / 2), Background = new SolidColorBrush(FromHsl(h, .30, .18)),
            Child = T(ini, size * .38, new SolidColorBrush(FromHsl(h, .85, .80)), FontWeight.Bold).Also(t => t.HorizontalAlignment = HorizontalAlignment.Center),
        };
    }

    static Color FromHsl(double h, double s, double l)
    {
        double c = (1 - Math.Abs(2 * l - 1)) * s, x = c * (1 - Math.Abs(h / 60 % 2 - 1)), m = l - c / 2;
        var (r, g, b) = h < 60 ? (c, x, 0d) : h < 120 ? (x, c, 0d) : h < 180 ? (0d, c, x) : h < 240 ? (0d, x, c) : h < 300 ? (x, 0d, c) : (c, 0d, x);
        return Color.FromRgb((byte)((r + m) * 255), (byte)((g + m) * 255), (byte)((b + m) * 255));
    }

    /// <summary>Nome do agente do jeito que se lê (CLAUDE → Claude, OPENCODE → OpenCode).</summary>
    public static string Nice(string id) => id.ToUpperInvariant() switch
    {
        "OPENCODE" => "OpenCode", "OPENCLAW" => "OpenClaw", "CHATGPT" => "ChatGPT", "OUTRO" => "Outros", "CHAMADA" => "Chamada", "JARVIS" or "AGENTC" => "AgentC",
        _ => id.Length <= 1 ? id : char.ToUpperInvariant(id[0]) + id[1..].ToLowerInvariant(),
    };

    /// <summary>Siglas que não se repetem (OPENCODE = OC, OPENCLAW = OP→OL…), mesma regra do app do celular.</summary>
    public static Dictionary<string, string> Marks(IEnumerable<string> ids)
    {
        var used = new HashSet<string>();
        var r = new Dictionary<string, string>();
        foreach (var id in ids)
        {
            var s = new string(id.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
            r[id] = Enumerable.Range(1, Math.Max(0, s.Length - 1)).Select(i => $"{s[0]}{s[i]}").FirstOrDefault(used.Add) ?? (s.Length >= 2 ? s[..2] : s);
        }
        return r;
    }

    /// <summary>Arco de progresso começando no topo, sentido horário (0..1).</summary>
    public static Path Arc(double size, double th, double value, IBrush color)
    {
        value = Math.Clamp(value, 0, .9999);
        var r = (size - th) / 2; var c = size / 2;
        var a = value * 2 * Math.PI;
        var fig = new PathFigure { StartPoint = new Point(c, c - r), IsClosed = false, IsFilled = false };
        fig.Segments!.Add(new ArcSegment { Point = new Point(c + r * Math.Sin(a), c - r * Math.Cos(a)), Size = new Size(r, r), IsLargeArc = value > .5, SweepDirection = SweepDirection.Clockwise });
        return new Path { Data = new PathGeometry { Figures = [fig] }, Stroke = color, StrokeThickness = th, StrokeLineCap = PenLineCap.Round, IsVisible = value > .001, Width = size, Height = size };
    }

    /// <summary>
    /// Foto do agente dentro de um anel que enche com o uso de hoje (laranja); o ponto embaixo à direita
    /// é o status (verde terminou, laranja trabalhando, vermelho travado, cinza parado).
    /// </summary>
    public static Grid UsageRing(string id, double size, double share, IBrush status, string? mark = null)
    {
        var th = Math.Max(2.2, size / 15);
        var g = new Grid { Width = size, Height = size, VerticalAlignment = VerticalAlignment.Center };
        g.Children.Add(new Ellipse { Stroke = Raised, StrokeThickness = th });
        var arc = Arc(size, th, share, Brand);
        g.Children.Add(arc);
        if (share > 0) Fade(arc, 1, 700, OutExpo, 0);
        var photo = Avatar(id, size - th * 2 - 3, mark);
        photo.HorizontalAlignment = HorizontalAlignment.Center; photo.VerticalAlignment = VerticalAlignment.Center;
        g.Children.Add(photo);
        var d = Math.Max(7, size / 5);
        var dot = new Ellipse { Width = d, Height = d, Fill = status, Stroke = Surface, StrokeThickness = 1.5, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom };
        if (status == Brand) Pulse(dot, .35);
        g.Children.Add(dot);
        return g;
    }

    /// <summary>Janela flutuante sem borda, transparente, por cima de tudo e fora da barra de tarefas.</summary>
    public static void Floating(Window w)
    {
        w.SystemDecorations = SystemDecorations.None;
        w.TransparencyLevelHint = [WindowTransparencyLevel.Transparent];
        w.Background = Brushes.Transparent;
        w.Topmost = true; w.ShowInTaskbar = false; w.CanResize = false; w.ShowActivated = false;
        w.FontFamily = Ui; w.Foreground = Text; w.SizeToContent = SizeToContent.WidthAndHeight;
        w.WindowStartupLocation = WindowStartupLocation.Manual;
    }

    /// <summary>Área de trabalho (sem a barra de tarefas/menus) da tela da janela, em DIPs, mais a escala.</summary>
    public static (Rect Area, double Scale) WorkArea(Window w)
    {
        var s = w.Screens.ScreenFromWindow(w) ?? w.Screens.Primary;
        if (s is null) return (new Rect(0, 0, 1920, 1080), 1);
        var wa = s.WorkingArea;
        return (new Rect(wa.X / s.Scaling, wa.Y / s.Scaling, wa.Width / s.Scaling, wa.Height / s.Scaling), s.Scaling);
    }

    /// <summary>Põe a janela na posição em DIPs (o Avalonia posiciona em pixels).</summary>
    public static void MoveTo(Window w, double x, double y)
    {
        var (_, scale) = WorkArea(w);
        w.Position = new PixelPoint((int)Math.Round(x * scale), (int)Math.Round(y * scale));
    }

    public static (double X, double Y) PosDip(Window w)
    {
        var (_, scale) = WorkArea(w);
        return (w.Position.X / scale, w.Position.Y / scale);
    }

    /// <summary>
    /// Arrastar move a janela (manual, igual nos três sistemas); um clique sem mexer chama [click].
    /// [moved] roda no fim de um arrasto (para salvar o lugar).
    /// </summary>
    public static void DragOrClick(Window w, Control handle, Action? click, Action? moved = null)
    {
        PixelPoint? startPtr = null; PixelPoint startPos = default; var moving = false;
        handle.PointerPressed += (_, e) =>
        {
            if (!e.GetCurrentPoint(handle).Properties.IsLeftButtonPressed) return;
            startPtr = w.PointToScreen(e.GetPosition(w)); startPos = w.Position; moving = false;
            e.Pointer.Capture(handle); e.Handled = true;
        };
        handle.PointerMoved += (_, e) =>
        {
            if (startPtr is not { } s0) return;
            var p = w.PointToScreen(e.GetPosition(w));
            var dx = p.X - s0.X; var dy = p.Y - s0.Y;
            if (!moving && Math.Abs(dx) + Math.Abs(dy) < 5) return;
            moving = true;
            w.Position = new PixelPoint(startPos.X + dx, startPos.Y + dy);
        };
        handle.PointerReleased += (_, e) =>
        {
            if (startPtr is null) return;
            startPtr = null; e.Pointer.Capture(null); e.Handled = true;
            if (moving) moved?.Invoke(); else click?.Invoke();
        };
    }
}

/// <summary>Linha de colunas iguais com espaço entre elas.</summary>
public sealed class Cols
{
    public Grid Panel { get; } = new();
    readonly int cols;
    readonly double gap;
    int n;
    public Cols(int cols = 2, double gap = 8)
    {
        this.cols = cols; this.gap = gap;
        for (var i = 0; i < cols; i++) Panel.ColumnDefinitions.Add(new ColumnDefinition(1, GridUnitType.Star));
    }
    public Cols Add(Control e)
    {
        e.Margin = new Thickness(n == 0 ? 0 : gap / 2, 0, n == cols - 1 ? 0 : gap / 2, 0);
        Grid.SetColumn(e, n++); Panel.Children.Add(e);
        return this;
    }
}
