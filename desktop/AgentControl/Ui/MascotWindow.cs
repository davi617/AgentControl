using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using AgentControl.Core;

namespace AgentControl.Ui;

public enum Mood { Offline, Idle, Working, Alert }

/// <summary>
/// AgentC (o mascote é o logo): hexágono com dois olhos em pílula, parado no canto da tela.
/// Clique abre/fecha a HUD e a mini janela; arrastar muda de lugar; botão direito abre o menu.
/// Pisca, olha em volta (e segue o mouse no Windows), fica amarelo com aprovação esperando
/// e dorme (olhos fechados) com o servidor desligado.
/// </summary>
public sealed class MascotWindow : Window
{
    const double Box = 104, S = 64;
    readonly SolidColorBrush stroke = new(K.C("#F97316"));
    readonly ScaleTransform body = new(1, 1);
    readonly ScaleTransform blink = new(1, 1);
    readonly TranslateTransform look = new();
    readonly Border badge;
    readonly TextBlock badgeText = K.T("", 11, K.OnBrand, FontWeight.Bold);
    readonly Popup bubble = new() { Placement = PlacementMode.Top, HorizontalOffset = 40, VerticalOffset = 10 };
    readonly TextBlock bubbleWho = K.T("", 11, K.BrandText, FontWeight.SemiBold);
    readonly TextBlock bubbleText = K.Wrap("", 12.5, K.Text, maxLines: 3);
    readonly Border bubbleBox;
    readonly Popup menu = new() { Placement = PlacementMode.Top, HorizontalOffset = 30, IsLightDismissEnabled = true };
    readonly DispatcherTimer eyeTimer = new() { Interval = TimeSpan.FromMilliseconds(33) };
    readonly DispatcherTimer blinkTimer = new();
    readonly DispatcherTimer bubbleTimer = new() { Interval = TimeSpan.FromSeconds(7) };
    readonly Random rnd = new();
    Mood mood = Mood.Idle;
    double lookX, lookY, glanceX, glanceY;
    DateTime nextGlance = DateTime.Now, mouseStill = DateTime.Now;
    (int X, int Y) lastMouse;
    Point? localMouse;
    // expressões (estilo Grok): falando, pensando, feliz, alerta, dormindo
    readonly Canvas eyes;
    readonly Canvas happyEyes = new() { Width = S, Height = S, Opacity = 0, IsHitTestVisible = false };
    readonly Rectangle mouth = new() { Width = 14, Height = 3, RadiusX = 2, RadiusY = 2, Fill = K.Text, Opacity = 0 };
    readonly Avalonia.Controls.Shapes.Path thinkArc;
    readonly RotateTransform thinkRot = new();
    readonly Ellipse voiceRing = new() { Width = S + 6, Height = S + 6, StrokeThickness = 2, Opacity = 0, IsHitTestVisible = false, RenderTransformOrigin = RelativePoint.Center };
    readonly ScaleTransform voiceScale = new(1, 1);
    readonly TextBlock zzz = K.T("z", 13, K.Muted, FontWeight.Bold);
    readonly DispatcherTimer fx = new() { Interval = TimeSpan.FromMilliseconds(33) };
    readonly System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
    DateTime talkUntil, happyUntil, nextAlertHop;

    public event Action? Clicked;
    public event Action<string>? MenuChosen;
    static string PosFile => System.IO.Path.Combine(Platform.DataDir, "mascote.json");

    public MascotWindow()
    {
        K.Floating(this);
        SizeToContent = SizeToContent.Manual;
        Width = Box; Height = Box; Title = "AgentC";

        var root = new Grid { Width = Box, Height = Box, Background = Brushes.Transparent };
        var face = new Grid { Width = S, Height = S, RenderTransformOrigin = RelativePoint.Center, RenderTransform = body };
        face.Children.Add(K.Hex(S, K.Surface, stroke, 3.4));
        eyes = new Canvas { Width = S, Height = S, RenderTransformOrigin = RelativePoint.Center, RenderTransform = new TransformGroup { Children = { blink, look } } };
        eyes.Children.Add(Eye(S / 2 - 12)); eyes.Children.Add(Eye(S / 2 + 4));
        face.Children.Add(eyes);
        // olhos felizes (^ ^) e boca (aparece quando fala)
        foreach (var x in new[] { S / 2 - 13, S / 2 + 3 })
        {
            var arc = new Avalonia.Controls.Shapes.Path { Data = Geometry.Parse("M0 8 Q5 0 10 8"), Stroke = K.Text, StrokeThickness = 3.2, StrokeLineCap = PenLineCap.Round };
            Canvas.SetLeft(arc, x); Canvas.SetTop(arc, S / 2 - 7); happyEyes.Children.Add(arc);
        }
        face.Children.Add(happyEyes);
        var mouthLayer = new Canvas { Width = S, Height = S, IsHitTestVisible = false };
        Canvas.SetLeft(mouth, S / 2 - 7); Canvas.SetTop(mouth, S / 2 + 11); mouthLayer.Children.Add(mouth);
        face.Children.Add(mouthLayer);
        // anel de voz (sai do AgentC enquanto alguém fala) e arco "pensando" (gira com agentes trabalhando)
        voiceRing.Stroke = stroke; voiceRing.RenderTransform = voiceScale;
        root.Children.Add(voiceRing);
        var rr = S / 2 + 8;
        thinkArc = new Avalonia.Controls.Shapes.Path
        {
            Data = Geometry.Parse(FormattableString.Invariant($"M{Box / 2} {Box / 2 - rr} A{rr} {rr} 0 0 1 {Box / 2 + rr * Math.Sin(1.2)} {Box / 2 - rr * Math.Cos(1.2)}")),
            Stroke = K.Brand, StrokeThickness = 2.6, StrokeLineCap = PenLineCap.Round, Opacity = 0, Width = Box, Height = Box, IsHitTestVisible = false,
            RenderTransformOrigin = RelativePoint.Center, RenderTransform = thinkRot,
        };
        root.Children.Add(thinkArc);
        root.Children.Add(face);
        zzz.Opacity = 0; zzz.HorizontalAlignment = HorizontalAlignment.Right; zzz.VerticalAlignment = VerticalAlignment.Top; zzz.Margin = new Thickness(0, 18, 18, 0); zzz.RenderTransform = new TranslateTransform();
        root.Children.Add(zzz);

        badge = new Border
        {
            Background = K.Warn, CornerRadius = new CornerRadius(9), MinWidth = 18, Height = 18, Padding = new Thickness(5, 0), HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 12, 14, 0), Child = badgeText.Also(t => t.HorizontalAlignment = HorizontalAlignment.Center), IsVisible = false,
        };
        root.Children.Add(badge);

        bubbleBox = new Border
        {
            Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12, 12, 12, 3), Padding = new Thickness(12, 9, 12, 10),
            MaxWidth = 260, Margin = new Thickness(10), BoxShadow = K.Shadow(18, 2, .45), Child = new StackPanel { Spacing = 2, Children = { bubbleWho, bubbleText } },
        };
        bubble.Child = bubbleBox; bubble.PlacementTarget = root;
        root.Children.Add(bubble);
        bubbleTimer.Tick += (_, _) => HideBubble();

        BuildMenu(root);
        root.Children.Add(menu);
        Content = root;
        root.Tip("AgentC · clique para falar com os agentes · arraste para mover · botão direito para opções");

        K.DragOrClick(this, root, () => { Squish(); Clicked?.Invoke(); }, SavePos);
        root.PointerReleased += (_, e) => { if (e.InitialPressMouseButton == MouseButton.Right) { menu.IsOpen = true; if (menu.Child is { } m) K.EnterUp(m, 0, 6); } };
        root.PointerMoved += (_, e) => localMouse = e.GetPosition(root);
        root.PointerExited += (_, _) => localMouse = null;

        eyeTimer.Tick += (_, _) => FollowMouse();
        fx.Tick += (_, _) => Effects();
        blinkTimer.Tick += (_, _) => Blink();
        Opened += (_, _) =>
        {
            PlaceStart(); eyeTimer.Start(); ScheduleBlink(); if (!K.Reduced) fx.Start();
            K.Anim(body, "s", () => body.ScaleX, x => { body.ScaleX = x; body.ScaleY = x; }, 1, 700, K.Spring, .2);
        };
    }

    static Rectangle Eye(double x)
    {
        var e = new Rectangle { Width = 8, Height = 15, RadiusX = 4, RadiusY = 4, Fill = K.Text };
        Canvas.SetLeft(e, x); Canvas.SetTop(e, S / 2 - 8);
        return e;
    }

    // ---------- humor ----------
    public void SetMood(Mood m, int pending)
    {
        badge.IsVisible = pending > 0;
        badgeText.Text = pending > 9 ? "9+" : pending.ToString();
        if (m == mood) return;
        mood = m;
        K.AnimColor(stroke, m switch { Mood.Offline => K.C("#52525B"), Mood.Alert => K.C("#F59E0B"), _ => K.C("#F97316") }, 500);
        K.Anim(blink, "blink", () => blink.ScaleY, y => blink.ScaleY = y, m == Mood.Offline ? .16 : 1, 420);
    }

    /// <summary>Um agente falou: o AgentC pula, olha para cima e mostra o balão.</summary>
    public void Say(string who, string text)
    {
        if (string.IsNullOrWhiteSpace(text) || !IsVisible) return;
        bubbleWho.Text = who == "DONO" ? "Você" : K.Nice(who);
        bubbleText.Text = text.Length > 160 ? text[..160] + "…" : text;
        bubble.IsOpen = true;
        K.Fade(bubbleBox, 1, 260, from: 0);
        var s = K.Scale(bubbleBox); bubbleBox.RenderTransformOrigin = new RelativePoint(0, 1, RelativeUnit.Relative);
        K.Anim(s, "s", () => s.ScaleX, x => { s.ScaleX = x; s.ScaleY = x; }, 1, 520, K.Spring, .7);
        Hop();
        // fala: a boca mexe e o anel de voz sai do AgentC pelo tempo de leitura (1,2 s a 6 s)
        talkUntil = DateTime.Now.AddMilliseconds(Math.Clamp(text.Length * 45, 1200, 6000));
        bubbleTimer.Stop(); bubbleTimer.Start();
    }

    /// <summary>Um agente terminou algo: olhos felizes (^ ^) e um pulo.</summary>
    public void Celebrate()
    {
        happyUntil = DateTime.Now.AddSeconds(2.4);
        Hop();
    }

    /// <summary>Quadro a quadro das expressões (só roda com animações ligadas).</summary>
    void Effects()
    {
        if (!IsVisible) return;
        var t = clock.Elapsed.TotalSeconds;
        var now = DateTime.Now;
        // falando
        var talking = now < talkUntil && mood != Mood.Offline;
        mouth.Opacity = talking ? 1 : 0;
        if (talking)
        {
            var open = Math.Abs(Math.Sin(t * 13)) * (.55 + .45 * Math.Sin(t * 4.7));
            mouth.Height = 3 + 8 * open; Canvas.SetTop(mouth, S / 2 + 11 - mouth.Height / 2 + 1.5);
            var ph = t * 1.4 % 1;
            voiceRing.Opacity = .55 * (1 - ph); voiceScale.ScaleX = voiceScale.ScaleY = 1 + .45 * ph;
        }
        else voiceRing.Opacity = 0;
        // feliz
        var happy = now < happyUntil && mood != Mood.Offline;
        eyes.Opacity = happy ? 0 : 1; happyEyes.Opacity = happy ? 1 : 0;
        // pensando (agentes trabalhando)
        thinkArc.Opacity = mood == Mood.Working && !talking ? .9 : 0;
        if (mood == Mood.Working) thinkRot.Angle = t * 220 % 360;
        // alerta: um pulinho a cada 4 s
        if (mood == Mood.Alert && now >= nextAlertHop) { nextAlertHop = now.AddSeconds(4); Hop(); }
        // dormindo: z sobe e some
        if (mood == Mood.Offline)
        {
            var z = t * .45 % 1;
            zzz.Opacity = z < .85 ? .8 * (1 - z) : 0;
            if (zzz.RenderTransform is TranslateTransform tt) { tt.Y = -14 * z; tt.X = 4 * Math.Sin(z * 6); }
            zzz.FontSize = 10 + 5 * z;
        }
        else zzz.Opacity = 0;
    }

    void HideBubble()
    {
        bubbleTimer.Stop();
        K.Fade(bubbleBox, 0, 220, K.InQuad, done: () => bubble.IsOpen = false);
    }

    // ---------- movimento ----------
    void Hop()
    {
        K.Anim(body, "s", () => body.ScaleX, x => { body.ScaleX = x; body.ScaleY = x; }, 1.12, 140, K.OutExpo,
            done: () => K.Anim(body, "s", () => body.ScaleX, x => { body.ScaleX = x; body.ScaleY = x; }, 1, 480, K.Spring));
        lookY = -4;
    }

    void Squish()
    {
        K.Anim(body, "sx", () => body.ScaleX, x => body.ScaleX = x, 1.1, 90, K.OutExpo, done: () => K.Anim(body, "sx", () => body.ScaleX, x => body.ScaleX = x, 1, 430, K.Spring));
        K.Anim(body, "sy", () => body.ScaleY, y => body.ScaleY = y, .9, 90, K.OutExpo, done: () => K.Anim(body, "sy", () => body.ScaleY, y => body.ScaleY = y, 1, 430, K.Spring));
    }

    void ScheduleBlink() { blinkTimer.Interval = TimeSpan.FromMilliseconds(rnd.Next(2600, 6200)); blinkTimer.Start(); }

    void Blink()
    {
        blinkTimer.Stop();
        if (mood != Mood.Offline && !K.Reduced)
        {
            var twice = rnd.NextDouble() < .2;
            void Close(Action then) => K.Anim(blink, "blink", () => blink.ScaleY, y => blink.ScaleY = y, .08, 70, K.InQuad, done: then);
            void Open(Action? then) => K.Anim(blink, "blink", () => blink.ScaleY, y => blink.ScaleY = y, 1, 110, K.OutExpo, done: then);
            Close(() => Open(twice ? () => Close(() => Open(null)) : null));
        }
        ScheduleBlink();
    }

    void FollowMouse()
    {
        if (!IsVisible) return;
        var (_, scale) = K.WorkArea(this);
        double dx, dy;
        (int X, int Y) mouse;
        if (Platform.Cursor() is { } p)
        {
            mouse = p;
            dx = p.X - (Position.X + Box * scale / 2); dy = p.Y - (Position.Y + Box * scale / 2);
        }
        else if (localMouse is { } lp) { mouse = ((int)lp.X, (int)lp.Y); dx = lp.X - Box / 2; dy = lp.Y - Box / 2; }
        else { mouse = lastMouse; dx = dy = 0; }
        var d = Math.Max(1, Math.Sqrt(dx * dx + dy * dy));
        var reach = Math.Min(1, d / 260);
        // Mouse parado há 3 s (ou fora do alcance, no Linux/macOS): o AgentC olha em volta sozinho.
        if (mouse != lastMouse) { lastMouse = mouse; mouseStill = DateTime.Now; glanceX = glanceY = 0; }
        var idleLook = DateTime.Now - mouseStill > TimeSpan.FromSeconds(3) || (dx == 0 && dy == 0);
        if (idleLook && DateTime.Now >= nextGlance)
        {
            (glanceX, glanceY) = rnd.NextDouble() < .35 ? (0d, 0d) : (rnd.Next(-4, 5), rnd.Next(-3, 3));
            nextGlance = DateTime.Now.AddMilliseconds(rnd.Next(1400, 3600));
        }
        var tx = mood == Mood.Offline || K.Reduced ? 0 : idleLook ? glanceX : dx / d * 4 * reach;
        var ty = mood == Mood.Offline || K.Reduced ? 0 : idleLook ? glanceY : dy / d * 3 * reach;
        lookX += (tx - lookX) * .18; lookY += (ty - lookY) * .18;
        look.X = lookX; look.Y = lookY;
    }

    // ---------- menu do botão direito ----------
    void BuildMenu(Control target)
    {
        menu.PlacementTarget = target;
        var list = new StackPanel { MinWidth = 220 };
        void Item(string id, string icon, string text, bool danger = false)
        {
            var row = new Grid { Height = 34, ColumnDefinitions = new ColumnDefinitions("30,*"), Background = Brushes.Transparent };
            row.Children.Add(K.Icon(icon, 14, danger ? K.Err : K.Muted));
            var t = K.T(text, 13, danger ? K.Err : K.Text); Grid.SetColumn(t, 1); row.Children.Add(t);
            var hover = new SolidColorBrush(Colors.Transparent);
            var b = new Border { Child = row, CornerRadius = new CornerRadius(8), Background = hover, Padding = new Thickness(4, 0, 10, 0) };
            K.Pressable(b, () => { menu.IsOpen = false; MenuChosen?.Invoke(id); }, () => K.AnimColor(hover, K.C("#1E1E1E"), 120), () => K.AnimColor(hover, Colors.Transparent, 160));
            list.Children.Add(b);
        }
        Item("hud", K.IHome, "Abrir a HUD");
        Item("full", K.IOpen, "Abrir a tela completa");
        Item("mini", K.IChat, "Falar com os agentes");
        Item("web", K.IOpen, "Abrir a sala no navegador");
        Item("goal", K.IGoal, "Iniciar Modo Goal");
        Item("launcher", K.IHealth, "Abrir o Launcher");
        list.Children.Add(new Border { Height = 1, Background = K.Line, Margin = new Thickness(6, 4) });
        Item("esconder", K.IHide, "Esconder AgentC e a HUD");
        Item("sair", K.IClose, "Fechar o AgentC", danger: true);
        menu.Child = new Border { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(5), Child = list, Margin = new Thickness(10), BoxShadow = K.Shadow(20, 3, .5) };
    }

    // ---------- posição ----------
    void PlaceStart()
    {
        var (wa, _) = K.WorkArea(this);
        try
        {
            var p = JsonSerializer.Deserialize<double[]>(File.ReadAllText(PosFile));
            if (p is { Length: 2 } && p[0] >= wa.Left - 40 && p[0] <= wa.Right - 40 && p[1] >= wa.Top - 40 && p[1] <= wa.Bottom - 40) { K.MoveTo(this, p[0], p[1]); return; }
        }
        catch { }
        K.MoveTo(this, wa.Left + 18, wa.Bottom - Box - 14);
    }

    void SavePos()
    {
        try { var (x, y) = K.PosDip(this); File.WriteAllText(PosFile, JsonSerializer.Serialize(new[] { x, y })); } catch { }
    }
}
