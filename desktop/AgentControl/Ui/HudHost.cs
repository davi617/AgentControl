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

    readonly IClassicDesktopStyleApplicationLifetime desk;
    internal readonly MascotWindow Mascot;
    internal readonly HudWindow Hud;
    internal readonly MiniWindow Mini;
    internal readonly FullWindow Full;
    readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(4) };
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
            case "web": OpenWeb(); break;
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
            else if (msg == "esconder") HideAll();
            else if (msg == "demo") { if (hidden) ShowAll(); Mascot.Celebrate(); DispatcherTimer.RunOnce(() => Mascot.Say("AgentC", "Oi! Assim eu fico quando um agente fala com você: a boca mexe e a onda sai de mim."), TimeSpan.FromSeconds(2.6)); }
        }));
        BuildTray();
        Mascot.Show();
        Hud.ShowStrip(); // fica sempre no meio de cima da tela, recolhido
        timer.Start();
        _ = Poll();
    }

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
            first = false;
            Hud.Refresh();
            if (Mini.IsVisible) Mini.Refresh();
            if (Full.IsVisible) Full.Refresh();
            if (Snap.Online && Snap.CallStatus == "ATIVA" && Snap.CallModo == "goal" && !Pumping) _ = Pump();
            if (!Snap.CallActive) LastCaption = null;
        }
        finally { polling = false; }
    }

    /// <summary>Modo Goal: pede a próxima fala até a chamada parar (o servidor junta pedidos iguais do celular).</summary>
    async Task Pump()
    {
        Pumping = true;
        try
        {
            for (var i = 0; i < 600; i++)
            {
                var t = await Api.CallNext();
                if (t is null) break;
                LastCaption = t;
                Mascot.Say(t.Value.Speaker, t.Value.Text);
                Hud.Refresh();
            }
        }
        finally { Pumping = false; }
    }

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

    public async void SetPause(bool on)
    {
        var err = await Api.Pause(on);
        Mascot.Say("AgentC", err is not null ? $"Não consegui: {err}" : on ? "Agentes pausados depois da rodada atual." : "Agentes de volta ao trabalho.");
        await Poll();
    }
}
