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
    CancellationTokenSource? voiceCts;

    readonly IClassicDesktopStyleApplicationLifetime desk;
    internal readonly MascotWindow Mascot;
    internal readonly HudWindow Hud;
    internal readonly MiniWindow Mini;
    internal readonly FullWindow Full;
    readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(2) };
    string lastChatKey = "";
    Dictionary<string, (string Status, string Ts)> prevReports = [];
    bool first = true, polling, hidden;
    TrayIcon? tray;

    public HudHost(IClassicDesktopStyleApplicationLifetime desk)
    {
        this.desk = desk;
        Mascot = new MascotWindow();
        Hud = new HudWindow(this);
        Mini = new MiniWindow(this);
        Full = new FullWindow(this);
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
            case "goal": StartGoal(); break;
            case "launcher": OpenLauncher(); break;
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
            else if (msg == "esconder") HideAll();
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

    public async Task Poll()
    {
        if (polling) return;
        polling = true;
        try
        {
            Snap = await Api.SnapshotAsync();
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
                        Mascot.Celebrate();
                        Mascot.Say(id, string.IsNullOrWhiteSpace(task) ? "Terminei a tarefa." : $"Terminei: {task}");
                        break;
                    }
            prevReports = Snap.Reports;
            // Primeira leitura do dia: o AgentC dá um resumo curto (quem está ligado e o que espera você).
            if (first && Snap.Online) Greet();
            first = false;
            if (tray is not null) tray.ToolTipText = TraySummary();
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
        Mini.CloseAnimated(); Hud.Collapse();
        Mascot.Hide(); Hud.Hide();
    }

    public void ShowAll()
    {
        if (!hidden) { OpenHud(0); return; }
        hidden = false;
        Mascot.Show(); Hud.ShowStrip();
    }

    void Quit()
    {
        if (tray is not null) tray.IsVisible = false;
        desk.Shutdown();
    }

    void Greet()
    {
        var hour = DateTime.Now.Hour;
        var hi = hour < 5 ? "Boa madrugada" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
        var on = Snap.Agents.Count(a => a.Status is not ("OFF" or "OFFLINE" or ""));
        var parts = new List<string> { $"{on} de {Snap.Agents.Count} agentes ligados" };
        if (Snap.Pending > 0) parts.Add(Snap.Pending == 1 ? "1 aprovação esperando você" : $"{Snap.Pending} aprovações esperando você");
        if (Snap.Paused) parts.Add("o time está pausado");
        DispatcherTimer.RunOnce(() => Mascot.Say("AgentC", $"{hi}! {string.Join(", ", parts)}."), TimeSpan.FromSeconds(1.5));
    }

    /// <summary>Texto do ícone na bandeja: o estado sem precisar abrir nada.</summary>
    string TraySummary()
    {
        if (!Snap.Online) return "AgentC · servidor desligado";
        var working = Snap.Agents.Count(a => a.Status == "WORKING");
        var txt = $"AgentC · {working} trabalhando de {Snap.Agents.Count}";
        if (Snap.Pending > 0) txt += $" · {Snap.Pending} aprovação(ões)";
        if (Snap.Paused) txt += " · pausado";
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
            Item("Abrir o Launcher", OpenLauncher);
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

    public async void SetPause(bool on)
    {
        var err = await Api.Pause(on);
        Mascot.Say("AgentC", err is not null ? $"Não consegui: {err}" : on ? "Agentes pausados depois da rodada atual." : "Agentes de volta ao trabalho.");
        await Poll();
    }
}
