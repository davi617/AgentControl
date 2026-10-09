using System.Reflection;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using AgentControl.Core;

namespace AgentControl.Ui;

/// <summary>
/// Agent Control · Launcher (Windows, Linux e macOS).
/// Em cima: AgentC, estado, caminho (roteador → fila → servidor → agentes) e as ações principais.
/// Embaixo, em abas: Início (serviços, apps e o time), Agentes (cada um com ligar/parar, pasta, log e ordem),
/// Comandos (mandar, aprovar, recusar), Uso (7 dias), Logs e Ajustes. Fechar esta janela NÃO desliga nada.
/// Atalhos: Ctrl+1…6 trocam de aba, F5 atualiza.
/// </summary>
public sealed class LauncherWindow : Window
{
    enum Tab { Inicio, Agentes, Comandos, Uso, Logs, Ajustes }
    static readonly (Tab T, string Icon, string Name)[] Tabs =
        [(Tab.Inicio, K.IHome, "Início"), (Tab.Agentes, K.IPeople, "Agentes"), (Tab.Comandos, K.ISend, "Comandos"), (Tab.Uso, K.IUsage, "Uso"), (Tab.Logs, K.ILogs, "Logs"), (Tab.Ajustes, K.ISettings, "Ajustes")];

    readonly Services svc = new();
    readonly HudApi api = new();
    readonly Grid root = new() { Background = K.Bg };
    readonly StackPanel pipeline = new() { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
    readonly TextBlock heroTitle = K.T("", 24, K.Text, FontWeight.SemiBold, K.Display);
    readonly TextBlock heroSub = K.T("", 13, K.Muted);
    readonly StackPanel actions = new() { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
    readonly TextBlock ramText = K.T("", 12, K.Text2, FontWeight.SemiBold, K.Mono);
    readonly Grid ramBar = new() { Width = 70 };
    readonly TextBlock goalText = K.T("", 12, K.Text2);
    readonly Panel overlay = new() { IsVisible = false };
    readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(4) };
    // abas
    readonly List<(Tab T, SolidColorBrush Bg, K.Ico Icon, TextBlock Text, Border Badge)> tabButtons = [];
    readonly ContentControl tabBody = new();
    readonly TextBlock tabInfo = K.T("", 11, K.Faint, f: K.Mono);
    Tab tab = Tab.Inicio;
    // Início
    readonly StackPanel serviceRows = new();
    readonly WrapPanel appTiles = new();
    readonly UniformGrid agentCards = new() { Columns = 2 };
    Control? inicioView;
    // Agentes
    readonly StackPanel agentRows = new();
    // Comandos
    readonly WrapPanel cmdTargets = new();
    readonly TextBox cmdBox = new() { PlaceholderText = "Ordem para o time (ex.: rode os testes do login e me diga o que falhou)", FontSize = 14, Background = Brushes.Transparent, BorderThickness = new Thickness(0), CaretBrush = K.Brand, VerticalAlignment = VerticalAlignment.Center, AcceptsReturn = false };
    readonly TextBlock cmdToast = K.T("", 12.5, K.Ok);
    readonly StackPanel pendingPanel = new() { Spacing = 8 };
    readonly StackPanel historyPanel = new();
    string cmdTo = "TODOS";
    List<HudApi.Cmd> cmds = [];
    // Uso
    readonly ContentControl usageBody = new();
    (List<(string Dia, int Req, long Tokens)> Days, List<(string Agent, int Req, long Tokens, int R429, int MsMedio)> Agents) usage = ([], []);
    DateTime usageAt;
    // Logs
    readonly StackPanel logLines = new() { Spacing = 3 };
    readonly ScrollViewer logScroll = new() { VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
    readonly StackPanel fullLog = new() { Spacing = 4 };
    readonly ScrollViewer fullLogScroll = new() { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    readonly StackPanel loopLogs = new() { Spacing = 6 };

    HudSnapshot snap = HudSnapshot.Offline;
    Dictionary<string, (string Model, string Effort)> models = [];
    HashSet<string> alive = [];
    ServiceState router, gate, jarvis;
    bool refreshing, busy, first = true;
    public bool Ready { get; private set; }

    public LauncherWindow()
    {
        Title = "Agent Control";
        Width = 1260; Height = 840; MinWidth = 1040; MinHeight = 680;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = K.Bg; Foreground = K.Text; FontFamily = K.Ui;
        Icon = Program.AppIcon();
        try { svc.Load(); }
        catch (Exception ex) { Content = K.Wrap($"Não consegui ler {svc.SettingsPath}: {ex.Message}", 14, K.Err).Also(t => t.Margin = new Thickness(40)); return; }
        api.Configure(svc.Settings);
        svc.Logged += line => Dispatcher.UIThread.Post(() => AddLog(line));
        Content = Build();
        try { foreach (var l in File.ReadLines(svc.LogPath).Where(x => !x.Contains("Launcher pronto")).TakeLast(40)) AddLog(l.Length > 11 ? l[11..] : l); } catch { }
        timer.Tick += async (_, _) => await Refresh();
        KeyDown += async (_, e) =>
        {
            if (e.KeyModifiers.HasFlag(KeyModifiers.Control) && e.Key >= Key.D1 && e.Key <= Key.D6) { ShowTab((Tab)(e.Key - Key.D1)); e.Handled = true; }
            else if (e.Key == Key.F5) { e.Handled = true; await Refresh(); }
            else if (e.Key == Key.Escape && overlay.IsVisible) { e.Handled = true; K.Fade(overlay, 0, 140, K.InQuad, done: () => overlay.IsVisible = false); }
        };
        Opened += async (_, _) =>
        {
            // Cabe na tela (notebook com escala 125% tem ~830 de altura útil).
            var (wa, _) = K.WorkArea(this);
            Height = Math.Min(Height, wa.Height - 24); Width = Math.Min(Width, wa.Width - 24);
            K.MoveTo(this, wa.Left + (wa.Width - Width) / 2, wa.Top + (wa.Height - Height) / 2);
            timer.Start();
            svc.Note($"Launcher pronto ({Platform.Name}). Fechar esta janela não desliga os serviços nem os agentes.");
            await Refresh();
        };
    }

    // ======================================================================= estrutura
    Control Build()
    {
        var page = new Grid { Margin = new Thickness(28, 20, 28, 18), RowDefinitions = new RowDefinitions("Auto,Auto,Auto,*") };

        // ---------- cabeçalho ----------
        var head = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto"), Margin = new Thickness(0, 0, 0, 16) };
        head.Children.Add(K.Face(42));
        var brand = new StackPanel { Margin = new Thickness(14, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, Spacing = 2 };
        brand.Children.Add(K.T("AGENT CONTROL", 21, K.Text, FontWeight.Bold, K.Display).Also(t => t.LetterSpacing = 1.4));
        brand.Children.Add(K.T($"LAUNCHER · {Platform.Name.ToUpperInvariant()} · SEU TIME DE AGENTES NUM SÓ LUGAR", 10.5, K.Muted, FontWeight.SemiBold).Also(t => t.LetterSpacing = 1.2));
        Grid.SetColumn(brand, 1); head.Children.Add(brand);
        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        chips.Children.Add(Chip(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.Icon(K.IChip, 13, K.Muted), ramBar, ramText } }).Tip("Memória livre agora"));
        goalText.MaxWidth = 300;
        chips.Children.Add(Chip(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.Icon(K.IGoal, 13, K.BrandText), goalText } }));
        chips.Children.Add(Chip(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7, Children = { K.Icon(K.IShield, 13, K.Ok), K.T("só neste PC", 12, K.Text2) } }).Tip("Tudo escuta só em 127.0.0.1. Acesso de fora só pelo Tailscale com token."));
        Grid.SetColumn(chips, 2); head.Children.Add(chips);
        page.Children.Add(head);

        // ---------- faixa principal ----------
        var hero = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), RowDefinitions = new RowDefinitions("Auto,Auto") };
        hero.Children.Add(new StackPanel { Spacing = 4, Children = { heroTitle, heroSub } });
        Grid.SetColumn(actions, 1); hero.Children.Add(actions);
        pipeline.Margin = new Thickness(0, 16, 0, 0);
        Grid.SetRow(pipeline, 1); Grid.SetColumnSpan(pipeline, 2); hero.Children.Add(pipeline);
        var heroCard = new Border { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(20), Padding = new Thickness(24, 18, 20, 18), Child = hero };
        Grid.SetRow(heroCard, 1); page.Children.Add(heroCard);

        // ---------- abas ----------
        var bar = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto"), Margin = new Thickness(0, 14, 0, 12) };
        var tabsRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        foreach (var (t, icon, name) in Tabs)
        {
            var bg = new SolidColorBrush(Colors.Transparent);
            var ic = K.Icon(icon, 14, K.Muted);
            var tx = K.T(name, 13, K.Muted, FontWeight.SemiBold);
            var badge = new Border { Background = K.Warn, CornerRadius = new CornerRadius(8), Padding = new Thickness(6, 0), Height = 16, IsVisible = false, Child = K.T("", 10, K.OnBrand, FontWeight.Bold) };
            var b = new Border { Height = 36, Padding = new Thickness(14, 0), CornerRadius = new CornerRadius(10), Background = bg, Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { ic, tx, badge } } };
            b.Tip($"{name} (Ctrl+{(int)t + 1})");
            K.Pressable(b, () => ShowTab(t), () => { if (tab != t) K.AnimColor(bg, K.C("#141414"), 120); }, () => { if (tab != t) K.AnimColor(bg, Colors.Transparent, 160); });
            tabButtons.Add((t, bg, ic, tx, badge));
            tabsRow.Children.Add(b);
        }
        bar.Children.Add(new Border { Background = K.Side, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(13), Padding = new Thickness(4), Child = tabsRow });
        Grid.SetColumn(tabInfo, 2); bar.Children.Add(tabInfo);
        Grid.SetRow(bar, 2); page.Children.Add(bar);
        Grid.SetRow(tabBody, 3); page.Children.Add(tabBody);

        root.Children.Add(page);
        root.Children.Add(overlay);
        ShowTab(Tab.Inicio, animate: false);
        K.EnterUp(head, 0, 8); K.EnterUp(heroCard, 60, 10); K.EnterUp(bar, 100, 10); K.EnterUp(tabBody, 140, 12);
        return root;
    }

    void ShowTab(Tab t, bool animate = true)
    {
        tab = t;
        foreach (var b in tabButtons)
        {
            var on = b.T == t;
            K.AnimColor(b.Bg, on ? K.C("#1C1C1C") : Colors.Transparent, 160);
            b.Icon.Color = on ? K.BrandText : K.Muted;
            b.Text.Foreground = on ? K.Text : K.Muted;
        }
        tabBody.Content = t switch
        {
            Tab.Inicio => inicioView ??= InicioView(),
            Tab.Agentes => Scroll(agentRows),
            Tab.Comandos => ComandosView(),
            Tab.Uso => Scroll(usageBody),
            Tab.Logs => LogsView(),
            _ => AjustesView(),
        };
        if (animate && tabBody.Content is Visual v) K.EnterUp(v, 0, 8);
        RenderTab();
        if (t is Tab.Comandos or Tab.Uso) _ = LoadTabData();
    }

    static ScrollViewer Scroll(Control c) => new() { VerticalScrollBarVisibility = ScrollBarVisibility.Hidden, Content = c };

    static Border Chip(Control inner) =>
        new() { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(16), Padding = new Thickness(12, 7, 14, 7), Child = inner };

    static Border Link(string text, string icon, Action go, bool danger = false)
    {
        var fg = danger ? new SolidColorBrush(K.C("#F87171")) : K.Muted;
        var b = new Border { Padding = new Thickness(8, 6), CornerRadius = new CornerRadius(8), Background = Brushes.Transparent, Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { K.Icon(icon, 13, fg), K.T(text, 12.5, fg, FontWeight.SemiBold) } } };
        K.Pressable(b, go);
        return b;
    }

    /// <summary>Botãozinho só com ícone (ações de cada agente).</summary>
    static Border IconBtn(string icon, string tip, Action go, IBrush? color = null)
    {
        var bg = new SolidColorBrush(K.C("#181818"));
        var b = new Border { Width = 34, Height = 34, CornerRadius = new CornerRadius(9), Background = bg, BorderBrush = K.Line, BorderThickness = new Thickness(1), Child = K.Icon(icon, 14, color ?? K.Text2) };
        b.Tip(tip);
        K.Pressable(b, go, () => K.AnimColor(bg, K.C("#222222"), 120), () => K.AnimColor(bg, K.C("#181818"), 160));
        return b;
    }

    /// <summary>Botão de ação: enquanto uma ação longa roda, as outras esperam.</summary>
    Border Action(string text, string? icon, Func<Task> go, bool primary = false, bool danger = false, double height = 42)
    {
        Border? b = null;
        b = K.Button(text, icon, async () =>
        {
            if (busy) { svc.Log("Aguarde: outra ação ainda está rodando."); return; }
            busy = true; b!.Opacity = .55;
            try { await go(); } catch (Exception ex) { svc.Log($"Erro: {ex.Message}"); }
            finally { busy = false; b!.Opacity = 1; await Refresh(); }
        }, primary: primary, danger: danger, height: height);
        return b;
    }

    void AddLog(string line)
    {
        var color = line.Contains("ATENÇÃO") || line.Contains("falhou") || line.Contains("Erro") ? K.Err : line.Contains("pronto") || line.Contains("online") ? K.Text2 : K.Muted;
        logLines.Children.Add(K.Wrap(line, 11.5, color, maxLines: 2, f: K.Mono).Tip(line));
        while (logLines.Children.Count > 30) logLines.Children.RemoveAt(0);
        fullLog.Children.Add(K.Wrap(line, 12, color, f: K.Mono));
        while (fullLog.Children.Count > 400) fullLog.Children.RemoveAt(0);
        logScroll.ScrollToEnd(); fullLogScroll.ScrollToEnd();
    }

    // ======================================================================= estado
    async Task Refresh()
    {
        if (refreshing) return;
        refreshing = true;
        try
        {
            var ram = await Task.Run(Platform.FreeRamMb);
            ramText.Text = $"{ram / 1024.0:0.0} GB".Replace('.', ',');
            ramText.Foreground = ram < 1500 ? K.Err : K.Text2;
            ramBar.Children.Clear(); ramBar.Children.Add(K.Bar(Math.Clamp(ram / 16000.0, .03, 1), ram < 1500 ? K.Err : K.Ok, 5, first));
            router = await Task.Run(svc.RouterState);
            gate = await Task.Run(svc.GateState);
            jarvis = await svc.JarvisStateAsync();
            snap = jarvis == ServiceState.Online ? await api.SnapshotAsync() : HudSnapshot.Offline;
            if (jarvis == ServiceState.Online && (first || models.Count == 0 || DateTime.Now.Second < 5)) models = await api.ModelsAsync();
            goalText.Text = string.IsNullOrWhiteSpace(snap.Goal) ? "sem Goal ativo" : snap.Goal;
            ToolTip.SetTip(goalText, snap.Goal);
            var loops = svc.Settings.LoopAgents;
            alive = await Task.Run(() => loops.Where(Platform.LoopAlive).ToHashSet());

            var allOn = router == ServiceState.Online && gate == ServiceState.Online && jarvis == ServiceState.Online;
            var exposed = router == ServiceState.Exposed || gate == ServiceState.Exposed;
            var working = snap.Agents.Count(a => K.StatusBrush(a.Status) == K.Brand);
            var anyOn = router == ServiceState.Online || gate == ServiceState.Online || jarvis == ServiceState.Online;
            heroTitle.Text = exposed ? "Atenção: serviço exposto na rede" : !allOn ? (anyOn ? "Parte dos serviços desligada" : "Serviços desligados") : alive.Count == 0 ? "Serviços no ar · agentes desligados" : snap.Paused ? "Agentes pausados" : $"Tudo no ar · {alive.Count} de {loops.Count} agentes ligados";
            heroTitle.Foreground = exposed ? K.Err : !allOn || alive.Count == 0 || snap.Paused ? K.Warn : K.Text;
            heroSub.Text = exposed ? "Algo está escutando fora do 127.0.0.1. Desligue o serviço e ligue de novo por aqui."
                : !allOn ? (anyOn ? $"Fora do ar: {string.Join(", ", new[] { router == ServiceState.Online ? null : "roteador", gate == ServiceState.Online ? null : "fila", jarvis == ServiceState.Online ? null : "servidor" }.Where(x => x is not null))}. Ligar tudo sobe o que falta." : "Ligar tudo sobe o roteador, a fila, o servidor e os agentes, nessa ordem.")
                : alive.Count == 0 ? "Toque em Ligar agentes: os loops não voltam sozinhos quando o PC reinicia."
                : $"{working} trabalhando agora · {snap.Pending} {(snap.Pending == 1 ? "aprovação esperando" : "aprovações esperando")} · {snap.TasksDone}/{snap.TasksTotal} tarefas do Goal";

            Title = (snap.Pending > 0 ? $"({snap.Pending}) " : "") + (exposed ? "Agent Control · ATENÇÃO" : !allOn ? "Agent Control · serviços desligados" : snap.Paused ? "Agent Control · pausado" : $"Agent Control · {working} trabalhando");
            pipeline.Children.Clear();
            Step("Roteador", $":{svc.Settings.RouterPort}", router);
            Step("Fila anti-429", $":{svc.Settings.GatePort}", gate);
            Step("Servidor", $":{svc.Settings.JarvisPort}", jarvis);
            Step("Agentes", $"{alive.Count}/{loops.Count}", alive.Count == 0 ? ServiceState.Off : alive.Count < loops.Count ? ServiceState.Starting : ServiceState.Online, last: true);

            actions.Children.Clear();
            actions.Children.Add(Action("Ligar tudo", K.IPower, StartAll, primary: true));
            actions.Children.Add(Action("Ligar agentes", K.IPeople, StartAgents));
            if (snap.Online)
            {
                actions.Children.Add(snap.Paused ? Action("Retomar", K.IPlay, async () => { await api.Pause(false); svc.Log("Agentes retomados."); })
                    : Action("Pausar", K.IPause, async () => { await api.Pause(true); svc.Log("Agentes pausam depois da rodada atual."); }));
                var goalOn = snap.CallActive && snap.CallModo == "goal";
                actions.Children.Add(goalOn ? Action("Parar Goal", K.IStop, async () => { var e = await api.EndCall(); svc.Log(e is null ? "Modo Goal encerrado; a ata ficou no vault." : $"Não encerrei o Modo Goal: {e}"); }, danger: true)
                    : Action("Modo Goal", K.IGoal, async () => { var e = await api.StartGoal(snap.Goal); svc.Log(e is null ? "Modo Goal ligado: o time está tocando o Goal sem parar." : $"Não liguei o Modo Goal: {e}"); }));
            }
            actions.Children.Add(Action("Abrir painel", K.IOpen, OpenPanel));

            var pendBadge = tabButtons.First(b => b.T == Tab.Comandos).Badge;
            pendBadge.IsVisible = snap.Pending > 0;
            if (pendBadge.Child is TextBlock pt) pt.Text = snap.Pending.ToString();
            tabInfo.Text = $"{alive.Count} loops ligados · {working} trabalhando · {snap.Agents.Count} no time";
            RenderTab();
            if (tab is Tab.Comandos or Tab.Uso) await LoadTabData();
        }
        catch (Exception ex) { svc.Log($"Erro ao atualizar a tela: {ex.GetType().Name}: {ex.Message}"); }
        finally { refreshing = false; first = false; Ready = true; }
    }

    /// <summary>Busca o que só a aba aberta precisa (comandos, uso).</summary>
    async Task LoadTabData()
    {
        if (!snap.Online) return;
        if (tab == Tab.Comandos) { cmds = await api.CommandsAsync(); RenderTab(); }
        if (tab == Tab.Uso && DateTime.Now - usageAt > TimeSpan.FromSeconds(20)) { usage = await api.UsageAsync(7); usageAt = DateTime.Now; RenderTab(); }
    }

    void RenderTab()
    {
        switch (tab)
        {
            case Tab.Inicio: RenderInicio(); break;
            case Tab.Agentes: RenderAgentes(); break;
            case Tab.Comandos: RenderComandos(); break;
            case Tab.Uso: RenderUso(); break;
            case Tab.Logs: RenderLoopLogs(); break;
        }
    }

    // ======================================================================= Início
    Control InicioView()
    {
        var body = new Grid { ColumnDefinitions = new ColumnDefinitions("400,18,*"), RowDefinitions = new RowDefinitions("*,Auto") };
        var left = new StackPanel();
        var sh = new DockPanel { Margin = new Thickness(0, 0, 0, 8) };
        var off = Link("Desligar tudo", K.IPower, StopAll, danger: true).Also(l => { l.Padding = new Thickness(6, 0); l.Margin = new Thickness(0, -6, -6, -6); });
        DockPanel.SetDock(off, Dock.Right); sh.Children.Add(off);
        sh.Children.Add(K.Label("Serviços").Also(l => l.Margin = new Thickness(0)));
        left.Children.Add(sh);
        left.Children.Add(K.Card(serviceRows, 16, new Thickness(6, 2)));
        left.Children.Add(K.Label("Apps").Also(l => l.Margin = new Thickness(0, 16, 0, 8)));
        left.Children.Add(appTiles);
        var util = new WrapPanel { Margin = new Thickness(-8, 2, 0, 0) };
        util.Children.Add(Link("Configuração", K.ISettings, () => svc.OpenPath(svc.SettingsPath)));
        util.Children.Add(Link("Sala no Obsidian", K.IBook, () => svc.OpenObsidianNote(svc.Settings.SalaNote)));
        util.Children.Add(Link("Chamada no painel", K.IPhone, () => _ = OpenPanel("call")));
        util.Children.Add(Link("Código ao vivo", K.ICode, () => _ = OpenPanel("codigo")));
        util.Children.Add(Link("Central de Missões", K.IHome, () => Platform.OpenAppWindow($"http://127.0.0.1:{svc.Settings.JarvisPort}/?project={Uri.EscapeDataString(svc.Settings.JarvisProject)}#missoes")));
        left.Children.Add(util);
        body.Children.Add(Scroll(left));
        var right = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = agentCards };
        Grid.SetColumn(right, 2); body.Children.Add(right);

        // atividade: faixa embaixo, na largura toda (as últimas linhas; tudo na aba Logs)
        logScroll.Content = logLines;
        var act = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
        act.Children.Add(new StackPanel { Spacing = 6, Margin = new Thickness(0, 1, 18, 0), Children = { K.Icon(K.ITerminal, 15, K.Muted), K.T("ATIVIDADE", 10, K.Faint, FontWeight.SemiBold).Also(t => t.LetterSpacing = .6) } });
        Grid.SetColumn(logScroll, 1); act.Children.Add(logScroll);
        var actCard = new Border { Height = 70, Background = K.Side, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(14), Padding = new Thickness(16, 10), Margin = new Thickness(0, 12, 0, 0), Child = act };
        K.Pressable(actCard, () => ShowTab(Tab.Logs));
        actCard.Tip("Ver tudo na aba Logs");
        Grid.SetRow(actCard, 1); Grid.SetColumnSpan(actCard, 3); body.Children.Add(actCard);
        return body;
    }

    void RenderInicio()
    {
        serviceRows.Children.Clear();
        ServiceRow("Roteador de modelos", "9Router · modelos da NVIDIA", svc.Settings.RouterPort, router,
            async () => await svc.StartRouterAsync(), () => Confirm("Desligar o roteador?", "Os agentes ficam sem modelo até ligar de novo.", "Desligar", () => svc.StopPort("9Router", svc.Settings.RouterPort)));
        ServiceRow("Fila anti-429", "agentes → fila → roteador", svc.Settings.GatePort, gate,
            async () => await svc.StartGateAsync(), () => Confirm("Desligar a fila?", "Sem a fila os agentes ficam sem modelo.", "Desligar", () => svc.StopPort("Fila anti-429", svc.Settings.GatePort)));
        ServiceRow("Servidor Agent Control", "sala, comandos, app do celular", svc.Settings.JarvisPort, jarvis,
            async () => await svc.StartJarvisAsync(), () => svc.StopPort("Servidor", svc.Settings.JarvisPort), last: true);

        appTiles.Children.Clear();
        foreach (var app in svc.Settings.Apps) appTiles.Children.Add(AppTile(app));

        agentCards.Children.Clear();
        var share = Share();
        var ids = Ids();
        var marks = K.Marks(ids);
        var i = 0;
        foreach (var id in ids)
        {
            var a = snap.Agents.FirstOrDefault(x => x.Id == id);
            var card = AgentCard(id, a.Status ?? "", a.Task, share.TryGetValue(id, out var v) ? v : 0, LoopState(id), marks[id]);
            if (first) K.EnterUp(card, 160 + 35 * i++, 10);
            agentCards.Children.Add(card);
        }
    }

    Dictionary<string, double> Share() => snap.Usage.GroupBy(u => u.Agent).ToDictionary(x => x.Key, x => x.Sum(y => y.Share));

    /// <summary>Todos os agentes: os do servidor e, com ele desligado, os que têm loop.</summary>
    List<string> Ids()
    {
        var ids = snap.Agents.Select(a => a.Id).ToList();
        foreach (var l in svc.Settings.LoopAgents) if (!ids.Contains(l.ToUpperInvariant())) ids.Add(l.ToUpperInvariant());
        return ids;
    }

    bool? LoopState(string id) => svc.Settings.LoopAgents.Contains(id.ToLowerInvariant()) ? alive.Contains(id.ToLowerInvariant()) : null;

    /// <summary>Um passo do caminho (roteador → fila → servidor → agentes).</summary>
    void Step(string name, string detail, ServiceState state, bool last = false)
    {
        var color = state switch { ServiceState.Online => K.Ok, ServiceState.Exposed => K.Err, ServiceState.Starting => K.Warn, _ => K.Faint };
        var c = ((ISolidColorBrush)color).Color;
        var dot = new Grid { Width = 26, Height = 26, Children = { new Ellipse { Fill = new SolidColorBrush(Color.FromArgb(36, c.R, c.G, c.B)) }, new Ellipse { Width = 10, Height = 10, Fill = color } } };
        var txt = new StackPanel { Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
        txt.Children.Add(K.T(name, 13, K.Text, FontWeight.SemiBold));
        txt.Children.Add(K.T(detail + (state == ServiceState.Exposed ? " · exposto" : state == ServiceState.Off ? " · desligado" : state == ServiceState.Starting ? " · em parte" : " · no ar"), 11, K.Muted, f: K.Mono));
        pipeline.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Children = { dot, txt } });
        if (!last) pipeline.Children.Add(new Border { Width = 56, Height = 2, CornerRadius = new CornerRadius(1), Margin = new Thickness(16, 0), VerticalAlignment = VerticalAlignment.Center, Background = state == ServiceState.Online ? new SolidColorBrush(K.C("#1F5E35")) : K.Line });
    }

    void ServiceRow(string name, string sub, int port, ServiceState state, Func<Task> start, Action stop, bool last = false)
    {
        var (text, color) = state switch
        {
            ServiceState.Online => ("no ar", K.Ok),
            ServiceState.Exposed => ("exposto na rede", K.Err),
            ServiceState.Starting => ("iniciando", K.Warn),
            _ => ("desligado", K.Faint),
        };
        var g = new Grid { ColumnDefinitions = new ColumnDefinitions("22,*,Auto"), Margin = new Thickness(10, 10, 6, 10) };
        g.Children.Add(new Ellipse { Width = 9, Height = 9, Fill = color, HorizontalAlignment = HorizontalAlignment.Left });
        var col = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 2 };
        col.Children.Add(K.T(name, 14, K.Text, FontWeight.SemiBold));
        col.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.T(sub, 11.5, K.Muted), K.T($":{port}", 11, K.Faint, f: K.Mono), K.T(text, 11.5, color, FontWeight.SemiBold) } }.Tip($"127.0.0.1:{port} · {text}"));
        Grid.SetColumn(col, 1); g.Children.Add(col);
        var btn = state == ServiceState.Off ? Action("Ligar", K.IPlay, start, height: 34) : Action("Desligar", K.IStop, () => { stop(); return Task.CompletedTask; }, danger: true, height: 34);
        btn.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(btn, 2); g.Children.Add(btn);
        serviceRows.Children.Add(g);
        if (!last) serviceRows.Children.Add(new Border { Height = 1, Background = K.Line, Margin = new Thickness(12, 0) });
    }

    Control AppTile(ManagedApp app)
    {
        var running = svc.FindProcess(app) is not null;
        var available = app.DetectedPath is not null || running;
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("14,*,Auto") };
        row.Children.Add(new Ellipse { Width = 7, Height = 7, Fill = running ? K.Ok : available ? K.Faint : K.Err });
        var n = K.T(app.Name, 13, available ? K.Text : K.Muted, FontWeight.SemiBold); Grid.SetColumn(n, 1); row.Children.Add(n);
        var act = K.T(running ? "focar" : available ? "abrir" : "não achei", 11.5, running ? K.BrandText : K.Faint); Grid.SetColumn(act, 2); row.Children.Add(act);
        var b = new Border
        {
            Width = 191, Height = 42, Margin = new Thickness(0, 0, 8, 8), Padding = new Thickness(12, 0), CornerRadius = new CornerRadius(12),
            Background = available ? K.Surface : Brushes.Transparent, BorderBrush = available ? K.Line : K.LineHi, BorderThickness = new Thickness(1), Child = row,
        };
        b.Tip(app.DetectedPath ?? "não achei: ajuste em Configuração");
        if (available) K.Pressable(b, () => svc.OpenOrFocus(app));
        return b;
    }

    Control AgentCard(string id, string status, string? task, double share, bool? loop, string mark)
    {
        var color = K.StatusBrush(status);
        var top = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        top.Children.Add(K.UsageRing(id, 42, share, color, mark));
        var names = new StackPanel { Margin = new Thickness(12, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center, Spacing = 1 };
        names.Children.Add(K.T(K.Nice(id), 14.5, K.Text, FontWeight.SemiBold, K.Display));
        names.Children.Add(K.T(K.StatusText(status), 11.5, color));
        Grid.SetColumn(names, 1); top.Children.Add(names);
        var badge = LoopBadge(loop);
        Grid.SetColumn(badge, 2); top.Children.Add(badge);
        var col = new StackPanel { Children = { top } };
        col.Children.Add(K.T(string.IsNullOrWhiteSpace(task) ? "Esperando ordem" : task!, 12, string.IsNullOrWhiteSpace(task) ? K.Faint : K.Text2).Also(t => t.Margin = new Thickness(0, 12, 0, 10)).Tip(task));
        var foot = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        foot.Children.Add(K.T(ModelOf(id), 11, K.Faint, f: K.Mono));
        var pct = (int)Math.Round(share * 100);
        var p = K.T($"{pct}% hoje", 11, pct > 0 ? K.BrandText : K.Faint, FontWeight.SemiBold, K.Mono); Grid.SetColumn(p, 1); foot.Children.Add(p);
        col.Children.Add(foot);
        var card = K.Card(col, 16, new Thickness(14, 12)).Also(c => c.Margin = new Thickness(0, 0, 10, 10));
        K.Pressable(card, () => ShowTab(Tab.Agentes));
        card.Tip("Ver ações do agente na aba Agentes");
        return card;
    }

    static Control LoopBadge(bool? loop) => loop is null ? K.Pill("APP", K.Muted).Tip("Sem loop: fala pelo app dele e pela sala")
        : loop == true ? K.Pill("LIGADO", K.Ok).Tip("O loop deste agente está rodando: pega cada ordem nova sozinho")
        : K.Pill("DESLIGADO", K.Err).Tip("Loop parado: ligue na aba Agentes ou em Ligar agentes");

    string ModelOf(string id) => models.TryGetValue(id, out var md) && md.Model.Length > 0 ? md.Model.Split('/').Last() + (md.Effort.Length > 0 ? " · " + md.Effort : "") : id == "CHATGPT" ? "app do ChatGPT" : "modelo —";

    // ======================================================================= Agentes
    void RenderAgentes()
    {
        agentRows.Children.Clear();
        agentRows.Children.Add(K.Wrap("Cada agente roda num loop próprio: acorda quando chega ordem nova, trabalha na pasta dele e escreve o resultado no STATUS. Aqui você liga ou para um por um.", 13, K.Muted).Also(t => t.Margin = new Thickness(2, 0, 0, 12)));
        var share = Share();
        var ids = Ids();
        var marks = K.Marks(ids);
        foreach (var id in ids)
        {
            var a = snap.Agents.FirstOrDefault(x => x.Id == id);
            var status = a.Status ?? "";
            var color = K.StatusBrush(status);
            var loop = LoopState(id);
            (string State, DateTime? When, string? LastOut) info = loop is null ? ("", null, null) : Services.LoopInfo(id);
            var g = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,200,*,Auto") };
            g.Children.Add(K.UsageRing(id, 46, share.TryGetValue(id, out var v) ? v : 0, color, marks[id]));
            var who = new StackPanel { Margin = new Thickness(14, 0, 10, 0), VerticalAlignment = VerticalAlignment.Center, Spacing = 3 };
            who.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.T(K.Nice(id), 15, K.Text, FontWeight.SemiBold, K.Display), LoopBadge(loop) } });
            who.Children.Add(K.T(ModelOf(id), 11, K.Faint, f: K.Mono));
            Grid.SetColumn(who, 1); g.Children.Add(who);
            var mid = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 3, Margin = new Thickness(0, 0, 12, 0) };
            mid.Children.Add(K.T(string.IsNullOrWhiteSpace(a.Task) ? "Esperando ordem" : a.Task!, 12.5, string.IsNullOrWhiteSpace(a.Task) ? K.Faint : K.Text2).Tip(a.Task));
            var last = info.State switch
            {
                "RUN" => "rodando agora", "EXIT" => "terminou a última rodada", "IDLE" => "esperando ordem nova", "PAUSED" => "pausado", "WAIT_RAM" => "esperando memória livre",
                "TIMEOUT" => "a última rodada estourou o tempo", "STOPPED" => "parado por você", "ERRO" => "erro passageiro (o loop segue)", "STOP" => "loop parado", "START" => "acabou de ligar", "" => "", _ => info.State.ToLowerInvariant(),
            };
            mid.Children.Add(K.T((K.StatusText(status)) + (last.Length > 0 ? $" · {last}" : "") + (info.When is { } w ? $" · {K.Ago(w.ToString("s"))}" : ""), 11.5, color));
            Grid.SetColumn(mid, 2); g.Children.Add(mid);
            var btns = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            var lower = id.ToLowerInvariant();
            if (loop == true) btns.Children.Add(IconBtn(K.IStop, "Parar o loop deste agente", () => Confirm($"Parar o {K.Nice(id)}?", "O loop dele para, e a rodada que estiver fazendo agora é cortada. Os outros agentes continuam.", "Parar", () => { _ = Task.Run(() => svc.StopLoop(lower)).ContinueWith(_ => Dispatcher.UIThread.Post(() => _ = Refresh())); }), K.Err));
            else if (loop == false) btns.Children.Add(IconBtn(K.IPlay, "Ligar o loop deste agente", () => { svc.StartLoop(lower); DispatcherTimer.RunOnce(() => _ = Refresh(), TimeSpan.FromSeconds(4)); }, K.Ok));
            btns.Children.Add(IconBtn(K.ISend, "Mandar uma ordem só para ele", () => { cmdTo = id; ShowTab(Tab.Comandos); cmdBox.Focus(); }));
            var wt = Services.Worktree(id);
            if (Directory.Exists(wt)) btns.Children.Add(IconBtn(K.IFolder, $"Abrir a pasta dele ({wt})", () => svc.OpenPath(wt)));
            if (Directory.Exists(wt) && File.Exists(System.IO.Path.Combine(wt, ".ai-team", "STATUS.md"))) btns.Children.Add(IconBtn(K.IFile, "Abrir o STATUS dele", () => svc.OpenPath(System.IO.Path.Combine(wt, ".ai-team", "STATUS.md"))));
            if (info.LastOut is { } o) btns.Children.Add(IconBtn(K.ITerminal, "Ver a saída da última rodada", () => svc.OpenPath(o)));
            Grid.SetColumn(btns, 3); g.Children.Add(btns);
            agentRows.Children.Add(K.Card(g, 16, new Thickness(14, 12)).Also(c => c.Margin = new Thickness(0, 0, 0, 8)));
        }
        var foot = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 6, 0, 0) };
        foot.Children.Add(Action("Ligar todos", K.IPlay, StartAgents, height: 36));
        foot.Children.Add(Action("Parar todos", K.IStop, () => { Confirm("Parar todos os agentes?", "Todos os loops param agora, inclusive as rodadas em andamento. Para só segurar novas rodadas, use Pausar.", "Parar todos", () => _ = Task.Run(() => { foreach (var a in svc.Settings.LoopAgents) svc.StopLoop(a); })); return Task.CompletedTask; }, danger: true, height: 36));
        foot.Children.Add(Link("Pasta dos loops", K.IFolder, () => svc.OpenPath(System.IO.Path.Combine(Platform.AgentsDir, "night-logs"))));
        agentRows.Children.Add(foot);
    }

    // ======================================================================= Comandos
    Control? comandosView;
    Control ComandosView()
    {
        if (comandosView is not null) return comandosView;
        cmdBox.KeyDown += (_, e) => { if (e.Key == Key.Enter) { e.Handled = true; _ = SendCmd(); } };
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        row.Children.Add(cmdBox.Also(b => b.Margin = new Thickness(6, 0)));
        var go = K.Button("Enviar", K.ISend, () => _ = SendCmd(), height: 38); Grid.SetColumn(go, 1); row.Children.Add(go);
        var compose = new StackPanel { Spacing = 10, Children = { K.Label("Para").Also(l => l.Margin = new Thickness(0)), cmdTargets, K.Card(row, 22, new Thickness(8)), cmdToast } };
        var v = new StackPanel();
        v.Children.Add(K.Card(compose, 18, new Thickness(18, 16)));
        v.Children.Add(K.Wrap("Ordens com deploy, push, merge, apagar ou pagar ficam esperando você aprovar aqui. A aprovação vale só para aquele comando.", 12, K.Faint).Also(t => t.Margin = new Thickness(4, 8, 0, 0)));
        v.Children.Add(K.Label("Esperando você").Also(l => l.Margin = new Thickness(0, 18, 0, 8)));
        v.Children.Add(pendingPanel);
        v.Children.Add(K.Label("Últimos comandos").Also(l => l.Margin = new Thickness(0, 18, 0, 8)));
        v.Children.Add(K.Card(historyPanel, 16, new Thickness(16, 4)));
        return comandosView = Scroll(v);
    }

    void RenderComandos()
    {
        cmdTargets.Children.Clear();
        foreach (var id in new[] { "TODOS", "LEADER" }.Concat(snap.Agents.Select(a => a.Id).Where(i => i != "CHATGPT")))
        {
            var on = id == cmdTo;
            var chip = new Border { CornerRadius = new CornerRadius(9), Padding = new Thickness(11, 5, 11, 6), Margin = new Thickness(0, 0, 6, 6), Background = on ? K.Brand : K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(on ? 0 : 1), Child = K.T(id == "TODOS" ? "Todos" : id == "LEADER" ? "Líder" : K.Nice(id), 12, on ? K.OnBrand : K.Text2, FontWeight.SemiBold) };
            var target = id;
            K.Pressable(chip, () => { cmdTo = target; RenderComandos(); cmdBox.Focus(); });
            cmdTargets.Children.Add(chip);
        }
        pendingPanel.Children.Clear();
        var pend = cmds.Where(c => c.Approval == "pending").ToList();
        if (pend.Count == 0) pendingPanel.Children.Add(K.T(snap.Online ? "Nada esperando aprovação." : "Servidor desligado.", 13, K.Muted).Also(t => t.Margin = new Thickness(4, 0, 0, 0)));
        foreach (var c in pend)
        {
            var g = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
            g.Children.Add(new StackPanel { Children = { K.T($"{c.Code} · {K.Nice(c.Target)}", 12, K.Warn, FontWeight.SemiBold, K.Mono), K.Wrap(c.Text, 13.5, K.Text).Also(t => t.Margin = new Thickness(0, 4, 12, 0)) } });
            var code = c.Code;
            var btns = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
            btns.Children.Add(Action("Recusar", null, async () => { var e = await api.Decide(code, false); cmdToast.Text = e ?? $"{code} recusado."; cmds = await api.CommandsAsync(); }, height: 34));
            btns.Children.Add(Action("Aprovar", K.ICheck, async () => { var e = await api.Decide(code, true); cmdToast.Text = e ?? $"{code} aprovado. Vale só para este comando."; cmds = await api.CommandsAsync(); }, primary: true, height: 34));
            Grid.SetColumn(btns, 1); g.Children.Add(btns);
            pendingPanel.Children.Add(new Border { Background = new SolidColorBrush(Color.FromArgb(22, 245, 158, 11)), BorderBrush = new SolidColorBrush(Color.FromArgb(70, 245, 158, 11)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(14), Padding = new Thickness(14, 12, 12, 12), Child = g });
        }
        historyPanel.Children.Clear();
        var hist = cmds.Where(c => c.Approval != "pending").OrderByDescending(c => int.TryParse(c.Code.AsSpan(2), out var x) ? x : 0).Take(15).ToList();
        if (hist.Count == 0) historyPanel.Children.Add(K.T("Nenhum comando ainda.", 13, K.Muted).Also(t => t.Margin = new Thickness(0, 10)));
        foreach (var c in hist)
        {
            var g = new Grid { MinHeight = 44, ColumnDefinitions = new ColumnDefinitions("62,100,*,110") };
            g.Children.Add(K.T(c.Code, 12, K.Faint, f: K.Mono));
            var who = K.T(c.Target == "TODOS" ? "Todos" : c.Target == "LEADER" ? "Líder" : K.Nice(c.Target), 12.5, K.Text, FontWeight.SemiBold); Grid.SetColumn(who, 1); g.Children.Add(who);
            var tx = K.T(c.Text.Replace('\n', ' '), 13, K.Text2); tx.Tip(c.Text); tx.Margin = new Thickness(0, 0, 12, 0); Grid.SetColumn(tx, 2); g.Children.Add(tx);
            var st = K.T(c.Status, 11, K.StatusBrush(c.Status), FontWeight.Bold, K.Mono); st.HorizontalAlignment = HorizontalAlignment.Right; Grid.SetColumn(st, 3); g.Children.Add(st);
            historyPanel.Children.Add(g);
        }
    }

    async Task SendCmd()
    {
        var t = (cmdBox.Text ?? "").Trim();
        if (t.Length == 0) { cmdToast.Text = "Escreva a ordem primeiro."; cmdToast.Foreground = K.Warn; return; }
        cmdBox.Text = "";
        var err = await api.SendCommand(t, cmdTo);
        cmdToast.Text = err is null ? $"Ordem enviada para {(cmdTo == "TODOS" ? "todos" : cmdTo == "LEADER" ? "o líder" : K.Nice(cmdTo))}. O loop dele acorda sozinho e responde no STATUS." : $"Não enviei: {err}";
        cmdToast.Foreground = err is null ? K.Ok : K.Err;
        svc.Log(err is null ? $"Ordem para {cmdTo}: {t}" : $"Ordem não enviada: {err}");
        cmds = await api.CommandsAsync();
        RenderComandos();
    }

    // ======================================================================= Uso
    void RenderUso()
    {
        var v = new StackPanel();
        if (!snap.Online) { v.Children.Add(K.T("Servidor desligado.", 13, K.Muted)); usageBody.Content = v; return; }
        var total = usage.Days.Sum(d => d.Req);
        var tokens = usage.Days.Sum(d => d.Tokens);
        var r429 = usage.Agents.Sum(a => a.R429);
        v.Children.Add(new Cols(4, 12).Add(Metric("Pedidos (7 dias)", $"{total}", K.Text)).Add(Metric("Pedidos hoje", $"{snap.Usage.Sum(u => u.Req)}", K.BrandText))
            .Add(Metric("Tokens (7 dias)", tokens >= 1_000_000 ? $"{tokens / 1_000_000.0:0.0} mi".Replace('.', ',') : $"{tokens / 1000} mil", K.Text))
            .Add(Metric("Erros 429", $"{r429}", r429 > 0 ? K.Warn : K.Text)).Panel);
        var cols = new Grid { ColumnDefinitions = new ColumnDefinitions("1.2*,14,*"), Margin = new Thickness(0, 14, 0, 0) };
        cols.Children.Add(K.Card(DayChart(usage.Days), 18, new Thickness(20, 16, 20, 14)));
        var rows = new StackPanel();
        rows.Children.Add(K.Label("Por agente · 7 dias"));
        var max = Math.Max(1, usage.Agents.Select(a => a.Req).DefaultIfEmpty(0).Max());
        foreach (var a in usage.Agents.OrderByDescending(a => a.Req))
        {
            var g = new Grid { Margin = new Thickness(0, 5), ColumnDefinitions = new ColumnDefinitions("30,90,*,120") };
            g.Children.Add(K.Avatar(a.Agent, 22));
            var n = K.T(K.Nice(a.Agent), 12.5, K.Text, FontWeight.SemiBold); Grid.SetColumn(n, 1); g.Children.Add(n);
            var bar = K.Bar((double)a.Req / max, height: 6); Grid.SetColumn(bar, 2); g.Children.Add(bar);
            var info = K.T($"{a.Req} · " + (a.MsMedio >= 1000 ? $"{a.MsMedio / 1000.0:0.0} s" : $"{a.MsMedio} ms"), 11.5, K.Muted, f: K.Mono); info.HorizontalAlignment = HorizontalAlignment.Right; Grid.SetColumn(info, 3); g.Children.Add(info);
            rows.Children.Add(g);
        }
        if (usage.Agents.Count == 0) rows.Children.Add(K.T(usageAt == default ? "Carregando…" : "Nenhum pedido nos últimos 7 dias.", 13, K.Muted));
        var rc = K.Card(rows, 18, new Thickness(20, 16, 20, 14)); Grid.SetColumn(rc, 2); cols.Children.Add(rc);
        v.Children.Add(cols);
        usageBody.Content = v;
    }

    static Border Metric(string label, string value, IBrush tone) =>
        K.Card(new StackPanel { Children = { K.T(label.ToUpperInvariant(), 10.5, K.Muted, FontWeight.SemiBold), K.T(value, 24, tone, FontWeight.SemiBold, K.Display).Also(t => t.Margin = new Thickness(0, 4, 0, 0)) } }, 16, new Thickness(18, 14));

    /// <summary>Barras por dia (pedidos), valor em cima e dia embaixo; hoje em laranja.</summary>
    static Control DayChart(List<(string Dia, int Req, long Tokens)> days)
    {
        var v = new StackPanel();
        v.Children.Add(K.Label("Pedidos por dia"));
        var g = new Grid { Height = 180 };
        var max = Math.Max(1, days.Select(d => d.Req).DefaultIfEmpty(0).Max());
        var today = DateTime.Now.ToString("yyyy-MM-dd");
        for (var i = 0; i < days.Count; i++)
        {
            g.ColumnDefinitions.Add(new ColumnDefinition(1, GridUnitType.Star));
            var d = days[i];
            var isToday = d.Dia == today;
            var col = new DockPanel { Margin = new Thickness(6, 0) };
            var label = K.T(DateTime.TryParse(d.Dia, out var dt) ? dt.ToString("ddd dd").Replace(".", "") : d.Dia, 11, isToday ? K.BrandText : K.Faint);
            label.HorizontalAlignment = HorizontalAlignment.Center; label.Margin = new Thickness(0, 8, 0, 0);
            DockPanel.SetDock(label, Dock.Bottom); col.Children.Add(label);
            var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom };
            stack.Children.Add(K.T(d.Req > 0 ? $"{d.Req}" : "", 11.5, isToday ? K.BrandText : K.Muted, FontWeight.SemiBold, K.Mono).Also(t => { t.HorizontalAlignment = HorizontalAlignment.Center; t.Margin = new Thickness(0, 0, 0, 4); }));
            var bar = new Border { Height = 0, MaxWidth = 42, CornerRadius = new CornerRadius(6, 6, 2, 2), Background = isToday ? K.Brand : new SolidColorBrush(K.C("#3A3A3A")) };
            bar.Tip($"{d.Req} pedidos · {d.Tokens:N0} tokens");
            if (d.Req == 0) { bar.Height = 3; bar.Background = K.Raised; }
            else K.Anim(bar, "h", () => bar.Height, h => bar.Height = h, Math.Max(4, 130.0 * d.Req / max), 900, K.OutExpo, 0, i * 60);
            stack.Children.Add(bar);
            col.Children.Add(stack);
            Grid.SetColumn(col, i); g.Children.Add(col);
        }
        if (days.Count == 0) g.Children.Add(K.T("Carregando…", 13, K.Muted));
        v.Children.Add(g);
        return v;
    }

    // ======================================================================= Logs
    Control? logsView;
    Control LogsView()
    {
        if (logsView is not null) return logsView;
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,14,300") };
        fullLogScroll.Content = fullLog;
        var head = new DockPanel { Margin = new Thickness(0, 0, 0, 8) };
        var open = Link("Abrir o arquivo", K.IFile, () => svc.OpenPath(svc.LogPath)).Also(l => l.Margin = new Thickness(0, -6, -6, -6));
        DockPanel.SetDock(open, Dock.Right); head.Children.Add(open);
        // Copiar: para colar o que deu errado num chat ou issue sem abrir arquivo.
        Border? copy = null;
        copy = Link("Copiar", K.IFile, async () =>
        {
            var text = string.Join("\n", fullLog.Children.OfType<TextBlock>().Select(t => t.Text));
            if (TopLevel.GetTopLevel(this)?.Clipboard is { } cb) { await cb.SetTextAsync(text); if (copy?.Child is StackPanel sp && sp.Children[^1] is TextBlock tb) { tb.Text = "Copiado"; DispatcherTimer.RunOnce(() => tb.Text = "Copiar", TimeSpan.FromSeconds(2)); } }
        }).Also(l => l.Margin = new Thickness(0, -6, 4, -6));
        DockPanel.SetDock(copy, Dock.Right); head.Children.Add(copy);
        head.Children.Add(K.Label("Atividade do Launcher").Also(l => l.Margin = new Thickness(0)));
        var left = new Grid { RowDefinitions = new RowDefinitions("Auto,*"), Children = { head } };
        var card = new Border { Background = K.Side, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(14), Padding = new Thickness(16, 12), Child = fullLogScroll };
        Grid.SetRow(card, 1); left.Children.Add(card);
        grid.Children.Add(left);
        var right = new StackPanel();
        right.Children.Add(K.Label("Logs dos serviços"));
        var svcLogs = new StackPanel { Spacing = 6 };
        foreach (var (name, file) in new[] { ("Roteador (9Router)", "9router"), ("Fila anti-429", "gate"), ("Servidor", "jarvis") })
            svcLogs.Children.Add(LogButton(name, svc.ServiceLog(file) ?? System.IO.Path.Combine(svc.LogsDir, file + ".log")));
        svcLogs.Children.Add(LogButton("Pasta de logs", svc.LogsDir));
        right.Children.Add(svcLogs);
        right.Children.Add(K.Label("Loops dos agentes").Also(l => l.Margin = new Thickness(0, 16, 0, 8)));
        right.Children.Add(loopLogs);
        var rs = Scroll(right); Grid.SetColumn(rs, 2); grid.Children.Add(rs);
        return logsView = grid;
    }

    Control LogButton(string name, string path)
    {
        var exists = File.Exists(path) || Directory.Exists(path);
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        row.Children.Add(K.Icon(Directory.Exists(path) ? K.IFolder : K.IFile, 14, K.Muted));
        var n = K.T(name, 12.5, exists ? K.Text2 : K.Faint, FontWeight.SemiBold).Also(t => t.Margin = new Thickness(10, 0, 0, 0)); Grid.SetColumn(n, 1); row.Children.Add(n);
        var s = K.T(exists ? "abrir" : "ainda não existe", 11, exists ? K.BrandText : K.Faint); Grid.SetColumn(s, 2); row.Children.Add(s);
        var b = new Border { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10), Padding = new Thickness(12, 9), Child = row };
        b.Tip(path);
        if (exists) K.Pressable(b, () => svc.OpenPath(path));
        return b;
    }

    void RenderLoopLogs()
    {
        loopLogs.Children.Clear();
        foreach (var a in svc.Settings.LoopAgents)
        {
            var info = Services.LoopInfo(a);
            var file = System.IO.Path.Combine(Platform.AgentsDir, "night-logs", a + ".log");
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
            row.Children.Add(K.Avatar(a.ToUpperInvariant(), 20));
            var n = K.T(K.Nice(a), 12.5, K.Text2, FontWeight.SemiBold).Also(t => t.Margin = new Thickness(10, 0, 0, 0)); Grid.SetColumn(n, 1); row.Children.Add(n);
            var s = K.T(info.State.Length > 0 ? $"{info.State}{(info.When is { } w ? " · " + K.Ago(w.ToString("s")) : "")}" : "sem log", 11, alive.Contains(a) ? K.Ok : K.Faint, f: K.Mono); Grid.SetColumn(s, 2); row.Children.Add(s);
            var b = new Border { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10), Padding = new Thickness(12, 8), Child = row };
            b.Tip(file);
            if (File.Exists(file)) K.Pressable(b, () => svc.OpenPath(file));
            loopLogs.Children.Add(b);
        }
    }

    // ======================================================================= Ajustes
    Control AjustesView()
    {
        var v = new StackPanel { Spacing = 10 };
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";
        Control Row(string label, string value, Action? open = null)
        {
            var g = new Grid { ColumnDefinitions = new ColumnDefinitions("190,*,Auto"), MinHeight = 40 };
            g.Children.Add(K.T(label, 12.5, K.Muted, FontWeight.SemiBold));
            var t = K.T(value, 12.5, K.Text2, f: K.Mono); t.Tip(value); Grid.SetColumn(t, 1); g.Children.Add(t);
            if (open is not null) { var b = Link("abrir", K.IOpen, open); Grid.SetColumn(b, 2); g.Children.Add(b); }
            return g;
        }
        v.Children.Add(K.Card(TeamPicker(), 18, new Thickness(20, 16)));
        v.Children.Add(K.Card(CallSettings(), 18, new Thickness(20, 16)));
        v.Children.Add(K.Card(TeamCard(), 18, new Thickness(20, 16)));
        v.Children.Add(K.Card(PhoneCard(), 18, new Thickness(20, 16)));
        v.Children.Add(K.Card(PlanCard(), 18, new Thickness(20, 16)));
        var info = new StackPanel();
        info.Children.Add(K.Label("Este PC"));
        info.Children.Add(Row("Sistema", $"{Platform.Name} · {System.Runtime.InteropServices.RuntimeInformation.OSDescription}"));
        info.Children.Add(Row("Versão do app", $"Agent Control {version} · .NET {Environment.Version}"));
        info.Children.Add(Row("Projeto (servidor)", Platform.Expand(svc.Settings.JarvisDir), () => svc.OpenPath(Platform.Expand(svc.Settings.JarvisDir))));
        info.Children.Add(Row("Configuração do app", svc.SettingsPath, () => svc.OpenPath(svc.SettingsPath)));
        info.Children.Add(Row("Dados do app", Platform.DataDir, () => svc.OpenPath(Platform.DataDir)));
        info.Children.Add(Row("Pasta dos agentes", Platform.AgentsDir, () => svc.OpenPath(Platform.AgentsDir)));
        info.Children.Add(Row("Node", svc.Node));
        info.Children.Add(Row("Portas", $"roteador {svc.Settings.RouterPort} · fila {svc.Settings.GatePort} · servidor {svc.Settings.JarvisPort} (só 127.0.0.1)"));
        v.Children.Add(K.Card(info, 18, new Thickness(20, 16)));

        var auto = new StackPanel { Spacing = 6 };
        auto.Children.Add(K.Label("Ligar sozinho quando o PC inicia"));
        if (Services.AutostartShortcut() is { } lnk)
            auto.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 0, 0, 6), Children = { K.Icon(K.ICheck, 15, K.Ok), K.T($"Já está ligado: {System.IO.Path.GetFileNameWithoutExtension(lnk)} (pasta Inicializar). Liga o roteador, a fila, o servidor e o AgentC.", 13, K.Ok, FontWeight.SemiBold) } });
        auto.Children.Add(K.Wrap(Platform.Win
            ? "Crie um atalho na pasta Inicializar (Win+R, digite shell:startup) apontando para este app com --autostart. Ele liga o roteador, a fila e o servidor sem abrir janela, e o AgentC aparece. Os agentes ligam pelo botão Ligar agentes (ou com outro atalho para tools\\ligar-agentes.ps1)."
            : "Rode no terminal: bash tools/instalar.sh --autostart (Linux cria ~/.config/autostart; macOS cria um LaunchAgent). Para tirar, apague o arquivo que ele indicar.", 13, K.Text2, lineHeight: 19));
        auto.Children.Add(K.T(Environment.ProcessPath is { } exe ? $"{exe} --autostart" : "", 12, K.BrandText, f: K.Mono).Also(t => t.Margin = new Thickness(0, 6, 0, 0)));
        v.Children.Add(K.Card(auto, 18, new Thickness(20, 16)));

        var keys = new StackPanel { Spacing = 4 };
        keys.Children.Add(K.Label("Atalhos"));
        foreach (var (k, d) in new[] { ("Ctrl+1 … Ctrl+6", "trocar de aba"), ("F5", "atualizar agora"), ("Botão direito no AgentC ou na faixa", "menu (esconder, tela completa, falar)"), ("Puxar a faixa de cima para baixo", "tela completa"), ("AgentControl --send full|hud|mini|show|esconder", "avisar o HUD por linha de comando") })
            keys.Children.Add(new Grid { ColumnDefinitions = new ColumnDefinitions("330,*"), Children = { K.T(k, 12.5, K.Text2, f: K.Mono), K.T(d, 12.5, K.Muted).Also(t => Grid.SetColumn(t, 1)) } });
        v.Children.Add(K.Card(keys, 18, new Thickness(20, 16)));
        return Scroll(v);
    }

    /// <summary>
    /// Seu time: escolher quais agentes usar (pode ser só o Claude Code, ou Claude + Hermes, ou outro pelo nome).
    /// Salvar grava no jarvis.config.json e no settings.json, para os loops de quem saiu e reinicia o servidor.
    /// </summary>
    Control TeamPicker()
    {
        var chosen = svc.TeamFromConfig().ToHashSet();
        var col = new StackPanel { Spacing = 10 };
        col.Children.Add(K.Label("Seu time de agentes").Also(l => l.Margin = new Thickness(0)));
        col.Children.Add(K.Wrap("Escolha quem trabalha com você. Pode ser um só (ex.: só o Claude Code) ou vários. Cada agente com loop precisa do CLI dele instalado e de um lançador na pasta dos agentes.", 12.5, K.Muted));
        var chips = new WrapPanel();
        var toast = K.T("", 12.5, K.Ok);
        void Draw()
        {
            chips.Children.Clear();
            var all = Services.Catalog.Select(c => (c.Id, c.Name, c.About)).ToList();
            foreach (var extra in chosen.Where(c => all.All(a => a.Id != c))) all.Add((extra, K.Nice(extra), "agente adicionado por você"));
            foreach (var (id, name, about) in all)
            {
                var on = chosen.Contains(id);
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.Avatar(id, 22), K.T(name, 13, on ? K.OnBrand : K.Text2, FontWeight.SemiBold) } };
                if (on) row.Children.Add(K.Icon(K.ICheck, 13, K.OnBrand));
                var chip = new Border { CornerRadius = new CornerRadius(12), Padding = new Thickness(8, 6, 12, 6), Margin = new Thickness(0, 0, 8, 8), Background = on ? K.Brand : K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(on ? 0 : 1), Child = row };
                chip.Tip(about);
                var key = id;
                K.Pressable(chip, () => { if (!chosen.Remove(key)) chosen.Add(key); toast.Text = ""; Draw(); });
                chips.Children.Add(chip);
            }
        }
        Draw();
        col.Children.Add(chips);
        var name = new TextBox { PlaceholderText = "Outro agente (nome, ex.: AIDER)", FontSize = 13, Width = 280, Background = K.Raised, BorderThickness = new Thickness(0), CaretBrush = K.Brand, Padding = new Thickness(10, 8) };
        var add = K.Button("Adicionar", K.IAdd, () =>
        {
            var n = (name.Text ?? "").Trim().ToUpperInvariant();
            if (!System.Text.RegularExpressions.Regex.IsMatch(n, "^[A-Z0-9_-]{2,24}$")) { toast.Text = "Nome com 2 a 24 letras, números, - ou _."; toast.Foreground = K.Warn; return; }
            chosen.Add(n); name.Text = ""; Draw();
        }, primary: false, height: 36);
        var save = Action("Salvar time", K.ICheck, async () =>
        {
            var err = await svc.SaveTeamAsync(chosen.ToList());
            toast.Text = err ?? $"Salvo: {chosen.Count} agente(s). O servidor reiniciou com o time novo; ligue os loops em Ligar agentes.";
            toast.Foreground = err is null ? K.Ok : K.Err;
        }, primary: true, height: 36);
        col.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { new Border { CornerRadius = new CornerRadius(10), ClipToBounds = true, Child = name }, add, save } });
        col.Children.Add(toast);
        return col;
    }

    /// <summary>
    /// Ajustes da chamada que roda no painel do HUD: modo e quem já vêm marcados, avançar sozinho e voz.
    /// Grava no settings.json; o HUD relê a cada poucos segundos (não precisa reabrir nada).
    /// </summary>
    Control CallSettings()
    {
        var st = svc.Settings;
        var modo = st.CallModo;
        var pick = st.CallPeople.Select(x => x.ToUpperInvariant()).ToHashSet();
        bool auto = st.CallAutoAdvance, voice = st.CallVoice;
        List<(string Id, string Papel, bool Virtual)> people = [];
        var loadingPeople = true;
        var col = new StackPanel { Spacing = 10 };
        col.Children.Add(K.Label("Chamada no painel").Also(l => l.Margin = new Thickness(0)));
        col.Children.Add(K.Wrap("A chamada com o time abre no painel do AgentC (aba Chamada), sem navegador. Aqui fica o que já vem escolhido quando você começa uma.", 12.5, K.Muted));
        var modes = new WrapPanel();
        var who = new WrapPanel();
        var toggles = new StackPanel { Spacing = 8 };
        var toast = K.T("", 12.5, K.Ok);
        Border Chip(string text, bool on, Action go, string? tip = null, string? avatar = null)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            if (avatar is not null) row.Children.Add(K.Avatar(avatar, 20));
            row.Children.Add(K.T(text, 12.5, on ? K.OnBrand : K.Text2, FontWeight.SemiBold));
            var c = new Border { CornerRadius = new CornerRadius(11), Padding = new Thickness(avatar is null ? 12 : 7, 6, 12, 6), Margin = new Thickness(0, 0, 8, 8), Background = on ? K.Brand : K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(on ? 0 : 1), Child = row };
            if (tip is not null) c.Tip(tip);
            K.Pressable(c, () => { toast.Text = ""; go(); Draw(); });
            return c;
        }
        Control Toggle(string title, string about, bool on, Action flip)
        {
            var knob = new Border { Width = 16, Height = 16, CornerRadius = new CornerRadius(8), Background = on ? K.OnBrand : K.Muted, HorizontalAlignment = on ? HorizontalAlignment.Right : HorizontalAlignment.Left, Margin = new Thickness(3, 0) };
            var sw = new Border { Width = 40, Height = 22, CornerRadius = new CornerRadius(11), Background = on ? K.Brand : K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(on ? 0 : 1), Child = knob, VerticalAlignment = VerticalAlignment.Center };
            var g = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), Background = Brushes.Transparent, Cursor = new Cursor(StandardCursorType.Hand) };
            g.Children.Add(sw);
            var txt = new StackPanel { Margin = new Thickness(12, 0, 0, 0), Spacing = 1, Children = { K.T(title, 13, K.Text, FontWeight.SemiBold), K.T(about, 11.5, K.Muted) } };
            Grid.SetColumn(txt, 1); g.Children.Add(txt);
            K.Pressable(g, () => { toast.Text = ""; flip(); Draw(); });
            return g;
        }
        void Draw()
        {
            modes.Children.Clear();
            foreach (var (id, name, about) in new[] { ("debate", "Debate", "cada um defende o ponto do seu papel"), ("brainstorm", "Ideias", "constroem em cima das ideias dos outros"), ("revisao", "Revisão", "procuram riscos, bugs e o que falta testar"), ("goal", "Goal", "tocam o Goal ativo sem parar") })
                modes.Children.Add(Chip(name, modo == id, () => modo = id, about));
            who.Children.Clear();
            if (people.Count == 0) who.Children.Add(K.T(loadingPeople ? "Carregando…" : "Ligue o servidor para escolher quem entra. Sem escolha, entra o time todo.", 12.5, K.Muted));
            foreach (var p in people)
            {
                var on = pick.Count == 0 ? !p.Virtual : pick.Contains(p.Id);
                var id = p.Id;
                who.Children.Add(Chip(K.Nice(p.Id), on, () =>
                {
                    if (pick.Count == 0) foreach (var x in people.Where(x => !x.Virtual)) pick.Add(x.Id);
                    if (!pick.Remove(id)) pick.Add(id);
                    if (pick.SetEquals(people.Where(x => !x.Virtual).Select(x => x.Id))) pick.Clear();
                }, p.Papel + (p.Virtual ? " · especialista: só opina na chamada" : ""), p.Id));
            }
            toggles.Children.Clear();
            toggles.Children.Add(Toggle("Avançar sozinho", "Os agentes falam um depois do outro até pararem para esperar você. Desligado: botão Próxima fala.", auto, () => auto = !auto));
            toggles.Children.Add(Toggle("Ler as falas em voz alta", "Usa a voz do sistema deste PC. Dá para calar na hora pelo botão de som no painel.", voice, () => voice = !voice));
        }
        Draw();
        col.Children.Add(K.T("Modo que já vem marcado", 12, K.Text2, FontWeight.SemiBold));
        col.Children.Add(modes);
        col.Children.Add(K.T("Quem entra", 12, K.Text2, FontWeight.SemiBold));
        col.Children.Add(who);
        col.Children.Add(toggles);
        var save = Action("Salvar ajustes da chamada", K.ICheck, () =>
        {
            st.CallModo = modo; st.CallPeople = pick.ToList(); st.CallAutoAdvance = auto; st.CallVoice = voice;
            try { svc.Save(); toast.Text = "Salvo. O painel já usa os ajustes novos na próxima chamada."; toast.Foreground = K.Ok; svc.Log("Ajustes da chamada salvos."); }
            catch (Exception ex) { toast.Text = $"Não salvei: {ex.Message}"; toast.Foreground = K.Err; }
            return Task.CompletedTask;
        }, primary: true, height: 36);
        var test = K.Button("Testar voz", K.ISound, () => _ = Platform.SpeakAsync("Oi! Eu sou o AgentC. É assim que eu leio as falas da chamada."), primary: false, height: 36);
        col.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Margin = new Thickness(0, 4, 0, 0), Children = { save, test, toast.Also(t => t.VerticalAlignment = VerticalAlignment.Center) } });
        // Pergunta direto ao servidor (o "snap" pode ainda não ter chegado quando a aba abre).
        _ = Task.Run(async () =>
        {
            var list = await api.CallPeopleAsync();
            Dispatcher.UIThread.Post(() => { people = list; loadingPeople = false; Draw(); });
        });
        return col;
    }

    /// <summary>
    /// Modo Time: pessoas que trabalham junto com você e os agentes. Convidar gera um acesso só da pessoa
    /// (aparece uma vez, para copiar e mandar); tirar do time faz o acesso parar de valer na hora.
    /// </summary>
    Control TeamCard()
    {
        var col = new StackPanel { Spacing = 10 };
        col.Children.Add(K.Label("Pessoas do time").Also(l => l.Margin = new Thickness(0)));
        col.Children.Add(K.Wrap("Gente trabalhando junto com os agentes: cada pessoa entra pelo app do celular com um acesso só dela e fala com o próprio nome na sala e na chamada. Membro fala e manda ordem; Só leitura acompanha; aprovar continua sendo só seu.", 12.5, K.Muted));
        var list = new StackPanel { Spacing = 6 };
        var toast = K.T("", 12.5, K.Ok);
        var tokenBox = new TextBox { IsReadOnly = true, IsVisible = false, FontFamily = K.Mono, FontSize = 12, Background = K.Raised, BorderThickness = new Thickness(0), Padding = new Thickness(10, 8) };
        async Task Load()
        {
            var people = await api.TeamAsync();
            list.Children.Clear();
            if (people.Count == 0) { list.Children.Add(K.T(snap.Online ? "Atualize o servidor para usar o Modo Time." : "Ligue o servidor para ver o time.", 12.5, K.Muted)); return; }
            foreach (var p in people)
            {
                var g = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto"), MinHeight = 36 };
                g.Children.Add(new Ellipse { Width = 9, Height = 9, Fill = p.Online ? K.Ok : K.Faint, Margin = new Thickness(2, 0, 10, 0) });
                var seen = p.Online ? $"online agora{(p.Via is { } v ? " · " + v : "")}" : p.LastSeen is { } l ? $"visto {K.Ago(l)}" : "ainda não entrou";
                var t = new StackPanel { Children = { K.T(p.Id == "DONO" ? "Você (dono)" : p.Name, 13, K.Text, FontWeight.SemiBold), K.T($"{p.Role} · {seen}", 11.5, p.Online ? K.Ok : K.Muted) } };
                Grid.SetColumn(t, 1); g.Children.Add(t);
                if (p.Id != "DONO")
                {
                    var id = p.Id; var nm = p.Name;
                    var rm = Link("Tirar do time", K.IClose, () => Confirm($"Tirar {nm} do time?", "O acesso dessa pessoa para de valer na hora. Dá para convidar de novo depois.", "Tirar", () => _ = Task.Run(async () => { await api.RemovePerson(id); Dispatcher.UIThread.Post(() => _ = Load()); })), danger: true);
                    Grid.SetColumn(rm, 2); g.Children.Add(rm);
                }
                list.Children.Add(g);
            }
        }
        col.Children.Add(list);
        var name = new TextBox { PlaceholderText = "Nome da pessoa", FontSize = 13, Width = 240, Background = K.Raised, BorderThickness = new Thickness(0), CaretBrush = K.Brand, Padding = new Thickness(10, 8) };
        var role = "membro";
        var roles = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        void DrawRoles()
        {
            roles.Children.Clear();
            foreach (var (r, label) in new[] { ("membro", "Membro"), ("leitura", "Só leitura") })
            {
                var on = r == role; var rr = r;
                var chip = new Border { CornerRadius = new CornerRadius(10), Padding = new Thickness(12, 6), Background = on ? K.Brand : K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(on ? 0 : 1), Child = K.T(label, 12.5, on ? K.OnBrand : K.Text2, FontWeight.SemiBold) };
                K.Pressable(chip, () => { role = rr; DrawRoles(); });
                roles.Children.Add(chip);
            }
        }
        DrawRoles();
        var invite = Action("Convidar", K.IAdd, async () =>
        {
            var n = (name.Text ?? "").Trim();
            if (n.Length == 0) { toast.Text = "Escreva o nome da pessoa."; toast.Foreground = K.Warn; return; }
            var (err, token, _) = await api.InviteAsync(n, role);
            if (err is not null) { toast.Text = $"Não convidei: {err}"; toast.Foreground = K.Err; return; }
            name.Text = "";
            tokenBox.Text = token; tokenBox.IsVisible = true;
            toast.Text = $"{n} convidado(a). Copie o acesso abaixo e mande só para essa pessoa: ele aparece uma vez. No app do celular ela usa o endereço do seu PC pelo Tailscale e este token.";
            toast.Foreground = K.Ok;
            svc.Log($"Time: {n} convidado(a) como {role}.");
            await Load();
        }, primary: true, height: 36);
        col.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { new Border { CornerRadius = new CornerRadius(10), ClipToBounds = true, Child = name }, roles, invite } });
        col.Children.Add(toast.Also(t => { t.TextWrapping = TextWrapping.Wrap; t.MaxWidth = 900; }));
        col.Children.Add(tokenBox);
        _ = Load();
        return col;
    }

    /// <summary>
    /// Celular e iPhone: liga o acesso de fora só pelo Tailscale e mostra o endereço e o token para colar no app Android
    /// ou no Safari do iPhone (Adicionar à Tela de Início). O token só aparece quando você toca em Mostrar.
    /// </summary>
    Control PhoneCard()
    {
        var col = new StackPanel { Spacing = 10 };
        col.Children.Add(K.Label("Celular e iPhone").Also(l => l.Margin = new Thickness(0)));
        col.Children.Add(K.Wrap("Use a sala, o código ao vivo, os comandos e as aprovações no celular. No Android pelo app; no iPhone pelo Safari, como app na tela de início. Só pelo Tailscale (rede privada entre os seus aparelhos) e sempre com token: nada fica aberto na internet.", 12.5, K.Muted));
        var state = K.T("", 13, K.Text2, FontWeight.SemiBold);
        var addr = new TextBox { IsReadOnly = true, FontFamily = K.Mono, FontSize = 12.5, Background = K.Raised, BorderThickness = new Thickness(0), Padding = new Thickness(10, 8), MinWidth = 280 };
        var tok = new TextBox { IsReadOnly = true, FontFamily = K.Mono, FontSize = 12, Background = K.Raised, BorderThickness = new Thickness(0), Padding = new Thickness(10, 8), MinWidth = 280, PasswordChar = '•' };
        var details = new StackPanel { Spacing = 8, IsVisible = false };
        var toast = K.T("", 12.5, K.Muted);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        void Draw()
        {
            var r = svc.RemoteInfo();
            state.Text = r.On ? $"Ligado · só pelo Tailscale ({r.Host})" : "Desligado · a sala só abre neste PC";
            state.Foreground = r.On ? K.Ok : K.Muted;
            details.IsVisible = r.On;
            addr.Text = r.On ? $"http://{r.Host}:{r.Port}" : "";
            tok.Text = r.Token ?? "(o servidor cria o token ao ligar; atualize em alguns segundos)";
            buttons.Children.Clear();
            buttons.Children.Add(Action(r.On ? "Desligar acesso pelo celular" : "Ligar acesso pelo celular", r.On ? K.IStop : K.IPhone, async () =>
            {
                toast.Text = r.On ? "Desligando…" : "Procurando o Tailscale e ligando…"; toast.Foreground = K.Muted;
                var err = await svc.SetRemoteAsync(!r.On);
                toast.Text = err ?? (r.On ? "Desligado. O celular para de conectar." : "Ligado. Abra o endereço abaixo no celular com o Tailscale ligado.");
                toast.Foreground = err is null ? K.Ok : K.Err;
                await Task.Delay(2500);
                Draw();
            }, primary: !r.On, danger: r.On, height: 36));
        }
        var show = Link("Mostrar", K.IOpen, () => { tok.PasswordChar = tok.PasswordChar == '\0' ? '•' : '\0'; });
        var copyAddr = Link("Copiar", K.ICheck, () => _ = Clipboard?.SetTextAsync(addr.Text ?? ""));
        var copyTok = Link("Copiar", K.ICheck, () => { _ = Clipboard?.SetTextAsync(svc.RemoteInfo().Token ?? ""); toast.Text = "Token copiado. Cole só no seu aparelho; quem tiver o token entra como você."; toast.Foreground = K.Warn; });
        details.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.T("Endereço", 12, K.Muted).Also(t => { t.Width = 70; t.VerticalAlignment = VerticalAlignment.Center; }), new Border { CornerRadius = new CornerRadius(10), ClipToBounds = true, Child = addr }, copyAddr } });
        details.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { K.T("Token", 12, K.Muted).Also(t => { t.Width = 70; t.VerticalAlignment = VerticalAlignment.Center; }), new Border { CornerRadius = new CornerRadius(10), ClipToBounds = true, Child = tok }, show, copyTok } });
        details.Children.Add(K.Wrap("iPhone: instale o Tailscale, abra o endereço no Safari, cole o token e toque em Compartilhar → Adicionar à Tela de Início. Android: abra o app, cole o endereço e o token. Pessoas do time usam o token próprio (Pessoas do time, acima).", 12, K.Faint));
        col.Children.Add(state);
        col.Children.Add(buttons);
        col.Children.Add(details);
        col.Children.Add(toast.Also(t => { t.TextWrapping = TextWrapping.Wrap; t.MaxWidth = 900; }));
        Draw();
        return col;
    }

    /// <summary>
    /// Plano: qual está valendo e o campo para colar a licença que chega depois do pagamento. O botão de pagar só aparece
    /// se o servidor tiver uma página de pagamento configurada (pagarUrl): pagamento fica fora do resto do app.
    /// </summary>
    Control PlanCard()
    {
        var col = new StackPanel { Spacing = 10 };
        col.Children.Add(K.Label("Plano").Also(l => l.Margin = new Thickness(0)));
        var line = K.T("Carregando…", 13, K.Text2, FontWeight.SemiBold);
        col.Children.Add(line);
        col.Children.Add(K.Wrap("O app é grátis e completo no seu PC. Plano pago libera mais pessoas no Modo Time e serviços na nuvem. Depois de pagar, cole aqui a licença (texto que começa com AC1.).", 12.5, K.Muted));
        var box = new TextBox { PlaceholderText = "Cole a licença (AC1.…)", FontFamily = K.Mono, FontSize = 12, Background = K.Raised, BorderThickness = new Thickness(0), Padding = new Thickness(10, 8), Width = 520, AcceptsReturn = false };
        var toast = K.T("", 12.5, K.Muted);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        string? payUrl = null;
        var pay = Action("Mudar de plano", K.IOpen, () => { if (payUrl is not null) Platform.Open(payUrl); return Task.CompletedTask; }, height: 36);
        pay.IsVisible = false;
        async Task Load()
        {
            line.Text = await PlanText((await api.TeamAsync()).Count);
            if (line.Text.Length == 0) line.Text = snap.Online ? "Plano Grátis" : "Ligue o servidor para ver o plano.";
            try
            {
                using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                using var doc = System.Text.Json.JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{svc.Settings.JarvisPort}/api/plan"));
                payUrl = doc.RootElement.TryGetProperty("pagarUrl", out var u) && u.ValueKind == System.Text.Json.JsonValueKind.String && u.GetString()!.StartsWith("https://") ? u.GetString() : null;
            }
            catch { payUrl = null; }
            pay.IsVisible = payUrl is not null;
        }
        var install = Action("Colar licença", K.ICheck, async () =>
        {
            var text = (box.Text ?? "").Trim();
            if (!text.StartsWith("AC1.")) { toast.Text = "Isso não parece uma licença (começa com AC1.)."; toast.Foreground = K.Warn; return; }
            var err = await api.InstallLicense(text);
            toast.Text = err is null ? "Licença instalada. Obrigado!" : $"Licença recusada: {err}";
            toast.Foreground = err is null ? K.Ok : K.Err;
            if (err is null) { box.Text = ""; svc.Log("Plano: licença nova instalada."); }
            await Load();
        }, primary: true, height: 36);
        row.Children.Add(new Border { CornerRadius = new CornerRadius(10), ClipToBounds = true, Child = box });
        row.Children.Add(install);
        row.Children.Add(pay);
        col.Children.Add(row);
        col.Children.Add(toast.Also(t => { t.TextWrapping = TextWrapping.Wrap; t.MaxWidth = 900; }));
        _ = Load();
        return col;
    }

    /// <summary>Freemium: "Plano Grátis · 2 de 3 pessoas" (GET /api/plan; leitura não precisa de token CSRF).</summary>
    async Task<string> PlanText(int people)
    {
        try
        {
            using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            using var doc = System.Text.Json.JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{svc.Settings.JarvisPort}/api/plan"));
            var r = doc.RootElement;
            var nome = r.GetProperty("nome").GetString();
            var cap = r.GetProperty("pessoas").ValueKind == System.Text.Json.JsonValueKind.Number ? $"{people} de {r.GetProperty("pessoas").GetInt32()} pessoas" : $"{people} pessoas (sem limite)";
            var motivo = r.TryGetProperty("motivo", out var m) && m.ValueKind == System.Text.Json.JsonValueKind.String ? $" · licença recusada: {m.GetString()}" : "";
            return $"Plano {nome} · {cap}{motivo}";
        }
        catch { return ""; }
    }

    // ======================================================================= diálogo e ações
    /// <summary>Pergunta "tem certeza?" dentro da própria janela (igual nos três sistemas).</summary>
    void Confirm(string title, string text, string yesText, Action yes)
    {
        overlay.Children.Clear();
        var shade = new Border { Background = new SolidColorBrush(Color.FromArgb(170, 0, 0, 0)) };
        var box = new StackPanel { Spacing = 6, Width = 400 };
        box.Children.Add(K.T(title, 17, K.Text, FontWeight.SemiBold, K.Display));
        box.Children.Add(K.Wrap(text, 13, K.Muted));
        var btns = new Cols(2).Add(K.Button("Cancelar", null, Close, primary: false)).Add(K.Button(yesText, K.IStop, () => { Close(); yes(); _ = Refresh(); }, primary: false, danger: true));
        btns.Panel.Margin = new Thickness(0, 14, 0, 0);
        box.Children.Add(btns.Panel);
        var card = new Border { Background = K.Surface, BorderBrush = K.LineHi, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(18), Padding = new Thickness(22, 20), Child = box, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, BoxShadow = K.Shadow(40, 8, .6) };
        overlay.Children.Add(shade); overlay.Children.Add(card);
        overlay.IsVisible = true;
        K.Fade(overlay, 1, 200, from: 0);
        var s = K.Scale(card); K.Anim(s, "sx", () => s.ScaleX, x => { s.ScaleX = x; s.ScaleY = x; }, 1, 420, K.Spring, .94);
        void Close() => K.Fade(overlay, 0, 140, K.InQuad, done: () => overlay.IsVisible = false);
    }

    async Task StartAll()
    {
        svc.Log("Ligar tudo: começando.");
        if (!await svc.StartRouterAsync()) svc.Log("Seguindo sem o roteador: a sala funciona, os resumos por IA ficam NOT_RUN.");
        await svc.StartGateAsync();
        await svc.StartJarvisAsync();
        await StartAgents();
        Program.StartHud();
        svc.Log("Ligar tudo: pronto.");
    }

    async Task StartAgents()
    {
        if (!svc.StartAgents()) return;
        await Task.Delay(7000);
        svc.Log($"Agentes: {svc.AgentsAlive()} de {svc.Settings.LoopAgents.Count} ligados.");
    }

    /// <summary>Abre a tela completa no HUD (outro processo) por um aviso local.</summary>
    async Task OpenPanel() => await OpenPanel("full");

    async Task OpenPanel(string what)
    {
        if (Signal.Send(what)) return;
        Program.StartHud();
        for (var i = 0; i < 10; i++) { await Task.Delay(500); if (Signal.Send(what)) return; }
        svc.Log("O HUD ainda está abrindo; tente de novo em alguns segundos.");
    }

    void StopAll() => Confirm("Desligar os serviços?", "O servidor, a fila e o roteador param. Os agentes ficam sem modelo até ligar de novo.", "Desligar", () =>
    {
        svc.StopPort("Servidor", svc.Settings.JarvisPort);
        svc.StopPort("Fila anti-429", svc.Settings.GatePort);
        svc.StopPort("9Router", svc.Settings.RouterPort);
    });

    /// <summary>Conferência visual (--print): abre cada aba sem clique.</summary>
    public void SelectForPrint(int i) => ShowTab((Tab)i, animate: false);
}
