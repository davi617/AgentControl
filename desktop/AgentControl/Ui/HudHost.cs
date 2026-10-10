using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using AgentControl.Core;

namespace AgentControl.Ui;

/// <summary>
/// Liga as peças do HUD: AgentC (mascote), faixa do topo, mini janela, tela completa e o ícone
/// na bandeja (Windows/Linux) ou na barra de menus (macOS). Lê o servidor a cada 4 s, muda o humor
/// do AgentC, mostra no balão quem falou e toca o Modo Goal mesmo com o celular fechado.
/// </summary>
public sealed class HudHost
{
    public HudApi Api { get; } = new();
    public HudSnapshot Snap { get; private set; } = HudSnapshot.Offline;
    public (string Speaker, string Text)? LastCaption { get; private set; }
    public bool Pumping { get; private set; }
    /// <summary>Esperando o modelo responder a próxima fala.</summary>
    public bool Thinking { get; private set; }
    /// <summary>Ler as falas em voz alta (começa pelo ajuste do Launcher; o botão do painel troca só nesta sessão).</summary>
    public bool VoiceOn { get; private set; }
    public LauncherSettings Settings { get; private set; } = HudApi.ReadSettings();
    bool? lastVoiceSetting;
    /// <summary>Modo Time: pessoas do time e quem está online (o dono é o primeiro).</summary>
    public List<HudApi.Person> People { get; private set; } = [];
    /// <summary>A fila anti-429 está escutando? (sem ela os agentes ficam sem modelo; o HUD não diz "tudo no ar").</summary>
    public bool QueueUp { get; private set; } = true;
    int svcTick;
    CancellationTokenSource? voiceCts;

    readonly IClassicDesktopStyleApplicationLifetime desk;
    internal readonly MascotWindow Mascot;
    internal readonly HudWindow Hud;
    internal readonly MiniWindow Mini;
    internal readonly FullWindow Full;
    internal readonly ApprovalWindow Approval;
    readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(2) };
    string lastChatKey = "";
    Dictionary<string, (string Status, string Ts)> prevReports = [];
    bool first = true, polling, hidden;
    int prevDone;
    Dictionary<string, string> prevWhy = [];
    HashSet<string> prevPending = [];
    TrayIcon? tray;

    public HudHost(IClassicDesktopStyleApplicationLifetime desk)
    {
        this.desk = desk;
        Mascot = new MascotWindow();
        Hud = new HudWindow(this);
        Mini = new MiniWindow(this);
        Full = new FullWindow(this);
        Approval = new ApprovalWindow(this);
        Mascot.Clicked += Toggle;
        Mascot.MenuChosen += Menu;
        timer.Tick += async (_, _) => await Poll();
    }

    void Menu(string id)
    {
        switch (id)
        {
            case "hud": OpenHud(0); break;
            case "mini": OpenMini(); break;
            case "web": OpenHud(2); break; // chamada agora fica no painel (antes abria a página antiga no navegador)
            case "codigo": case "predio": OpenCode(); break;
            case "goal": StartGoal(); break;
            case "launcher": OpenLauncher(); break;
            case "pausa": SetPause(!Snap.Paused); break;
            case "silencio": ToggleQuiet(); break;
            case "full": OpenFull(); break;
            case "esconder": HideAll(); break;
            case "sair": Quit(); break;
        }
    }

    public void Start()
    {
        Signal.Listen(msg => Dispatcher.UIThread.Post(() =>
        {
            if (msg == "full") { if (hidden) ShowAll(); OpenFull(); }
            else if (msg == "show") { if (hidden) ShowAll(); } // o Launcher abrindo não deve abrir o painel por cima dele
            else if (msg == "hud") { if (hidden) ShowAll(); OpenHud(0); }
            else if (msg == "mini") { if (hidden) ShowAll(); OpenMini(); }
            else if (msg == "call") { if (hidden) ShowAll(); OpenHud(2); }
            // "predio": Launcher de antes da v4.0 ainda manda esse nome
            else if (msg is "codigo" or "predio") { if (hidden) ShowAll(); OpenCode(); }
            else if (msg == "esconder") HideAll();
            // App minimizado (Launcher ou tela completa): a HUD abre, o AgentC dá um olá e a HUD volta para a faixa.
            else if (msg == "ola") Hello();
            else if (msg == "demo") { if (hidden) ShowAll(); Mascot.Celebrate(); DispatcherTimer.RunOnce(() => Mascot.Say("AgentC", "Oi! Assim eu fico quando um agente fala com você: a boca mexe e a onda sai de mim."), TimeSpan.FromSeconds(2.6)); }
        }));
        BuildTray();
        Mascot.Show();
        Hud.ShowStrip(); // fica sempre no meio de cima da tela, recolhido
        timer.Start();
        _ = Poll();
    }

    internal void SetPreview(HudSnapshot snapshot) => Snap = snapshot;

    public void KickRefresh() { _ = Poll(); }

    /// <summary>Código ao vivo: o que cada agente está mexendo no código agora (tela completa).</summary>
    public void OpenCode() { Full.Open(); Full.ShowView(FullWindow.View.Code, animate: false); }

    public async Task Poll()
    {
        if (polling) return;
        polling = true;
        try
        {
            Snap = await Api.SnapshotAsync();
            if (svcTick++ % 10 == 0) QueueUp = !Snap.Online || await Task.Run(() => Platform.Listeners(Settings.GatePort).Count > 0);
            var mood = !Snap.Online ? Mood.Offline : Snap.Pending > 0 ? Mood.Alert : Snap.Working || Pumping ? Mood.Working : Mood.Idle;
            Mascot.SetMood(mood, Snap.Pending);
            if (Snap.Chat.Count > 0)
            {
                var newest = Snap.Chat[0];
                var key = newest.Ts + newest.Agent + newest.Text.Length;
                if (!first && key != lastChatKey && newest.Agent != "DONO" && !Pumping) Mascot.Say(newest.Agent, newest.Text);
                lastChatKey = key;
            }
            // Agente acabou de registrar DONE no STATUS: AgentC comemora e conta quem foi.
            if (!first)
                foreach (var (id, rep) in Snap.Reports)
                    if (prevReports.TryGetValue(id, out var old) && old.Ts != rep.Ts && rep.Status.StartsWith("DONE", StringComparison.OrdinalIgnoreCase))
                    {
                        var task = Snap.Agents.FirstOrDefault(a => a.Id == id).Task;
                        Mascot.Celebrate(); Mascot.Spin();
                        Mascot.Say(id, string.IsNullOrWhiteSpace(task) ? "Terminei a tarefa." : $"Terminei: {task}");
                        break;
                    }
            if (!first && prevDone < Snap.TasksTotal && Snap.TasksTotal > 0 && Snap.TasksDone == Snap.TasksTotal)
            { Mascot.Celebrate(); Mascot.Jump(); Mascot.Dance(); Mascot.Say("AgentC!", "Goal concluído! Todas as tarefas estão DONE. 🎉"); }
            if (!first)
                foreach (var (id, rep) in Snap.Reports)
                    if (prevReports.TryGetValue(id, out var was) && was.Ts != rep.Ts && System.Text.RegularExpressions.Regex.IsMatch(rep.Status, "^(FAIL|ERRO|BLOCK)", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                    { Mascot.Shake(); Mascot.Say(id, $"Travei: {rep.Status}. Dá uma olhada na tela de Agentes."); break; }
            // Loop que passou a falhar (sem chave, CLI faltando): avisa uma vez, com o motivo.
            if (!first)
                foreach (var (id, why) in Snap.LoopWhy)
                    if (!prevWhy.ContainsKey(id)) { Mascot.Shake(); Mascot.Say(id, $"Não consigo rodar: {why}"); break; }
            prevWhy = Snap.LoopWhy;
            // Pedido de aprovação novo: a caixinha desce da HUD e o AgentC chama atenção.
            if (!first && Snap.PendingCmds.Any(c => !prevPending.Contains(c.Code))) { Mascot.Jump(); Mascot.Say("AgentC!", "Um agente precisa da sua aprovação. Tá na caixinha embaixo da HUD."); }
            prevPending = Snap.PendingCmds.Select(c => c.Code).ToHashSet();
            if (!hidden) Approval.Update(Snap.PendingCmds);
            prevDone = Snap.TasksDone;
            prevReports = Snap.Reports;
            // Primeira leitura do dia: o AgentC dá um resumo curto (quem está ligado e o que espera você).
            if (first && Snap.Online) Greet();
            first = false;
            if (tray is not null) tray.ToolTipText = TraySummary();
            // Modo Time: AgentC avisa quando alguém do time entra.
            var people = await Api.TeamAsync();
            if (!first)
                foreach (var p in people.Skip(1).Where(p => p.Online && People.FirstOrDefault(o => o.Id == p.Id) is { Online: false } or null && People.Count > 0))
                    Mascot.Say("AgentC", $"{p.Name} entrou no time agora ({p.Via ?? "online"}).");
            People = people;
            Chatter();
            Hud.Refresh();
            if (Mini.IsVisible) Mini.Refresh();
            if (Full.IsVisible) Full.Refresh();
            // Chamada no painel: os agentes falam um atrás do outro sozinhos (Goal sempre; os outros modos se o ajuste mandar).
            Settings = HudApi.ReadSettings();
            if (Settings.CallVoice != lastVoiceSetting) { lastVoiceSetting = Settings.CallVoice; VoiceOn = Settings.CallVoice; }
            if (Snap.Online && Snap.CallStatus == "ATIVA" && (Snap.CallModo == "goal" || Settings.CallAutoAdvance) && !Pumping) _ = Pump();
            if (!Snap.CallActive) { LastCaption = null; voiceCts?.Cancel(); }
        }
        finally { polling = false; }
    }

    /// <summary>Pede a próxima fala até a chamada parar ou esperar você (o servidor junta pedidos iguais do celular).</summary>
    async Task Pump()
    {
        Pumping = true;
        try
        {
            for (var i = 0; i < 600; i++)
            {
                if (!await NextTurn()) break;
                if (Snap.CallModo != "goal" && !Settings.CallAutoAdvance) break;
            }
        }
        finally { Pumping = false; }
    }

    /// <summary>Uma fala: mostra no balão e no painel e, com a voz ligada, lê em voz alta antes da próxima.</summary>
    async Task<bool> NextTurn()
    {
        Thinking = true; Hud.Refresh();
        var t = await Api.CallNext();
        Thinking = false;
        if (t is null) { Hud.Refresh(); return false; }
        LastCaption = t;
        Mascot.Say(t.Value.Speaker, t.Value.Text);
        Snap = await Api.SnapshotAsync();
        Hud.Refresh();
        if (VoiceOn)
        {
            voiceCts = new CancellationTokenSource();
            await Platform.SpeakAsync(t.Value.Text, voiceCts.Token);
        }
        return true;
    }

    /// <summary>Botão "Próxima fala" (avançar sozinho desligado).</summary>
    public async void CallNextManual() { if (!Pumping) { Pumping = true; try { await NextTurn(); } finally { Pumping = false; } } }

    public void ToggleVoice() { VoiceOn = !VoiceOn; if (!VoiceOn) voiceCts?.Cancel(); Hud.Refresh(); }

    /// <summary>Começa uma chamada pelo painel e já põe o primeiro agente para falar.</summary>
    public async Task<string?> StartCall(string topic, IEnumerable<string> who, string modo)
    {
        var err = await Api.StartCall(topic, who, modo);
        if (err is not null) return err;
        Mascot.Say("AgentC", modo == "goal" ? "Modo Goal ligado. O time está tocando o Goal." : "Chamada começou. O time vai falar aqui no painel.");
        await Poll();
        return null;
    }

    /// <summary>Você fala na chamada (texto); os agentes respondem em seguida.</summary>
    public async Task<string?> CallSay(string text)
    {
        var err = await Api.CallSay(text);
        await Poll();
        return err;
    }

    public async Task<string?> CallRound() { var e = await Api.CallRound(); await Poll(); return e; }
    public async Task<string?> CallTurn(string agent) { var e = await Api.CallTurn(agent); await Poll(); return e; }
    public async Task<string?> CallKick(string agent) { var e = await Api.CallKick(agent); await Poll(); return e; }

    // ---------- abrir / fechar ----------
    void Toggle()
    {
        if (Mini.IsVisible) { CloseAll(); return; }
        OpenHud(0);
        OpenMini();
    }

    public void OpenHud(int tab) => Hud.Expand(tab);
    public void OpenFull() => Full.Open();
    public void OpenMini() => Mini.Open(Mascot);
    public void CloseAll() { Hud.Collapse(); Mini.CloseAnimated(); }

    /// <summary>Some com o AgentC e a HUD; voltam pelo ícone na bandeja / barra de menus.</summary>
    public void HideAll()
    {
        hidden = true;
        Approval.Hide();
        Mini.CloseAnimated(); Hud.Collapse();
        Mascot.Hide(); Hud.Hide();
    }

    public void ShowAll()
    {
        if (!hidden) { OpenHud(0); return; }
        hidden = false;
        Mascot.Show(); Hud.ShowStrip();
    }

    /// <summary>
    /// O app foi minimizado: a HUD aparece aberta, o AgentC acena "olá" e, se você não mexer nela,
    /// ela recolhe sozinha para a faixa do topo (a tela de sempre da HUD).
    /// </summary>
    public void Hello()
    {
        if (hidden) ShowAll();
        Hud.Expand(0);
        var hi = DateTime.Now.Hour switch { < 5 => "Boa madrugada", < 12 => "Bom dia", < 18 => "Boa tarde", _ => "Boa noite" };
        var on = Snap.Agents.Count(a => a.Status is "WORKING" or "IDLE");
        Mascot.Hello(!Snap.Online ? $"Olá! Fiquei aqui na HUD. O servidor está desligado." : Snap.Pending > 0 ? $"Olá! Fiquei aqui na HUD. Tem {Snap.Pending} aprovação esperando você." : $"{hi}! Fiquei aqui na HUD, de olho no time ({on} de {Snap.Agents.Count} prontos).");
        DispatcherTimer.RunOnce(() => { if (!Hud.IsPointerOver) Hud.Collapse(); }, TimeSpan.FromSeconds(5));
    }

    void Quit()
    {
        if (tray is not null) tray.IsVisible = false;
        desk.Shutdown();
    }

    // Puxar assunto (como um companheiro): de vez em quando, com tudo calmo, o AgentC comenta o estado do time.
    DateTime nextChatter = DateTime.Now.AddMinutes(new Random().Next(20, 40));
    void Chatter()
    {
        if (DateTime.Now < nextChatter || !Snap.Online || Pumping || Snap.CallActive) return;
        if (DateTime.Now.Hour is >= 23 or < 7) return; // de madrugada não puxa assunto
        nextChatter = DateTime.Now.AddMinutes(new Random().Next(25, 55));
        var working = Snap.Agents.Count(a => a.Status == "WORKING");
        var lines = new List<string>();
        if (Snap.Paused) lines.Add("O time segue pausado. Quando quiser, toque em Retomar.");
        if (Snap.Pending > 0) lines.Add($"Ainda tem {Snap.Pending} aprovação esperando você.");
        if (working > 0) lines.Add(working == 1 ? "Um agente está trabalhando agora. Eu aviso quando terminar." : $"{working} agentes trabalhando agora. Eu aviso quando terminarem.");
        if (Snap.TasksTotal > 0) lines.Add($"O Goal está em {100 * Snap.TasksDone / Snap.TasksTotal}%: {Snap.TasksDone} de {Snap.TasksTotal} tarefas.");
        if (Snap.RamFreeMb is > 0 and < 1500) lines.Add("O PC está com pouca memória. Fechar umas abas ajuda os agentes.");
        if (AgentControl.Core.Memory.Reminder() is { } m) lines.Add($"Não esqueci: {m}.");
        lines.Add("Dica: diga \"lembra que…\" na janelinha e eu guardo para você.");
        Mascot.Say("AgentC", lines[new Random().Next(lines.Count)]);
    }

    void ToggleQuiet()
    {
        if (DateTime.Now < Mascot.QuietUntil) { Mascot.QuietUntil = DateTime.MinValue; Mascot.Say("AgentC", "Voltei a falar."); return; }
        Mascot.Say("AgentC", "Tá bom, fico quieto por 1 hora. Aprovação esperando ainda aparece na faixa do topo.");
        Mascot.QuietUntil = DateTime.Now.AddHours(1);
    }

    void Greet()
    {
        var hour = DateTime.Now.Hour;
        var hi = hour < 5 ? "Boa madrugada" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
        var on = Snap.Agents.Count(a => a.Status is not ("OFF" or "OFFLINE" or ""));
        var parts = new List<string> { $"{on} de {Snap.Agents.Count} agentes ligados" };
        if (Snap.Pending > 0) parts.Add(Snap.Pending == 1 ? "1 aprovação esperando você" : $"{Snap.Pending} aprovações esperando você");
        if (Snap.Paused) parts.Add("o time está pausado");
        var memo = AgentControl.Core.Memory.Reminder();
        DispatcherTimer.RunOnce(() => Mascot.Say("AgentC", $"{hi}! {string.Join(", ", parts)}." + (memo is null ? "" : $" Lembrete: {memo}.")), TimeSpan.FromSeconds(1.5));
    }

    /// <summary>Texto do ícone na bandeja: o estado sem precisar abrir nada.</summary>
    string TraySummary()
    {
        if (!Snap.Online) return "AgentC · servidor desligado";
        var working = Snap.Agents.Count(a => a.Status == "WORKING");
        var txt = $"AgentC · {working} trabalhando de {Snap.Agents.Count}";
        if (Snap.Pending > 0) txt += $" · {Snap.Pending} aprovação(ões)";
        if (Snap.Panic) txt += " · PÂNICO";
        else if (Snap.Paused) txt += " · pausado";
        if (Snap.CallActive) txt += " · em chamada";
        return txt;
    }

    void BuildTray()
    {
        try
        {
            var menu = new NativeMenu();
            void Item(string text, Action go) { var i = new NativeMenuItem(text); i.Click += (_, _) => go(); menu.Add(i); }
            Item("Mostrar AgentC e a HUD", ShowAll);
            Item("Esconder", HideAll);
            Item("Tela completa", OpenFull);
            Item("Código ao vivo", OpenCode);
            Item("Central de Missões", OpenMissions);
            Item("Abrir o Launcher", OpenLauncher);
            Item("Pausar / retomar os agentes", () => SetPause(!Snap.Paused));
            Item("Silenciar o AgentC por 1 h", ToggleQuiet);
            menu.Add(new NativeMenuItemSeparator());
            Item("Fechar o AgentC", Quit);
            tray = new TrayIcon { Icon = Program.AppIcon(), ToolTipText = "AgentC · Agent Control", Menu = menu, IsVisible = true };
            tray.Clicked += (_, _) => { if (hidden) ShowAll(); else HideAll(); };
            TrayIcon.SetIcons(Application.Current!, [tray]);
        }
        catch { /* Linux sem bandeja (alguns GNOME): segue sem ícone, o botão direito no AgentC esconde/mostra */ }
    }

    // ---------- ações ----------
    public void OpenWeb() => Platform.OpenAppWindow(HudApi.Base + "/");
    public void OpenMissions() => Platform.OpenAppWindow(HudApi.Base + "/?project=" + Uri.EscapeDataString(Api.Project) + "#missoes");

    public void OpenLauncher()
    {
        try { if (Environment.ProcessPath is { } exe) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(exe) { UseShellExecute = false }); } catch { }
    }

    public async void StartGoal()
    {
        var err = await Api.StartGoal(Snap.Goal);
        if (err is not null) { Mascot.Say("AgentC", $"Não consegui iniciar o Modo Goal: {err}"); return; }
        Mascot.Say("AgentC", "Modo Goal ligado. O time está tocando o Goal.");
        await Poll();
        Hud.Select(2);
    }

    public async void EndCall()
    {
        var err = await Api.EndCall();
        Mascot.Say("AgentC", err is null ? "Chamada encerrada. A ata ficou no vault." : $"Não encerrei: {err}");
        await Poll();
    }

    public void StartAgents()
    {
        var svc = new Services();
        try { svc.Load(); } catch (Exception ex) { Mascot.Say("AgentC", $"Não li os ajustes: {ex.Message}"); return; }
        Mascot.Say("AgentC", svc.StartAgents() ? "Ligando os agentes. Em alguns segundos eles aparecem trabalhando." : "Não consegui ligar os agentes. Veja os logs no Launcher.");
        DispatcherTimer.RunOnce(() => _ = Poll(), TimeSpan.FromSeconds(6));
    }

    public async void SetPanic(bool on)
    {
        var msg = await Api.Panic(on);
        Mascot.Say("AgentC", msg);
        await Poll();
    }

    public async void SetPause(bool on)
    {
        var err = await Api.Pause(on);
        Mascot.Say("AgentC", err is not null ? $"Não consegui: {err}" : on ? "Agentes pausados depois da rodada atual." : "Agentes de volta ao trabalho.");
        await Poll();
    }
}
