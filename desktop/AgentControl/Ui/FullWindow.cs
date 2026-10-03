using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using AgentControl.Core;

namespace AgentControl.Ui;

/// <summary>
/// Tela completa do Agent Control (abre puxando a HUD de cima para baixo). Estilo app de chat:
/// barra à esquerda e, no centro, a conversa com o time e o AgentC; mais as telas Agentes, Comandos,
/// Uso, Saúde do PC, Modelos e força, e Visão geral.
/// </summary>
public sealed class FullWindow : Window
{
    public enum View { Chat, Agents, Commands, Usage, Health, Models, Overview }
    readonly HudHost host;
    readonly Border shell;
    readonly TranslateTransform drop = new();
    readonly ContentControl body = new();
    readonly TextBlock title = K.T("Conversa", 15, K.Text, FontWeight.SemiBold, K.Display);
    readonly TextBlock live = K.T("", 12, K.Muted);
    readonly Ellipse liveDot = new() { Width = 7, Height = 7 };
    readonly List<(View V, SolidColorBrush Bg, K.Ico Icon, TextBlock Text)> nav = [];
    readonly StackPanel goalBox = new();
    readonly StackPanel messages = new() { MaxWidth = 760, Width = 760, HorizontalAlignment = HorizontalAlignment.Center };
    readonly ScrollViewer scroll = new() { VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
    readonly TextBox input;
    readonly TextBlock toLabel = K.T("Todos", 12, K.Muted, FontWeight.SemiBold);
    readonly Grid chatView = new() { RowDefinitions = new RowDefinitions("*,Auto") };
    List<(string Agent, string Text, string Ts)> chat = [];
    Dictionary<string, (string Model, string Effort)> models = [];
    List<HudApi.Cmd> cmds = [];
    (List<(string Dia, int Req, long Tokens)> Days, List<(string Agent, int Req, long Tokens, int R429, int MsMedio)> Agents) usage = ([], []);
    List<HudApi.ModelInfo> modelOpts = [];
    string cmdTo = "TODOS", toast = "", to = "TODOS", sig = "", chatSig = "";
    // Redesenhar a tela inteira a cada leitura do servidor fazia os cartões "piscarem" e a rolagem voltar ao topo.
    View lastView = (View)(-1);
    bool enterCards = true;
    View view = View.Chat;
    bool closing, sending, loadingChat, loadingUsage;
    DateTime usageLoadedAt = DateTime.MinValue;

    public FullWindow(HudHost host)
    {
        this.host = host;
        SystemDecorations = SystemDecorations.None;
        TransparencyLevelHint = [WindowTransparencyLevel.Transparent];
        Background = Brushes.Transparent; CanResize = false; ShowInTaskbar = true; Title = "Agent Control";
        Width = 1180; Height = 760; FontFamily = K.Ui; Foreground = K.Text; Icon = Program.AppIcon();
        WindowStartupLocation = WindowStartupLocation.Manual;

        // ---------- barra lateral ----------
        var side = new DockPanel { Width = 232, LastChildFill = false };
        var brand = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(18, 20, 18, 22), Background = Brushes.Transparent, Children = { K.Face(30), K.T("Agent Control", 15, K.Text, FontWeight.SemiBold, K.Display) } };
        K.DragOrClick(this, brand, null);
        DockPanel.SetDock(brand, Dock.Top); side.Children.Add(brand);
        var items = new StackPanel { Margin = new Thickness(10, 0), Spacing = 2 };
        foreach (var (v, icon, text) in new[] { (View.Chat, K.IChat, "Conversa"), (View.Agents, K.IPeople, "Agentes"), (View.Commands, K.ISend, "Comandos"), (View.Usage, K.IUsage, "Uso"), (View.Health, K.IHealth, "Saúde do PC"), (View.Models, K.ISettings, "Modelos e força"), (View.Overview, K.IHome, "Visão geral") })
        {
            var bg = new SolidColorBrush(Colors.Transparent);
            var ic = K.Icon(icon, 16, K.Muted);
            var tx = K.T(text, 13.5, K.Text2, FontWeight.Medium);
            var box = new Border { Height = 40, CornerRadius = new CornerRadius(10), Background = bg, Padding = new Thickness(12, 0), Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center, Children = { ic, tx } } };
            K.Pressable(box, () => ShowView(v), () => { if (view != v) K.AnimColor(bg, K.C("#161616"), 120); }, () => { if (view != v) K.AnimColor(bg, Colors.Transparent, 160); });
            nav.Add((v, bg, ic, tx));
            items.Children.Add(box);
        }
        DockPanel.SetDock(items, Dock.Top); side.Children.Add(items);
        var foot = new StackPanel { Margin = new Thickness(14, 0, 14, 16), Children = { goalBox, new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(4, 12, 0, 0), Children = { liveDot, live } } } };
        DockPanel.SetDock(foot, Dock.Bottom); side.Children.Add(foot);
        var sideBox = new Border { Background = K.Side, BorderBrush = K.Line, BorderThickness = new Thickness(0, 0, 1, 0), CornerRadius = new CornerRadius(22, 0, 0, 22), Child = side };

        // ---------- topo do conteúdo ----------
        var head = new Grid { Height = 56, Background = Brushes.Transparent, Margin = new Thickness(24, 6, 14, 0), ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        head.Children.Add(title);
        var close = new Border { Width = 34, Height = 34, CornerRadius = new CornerRadius(10), Background = Brushes.Transparent, Child = K.Icon(K.IClose, 13, K.Muted), VerticalAlignment = VerticalAlignment.Center };
        close.Tip("Fechar (Esc)");
        K.Pressable(close, CloseAnimated); Grid.SetColumn(close, 1); head.Children.Add(close);
        K.DragOrClick(this, head, null);

        // ---------- conversa ----------
        input = new TextBox
        {
            Watermark = "Mensagem para o time", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MaxHeight = 160, FontSize = 14.5, FontFamily = K.Ui,
            Background = Brushes.Transparent, BorderThickness = new Thickness(0), CaretBrush = K.Brand, VerticalAlignment = VerticalAlignment.Center, Padding = new Thickness(4, 6), MinHeight = 0,
        };
        input.AddHandler(KeyDownEvent, (_, e) => { if (e.Key == Key.Enter && !e.KeyModifiers.HasFlag(KeyModifiers.Shift)) { e.Handled = true; _ = Send(); } }, RoutingStrategies.Tunnel);
        var toBox = new Border { CornerRadius = new CornerRadius(15), Padding = new Thickness(12, 5, 12, 6), Background = K.Raised, Child = toLabel, VerticalAlignment = VerticalAlignment.Center };
        toBox.Tip("Para quem vai (clique para trocar)");
        K.Pressable(toBox, NextTarget);
        var send = new Border { Width = 36, Height = 36, CornerRadius = new CornerRadius(18), Background = K.Text, Child = K.Icon(K.ISend, 15, K.Bg), VerticalAlignment = VerticalAlignment.Center };
        send.Tip("Enviar (Enter)");
        K.Pressable(send, () => _ = Send());
        var comp = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        comp.Children.Add(toBox); Grid.SetColumn(input, 1); input.Margin = new Thickness(6, 0, 8, 0); comp.Children.Add(input); Grid.SetColumn(send, 2); comp.Children.Add(send);
        var composer = new Border { MaxWidth = 760, MinHeight = 56, CornerRadius = new CornerRadius(28), Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), Padding = new Thickness(10, 8), Child = comp, Margin = new Thickness(24, 8, 24, 18) };
        input.GotFocus += (_, _) => composer.BorderBrush = K.LineHi;
        input.LostFocus += (_, _) => composer.BorderBrush = K.Line;
        scroll.Content = new Border { Padding = new Thickness(24, 8, 24, 24), Child = messages };
        chatView.Children.Add(scroll); Grid.SetRow(composer, 1); chatView.Children.Add(composer);

        var main = new DockPanel();
        DockPanel.SetDock(head, Dock.Top); main.Children.Add(head);
        main.Children.Add(body);
        var cols = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
        cols.Children.Add(sideBox); Grid.SetColumn(main, 1); cols.Children.Add(main);
        shell = new Border
        {
            Background = K.Bg, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(22), ClipToBounds = true,
            Margin = new Thickness(18), Child = cols, RenderTransform = drop, BoxShadow = K.Shadow(40, 6, .6),
        };
        Content = shell;
        KeyDown += (_, e) => { if (e.Key == Key.Escape) CloseAnimated(); };
    }

    /// <summary>Desce do topo da tela, como se viesse puxada da HUD.</summary>
    public void Open()
    {
        closing = false;
        ShowView(view, animate: false);
        // Aberta por aviso de outro processo (Launcher), o Windows não deixa roubar o foco: sobe por cima um instante.
        Topmost = true;
        Show(); Activate();
        DispatcherTimer.RunOnce(() => Topmost = false, TimeSpan.FromMilliseconds(600));
        var (wa, _) = K.WorkArea(this);
        K.MoveTo(this, wa.Left + (wa.Width - Width) / 2, wa.Top + Math.Max(0, (wa.Height - Height) / 2));
        K.Fade(shell, 1, 320, from: 0);
        K.Anim(drop, "y", () => drop.Y, y => drop.Y = y, 0, 700, K.OutExpo, -140);
        if (view == View.Chat) Dispatcher.UIThread.Post(() => input.Focus(), DispatcherPriority.Input);
    }

    public void CloseAnimated()
    {
        if (!IsVisible || closing) return;
        closing = true;
        K.Anim(drop, "y", () => drop.Y, y => drop.Y = y, -60, 200, K.InQuad);
        K.Fade(shell, 0, 200, K.InQuad, done: () => { if (closing) Hide(); });
    }

    public void ShowView(View v, bool animate = true)
    {
        view = v;
        foreach (var n in nav)
        {
            var on = n.V == v;
            K.AnimColor(n.Bg, on ? K.C("#1A1A1A") : Colors.Transparent, 160);
            n.Icon.Color = on ? K.BrandText : K.Muted;
            n.Text.Foreground = on ? K.Text : K.Text2;
            n.Text.FontWeight = on ? FontWeight.SemiBold : FontWeight.Medium;
        }
        title.Text = v switch { View.Chat => "Conversa", View.Agents => "Agentes", View.Commands => "Comandos", View.Usage => "Uso dos agentes", View.Health => "Saúde do PC", View.Models => "Modelos e força", _ => "Visão geral" };
        sig = ""; chatSig = "";
        Refresh();
        if (animate && body.Content is Visual fe) K.EnterUp(fe, 0, 10);
        if (v == View.Chat) _ = LoadChat();
        if (v == View.Agents) _ = LoadModels();
        if (v == View.Commands) _ = LoadCommands();
        if (v == View.Usage) _ = LoadUsage();
        if (v == View.Models) _ = LoadModelOpts();
    }

    public void Refresh()
    {
        if (view == View.Usage && !loadingUsage && DateTime.UtcNow - usageLoadedAt >= TimeSpan.FromSeconds(10)) _ = LoadUsage();
        var s = host.Snap;
        liveDot.Fill = !s.Online ? K.Err : s.Paused ? K.Warn : K.Ok;
        live.Text = !s.Online ? "servidor desligado" : s.Paused ? "agentes pausados" : "online";
        GoalFoot(s);
        if (!s.Online) { body.Content = OfflineView(); sig = "off"; return; }
        if (view == View.Chat) { body.Content = chatView; if (s.Chat.FirstOrDefault().Ts != chat.LastOrDefault().Ts) _ = LoadChat(); return; }
        var newSig = Signature(s);
        if (newSig == sig) return;
        sig = newSig;
        if (view == View.Commands && cmds.Count(c => c.Approval == "pending") != s.Pending) _ = LoadCommands();
        // Mesma tela atualizando: guarda onde a rolagem estava e não repete a animação de entrada.
        var sameView = view == lastView;
        var savedY = sameView && body.Content is ScrollViewer old ? old.Offset.Y : 0;
        enterCards = !sameView;
        lastView = view;
        body.Content = view switch
        {
            View.Agents => AgentsView(s),
            View.Commands => CommandsView(),
            View.Usage => UsageView(),
            View.Health => Padded(HealthView(s)),
            View.Models => ModelsView(),
            _ => Padded(Overview(s)),
        };
        if (savedY > 0 && body.Content is ScrollViewer sv)
            Avalonia.Threading.Dispatcher.UIThread.Post(() => sv.Offset = new Vector(0, savedY), Avalonia.Threading.DispatcherPriority.Background);
    }

    /// <summary>
    /// O que muda a tela de cada view. Antes todas olhavam tudo (RAM, CPU, pedidos, "checado em"…) e a tela refazia a cada
    /// poucos segundos. Agora cada uma só olha o que ela mostra, e porcentagem em passos inteiros.
    /// </summary>
    string Signature(HudSnapshot s)
    {
        string Agents() => string.Join(",", s.Agents.Select(a => a.Id + a.Status + a.Task));
        string Pcts() => string.Join(",", s.Usage.GroupBy(u => u.Agent).Select(g => g.Key + (int)Math.Round(g.Sum(x => x.Share) * 100)));
        var calls = $"{s.Pending}{s.Paused}{s.Goal}{s.TasksDone}{s.CallStatus}{s.CallModo}";
        return view switch
        {
            View.Agents => $"{view}{Agents()}|{Pcts()}|{string.Join(",", models.Select(m => m.Key + m.Value.Model + m.Value.Effort))}|{string.Join(",", s.Limits.Values.Select(q => q.Agent + q.Badge))}",
            View.Commands => $"{view}{s.Pending}|{string.Join(",", cmds.Select(c => c.Code + c.Status + c.Approval))}|{toast}",
            View.Usage => $"{view}{usage.Days.Sum(d => d.Req)}|{usage.Agents.Sum(a => a.Req)}",
            View.Models => $"{view}{string.Join(",", modelOpts.Select(m => m.Id + m.Current + m.Effort))}|{toast}",
            View.Health => $"{view}{s.RamFreeMb / 200}{s.Cpu / 10}{s.Paused}|{Agents()}|{string.Join(",", s.Alerts)}",
            _ => $"{view}{Agents()}|{Pcts()}|{calls}|{s.RamFreeMb / 200}",
        };
    }

    // ---------- Goal no rodapé da barra lateral ----------
    void GoalFoot(HudSnapshot s)
    {
        goalBox.Children.Clear();
        if (!s.Online || string.IsNullOrWhiteSpace(s.Goal)) return;
        var running = s.CallActive && s.CallModo == "goal";
        var col = new StackPanel();
        col.Children.Add(K.T("GOAL", 10, K.Muted, FontWeight.SemiBold));
        col.Children.Add(K.Wrap(s.Goal, 12, K.Text2, 2).Also(t => t.Margin = new Thickness(0, 3, 0, 8)));
        if (s.TasksTotal > 0) col.Children.Add(K.Bar((double)s.TasksDone / s.TasksTotal, height: 3, animate: false));
        col.Children.Add(K.T(running ? "Modo Goal rodando" : $"{s.TasksDone}/{s.TasksTotal} · iniciar Modo Goal", 11.5, running ? K.Ok : K.BrandText, FontWeight.SemiBold).Also(t => t.Margin = new Thickness(0, 8, 0, 0)));
        var card = new Border { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 10), Child = col };
        K.Pressable(card, running ? host.EndCall : host.StartGoal);
        card.Tip(running ? "Clique para encerrar o Modo Goal" : "Clique para iniciar o Modo Goal");
        goalBox.Children.Add(card);
    }

    // ---------- conversa ----------
    async Task LoadChat()
    {
        if (loadingChat) return;
        loadingChat = true;
        try { chat = await host.Api.ChatAsync(); } finally { loadingChat = false; }
        RenderChat();
    }

    void RenderChat()
    {
        var newSig = string.Join("|", chat.Select(c => c.Ts + c.Agent + c.Text.Length)) + sending;
        if (newSig == chatSig) return;
        chatSig = newSig;
        messages.Children.Clear();
        var today = DateTime.Now.ToString("yyyy-MM-dd");
        var todays = chat.Where(c => c.Ts.StartsWith(today)).ToList();
        if (todays.Count == 0)
        {
            // Conversa nova do dia: AgentC, pergunta e sugestões.
            var hero = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 90, 0, 0) };
            hero.Children.Add(K.Face(72).Also(f => f.HorizontalAlignment = HorizontalAlignment.Center));
            hero.Children.Add(K.T("Como posso ajudar?", 26, K.Text, FontWeight.SemiBold, K.Display).Also(t => { t.HorizontalAlignment = HorizontalAlignment.Center; t.Margin = new Thickness(0, 22); }));
            var sug = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Center };
            foreach (var (label, text) in new[] { ("Como está o time agora?", "Como está o time agora? Quem está trabalhando, quem travou e o que falta."), ("O que falta no Goal?", "O que falta para terminar o Goal ativo? Liste em ordem."), ("Resumo de hoje", "Faça um resumo curto do que o time fez hoje.") })
            {
                var b = new Border { CornerRadius = new CornerRadius(18), BorderBrush = K.Line, BorderThickness = new Thickness(1), Padding = new Thickness(14, 8, 14, 9), Margin = new Thickness(4), Child = K.T(label, 13, K.Text2) };
                K.Pressable(b, () => { input.Text = text; _ = Send(); });
                sug.Children.Add(b);
            }
            hero.Children.Add(sug);
            if (chat.Count > 0) hero.Children.Add(K.T($"{chat.Count} mensagens antigas na sala", 11.5, K.Faint).Also(t => { t.HorizontalAlignment = HorizontalAlignment.Center; t.Margin = new Thickness(0, 18, 0, 0); }));
            messages.Children.Add(hero);
        }
        foreach (var m in todays) messages.Children.Add(Message(m.Agent, m.Text, m.Ts));
        if (sending || todays.LastOrDefault().Agent == "DONO")
            messages.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, 6, 0, 0), Children = { K.Face(22), K.T("AgentC está pensando…", 13, K.Muted) } });
        Dispatcher.UIThread.Post(scroll.ScrollToEnd, DispatcherPriority.Background);
    }

    static Control Message(string agent, string text, string ts)
    {
        if (agent == "DONO")
            return new Border
            {
                HorizontalAlignment = HorizontalAlignment.Right, MaxWidth = 520, Margin = new Thickness(0, 10), Background = K.Raised, CornerRadius = new CornerRadius(18), Padding = new Thickness(16, 11, 16, 12),
                Child = K.Wrap(text, 14.5, K.Text, lineHeight: 21),
            };
        var col = new StackPanel { Margin = new Thickness(0, 10) };
        col.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal, Spacing = 9, Margin = new Thickness(0, 0, 0, 6),
            Children = { agent == "JARVIS" ? K.Face(22) : K.Avatar(agent, 22), K.T(K.Nice(agent), 13, K.Text, FontWeight.SemiBold), K.T(K.Ago(ts), 11.5, K.Faint) },
        });
        col.Children.Add(K.Wrap(text, 14.5, K.Text2, lineHeight: 22).Also(t => t.Margin = new Thickness(31, 0, 0, 0)));
        return col;
    }

    void NextTarget()
    {
        var ids = new[] { "TODOS" }.Concat(host.Snap.Agents.Select(a => a.Id).Where(i => i != "CHATGPT")).ToList();
        to = ids[(ids.IndexOf(to) + 1) % ids.Count];
        toLabel.Text = to == "TODOS" ? "Todos" : K.Nice(to);
        toLabel.Foreground = to == "TODOS" ? K.Muted : K.BrandText;
    }

    async Task Send()
    {
        var text = (input.Text ?? "").Trim();
        if (text.Length == 0 || sending) return;
        sending = true;
        chat.Add(("DONO", text, DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss")));
        input.Text = "";
        RenderChat();
        var err = await host.Api.SendChat(text, to);
        sending = false;
        if (err is not null) { chat.Add(("JARVIS", $"Não consegui enviar: {err}", DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss"))); RenderChat(); return; }
        host.KickRefresh();
        await LoadChat();
    }

    static Control Padded(Control e) => new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, AllowAutoHide = true, Content = new Border { Padding = new Thickness(24, 4, 24, 24), Child = e } };

    // ---------- Comandos (J-xxx): mandar, aprovar, recusar ----------
    async Task LoadCommands() { cmds = await host.Api.CommandsAsync(); sig = ""; Refresh(); }

    Control CommandsView()
    {
        var v = new StackPanel();
        var box = new TextBox { Watermark = "Comando para um agente (ex.: rode os testes do login)", FontSize = 14, FontFamily = K.Ui, Background = Brushes.Transparent, BorderThickness = new Thickness(0), CaretBrush = K.Brand, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0) };
        var toTx = K.T(cmdTo == "TODOS" ? "Todos" : K.Nice(cmdTo), 12, cmdTo == "TODOS" ? K.Muted : K.BrandText, FontWeight.SemiBold);
        var toB = new Border { CornerRadius = new CornerRadius(14), Padding = new Thickness(12, 5, 12, 6), Background = K.Raised, Child = toTx, VerticalAlignment = VerticalAlignment.Center };
        toB.Tip("Para quem (clique para trocar)");
        K.Pressable(toB, () =>
        {
            var ids = new[] { "TODOS", "LEADER" }.Concat(host.Snap.Agents.Select(a => a.Id).Where(i => i != "CHATGPT")).ToList();
            cmdTo = ids[(ids.IndexOf(cmdTo) + 1) % ids.Count];
            toTx.Text = cmdTo == "TODOS" ? "Todos" : cmdTo == "LEADER" ? "Líder" : K.Nice(cmdTo);
            toTx.Foreground = cmdTo == "TODOS" ? K.Muted : K.BrandText;
        });
        async void SendCmd()
        {
            var t = (box.Text ?? "").Trim(); if (t.Length == 0) return;
            box.Text = "";
            var err = await host.Api.SendCommand(t, cmdTo);
            toast = err is null ? $"Comando enviado para {(cmdTo == "TODOS" ? "todos" : K.Nice(cmdTo))}." : $"Não enviei: {err}";
            await LoadCommands();
        }
        box.KeyDown += (_, e) => { if (e.Key == Key.Enter) SendCmd(); };
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        row.Children.Add(toB); Grid.SetColumn(box, 1); row.Children.Add(box);
        var go = K.Button("Enviar", K.ISend, SendCmd, height: 36); Grid.SetColumn(go, 2); row.Children.Add(go);
        v.Children.Add(K.Card(row, 24, new Thickness(8)));
        if (toast.Length > 0) v.Children.Add(K.T(toast, 12.5, toast.StartsWith("Não") ? K.Err : K.Ok).Also(t => t.Margin = new Thickness(6, 8, 0, 0)));

        var pend = cmds.Where(c => c.Approval == "pending").ToList();
        if (pend.Count > 0)
        {
            v.Children.Add(K.Label("Esperando você").Also(l => l.Margin = new Thickness(0, 18, 0, 8)));
            foreach (var c in pend)
            {
                var g = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
                g.Children.Add(new StackPanel { Children = { K.T($"{c.Code} · {K.Nice(c.Target)}", 12, K.Warn, FontWeight.SemiBold, K.Mono), K.Wrap(c.Text, 13.5, K.Text).Also(t => t.Margin = new Thickness(0, 4, 12, 0)) } });
                var code = c.Code;
                var btns = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
                btns.Children.Add(K.Button("Recusar", null, async () => { var e = await host.Api.Decide(code, false); toast = e ?? $"{code} recusado."; host.KickRefresh(); await LoadCommands(); }, primary: false, height: 34));
                btns.Children.Add(K.Button("Aprovar", K.ICheck, async () => { var e = await host.Api.Decide(code, true); toast = e ?? $"{code} aprovado. Vale só para este comando."; host.KickRefresh(); await LoadCommands(); }, height: 34));
                Grid.SetColumn(btns, 1); g.Children.Add(btns);
                v.Children.Add(new Border { Background = new SolidColorBrush(Color.FromArgb(22, 245, 158, 11)), BorderBrush = new SolidColorBrush(Color.FromArgb(70, 245, 158, 11)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(14), Padding = new Thickness(14, 12, 12, 12), Margin = new Thickness(0, 0, 0, 8), Child = g });
            }
        }
        v.Children.Add(K.Label("Histórico").Also(l => l.Margin = new Thickness(0, 18, 0, 8)));
        if (cmds.Count == 0) v.Children.Add(K.T("Nenhum comando ainda.", 13, K.Muted));
        var list = new StackPanel();
        foreach (var c in cmds.Where(c => c.Approval != "pending").OrderByDescending(c => int.TryParse(c.Code.AsSpan(2), out var x) ? x : 0).Take(40))
        {
            var g = new Grid { MinHeight = 46, ColumnDefinitions = new ColumnDefinitions("62,100,*,110") };
            g.Children.Add(K.T(c.Code, 12, K.Faint, f: K.Mono));
            var who = K.T(c.Target == "TODOS" ? "Todos" : c.Target == "LEADER" ? "Líder" : K.Nice(c.Target), 12.5, K.Text, FontWeight.SemiBold); Grid.SetColumn(who, 1); g.Children.Add(who);
            var tx = K.T(c.Text.Replace('\n', ' '), 13, K.Text2); tx.Tip(c.Text); tx.Margin = new Thickness(0, 0, 12, 0); Grid.SetColumn(tx, 2); g.Children.Add(tx);
            var st = K.T(c.Status, 11, K.StatusBrush(c.Status), FontWeight.Bold, K.Mono); st.HorizontalAlignment = HorizontalAlignment.Right; Grid.SetColumn(st, 3); g.Children.Add(st);
            var line = new Border { Height = 1, Background = K.Line, VerticalAlignment = VerticalAlignment.Bottom, Opacity = .6 }; Grid.SetColumnSpan(line, 4); g.Children.Add(line);
            list.Children.Add(g);
        }
        v.Children.Add(K.Card(list, 16, new Thickness(16, 4)));
        return Padded(v);
    }

    // ---------- Uso: gráfico de 7 dias + por agente ----------
    async Task LoadUsage()
    {
        if (loadingUsage) return;
        loadingUsage = true;
        try { usage = await host.Api.UsageAsync(7); usageLoadedAt = DateTime.UtcNow; sig = ""; }
        finally { loadingUsage = false; }
        Refresh();
    }

    Control UsageView()
    {
        var v = new StackPanel();
        var limits = new StackPanel { Spacing = 8 };
        limits.Children.Add(K.Label("Cotas dos provedores · atualização automática"));
        foreach (var a in host.Snap.Agents.Where(a => a.Id != "CHATGPT"))
        {
            var q = host.Snap.Limits.GetValueOrDefault(a.Id);
            var row = new StackPanel { Spacing = 3 };
            row.Children.Add(K.T(K.Nice(a.Id) + " · " + (q?.Badge ?? "—") + (q?.RemainingPercent is not null && q.Fresh ? " restantes" : ""), 13, q?.Status == "limited" ? K.Warn : K.Text, FontWeight.SemiBold));
            row.Children.Add(K.Wrap(q?.Description ?? "Saldo de cota não informado pelo provedor.", 11.5, K.Muted));
            limits.Children.Add(row);
        }
        v.Children.Add(K.Card(limits, 18, new Thickness(20, 16)).Also(c => c.Margin = new Thickness(0, 0, 0, 14)));
        var total = usage.Days.Sum(d => d.Req);
        var tokens = usage.Days.Sum(d => d.Tokens);
        var r429 = usage.Agents.Sum(a => a.R429);
        v.Children.Add(new Cols(3, 12).Add(Metric("Pedidos (7 dias)", $"{total}", K.Text))
            .Add(Metric("Tokens (7 dias)", tokens >= 1_000_000 ? $"{tokens / 1_000_000.0:0.0} mi".Replace('.', ',') : $"{tokens / 1000} mil", K.Text))
            .Add(Metric("Erros 429", $"{r429}", r429 > 0 ? K.Warn : K.Text)).Panel);
        v.Children.Add(K.Card(DayChart(usage.Days), 18, new Thickness(20, 16, 20, 14)).Also(c => c.Margin = new Thickness(0, 14)));
        var rows = new StackPanel();
        rows.Children.Add(K.Label("Por agente"));
        var max = Math.Max(1, usage.Agents.Select(a => a.Req).DefaultIfEmpty(0).Max());
        foreach (var a in usage.Agents.OrderByDescending(a => a.Req))
        {
            var g = new Grid { Margin = new Thickness(0, 6), ColumnDefinitions = new ColumnDefinitions("36,110,*,150") };
            g.Children.Add(K.Avatar(a.Agent, 26));
            var n = K.T(K.Nice(a.Agent), 13, K.Text, FontWeight.SemiBold); Grid.SetColumn(n, 1); g.Children.Add(n);
            var bar = K.Bar((double)a.Req / max, height: 6); Grid.SetColumn(bar, 2); g.Children.Add(bar);
            var info = K.T($"{a.Req} pedidos · " + (a.MsMedio >= 1000 ? $"{a.MsMedio / 1000.0:0.0} s" : $"{a.MsMedio} ms"), 12, K.Muted, f: K.Mono); info.HorizontalAlignment = HorizontalAlignment.Right; Grid.SetColumn(info, 3); g.Children.Add(info);
            rows.Children.Add(g);
        }
        if (usage.Agents.Count == 0) rows.Children.Add(K.T("Nenhum pedido nos últimos 7 dias.", 13, K.Muted));
        v.Children.Add(K.Card(rows, 18, new Thickness(20, 16, 20, 14)));
        return Padded(v);
    }

    /// <summary>Barras por dia (pedidos), com o valor em cima e o dia embaixo; hoje em laranja.</summary>
    static Control DayChart(List<(string Dia, int Req, long Tokens)> days)
    {
        var v = new StackPanel();
        v.Children.Add(K.Label("Pedidos por dia"));
        var g = new Grid { Height = 170 };
        var max = Math.Max(1, days.Select(d => d.Req).DefaultIfEmpty(0).Max());
        var today = DateTime.Now.ToString("yyyy-MM-dd");
        for (var i = 0; i < days.Count; i++)
        {
            g.ColumnDefinitions.Add(new ColumnDefinition(1, GridUnitType.Star));
            var d = days[i];
            var isToday = d.Dia == today;
            var col = new DockPanel { Margin = new Thickness(8, 0) };
            var label = K.T(DateTime.TryParse(d.Dia, out var dt) ? dt.ToString("ddd dd").Replace(".", "") : d.Dia, 11, isToday ? K.BrandText : K.Faint);
            label.HorizontalAlignment = HorizontalAlignment.Center; label.Margin = new Thickness(0, 8, 0, 0);
            DockPanel.SetDock(label, Dock.Bottom); col.Children.Add(label);
            var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom };
            stack.Children.Add(K.T(d.Req > 0 ? $"{d.Req}" : "", 11.5, isToday ? K.BrandText : K.Muted, FontWeight.SemiBold, K.Mono).Also(t => { t.HorizontalAlignment = HorizontalAlignment.Center; t.Margin = new Thickness(0, 0, 0, 4); }));
            var bar = new Border { Height = 0, MaxWidth = 46, CornerRadius = new CornerRadius(6, 6, 2, 2), Background = isToday ? K.Brand : new SolidColorBrush(K.C("#3A3A3A")) };
            bar.Tip($"{d.Req} pedidos · {d.Tokens:N0} tokens");
            if (d.Req == 0) { bar.Height = 3; bar.Background = K.Raised; }
            else K.Anim(bar, "h", () => bar.Height, h => bar.Height = h, Math.Max(4, 120.0 * d.Req / max), 900, K.OutExpo, 0, i * 60);
            stack.Children.Add(bar);
            col.Children.Add(stack);
            Grid.SetColumn(col, i); g.Children.Add(col);
        }
        v.Children.Add(g);
        return v;
    }

    // ---------- Saúde do PC ----------
    Control HealthView(HudSnapshot s)
    {
        var v = new StackPanel();
        v.Children.Add(new Cols(3, 12).Add(Metric("RAM livre", $"{s.RamFreeMb / 1024.0:0.0} GB".Replace('.', ','), s.RamFreeMb < 1500 ? K.Err : K.Text))
            .Add(Metric("CPU", s.Cpu is { } c ? $"{c}%" : "—", s.Cpu > 85 ? K.Warn : K.Text)).Add(Metric("Agentes", s.Paused ? "pausados" : "rodando", s.Paused ? K.Warn : K.Ok)).Panel);
        var gauges = new Cols(2, 12)
            .Add(K.Card(Gauge("Memória livre", Math.Clamp(s.RamFreeMb / 12000.0, 0, 1), s.RamFreeMb < 1500 ? K.Err : K.Ok, $"{s.RamFreeMb} MB"), 18, new Thickness(18)))
            .Add(K.Card(Gauge("CPU em uso", (s.Cpu ?? 0) / 100.0, s.Cpu > 85 ? K.Warn : K.Brand, s.Cpu is { } cc ? $"{cc}%" : "—"), 18, new Thickness(18)));
        v.Children.Add(gauges.Panel.Also(p => p.Margin = new Thickness(0, 14)));
        if (s.Alerts.Count > 0)
        {
            var al = new StackPanel { Spacing = 6 };
            al.Children.Add(K.Label("Alertas"));
            foreach (var a in s.Alerts) al.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { K.Icon(K.IWarn, 13, K.Warn), K.Wrap(a, 13, K.Warn).Also(t => t.MaxWidth = 760) } });
            v.Children.Add(K.Card(al, 16, new Thickness(18, 14)).Also(c => c.Margin = new Thickness(0, 0, 0, 14)));
        }
        v.Children.Add(new Cols(2, 12).Add(s.Paused ? K.Button("Retomar os agentes", K.IPlay, () => host.SetPause(false)) : K.Button("Pausar os agentes", K.IPause, () => host.SetPause(true), primary: false))
            .Add(K.Button("Abrir o Launcher", K.IOpen, host.OpenLauncher, primary: false)).Panel);
        return v;
    }

    /// <summary>Medidor em arco (0..1) com o valor no meio.</summary>
    static Control Gauge(string label, double value, IBrush color, string text)
    {
        const double size = 150, th = 12;
        var g = new Grid { Width = size, Height = size, HorizontalAlignment = HorizontalAlignment.Center };
        g.Children.Add(new Ellipse { Stroke = K.Raised, StrokeThickness = th, Margin = new Thickness(th / 2) });
        g.Children.Add(K.Arc(size, th, value, color));
        g.Children.Add(new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Children = { K.T(text, 20, K.Text, FontWeight.SemiBold, K.Display).Also(t => t.HorizontalAlignment = HorizontalAlignment.Center), K.T(label, 11.5, K.Muted).Also(t => t.HorizontalAlignment = HorizontalAlignment.Center) } });
        return g;
    }

    // ---------- Modelos e força ----------
    async Task LoadModelOpts() { modelOpts = await host.Api.ModelOptionsAsync(); sig = ""; Refresh(); }

    Control ModelsView()
    {
        var v = new StackPanel();
        v.Children.Add(K.Wrap("Escolha o modelo e a força de cada agente. Vale a partir da próxima rodada dele.", 13, K.Muted).Also(t => t.Margin = new Thickness(0, 0, 0, 14)));
        if (toast.Length > 0) v.Children.Add(K.T(toast, 12.5, toast.StartsWith("Não") ? K.Err : K.Ok).Also(t => t.Margin = new Thickness(2, 0, 0, 12)));
        if (modelOpts.Count == 0) v.Children.Add(K.T("Carregando…", 13, K.Muted));
        foreach (var m in modelOpts)
        {
            var col = new StackPanel();
            col.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Children = { K.Avatar(m.Id, 30), K.T(K.Nice(m.Id), 15, K.Text, FontWeight.SemiBold, K.Display), K.T($"{m.Current.Split('/').Last()}{(m.Effort.Length > 0 ? " · " + m.Effort : "")}", 12, K.Faint, f: K.Mono) } });
            var opts = new WrapPanel { Margin = new Thickness(0, 12, 0, 0) };
            foreach (var o in m.Options)
            {
                var on = o.Id == m.Current;
                var chip = new Border { CornerRadius = new CornerRadius(10), Padding = new Thickness(12, 6, 12, 7), Margin = new Thickness(0, 0, 6, 6), Background = on ? K.Brand : K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(on ? 0 : 1), Child = K.T(o.Label.Length > 0 ? o.Label : o.Id.Split('/').Last(), 12, on ? K.OnBrand : K.Text2, FontWeight.SemiBold) };
                chip.Tip(o.Note.Length > 0 ? o.Note : o.Id);
                var (agent, model, eff) = (m.Id, o.Id, m.Effort);
                if (!on) K.Pressable(chip, async () => { var e = await host.Api.SetModel(agent, model, eff.Length > 0 ? eff : null); toast = e is null ? $"{K.Nice(agent)} agora usa {model.Split('/').Last()}." : $"Não troquei: {e}"; await LoadModelOpts(); });
                opts.Children.Add(chip);
            }
            col.Children.Add(opts);
            if (m.Efforts.Count > 0)
            {
                var ef = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
                ef.Children.Add(K.T("Força", 12, K.Muted).Also(t => t.Margin = new Thickness(0, 0, 10, 6)));
                foreach (var e in m.Efforts)
                {
                    var on = e == m.Effort;
                    var chip = new Border { CornerRadius = new CornerRadius(10), Padding = new Thickness(10, 4, 10, 5), Margin = new Thickness(0, 0, 4, 6), Background = on ? K.BrandSoft : Brushes.Transparent, BorderBrush = on ? K.Brand : K.Line, BorderThickness = new Thickness(1), Child = K.T(e, 11.5, on ? K.BrandText : K.Muted, FontWeight.SemiBold, K.Mono) };
                    var (agent, model, eff) = (m.Id, m.Current, e);
                    if (!on) K.Pressable(chip, async () => { var er = await host.Api.SetModel(agent, model, eff); toast = er is null ? $"{K.Nice(agent)} agora com força {eff}." : $"Não troquei: {er}"; await LoadModelOpts(); });
                    ef.Children.Add(chip);
                }
                col.Children.Add(ef);
            }
            v.Children.Add(K.Card(col, 16, new Thickness(18, 14, 18, 10)).Also(c => c.Margin = new Thickness(0, 0, 0, 10)));
        }
        return Padded(v);
    }

    // ---------- tela só dos agentes ----------
    async Task LoadModels() { models = await host.Api.ModelsAsync(); sig = ""; Refresh(); }

    Control AgentsView(HudSnapshot s)
    {
        var agents = s.Agents.Where(a => a.Id != "CHATGPT").ToList();
        var share = s.Usage.GroupBy(u => u.Agent).ToDictionary(g => g.Key, g => g.Sum(x => x.Share));
        var grid = new UniformGrid { Columns = 3 };
        var i = 0;
        var marks = K.Marks(agents.Select(a => a.Id));
        foreach (var a in agents)
        {
            var color = K.StatusBrush(a.Status);
            var pct = share.TryGetValue(a.Id, out var v) ? (int)Math.Round(v * 100) : 0;
            var top = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
            top.Children.Add(K.UsageRing(a.Id, 46, pct / 100.0, color, marks[a.Id]));
            var names = new StackPanel { Margin = new Thickness(12, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, Children = { K.T(K.Nice(a.Id), 15, K.Text, FontWeight.SemiBold, K.Display), K.T(K.StatusText(a.Status), 12, color) } };
            Grid.SetColumn(names, 1); top.Children.Add(names);
            var big = K.T($"{pct}%", 20, pct > 0 ? K.BrandText : K.Faint, FontWeight.SemiBold, K.Display); big.Tip("Uso de hoje (parte dos pedidos do time)");
            Grid.SetColumn(big, 2); top.Children.Add(big);
            var card = new StackPanel { Children = { top } };
            // Status velho (loop desligado ou sem registro há mais de 2 h) não pode parecer trabalho de agora.
            var age = s.Reports.TryGetValue(a.Id, out var r0) && DateTime.TryParse(r0.Ts, out var t0) ? DateTime.Now - t0 : TimeSpan.MaxValue;
            var stale = age > TimeSpan.FromHours(2) || K.StatusText(a.Status).Contains("desligado");
            var taskText = string.IsNullOrWhiteSpace(a.Task) ? "Esperando ordem" : stale ? $"Última tarefa: {a.Task}" : a.Task;
            card.Children.Add(K.Wrap(taskText, 12.5, stale ? K.Faint : K.Muted, 2).Also(t => t.Margin = new Thickness(0, 14, 0, 12)).Tip(a.Task));
            if (stale) card.Opacity = .72;
            card.Children.Add(K.Bar(pct / 100.0, height: 4));
            var model = models.TryGetValue(a.Id, out var md) && md.Model.Length > 0 ? $"{md.Model.Split('/').Last()} · {md.Effort}" : "modelo —";
            card.Children.Add(K.T(model, 11.5, K.Faint, f: K.Mono).Also(t => t.Margin = new Thickness(0, 10, 0, 0)));
            // Mini-funções: quando o agente registrou a última coisa e atalho para mandar comando a ele.
            var seen = s.Reports.TryGetValue(a.Id, out var rep) && !string.IsNullOrEmpty(rep.Ts) ? $"último registro há {K.Ago(rep.Ts)}" : "sem registro ainda";
            card.Children.Add(K.T(seen, 11, K.Faint).Also(t => t.Margin = new Thickness(0, 4, 0, 0)));
            var agentId = a.Id;
            var box = K.Card(card, 16, new Thickness(16)).Also(b => b.Margin = new Thickness(0, 0, 12, 12));
            box.Tip("Clique para mandar um comando a " + K.Nice(a.Id));
            K.Pressable(box, () => { cmdTo = agentId; ShowView(View.Commands); });
            if (enterCards) K.EnterUp(box, 40 * i, 10);
            i++;
            grid.Children.Add(box);
        }
        return new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, AllowAutoHide = true, Content = new Border { Padding = new Thickness(24, 4, 12, 24), Child = grid } };
    }

    Control OfflineView()
    {
        var v = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
        v.Children.Add(K.Face(96, K.Faint, .16).Also(f => f.HorizontalAlignment = HorizontalAlignment.Center));
        v.Children.Add(K.T("Servidor desligado", 20, K.Text, FontWeight.SemiBold, K.Display).Also(t => { t.Margin = new Thickness(0, 18, 0, 6); t.HorizontalAlignment = HorizontalAlignment.Center; }));
        v.Children.Add(K.T("Abra o Launcher para ligar os serviços.", 13.5, K.Muted).Also(t => t.HorizontalAlignment = HorizontalAlignment.Center));
        v.Children.Add(K.Button("Abrir o Launcher", K.IPlay, host.OpenLauncher).Also(b => { b.Margin = new Thickness(0, 18, 0, 0); b.HorizontalAlignment = HorizontalAlignment.Center; }));
        return v;
    }

    Control Overview(HudSnapshot s)
    {
        var agents = s.Agents.Where(a => a.Id != "CHATGPT").ToList();
        var working = agents.Count(a => K.StatusBrush(a.Status) == K.Brand);
        var blocked = agents.Count(a => K.StatusBrush(a.Status) == K.Err);
        var root = new Grid { RowDefinitions = new RowDefinitions("Auto,Auto,*") };
        root.Children.Add(new Cols(5, 12).Add(Metric("Agentes", $"{agents.Count}", K.Text)).Add(Metric("Trabalhando", $"{working}", working > 0 ? K.BrandText : K.Text))
            .Add(Metric("Travados", $"{blocked}", blocked > 0 ? K.Err : K.Text)).Add(Metric("Aprovações", $"{s.Pending}", s.Pending > 0 ? K.Warn : K.Text))
            .Add(Metric("RAM livre", $"{s.RamFreeMb / 1024.0:0.0} GB".Replace('.', ','), s.RamFreeMb < 1500 ? K.Err : K.Text)).Panel);

        var running = s.CallActive && s.CallModo == "goal";
        var goalCol = new StackPanel();
        var gh = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { K.T("GOAL ATIVO", 11, K.Muted, FontWeight.SemiBold) } };
        if (running) gh.Children.Add(K.Pill("EM EXECUÇÃO", K.Ok));
        goalCol.Children.Add(gh);
        goalCol.Children.Add(K.Wrap(string.IsNullOrWhiteSpace(s.Goal) ? "Nenhum Goal ativo no vault." : s.Goal, 16, K.Text, 2, w: FontWeight.SemiBold, f: K.Display).Also(t => t.Margin = new Thickness(0, 8, 0, 12)));
        if (s.TasksTotal > 0)
        {
            goalCol.Children.Add(K.Bar((double)s.TasksDone / s.TasksTotal, height: 6));
            goalCol.Children.Add(K.T($"{s.TasksDone} de {s.TasksTotal} tarefas concluídas", 12.5, K.Muted).Also(t => t.Margin = new Thickness(0, 8, 0, 0)));
        }
        var goalRow = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Children = { goalCol } };
        var goalBtn = running ? K.Button("Encerrar Modo Goal", K.IStop, host.EndCall, primary: false, danger: true, height: 46) : K.Button("Iniciar Modo Goal", K.IPlay, host.StartGoal, height: 46);
        goalBtn.VerticalAlignment = VerticalAlignment.Center; goalBtn.Margin = new Thickness(24, 0, 0, 0);
        Grid.SetColumn(goalBtn, 1); goalRow.Children.Add(goalBtn);
        var goalCard = K.Card(goalRow, 18, new Thickness(22, 18)).Also(c => c.Margin = new Thickness(0, 14));
        Grid.SetRow(goalCard, 1); root.Children.Add(goalCard);

        var cols = new Grid { ColumnDefinitions = new ColumnDefinitions("1.6*,14,*") };
        Grid.SetRow(cols, 2); root.Children.Add(cols);
        var table = new StackPanel();
        table.Children.Add(Row(K.T("AGENTE", 10.5, K.Faint, FontWeight.SemiBold), K.T("TRABALHANDO EM", 10.5, K.Faint, FontWeight.SemiBold), K.T("STATUS", 10.5, K.Faint, FontWeight.SemiBold), header: true));
        var marks = K.Marks(agents.Select(a => a.Id));
        foreach (var a in agents)
        {
            var name = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { K.Avatar(a.Id, 26, marks[a.Id]), K.T(K.Nice(a.Id), 13.5, K.Text, FontWeight.SemiBold) } };
            var task = K.T(string.IsNullOrWhiteSpace(a.Task) ? "—" : a.Task!, 12.5, K.Muted); task.Tip(a.Task);
            var st = K.T(string.IsNullOrEmpty(a.Status) ? "SEM STATUS" : a.Status.ToUpperInvariant(), 11.5, K.StatusBrush(a.Status), FontWeight.Bold, K.Mono);
            table.Children.Add(Row(name, task, st));
        }
        cols.Children.Add(K.Card(new ScrollViewer { Content = table, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden }, 18, new Thickness(18, 10)));

        var side = new StackPanel();
        side.Children.Add(K.Label("Uso hoje"));
        if (s.Usage.Count == 0) side.Children.Add(K.T("Nenhum pedido hoje ainda.", 12.5, K.Muted));
        foreach (var u in s.Usage.Take(5))
        {
            var r = new Grid { Margin = new Thickness(0, 4), ColumnDefinitions = new ColumnDefinitions("80,*,42") };
            r.Children.Add(K.T(K.Nice(u.Agent), 12, K.Text2, FontWeight.SemiBold));
            var bar = K.Bar(u.Share); Grid.SetColumn(bar, 1); r.Children.Add(bar);
            var pct = K.T($"{Math.Round(u.Share * 100)}%", 12, K.BrandText, FontWeight.SemiBold, K.Mono); pct.HorizontalAlignment = HorizontalAlignment.Right; Grid.SetColumn(pct, 2); r.Children.Add(pct);
            side.Children.Add(r);
        }
        side.Children.Add(new Border { Height = 18 });
        side.Children.Add(K.Label("Atividade da sala"));
        foreach (var m in s.Chat.Take(5))
        {
            var r = new DockPanel { Margin = new Thickness(0, 5) };
            var when = K.T(K.Ago(m.Ts), 11, K.Faint, f: K.Mono); when.Margin = new Thickness(8, 0, 0, 0); DockPanel.SetDock(when, Dock.Right); r.Children.Add(when);
            var line = new TextBlock { FontSize = 12.5, Foreground = K.Text2, TextTrimming = TextTrimming.CharacterEllipsis, FontFamily = K.Ui, Inlines = [new Run((m.Agent == "DONO" ? "Você" : K.Nice(m.Agent)) + "  ") { FontWeight = FontWeight.SemiBold, Foreground = K.BrandText }, new Run(m.Text)] };
            r.Children.Add(line);
            side.Children.Add(r);
        }
        side.Children.Add(new Border { Height = 16 });
        side.Children.Add(new Cols(2).Add(K.Button("Falar com os agentes", K.IChat, host.OpenMini, primary: false))
            .Add(s.Paused ? K.Button("Retomar", K.IPlay, () => host.SetPause(false), primary: false) : K.Button("Pausar agentes", K.IPause, () => host.SetPause(true), primary: false)).Panel);
        var sideCard = K.Card(side, 18, new Thickness(18, 16));
        Grid.SetColumn(sideCard, 2); cols.Children.Add(sideCard);
        return root;
    }

    static Border Metric(string label, string value, IBrush tone) =>
        K.Card(new StackPanel { Children = { K.T(label.ToUpperInvariant(), 10.5, K.Muted, FontWeight.SemiBold), K.T(value, 26, tone, FontWeight.SemiBold, K.Display).Also(t => t.Margin = new Thickness(0, 4, 0, 0)) } }, 16, new Thickness(18, 14));

    static Grid Row(Control a, Control b, Control c, bool header = false)
    {
        var g = new Grid { Height = header ? 34 : 50, ColumnDefinitions = new ColumnDefinitions("170,*,140") };
        b.Margin = new Thickness(0, 0, 12, 0);
        c.HorizontalAlignment = HorizontalAlignment.Right;
        a.VerticalAlignment = b.VerticalAlignment = c.VerticalAlignment = VerticalAlignment.Center;
        g.Children.Add(a); Grid.SetColumn(b, 1); g.Children.Add(b); Grid.SetColumn(c, 2); g.Children.Add(c);
        var line = new Border { Height = 1, Background = K.Line, VerticalAlignment = VerticalAlignment.Bottom, Opacity = header ? 1 : .6 };
        Grid.SetColumnSpan(line, 3); g.Children.Add(line);
        return g;
    }
}
