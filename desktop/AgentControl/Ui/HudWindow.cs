using System.Text.Json;
using System.Text.RegularExpressions;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using AgentControl.Core;

namespace AgentControl.Ui;

/// <summary>
/// HUD do topo da tela: fica SEMPRE no meio de cima. Recolhido é uma faixa fina com o AgentC piscando e
/// cada agente só com a foto e o uso de hoje em %. Clique abre o painel (Início, Sala, Chamada, Goal, Saúde);
/// puxar a alça de baixo abre a tela completa; arrastar muda de lugar; botão direito: menu.
/// </summary>
public sealed class HudWindow : Window
{
    static readonly (string Icon, string Name)[] Tabs = [(K.IHome, "Início"), (K.IChat, "Sala"), (K.IPhone, "Chamada"), (K.IGoal, "Goal"), (K.IHealth, "Saúde"), (K.ITerminal, "Comandos")];
    readonly HudHost host;
    readonly Border shell;
    readonly TranslateTransform slide = new();
    readonly ContentControl body = new();
    readonly List<(Border Box, SolidColorBrush Bg, K.Ico Icon)> tabs = [];
    readonly Ellipse liveDot = new() { Width = 7, Height = 7, Fill = K.Muted, VerticalAlignment = VerticalAlignment.Center };
    readonly TextBlock liveText = K.T("conectando", 11.5, K.Muted);
    readonly Border island;
    readonly StackPanel islandAgents = new() { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
    readonly SolidColorBrush islandStroke = new(K.C("#F97316"));
    readonly ScaleTransform islandBlink = new(1, 1);
    readonly DispatcherTimer idle = new() { Interval = TimeSpan.FromSeconds(1) };
    readonly DispatcherTimer blinkTimer = new();
    readonly Popup menu = new() { Placement = PlacementMode.Bottom, IsLightDismissEnabled = true };
    readonly Random rnd = new();
    readonly SolidColorBrush gripBrush = new(K.C("#52525B"));
    ScrollViewer? panelScroll;
    int tab, outside;
    bool hovered, expanded;
    // Aba Comandos e caixas de texto do painel (2026-10-02: "o painel tem pouca função").
    List<HudApi.Cmd> cmds = [];
    string cmdTo = "TODOS", replyTo = "TODOS", toast = "";
    bool typing, loadingCmds;
    string sig = "", islandSig = "";
    double? centerX;
    static string PosFile => System.IO.Path.Combine(Platform.DataDir, "topo.json");

    public HudWindow(HudHost host)
    {
        this.host = host;
        K.Floating(this);
        Title = "Agent Control";

        // Barra: 5 abas + status + recolher
        var bar = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        var tabRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
        for (var i = 0; i < Tabs.Length; i++)
        {
            var idx = i;
            var bg = new SolidColorBrush(i == 0 ? K.C("#1A1A1A") : Colors.Transparent);
            var ic = K.Icon(Tabs[i].Icon, 16, i == 0 ? K.BrandText : K.Muted);
            var b = new Border { Width = 34, Height = 34, CornerRadius = new CornerRadius(10), Background = bg, Child = ic };
            b.Tip($"{Tabs[i].Name} (Ctrl+{i + 1})");
            K.Pressable(b, () => Select(idx), () => { if (tab != idx) K.AnimColor(bg, K.C("#151515"), 120); }, () => { if (tab != idx) K.AnimColor(bg, Colors.Transparent, 160); });
            tabs.Add((b, bg, ic));
            tabRow.Children.Add(b);
        }
        bar.Children.Add(tabRow);
        var live = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 0, 10, 0), Children = { liveDot, liveText } };
        Grid.SetColumn(live, 1); bar.Children.Add(live);
        var close = new Border { Width = 30, Height = 30, CornerRadius = new CornerRadius(8), Background = Brushes.Transparent, Child = K.Icon(K.IUp, 14, K.Muted) };
        close.Tip("Recolher (Esc)");
        K.Pressable(close, Collapse);
        Grid.SetColumn(close, 2); bar.Children.Add(close);
        var barBox = new Border { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(14), Padding = new Thickness(5), Child = bar, Cursor = new Cursor(StandardCursorType.SizeAll) };

        // O painel rola quando o conteúdo é maior que a tela (antes cortava e não dava para ver o resto).
        var bodyScroll = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, AllowAutoHide = true, Content = body };
        panelScroll = bodyScroll;
        var panel = new Border { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(16), Padding = new Thickness(16, 16, 10, 16), Margin = new Thickness(0, 8, 0, 0), Child = bodyScroll };
        // Alça embaixo do painel: puxar para baixo (ou clicar) abre a tela completa.
        var grip = new Border { Width = 44, Height = 5, CornerRadius = new CornerRadius(3), Background = gripBrush, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var handle = new Border { Height = 22, Background = Brushes.Transparent, Cursor = new Cursor(StandardCursorType.SizeNorthSouth), Child = grip };
        handle.Tip("Puxe para baixo: tela completa");
        double? pullFrom = null;
        handle.PointerPressed += (_, e) => { pullFrom = e.GetPosition(this).Y; e.Pointer.Capture(handle); e.Handled = true; };
        handle.PointerMoved += (_, e) =>
        {
            if (pullFrom is not { } y0) return;
            var dy = Math.Max(0, e.GetPosition(this).Y - y0);
            slide.Y = Math.Min(36, dy * .35); grip.Width = 44 + Math.Min(40, dy * .5);
        };
        handle.PointerReleased += (_, e) =>
        {
            if (pullFrom is not { } y0) return;
            var dy = e.GetPosition(this).Y - y0;
            pullFrom = null; e.Pointer.Capture(null); e.Handled = true;
            K.Anim(slide, "y", () => slide.Y, y => slide.Y = y, 0, 420, K.Spring);
            K.Anim(grip, "w", () => grip.Width, w => grip.Width = w, 44, 420, K.Spring);
            if (dy > 50 || Math.Abs(dy) < 3) { Collapse(); host.OpenFull(); }
        };
        handle.PointerEntered += (_, _) => K.AnimColor(gripBrush, K.C("#F97316"), 160);
        handle.PointerExited += (_, _) => K.AnimColor(gripBrush, K.C("#52525B"), 200);

        var stack = new StackPanel { Width = 420, Children = { barBox, panel, handle } };
        shell = new Border { Child = stack, Margin = new Thickness(14, 8, 14, 14), RenderTransform = slide, BoxShadow = K.Shadow(28, 4, .55), IsVisible = false, Opacity = 0, CornerRadius = new CornerRadius(16) };
        K.DragOrClick(this, barBox, null, SavePos);

        // Faixa fina (recolhido): AgentC piscando + cada agente com a foto e o uso de hoje em %.
        var strip = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        strip.Children.Add(MiniFace(20));
        strip.Children.Add(new Border { Width = 1, Height = 14, Background = K.Line, Margin = new Thickness(10, 0, 12, 0) });
        strip.Children.Add(islandAgents);
        island = new Border
        {
            Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(19), Height = 38, Padding = new Thickness(8, 0, 12, 0),
            Child = strip, Margin = new Thickness(14, 6, 14, 14), Cursor = new Cursor(StandardCursorType.Hand), BoxShadow = K.Shadow(16, 2, .45), HorizontalAlignment = HorizontalAlignment.Center,
        };
        island.Tip("AgentC · saldo de cota por agente · — = provedor não informa · clique para abrir · arraste para mover");
        K.DragOrClick(this, island, () => Expand(Math.Max(0, tab)), SavePos);
        BuildMenu();
        island.PointerReleased += (_, e) => { if (e.InitialPressMouseButton == MouseButton.Right) OpenMenu(island); };
        barBox.PointerReleased += (_, e) => { if (e.InitialPressMouseButton == MouseButton.Right) OpenMenu(barBox); };

        Content = new Grid { Children = { island, shell, menu } };
        KeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape) Collapse();
            // Ctrl+1…6 troca de aba (igual ao Launcher)
            else if (e.KeyModifiers.HasFlag(KeyModifiers.Control) && e.Key >= Key.D1 && e.Key <= Key.D6) { Select(e.Key - Key.D1); e.Handled = true; }
        };
        // Mantém o centro no lugar quando troca de faixa para painel (larguras diferentes).
        PropertyChanged += (_, e) => { if (e.Property == ClientSizeProperty && centerX is { } c) K.MoveTo(this, c - ClientSize.Width / 2, K.PosDip(this).Y); };
        PointerEntered += (_, _) => hovered = true;
        idle.Tick += (_, _) => { if (IsPointerOver || !hovered || typing) outside = 0; else if (++outside >= 8) Collapse(); };
        blinkTimer.Tick += (_, _) => Blink();
    }

    // ---------- menu do botão direito ----------
    void BuildMenu()
    {
        var list = new StackPanel { MinWidth = 220 };
        void Item(string icon, string text, Action go)
        {
            var row = new Grid { Height = 34, ColumnDefinitions = new ColumnDefinitions("30,*"), Background = Brushes.Transparent };
            row.Children.Add(K.Icon(icon, 14, K.Muted));
            var t = K.T(text, 13, K.Text); Grid.SetColumn(t, 1); row.Children.Add(t);
            var hover = new SolidColorBrush(Colors.Transparent);
            var b = new Border { Child = row, CornerRadius = new CornerRadius(8), Background = hover, Padding = new Thickness(4, 0, 10, 0) };
            K.Pressable(b, () => { menu.IsOpen = false; go(); }, () => K.AnimColor(hover, K.C("#1E1E1E"), 120), () => K.AnimColor(hover, Colors.Transparent, 160));
            list.Children.Add(b);
        }
        Item(K.IOpen, "Abrir a tela completa", () => { Collapse(); host.OpenFull(); });
        Item(K.IChat, "Falar com os agentes", host.OpenMini);
        Item(K.IHealth, "Abrir o Launcher", host.OpenLauncher);
        list.Children.Add(new Border { Height = 1, Background = K.Line, Margin = new Thickness(6, 4) });
        Item(K.IHide, "Esconder AgentC e a HUD", host.HideAll);
        menu.Child = new Border { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(5), Child = list, Margin = new Thickness(10), BoxShadow = K.Shadow(20, 3, .5) };
    }

    void OpenMenu(Control target)
    {
        menu.PlacementTarget = target;
        menu.IsOpen = true;
        if (menu.Child is { } m) K.EnterUp(m, 0, -6);
    }

    // ---------- faixa fina / painel ----------
    public void ShowStrip()
    {
        UpdateStrip();
        Show();
        PlaceStart();
        K.Fade(island, 1, 420, from: 0);
        ScheduleBlink();
    }

    public void Expand(int startTab = 0)
    {
        if (!IsVisible) ShowStrip();
        if (!expanded) tab = -1;
        Select(startTab, animate: expanded);
        if (expanded) return;
        expanded = true; outside = 0; hovered = IsPointerOver;
        island.IsVisible = false;
        shell.IsVisible = true;
        K.Fade(shell, 1, 380, from: 0);
        K.Anim(slide, "y", () => slide.Y, y => slide.Y = y, 0, 620, K.OutExpo, -24);
        LimitPanelHeight();
        Stagger();
        idle.Start();
        Activate();
    }

    public void Collapse()
    {
        if (!expanded) return;
        expanded = false;
        idle.Stop();
        K.Anim(slide, "y", () => slide.Y, y => slide.Y = y, -14, 160, K.InQuad);
        K.Fade(shell, 0, 160, K.InQuad, done: () =>
        {
            if (expanded) return;
            shell.IsVisible = false;
            island.IsVisible = true;
            K.Fade(island, 1, 280, from: 0);
        });
    }

    void PlaceStart()
    {
        var (wa, _) = K.WorkArea(this);
        try
        {
            var p = JsonSerializer.Deserialize<double[]>(File.ReadAllText(PosFile));
            if (p is { Length: 2 } && p[0] > wa.Left && p[0] < wa.Right && p[1] >= wa.Top - 10 && p[1] < wa.Bottom - 40) { centerX = p[0]; K.MoveTo(this, p[0] - ClientSize.Width / 2, p[1]); return; }
        }
        catch { }
        centerX = wa.Left + wa.Width / 2;
        K.MoveTo(this, centerX.Value - ClientSize.Width / 2, wa.Top);
    }

    void SavePos()
    {
        var (x, y) = K.PosDip(this);
        centerX = x + ClientSize.Width / 2;
        try { File.WriteAllText(PosFile, JsonSerializer.Serialize(new[] { centerX.Value, y })); } catch { }
    }

    Grid MiniFace(double size)
    {
        var g = new Grid { Width = size, Height = size, VerticalAlignment = VerticalAlignment.Center };
        g.Children.Add(K.Hex(size, K.Surface, islandStroke, 1.8));
        var eyes = new Canvas { Width = size, Height = size, RenderTransformOrigin = RelativePoint.Center, RenderTransform = islandBlink };
        foreach (var x in new[] { size * .31, size * .56 })
        {
            var w = size * .13;
            var e = new Rectangle { Width = w, Height = size * .26, RadiusX = w / 2, RadiusY = w / 2, Fill = K.Text };
            Canvas.SetLeft(e, x); Canvas.SetTop(e, size * .37); eyes.Children.Add(e);
        }
        g.Children.Add(eyes);
        return g;
    }

    void ScheduleBlink() { blinkTimer.Interval = TimeSpan.FromMilliseconds(rnd.Next(2400, 5600)); blinkTimer.Start(); }

    void Blink()
    {
        blinkTimer.Stop();
        if (host.Snap.Online && !K.Reduced)
            K.Anim(islandBlink, "b", () => islandBlink.ScaleY, y => islandBlink.ScaleY = y, .1, 70, K.InQuad,
                done: () => K.Anim(islandBlink, "b", () => islandBlink.ScaleY, y => islandBlink.ScaleY = y, 1, 130, K.OutExpo));
        ScheduleBlink();
    }

    static Dictionary<string, double> UsageOf(HudSnapshot s) => s.Usage.GroupBy(u => u.Agent).ToDictionary(g => g.Key, g => g.Sum(x => x.Share));
    static int Pct(Dictionary<string, double> share, string id) => share.TryGetValue(id, out var v) ? (int)Math.Round(v * 100) : 0;

    /// <summary>Faixa fina: cada agente com a foto no anel de uso e a % de hoje; Goal rodando e aprovações.</summary>
    void UpdateStrip()
    {
        var s = host.Snap;
        var agents = s.Agents.ToList();
        if (agents.Count == 0)
            agents.AddRange(new LauncherSettings().LoopAgents.Select(id => (id.ToUpperInvariant(), "OFFLINE", (string?)null)));
        var goal = s.CallActive && s.CallModo == "goal";
        var share = UsageOf(s);
        var newSig = $"{s.Online}|{s.Pending}|{goal}|{s.CallActive}|{s.Paused}|{string.Join(",", agents.Select(a => a.Id + a.Status + (s.Limits.GetValueOrDefault(a.Id)?.Badge ?? "—") + (s.Limits.GetValueOrDefault(a.Id)?.CheckedAt ?? "")))}";
        if (newSig == islandSig) return;
        islandSig = newSig;
        K.AnimColor(islandStroke, !s.Online ? K.C("#52525B") : s.Pending > 0 ? K.C("#F59E0B") : K.C("#F97316"), 400);
        K.Stop(islandBlink, "b");
        islandBlink.ScaleY = s.Online ? 1 : .16;
        islandAgents.Children.Clear();
        if (!s.Online) islandAgents.Children.Add(K.T("offline", 11.5, K.Muted).Also(t => t.Margin = new Thickness(0, 0, 10, 0)));
        var marks = K.Marks(agents.Select(a => a.Id));
        foreach (var a in agents)
        {
            var quota = s.Limits.GetValueOrDefault(a.Id);
            var pct = quota is { Fresh: true, RemainingPercent: { } remaining } ? remaining : 0;
            var req = s.Usage.FirstOrDefault(u => u.Agent == a.Id).Req;
            var item = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(0, 0, 12, 0), Background = Brushes.Transparent };
            item.Tip($"{K.Nice(a.Id)} · {K.StatusText(a.Status)} · {req} pedidos hoje\n" + (quota?.Description ?? "Saldo de cota não informado."));
            item.Children.Add(K.UsageRing(a.Id, 32, pct / 100.0, K.StatusBrush(a.Status), marks[a.Id]));
            item.Children.Add(K.T(quota?.Badge ?? "—", 11.5, quota?.Status == "limited" ? K.Warn : quota?.Fresh == true ? K.Text2 : K.Faint, FontWeight.SemiBold, K.Mono));
            islandAgents.Children.Add(item);
        }
        if (goal) islandAgents.Children.Add(K.Pill("GOAL", K.Ok).Also(p => p.Margin = new Thickness(4, 0, 0, 0)));
        else if (s.CallActive) islandAgents.Children.Add(K.Pill("CHAMADA", K.Ok).Also(p => { p.Margin = new Thickness(4, 0, 0, 0); p.Tip("Chamada com o time aberta: clique para ver"); }));
        if (s.Online && s.Paused) islandAgents.Children.Add(K.Pill("PAUSADO", K.Warn).Also(p => { p.Margin = new Thickness(6, 0, 0, 0); p.Tip("Agentes pausados: Retomar no painel"); }));
        if (s.Pending > 0) islandAgents.Children.Add(K.Pill(s.Pending == 1 ? "1 APROVAÇÃO" : $"{s.Pending} APROVAÇÕES", K.Warn).Also(p => p.Margin = new Thickness(6, 0, 0, 0)));
        // O tamanho inicial da janela não acompanha sempre o time carregado depois do primeiro GET.
        island.Measure(Size.Infinity);
        MinWidth = Math.Max(448, island.DesiredSize.Width);
    }

    public void Select(int i, bool animate = true)
    {
        if (i == tab) return;
        tab = i;
        for (var t = 0; t < tabs.Count; t++)
        {
            var on = t == i;
            K.AnimColor(tabs[t].Bg, on ? K.C("#1A1A1A") : Colors.Transparent, 220);
            tabs[t].Icon.Color = on ? K.BrandText : K.Muted;
        }
        sig = "";
        toast = "";
        panelScroll?.ScrollToHome();
        LimitPanelHeight();
        Render(animate);
        if (i == 5) _ = LoadCmds();
        if (i == 2) _ = LoadPeople();
    }

    public void Refresh()
    {
        if (!IsVisible) return;
        UpdateStrip();
        if (!expanded) return;
        if (tab == 5) _ = LoadCmds(); else Render(false);
    }

    async Task LoadCmds()
    {
        if (loadingCmds) return;
        loadingCmds = true;
        try { cmds = await host.Api.CommandsAsync(); } catch { }
        finally { loadingCmds = false; }
        Render(false);
    }

    /// <summary>Altura máxima do conteúdo do painel = o que cabe na tela abaixo da barra (descontando barra, alça e margens).</summary>
    void LimitPanelHeight()
    {
        if (panelScroll is null) return;
        var (wa, _) = K.WorkArea(this);
        panelScroll.MaxHeight = Math.Max(240, wa.Height - 170);
    }

    void Stagger()
    {
        if (body.Content is Panel p) { var d = 60; foreach (var c in p.Children) { K.EnterUp(c, d); d += 45; } }
    }

    void Render(bool animate)
    {
        var s = host.Snap;
        liveDot.Fill = !s.Online ? K.Err : s.Working ? K.Brand : K.Ok;
        liveText.Text = !s.Online ? "servidor desligado" : s.Paused ? "agentes pausados" : s.Working ? "trabalhando" : "online";
        var newSig = tab + "|" + Sig(s);
        if (newSig == sig || (typing && !animate)) return;
        sig = newSig;
        var savedY = animate ? 0 : panelScroll?.Offset.Y ?? 0;
        var view = new StackPanel();
        if (!s.Online) Offline(view);
        else switch (tab)
        {
            case 0: Home(view, s, animate); break;
            case 1: Sala(view, s); break;
            case 2: Chamada(view, s); break;
            case 3: Goal(view, s, animate); break;
            case 4: Saude(view, s); break;
            default: Comandos(view, s); break;
        }
        body.Content = view;
        if (animate) Stagger();
        if (!animate && savedY > 0) Avalonia.Threading.Dispatcher.UIThread.Post(() => { if (panelScroll is { } ps) ps.Offset = new Vector(0, savedY); }, Avalonia.Threading.DispatcherPriority.Background);
    }

    static Control Gap(double h = 12) => new Border { Height = h };

    static string Greeting() => DateTime.Now.Hour switch { < 5 => "Boa madrugada", < 12 => "Bom dia", < 18 => "Boa tarde", _ => "Boa noite" };

    void Offline(StackPanel v)
    {
        v.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal, Spacing = 14,
            Children = { K.Face(52, K.Faint, .16), new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { K.T("Servidor desligado", 16, K.Text, FontWeight.SemiBold, K.Display), K.T("Abra o Launcher para ligar os serviços.", 12.5, K.Muted) } } },
        });
        v.Children.Add(Gap(14));
        v.Children.Add(K.Button("Abrir o Launcher", K.IPlay, host.OpenLauncher));
    }

    void Home(StackPanel v, HudSnapshot s, bool animate)
    {
        var top = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
        top.Children.Add(K.Face(62, s.Pending > 0 ? K.Warn : K.Brand));
        var col = new StackPanel { Margin = new Thickness(14, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
        col.Children.Add(K.T(s.Paused ? $"{Greeting()} · agentes pausados" : $"{Greeting()} · tudo no ar", 11.5, s.Paused ? K.Warn : K.Muted, FontWeight.SemiBold));
        var working = s.Agents.Count(a => K.StatusBrush(a.Status) == K.Brand);
        col.Children.Add(K.T($"{s.Agents.Count} agentes · {working} trabalhando", 15.5, K.Text, FontWeight.SemiBold, K.Display).Also(t => t.Margin = new Thickness(0, 2, 0, 9)));
        col.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.Button(s.CallActive ? "Na chamada" : "Chamada", K.IPhone, () => Select(2), height: 34), K.Button("Escrever", K.IChat, host.OpenMini, primary: false, height: 34) } });
        Grid.SetColumn(col, 1); top.Children.Add(col);
        v.Children.Add(top);
        // Modo Time: quem mais está online agora.
        var online = host.People.Skip(1).Where(p => p.Online).Select(p => p.Name).ToList();
        if (online.Count > 0)
            v.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7, Margin = new Thickness(2, 12, 0, 0), Children = { new Ellipse { Width = 8, Height = 8, Fill = K.Ok }, K.Wrap("Online: " + string.Join(", ", online), 12, K.Ok, 2).Also(t => t.MaxWidth = 360) } });
        // O que você pediu para o AgentC lembrar aparece no Início.
        if (AgentControl.Core.Memory.Reminder() is { } memo)
            v.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7, Margin = new Thickness(2, 12, 0, 0), Children = { K.Icon(K.IBook, 13, K.BrandText), K.Wrap($"Lembrete: {memo}", 12, K.Text2, 2).Also(t => t.MaxWidth = 360) } });

        if (s.Pending > 0)
        {
            v.Children.Add(Gap(12));
            var chip = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(28, 245, 158, 11)), BorderBrush = new SolidColorBrush(Color.FromArgb(70, 245, 158, 11)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10), Padding = new Thickness(12, 9),
                Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.Icon(K.IWarn, 14, K.Warn), K.T($"{s.Pending} aprovação esperando você", 13, K.Warn, FontWeight.SemiBold) } },
            };
            K.Pressable(chip, () => Select(5));
            v.Children.Add(chip);
        }

        // Atalhos rápidos: o que mais se faz no dia a dia, sem abrir outra janela.
        v.Children.Add(Gap(14));
        var goalOn = s.CallActive && s.CallModo == "goal";
        v.Children.Add(new Cols(3).Add(Quick(goalOn ? K.IStop : K.IGoal, goalOn ? "Parar Goal" : "Modo Goal", goalOn ? host.EndCall : host.StartGoal, goalOn ? K.Ok : null))
            .Add(Quick(s.Paused ? K.IPlay : K.IPause, s.Paused ? "Retomar" : "Pausar", () => host.SetPause(!s.Paused), s.Paused ? K.Warn : null))
            .Add(Quick(K.IPower, "Ligar agentes", host.StartAgents)).Panel);
        v.Children.Add(Gap(8));
        v.Children.Add(new Cols(3).Add(Quick(K.ITerminal, "Comandos", () => Select(5), badge: s.Pending > 0 ? $"{s.Pending}" : null))
            .Add(Quick(K.IApps, "Tela completa", () => { Collapse(); host.OpenFull(); }))
            .Add(Quick(K.IPhone, s.CallActive ? "Na chamada" : "Chamada", () => Select(2), s.CallActive ? K.Ok : null)).Panel);

        v.Children.Add(Gap(16));
        var head = new DockPanel { Margin = new Thickness(0, 0, 0, 4) };
        var tot = K.T($"{s.Usage.Sum(u => u.Req)} pedidos hoje", 10.5, K.Faint); DockPanel.SetDock(tot, Dock.Right); head.Children.Add(tot);
        head.Children.Add(K.Label("Agentes · uso hoje").Also(l => l.Margin = new Thickness(0)));
        v.Children.Add(head);
        var share = UsageOf(s);
        var rows = s.Agents.Where(a => a.Id != "CHATGPT").Select(a => (a.Id, (string?)a.Status)).ToList();
        foreach (var extra in new[] { "CHAMADA", "OUTRO" }) if (Pct(share, extra) > 0) rows.Add((extra, null));
        foreach (var (id, status) in rows.OrderByDescending(r => Pct(share, r.Id)))
        {
            var p = Pct(share, id);
            var row = new Grid { Margin = new Thickness(0, 5), ColumnDefinitions = new ColumnDefinitions("26,84,*,44") };
            row.Children.Add(status is null ? new Border() : K.Avatar(id, 18));
            var name = K.T(K.Nice(id), 12.5, status is null ? K.Muted : K.Text, FontWeight.SemiBold); Grid.SetColumn(name, 1); row.Children.Add(name);
            var bar = K.Bar(p / 100.0, fill: status is null ? K.Faint : K.Brand, animate: animate); Grid.SetColumn(bar, 2); row.Children.Add(bar);
            var pct = K.T($"{p}%", 12, p > 0 ? K.BrandText : K.Faint, FontWeight.SemiBold, K.Mono); pct.HorizontalAlignment = HorizontalAlignment.Right; Grid.SetColumn(pct, 3); row.Children.Add(pct);
            row.Tip($"{K.Nice(id)} · {s.Usage.FirstOrDefault(u => u.Agent == id).Req} pedidos hoje" + (status is null ? "" : $" · {K.StatusText(status)}"));
            v.Children.Add(row);
        }
    }

    void Sala(StackPanel v, HudSnapshot s)
    {
        v.Children.Add(K.Label("Últimas mensagens"));
        if (s.Chat.Count == 0) v.Children.Add(K.Wrap("Ninguém falou ainda. Mande a primeira mensagem aqui embaixo.", 12.5, K.Muted));
        foreach (var m in s.Chat.Take(5))
        {
            var row = new Grid { Margin = new Thickness(0, 5), ColumnDefinitions = new ColumnDefinitions("Auto,*") };
            row.Children.Add(K.Avatar(m.Agent, 28).Also(a => a.VerticalAlignment = VerticalAlignment.Top));
            var col = new StackPanel { Margin = new Thickness(10, 0, 0, 0) };
            var head = new DockPanel();
            var when = K.T(K.Ago(m.Ts), 11, K.Faint); DockPanel.SetDock(when, Dock.Right); head.Children.Add(when);
            head.Children.Add(K.T(m.Agent == "DONO" ? "Você" : K.Nice(m.Agent), 12, m.Agent == "DONO" ? K.BrandText : K.Text, FontWeight.SemiBold));
            col.Children.Add(head);
            col.Children.Add(K.Wrap(m.Text, 12.5, K.Text2, maxLines: 2).Also(t => t.Margin = new Thickness(0, 1, 0, 0)));
            Grid.SetColumn(col, 1); row.Children.Add(col);
            v.Children.Add(row);
        }
        v.Children.Add(Gap(10));
        v.Children.Add(Composer("Responder na sala", replyTo, t => replyTo = t, async (text, to) =>
        {
            var err = await host.Api.SendChat(text, to);
            toast = err is null ? $"Enviado para {(to == "TODOS" ? "todos" : K.Nice(to))}." : $"Não enviei: {err}";
            host.KickRefresh();
        }, withLeader: false));
        if (toast.Length > 0) v.Children.Add(Toast());
        v.Children.Add(Gap(8));
        v.Children.Add(K.Button("Abrir a sala completa", K.IOpen, () => { Collapse(); host.OpenFull(); }, primary: false, height: 34));
    }

    // ---------- Chamada no painel (2026-10-02: antes os botões abriam a página antiga no navegador) ----------
    static readonly (string Id, string Name, string About)[] Modes =
        [("debate", "Debate", "Cada um defende o ponto do seu papel e discorde com argumento."), ("brainstorm", "Ideias", "Trazem ideias novas e constroem em cima das dos outros."),
         ("revisao", "Revisão", "Procuram riscos, bugs e o que falta testar."), ("goal", "Goal", "Tocam o Goal ativo sem parar, sem esperar você a cada passo.")];
    List<(string Id, string Papel, bool Virtual)> people = [];
    HashSet<string>? pick;
    string? modo;
    string topic = "";
    bool loadingPeople, confirmEnd, callMenu;
    string? kickConfirm;

    async Task LoadPeople()
    {
        if (loadingPeople || people.Count > 0) return;
        loadingPeople = true;
        try { people = await host.Api.CallPeopleAsync(); } catch { }
        finally { loadingPeople = false; }
        sig = "";
        Render(false);
    }

    static string ModeName(string? id) => Modes.FirstOrDefault(m => m.Id == id).Name ?? "Debate";

    // Clique num botão com a caixa de texto focada: sem isso o "typing" segurava o redesenho.
    void Redraw() { typing = false; sig = ""; Render(false); }

    void Chamada(StackPanel v, HudSnapshot s)
    {
        if (s.CallActive) { CallLive(v, s); return; }
        var cfg = host.Settings;
        modo ??= Modes.Any(m => m.Id == cfg.CallModo) ? cfg.CallModo : "debate";
        pick ??= cfg.CallPeople.Select(x => x.ToUpperInvariant()).ToHashSet();
        var goal = modo == "goal";

        v.Children.Add(K.T("Chamada com o time", 15.5, K.Text, FontWeight.SemiBold, K.Display));
        v.Children.Add(K.Wrap("Os agentes conversam aqui no painel, um de cada vez. Você entra na conversa escrevendo.", 12.5, K.Muted, lineHeight: 18).Also(t => t.Margin = new Thickness(0, 3, 0, 12)));

        var box = TextField(goal ? "Foco do Goal (opcional) · Enter começa" : "Sobre o que é a chamada? · Enter começa", topic, t => topic = t, () => _ = Begin(s));
        v.Children.Add(box);

        v.Children.Add(K.Label("Modo").Also(l => l.Margin = new Thickness(0, 14, 0, 6)));
        var modes = new Cols(4, 6);
        foreach (var m in Modes)
        {
            var on = m.Id == modo;
            var chip = new Border { Height = 32, CornerRadius = new CornerRadius(9), Background = on ? K.Brand : K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(on ? 0 : 1), Child = K.T(m.Name, 12, on ? K.OnBrand : K.Text2, FontWeight.SemiBold).Also(t => { t.HorizontalAlignment = HorizontalAlignment.Center; t.VerticalAlignment = VerticalAlignment.Center; }) };
            chip.Tip(m.About);
            var id = m.Id;
            K.Pressable(chip, () => { modo = id; Redraw(); });
            modes.Add(chip);
        }
        v.Children.Add(modes.Panel);
        v.Children.Add(K.Wrap(Modes.First(m => m.Id == modo).About, 11.5, K.Faint).Also(t => t.Margin = new Thickness(2, 6, 0, 0)));

        var head = new DockPanel { Margin = new Thickness(0, 14, 0, 6) };
        var count = K.T(pick.Count == 0 ? "o time todo" : $"{pick.Count} marcados", 10.5, K.Faint); DockPanel.SetDock(count, Dock.Right); head.Children.Add(count);
        head.Children.Add(K.Label("Quem entra").Also(l => l.Margin = new Thickness(0)));
        v.Children.Add(head);
        var who = new WrapPanel();
        if (people.Count == 0) who.Children.Add(K.T(loadingPeople ? "Carregando…" : "Sem lista do servidor: entra o time todo.", 12, K.Muted));
        foreach (var p in people)
        {
            var on = pick.Count == 0 ? !p.Virtual : pick.Contains(p.Id);
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { K.Avatar(p.Id, 18), K.T(K.Nice(p.Id), 11.5, on ? K.Text : K.Muted, FontWeight.SemiBold) } };
            var chip = new Border { CornerRadius = new CornerRadius(10), Padding = new Thickness(6, 4, 10, 4), Margin = new Thickness(0, 0, 6, 6), Background = on ? K.Raised : Brushes.Transparent, BorderBrush = on ? K.Brand : K.Line, BorderThickness = new Thickness(1), Opacity = on ? 1 : .7, Child = row };
            chip.Tip($"{p.Papel}{(p.Virtual ? " · especialista: só opina na chamada" : "")}");
            var id = p.Id;
            K.Pressable(chip, () =>
            {
                if (pick.Count == 0) foreach (var x in people.Where(x => !x.Virtual)) pick.Add(x.Id);
                if (!pick.Remove(id)) pick.Add(id);
                // Voltou a ser exatamente o time: guarda como "o time todo".
                if (pick.SetEquals(people.Where(x => !x.Virtual).Select(x => x.Id))) pick.Clear();
                Redraw();
            });
            who.Children.Add(chip);
        }
        v.Children.Add(who);

        if (toast.Length > 0) v.Children.Add(Toast());
        v.Children.Add(Gap(10));
        v.Children.Add(K.Button(goal ? "Iniciar Modo Goal" : "Começar chamada", goal ? K.IPlay : K.IPhone, () => _ = Begin(s)));
        var cfgLink = K.T("Modo e quem entra por padrão, voz e avanço automático: Launcher › Ajustes", 11, K.Faint).Also(t => { t.Margin = new Thickness(2, 10, 0, 0); t.Cursor = new Cursor(StandardCursorType.Hand); });
        K.Pressable(cfgLink, host.OpenLauncher);
        v.Children.Add(cfgLink);
    }

    async Task Begin(HudSnapshot s)
    {
        var t = topic.Trim();
        if (t.Length == 0 && modo == "goal") t = string.IsNullOrWhiteSpace(s.Goal) ? "Tocar o Goal ativo" : s.Goal!;
        if (t.Length == 0) { toast = "Não comecei: escreva o assunto da chamada."; Redraw(); return; }
        typing = false;
        var err = await host.StartCall(t, pick ?? [], modo ?? "debate");
        toast = err is null ? "" : $"Não comecei: {err}";
        if (err is null) topic = "";
        sig = "";
        Render(true);
    }

    // Menu de 3 pontos da chamada: expulsar um agente (dois toques) e o aviso de que quem fica sem tokens sai sozinho.
    Control CallMenu(HudSnapshot s)
    {
        var list = new StackPanel { Spacing = 6 };
        list.Children.Add(K.T("Tirar da chamada", 12, K.Muted, FontWeight.SemiBold));
        foreach (var id in s.CallWho)
        {
            var who = id;
            var row = new DockPanel();
            var sure = kickConfirm == who;
            var kick = K.Button(sure ? "Toque de novo" : "Expulsar", K.IClose, async () =>
            {
                if (kickConfirm != who) { kickConfirm = who; Redraw(); DispatcherTimer.RunOnce(() => { if (kickConfirm == who) { kickConfirm = null; Redraw(); } }, TimeSpan.FromSeconds(3)); return; }
                kickConfirm = null;
                var e = await host.CallKick(who);
                toast = e is null ? $"{K.Nice(who)} saiu da chamada." : $"Não tirei: {e}";
                Redraw();
            }, primary: false, danger: true, height: 30);
            DockPanel.SetDock(kick, Dock.Right); row.Children.Add(kick);
            row.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center, Children = { K.Avatar(who, 22), K.T(K.Nice(who), 12.5, K.Text) } });
            list.Children.Add(row);
        }
        if (s.CallWho.Count == 0) list.Children.Add(K.T("Ninguém na chamada.", 12, K.Muted));
        list.Children.Add(K.Wrap("Quem ficar sem tokens no meio da conversa sai sozinho, e a chamada segue com os outros.", 11.5, K.Muted, 3).Also(t => t.Margin = new Thickness(0, 4, 0, 0)));
        return new Border { Background = K.Side, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 10), Margin = new Thickness(0, 10, 0, 0), Child = list };
    }

    void CallLive(StackPanel v, HudSnapshot s)
    {
        var waiting = s.CallStatus == "AGUARDANDO_DONO";
        var goal = s.CallModo == "goal";
        var head = new DockPanel();
        var voice = new Border { Width = 30, Height = 30, CornerRadius = new CornerRadius(8), Background = host.VoiceOn ? K.Raised : Brushes.Transparent, BorderBrush = K.Line, BorderThickness = new Thickness(1), Child = K.Icon(host.VoiceOn ? K.ISound : K.IMute, 14, host.VoiceOn ? K.BrandText : K.Muted) };
        voice.Tip(host.VoiceOn ? "Lendo as falas em voz alta (clique para calar)" : "Ler as falas em voz alta");
        K.Pressable(voice, host.ToggleVoice);
        DockPanel.SetDock(voice, Dock.Right); head.Children.Add(voice);
        // Menu de 3 pontos: tirar alguém da chamada.
        var more = new Border { Width = 30, Height = 30, Margin = new Thickness(0, 0, 6, 0), CornerRadius = new CornerRadius(8), Background = callMenu ? K.Raised : Brushes.Transparent, BorderBrush = K.Line, BorderThickness = new Thickness(1), Child = K.T("⋯", 16, K.Text2, FontWeight.Bold).Also(t => { t.HorizontalAlignment = HorizontalAlignment.Center; t.VerticalAlignment = VerticalAlignment.Center; }) };
        more.Tip("Mais opções da chamada");
        K.Pressable(more, () => { callMenu = !callMenu; kickConfirm = null; Redraw(); });
        DockPanel.SetDock(more, Dock.Right); head.Children.Add(more);
        head.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center, Children = { K.Pill(waiting ? "SUA VEZ" : "AO VIVO", waiting ? K.Warn : K.Ok), K.T($"{ModeName(s.CallModo)} · {s.CallTurns} falas", 12, K.Muted) } });
        v.Children.Add(head);
        if (callMenu) v.Children.Add(CallMenu(s));

        // A roda: quem falou por último fica com o anel aceso; clique passa a vez para ele.
        var lastSpeaker = s.CallLog.Count > 0 ? s.CallLog[^1].Speaker : "";
        var ring = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 14, 0, 4) };
        var orb = new VoiceOrb(46) { Level = host.Thinking ? .9 : host.VoiceOn && host.Pumping ? .6 : .25 };
        ring.Children.Add(orb.Also(o => o.Tip(host.Thinking ? "Pensando na próxima fala…" : "AgentC")));
        foreach (var id in s.CallWho)
        {
            var on = id == lastSpeaker;
            var b = new Border { CornerRadius = new CornerRadius(20), Padding = new Thickness(2), BorderThickness = new Thickness(2), BorderBrush = on ? K.Brand : Brushes.Transparent, Opacity = on ? 1 : .62, Child = K.Avatar(id, 30), VerticalAlignment = VerticalAlignment.Center };
            b.Tip($"{K.Nice(id)} · clique para ele falar agora");
            var who = id;
            K.Pressable(b, async () => { var e = await host.CallTurn(who); toast = e is null ? $"{K.Nice(who)} fala agora." : $"Não passei a vez: {e}"; Redraw(); });
            ring.Children.Add(b);
        }
        v.Children.Add(ring);
        v.Children.Add(K.Wrap(s.CallTopic ?? "", 14.5, K.Text, 2, w: FontWeight.SemiBold, f: K.Display).Also(t => { t.TextAlignment = TextAlignment.Center; t.Margin = new Thickness(0, 6, 0, 12); }));

        // As últimas falas, mais nova embaixo (como numa conversa).
        var log = new StackPanel { Spacing = 8 };
        // Só as 3 últimas: a caixa de falar e os botões precisam caber sem rolar.
        foreach (var (speaker, text) in s.CallLog.TakeLast(3))
        {
            var me = speaker == "DONO";
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
            row.Children.Add(K.Avatar(speaker, 24).Also(a => a.VerticalAlignment = VerticalAlignment.Top));
            var col = new StackPanel { Margin = new Thickness(10, 0, 0, 0), Spacing = 1 };
            col.Children.Add(K.T(me ? "Você" : K.Nice(speaker), 11.5, me ? K.Text2 : K.BrandText, FontWeight.SemiBold));
            col.Children.Add(K.Wrap(text, 12.5, me ? K.Text2 : K.Text, 4, 18).Also(t => t.Tip(text)));
            Grid.SetColumn(col, 1); row.Children.Add(col);
            log.Children.Add(row);
        }
        if (host.Thinking) log.Children.Add(ThinkingDots());
        v.Children.Add(new Border { Background = K.Side, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 10), Child = log });
        if (waiting) v.Children.Add(K.Wrap("O time parou e espera você. Escreva algo ou peça uma rodada.", 12, K.Warn).Also(t => t.Margin = new Thickness(2, 8, 0, 0)));

        v.Children.Add(Gap(10));
        v.Children.Add(TextField("Falar na chamada", "", _ => { }, null, async text =>
        {
            var e = await host.CallSay(text);
            toast = e is null ? "" : $"Não enviei: {e}";
            Redraw();
        }));
        if (toast.Length > 0) v.Children.Add(Toast());
        v.Children.Add(Gap(10));
        var btns = new Cols(goal || host.Settings.CallAutoAdvance ? 2 : 3);
        btns.Add(K.Button("Rodada", K.IPeople, async () => { var e = await host.CallRound(); toast = e is null ? "Todo mundo vai falar uma vez." : $"Não pedi a rodada: {e}"; Redraw(); }, primary: false, height: 34).Also(b => b.Tip("Cada um da chamada fala uma vez, na ordem")));
        if (!goal && !host.Settings.CallAutoAdvance) btns.Add(K.Button("Próxima fala", K.IPlay, host.CallNextManual, height: 34));
        btns.Add(K.Button(confirmEnd ? "Toque de novo" : "Encerrar", K.IStop, () =>
        {
            // Dois toques: encerrar sem querer cortava a chamada e gerava a ata pela metade.
            if (!confirmEnd) { confirmEnd = true; Redraw(); DispatcherTimer.RunOnce(() => { if (confirmEnd) { confirmEnd = false; Redraw(); } }, TimeSpan.FromSeconds(3)); return; }
            confirmEnd = false; toast = ""; host.EndCall();
        }, primary: false, danger: true, height: 34));
        v.Children.Add(btns.Panel);
    }

    /// <summary>Três pontinhos que sobem e descem enquanto o modelo pensa a próxima fala.</summary>
    Control ThinkingDots()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5, Margin = new Thickness(34, 2, 0, 0) };
        var dots = Enumerable.Range(0, 3).Select(_ => new Ellipse { Width = 6, Height = 6, Fill = K.Muted, RenderTransform = new TranslateTransform() }).ToList();
        foreach (var d in dots) row.Children.Add(d);
        row.Children.Add(K.T("pensando", 11.5, K.Faint).Also(t => t.Margin = new Thickness(4, 0, 0, 0)));
        if (!K.Reduced)
        {
            var t0 = DateTime.Now;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(40) };
            timer.Tick += (_, _) =>
            {
                if (row.GetVisualRoot() is null && (DateTime.Now - t0).TotalSeconds > 1) { timer.Stop(); return; }
                var t = (DateTime.Now - t0).TotalSeconds;
                for (var i = 0; i < dots.Count; i++) ((TranslateTransform)dots[i].RenderTransform!).Y = -3.5 * Math.Max(0, Math.Sin(t * 6 - i * .8));
            };
            timer.Start();
        }
        return row;
    }

    /// <summary>Caixa de texto simples do painel. Enter envia (send) ou chama enter.</summary>
    Control TextField(string hint, string text, Action<string> changed, Action? enter, Func<string, Task>? send = null)
    {
        var box = new TextBox { Watermark = hint, Text = text, FontSize = 13, FontFamily = K.Ui, Background = Brushes.Transparent, BorderThickness = new Thickness(0), CaretBrush = K.Brand, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0), Padding = new Thickness(0) };
        box.GotFocus += (_, _) => typing = true;
        box.LostFocus += (_, _) => typing = false;
        box.TextChanged += (_, _) => changed(box.Text ?? "");
        async void Go()
        {
            if (send is null) { enter?.Invoke(); return; }
            var t = (box.Text ?? "").Trim();
            if (t.Length == 0) return;
            box.Text = "";
            typing = false;
            await send(t);
        }
        box.KeyDown += (_, e) => { if (e.Key == Key.Enter) { e.Handled = true; Go(); } };
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), MinHeight = 32 };
        row.Children.Add(box);
        if (send is not null)
        {
            var sendB = new Border { Width = 32, Height = 32, CornerRadius = new CornerRadius(9), Background = K.Brand, Child = K.Icon(K.ISend, 14, K.OnBrand) };
            sendB.Tip("Enviar (Enter)");
            K.Pressable(sendB, Go);
            Grid.SetColumn(sendB, 1); row.Children.Add(sendB);
        }
        return new Border { Background = K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(5), Child = row };
    }

    void Goal(StackPanel v, HudSnapshot s, bool animate)
    {
        var running = s.CallActive && s.CallModo == "goal";
        var head = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
        if (running) { var p = K.Pill("EM EXECUÇÃO", K.Ok); DockPanel.SetDock(p, Dock.Right); head.Children.Add(p); }
        head.Children.Add(K.T("GOAL ATIVO", 10.5, K.Muted, FontWeight.SemiBold));
        v.Children.Add(head);
        v.Children.Add(K.Wrap(string.IsNullOrWhiteSpace(s.Goal) ? "Nenhum Goal ativo no vault." : s.Goal, 14.5, K.Text, 5, 21, FontWeight.Medium, K.Display));
        if (s.TasksTotal > 0)
        {
            v.Children.Add(Gap(14));
            v.Children.Add(K.Bar((double)s.TasksDone / s.TasksTotal, animate: animate, height: 6));
            v.Children.Add(K.T($"{s.TasksDone} de {s.TasksTotal} tarefas concluídas · {100 * s.TasksDone / s.TasksTotal}%", 12, K.Muted).Also(t => t.Margin = new Thickness(0, 6, 0, 0)));
        }
        v.Children.Add(Gap(14));
        v.Children.Add(running ? K.Button("Encerrar Modo Goal", K.IStop, host.EndCall, primary: false, danger: true) : K.Button("Iniciar Modo Goal", K.IPlay, host.StartGoal));
    }

    void Saude(StackPanel v, HudSnapshot s)
    {
        var working = s.Agents.Count(a => K.StatusBrush(a.Status) == K.Brand);
        v.Children.Add(new Cols(3).Add(Tile("RAM livre", $"{s.RamFreeMb / 1024.0:0.0} GB".Replace('.', ','), s.RamFreeMb < 1500 ? K.Err : K.Text))
            .Add(Tile("CPU", s.Cpu is { } c ? $"{c}%" : "—", s.Cpu > 85 ? K.Warn : K.Text)).Add(Tile("Trabalhando", $"{working}/{s.Agents.Count}", working > 0 ? K.BrandText : K.Text)).Panel);
        if (s.Cpu is > 85)
            v.Children.Add(K.Wrap("CPU quase no máximo: as respostas podem demorar mais.", 11.5, K.Warn).Also(t => t.Margin = new Thickness(2, 8, 0, 0)));
        if (s.RamFreeMb is > 0 and < 1500)
            v.Children.Add(K.Wrap("Pouca memória livre: os agentes esperam abrir espaço antes de começar a próxima rodada.", 11.5, K.Warn).Also(t => t.Margin = new Thickness(2, 8, 0, 0)));
        v.Children.Add(Gap(14));
        v.Children.Add(K.Label("Agentes"));
        foreach (var a in s.Agents.Where(a => a.Id != "CHATGPT"))
        {
            var row = new Grid { Margin = new Thickness(0, 4), ColumnDefinitions = new ColumnDefinitions("18,96,*") };
            row.Children.Add(new Ellipse { Width = 8, Height = 8, Fill = K.StatusBrush(a.Status), HorizontalAlignment = HorizontalAlignment.Left });
            var name = K.T(K.Nice(a.Id), 12.5, K.Text, FontWeight.SemiBold); Grid.SetColumn(name, 1); row.Children.Add(name);
            var code = a.Task is null ? null : Regex.Match(a.Task, @"[TJ]-\d+").Value;
            var st = K.T((string.IsNullOrEmpty(code) ? "" : code + " · ") + K.StatusText(a.Status), 11, K.Muted, f: K.Mono);
            st.HorizontalAlignment = HorizontalAlignment.Right; st.Tip(a.Task); Grid.SetColumn(st, 2); row.Children.Add(st);
            v.Children.Add(row);
        }
        foreach (var al in s.Alerts.Take(3))
        {
            v.Children.Add(Gap(6));
            v.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.Icon(K.IWarn, 12, K.Warn), K.Wrap(al, 12, K.Warn).Also(t => t.MaxWidth = 360) } });
        }
        v.Children.Add(Gap(14));
        v.Children.Add(s.Paused ? K.Button("Retomar os agentes", K.IPlay, () => host.SetPause(false)) : K.Button("Pausar os agentes", K.IPause, () => host.SetPause(true), primary: false));
    }

    void Comandos(StackPanel v, HudSnapshot s)
    {
        v.Children.Add(Composer("Comando para um agente", cmdTo, t => cmdTo = t, async (text, to) =>
        {
            var err = await host.Api.SendCommand(text, to);
            toast = err is null ? $"Comando enviado para {(to == "TODOS" ? "todos" : to == "LEADER" ? "o líder" : K.Nice(to))}." : $"Não enviei: {err}";
            await LoadCmds();
        }, withLeader: true));
        if (toast.Length > 0) v.Children.Add(Toast());

        var pend = cmds.Where(c => c.Approval == "pending").ToList();
        if (pend.Count > 0)
        {
            v.Children.Add(K.Label("Esperando você").Also(l => l.Margin = new Thickness(0, 14, 0, 6)));
            foreach (var c in pend.Take(3))
            {
                var code = c.Code;
                var g = new StackPanel { Spacing = 8 };
                g.Children.Add(new StackPanel { Children = { K.T($"{c.Code} · {K.Nice(c.Target)}", 11.5, K.Warn, FontWeight.SemiBold, K.Mono), K.Wrap(c.Text, 12.5, K.Text, 3).Also(t => t.Margin = new Thickness(0, 3, 0, 0)) } });
                g.Children.Add(new Cols().Add(K.Button("Recusar", K.IClose, async () => { var e = await host.Api.Decide(code, false); toast = e ?? $"{code} recusado."; host.KickRefresh(); await LoadCmds(); }, primary: false, danger: true, height: 32))
                    .Add(K.Button("Aprovar", K.ICheck, async () => { var e = await host.Api.Decide(code, true); toast = e ?? $"{code} aprovado (só este comando)."; host.KickRefresh(); await LoadCmds(); }, height: 32)).Panel);
                v.Children.Add(new Border { Background = new SolidColorBrush(Color.FromArgb(22, 245, 158, 11)), BorderBrush = new SolidColorBrush(Color.FromArgb(70, 245, 158, 11)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 10), Margin = new Thickness(0, 0, 0, 8), Child = g });
            }
            if (pend.Count > 3) v.Children.Add(K.T($"+{pend.Count - 3} na tela completa", 11.5, K.Muted));
        }

        v.Children.Add(K.Label("Últimos comandos").Also(l => l.Margin = new Thickness(0, 14, 0, 6)));
        var recent = cmds.Where(c => c.Approval != "pending").OrderByDescending(c => int.TryParse(c.Code.AsSpan(2), out var x) ? x : 0).Take(5).ToList();
        if (recent.Count == 0) v.Children.Add(K.T(loadingCmds ? "Carregando…" : "Nenhum comando ainda.", 12.5, K.Muted));
        foreach (var c in recent)
        {
            var row = new Grid { Margin = new Thickness(0, 4), ColumnDefinitions = new ColumnDefinitions("52,78,*,Auto,Auto") };
            row.Children.Add(K.T(c.Code, 11.5, K.Muted, f: K.Mono));
            var who = K.T(K.Nice(c.Target), 12, K.Text, FontWeight.SemiBold); Grid.SetColumn(who, 1); row.Children.Add(who);
            var what = K.T(c.Text, 12, K.Text2); what.TextTrimming = TextTrimming.CharacterEllipsis; what.Margin = new Thickness(0, 0, 8, 0); Grid.SetColumn(what, 2); row.Children.Add(what);
            var st = K.Pill(K.StatusText(c.Status), K.StatusBrush(c.Status)); Grid.SetColumn(st, 3); row.Children.Add(st);
            var ago = K.T(string.IsNullOrEmpty(c.When) ? "" : K.Ago(c.When), 10.5, K.Faint).Also(t => { t.Margin = new Thickness(8, 0, 0, 0); t.VerticalAlignment = VerticalAlignment.Center; }); Grid.SetColumn(ago, 4); row.Children.Add(ago);
            row.Tip($"{c.Code} · {K.Nice(c.Target)} · {c.When}\n{c.Text}");
            v.Children.Add(row);
        }
        v.Children.Add(Gap(10));
        v.Children.Add(K.Button("Ver todos na tela completa", K.IOpen, () => { Collapse(); host.OpenFull(); }, primary: false, height: 34));
    }

    /// <summary>Caixa de texto do painel: destinatário (clique troca), texto e enviar. Enter envia.</summary>
    Control Composer(string hint, string to, Action<string> setTo, Func<string, string, Task> send, bool withLeader)
    {
        string Label(string id) => id == "TODOS" ? "Todos" : id == "LEADER" ? "Líder" : K.Nice(id);
        var box = new TextBox { Watermark = hint, FontSize = 13, FontFamily = K.Ui, Background = Brushes.Transparent, BorderThickness = new Thickness(0), CaretBrush = K.Brand, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(6, 0), Padding = new Thickness(0) };
        box.GotFocus += (_, _) => typing = true;
        box.LostFocus += (_, _) => typing = false;
        var toTx = K.T(Label(to), 11.5, to == "TODOS" ? K.Muted : K.BrandText, FontWeight.SemiBold);
        var toB = new Border { CornerRadius = new CornerRadius(10), Padding = new Thickness(10, 5, 10, 6), Background = K.Raised, Child = toTx, VerticalAlignment = VerticalAlignment.Center };
        toB.Tip("Para quem (clique para trocar)");
        K.Pressable(toB, () =>
        {
            var ids = (withLeader ? new[] { "TODOS", "LEADER" } : ["TODOS"]).Concat(host.Snap.Agents.Select(a => a.Id).Where(i => i != "CHATGPT")).ToList();
            to = ids[(ids.IndexOf(to) + 1) % ids.Count];
            setTo(to);
            toTx.Text = Label(to);
            toTx.Foreground = to == "TODOS" ? K.Muted : K.BrandText;
        });
        async void Go()
        {
            var t = (box.Text ?? "").Trim();
            if (t.Length == 0) return;
            box.Text = "";
            typing = false;
            await send(t, to);
            sig = "";
            Render(false);
        }
        box.KeyDown += (_, e) => { if (e.Key == Key.Enter) { e.Handled = true; Go(); } };
        var sendB = new Border { Width = 32, Height = 32, CornerRadius = new CornerRadius(9), Background = K.Brand, Child = K.Icon(K.ISend, 14, K.OnBrand) };
        sendB.Tip("Enviar (Enter)");
        K.Pressable(sendB, Go);
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        row.Children.Add(toB); Grid.SetColumn(box, 1); row.Children.Add(box); Grid.SetColumn(sendB, 2); row.Children.Add(sendB);
        return new Border { Background = K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(5), Child = row };
    }

    Control Toast()
    {
        var bad = toast.StartsWith("Não");
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7, Margin = new Thickness(4, 8, 0, 0), Children = { K.Icon(bad ? K.IWarn : K.ICheck, 13, bad ? K.Err : K.Ok), K.Wrap(toast, 12, bad ? K.Err : K.Ok).Also(t => t.MaxWidth = 340) } };
        K.EnterUp(row, 0, 4);
        return row;
    }

    /// <summary>Atalho quadrado do Início: ícone em cima, nome embaixo, mola no toque.</summary>
    static Border Quick(string icon, string label, Action go, IBrush? tone = null, string? badge = null)
    {
        var bg = new SolidColorBrush(K.C("#161616"));
        var col = new StackPanel { Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        col.Children.Add(K.Icon(icon, 17, tone ?? K.BrandText).Also(i => i.HorizontalAlignment = HorizontalAlignment.Center));
        col.Children.Add(K.T(label, 11.5, K.Text2, FontWeight.SemiBold).Also(t => t.HorizontalAlignment = HorizontalAlignment.Center));
        var g = new Grid { Children = { col } };
        if (badge is not null) g.Children.Add(K.Pill(badge, K.Warn).Also(p => { p.HorizontalAlignment = HorizontalAlignment.Right; p.VerticalAlignment = VerticalAlignment.Top; p.Margin = new Thickness(0, 5, 5, 0); }));
        var b = new Border { Height = 64, CornerRadius = new CornerRadius(12), Background = bg, BorderBrush = K.Line, BorderThickness = new Thickness(1), Child = g };
        K.Pressable(b, go, () => K.AnimColor(bg, K.C("#1F1F1F"), 120), () => K.AnimColor(bg, K.C("#161616"), 160));
        return b;
    }

    static Border Tile(string label, string value, IBrush tone) => new()
    {
        Background = K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10), Padding = new Thickness(10, 8),
        Child = new StackPanel { Children = { K.T(label.ToUpperInvariant(), 9.5, K.Muted, FontWeight.SemiBold), K.T(value, 17, tone, FontWeight.SemiBold, K.Display) } },
    };

    string Sig(HudSnapshot s) => tab switch
    {
        0 => $"{string.Join(",", host.People.Where(p => p.Online).Select(p => p.Id))}{s.Online}{s.Pending}{s.Working}{s.Paused}{s.CallStatus}{s.CallModo}{string.Join(",", s.Agents.Select(a => a.Id + a.Status))}{string.Join(",", s.Usage.Select(u => u.Agent + u.Req))}",
        1 => replyTo + toast + string.Join("|", s.Chat.Take(5).Select(c => c.Ts + c.Agent)),
        2 => $"{s.CallStatus}{s.CallModo}{s.CallTurns}{string.Join(",", s.CallWho)}{host.Thinking}{host.VoiceOn}{host.Settings.CallAutoAdvance}|{toast}|{people.Count}{loadingPeople}{modo}{string.Join(",", pick ?? [])}",
        3 => $"{s.Goal}{s.TasksDone}/{s.TasksTotal}{s.CallStatus}{s.CallModo}",
        4 => $"{s.RamFreeMb / 100}{s.Cpu / 5}{s.Paused}{string.Join(",", s.Agents.Select(a => a.Id + a.Status))}{string.Join(",", s.Alerts)}",
        _ => $"{s.Pending}|{toast}|{cmdTo}|{string.Join(",", cmds.Take(8).Select(c => c.Code + c.Status + c.Approval))}",
    };
}
