using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media.Imaging;
using AgentControl.Core;

namespace AgentControl.Ui;

/// <summary>Conferência visual (--print &lt;pasta&gt;): abre cada tela com dados reais, salva PNG e fecha.</summary>
public static class Shots
{
    public static async Task RunAsync(IClassicDesktopStyleApplicationLifetime desk, string dir)
    {
        Directory.CreateDirectory(dir);
        if (Program.DemoPrint) { await Demo(desk, dir); return; }
        try
        {
            var l = new LauncherWindow();
            l.Show();
            for (var i = 0; i < 60 && !l.Ready; i++) await Task.Delay(500);
            await Task.Delay(2500);
            Save(l, Path.Combine(dir, "launcher.png"));
            foreach (var (i, nome) in new[] { (1, "launcher-agentes"), (2, "launcher-comandos"), (3, "launcher-uso"), (4, "launcher-logs"), (5, "launcher-ajustes") })
            { l.SelectForPrint(i); await Task.Delay(2500); Save(l, Path.Combine(dir, nome + ".png")); }
            l.Close();

            var host = new HudHost(desk);
            await host.Poll();
            host.Mascot.Show();
            await Task.Delay(1500);
            Save(host.Mascot, Path.Combine(dir, "mascote.png"));
            host.Hud.ShowStrip();
            await Task.Delay(1500);
            Save(host.Hud, Path.Combine(dir, "faixa.png"));
            for (var t = 0; t < 6; t++)
            {
                if (t == 0) host.Hud.Expand(0); else host.Hud.Select(t);
                await Task.Delay(1500);
                Save(host.Hud, Path.Combine(dir, $"hud-{t}.png"));
            }
            host.Hud.Collapse();
            host.OpenMini();
            await Task.Delay(1500);
            Save(host.Mini, Path.Combine(dir, "mini.png"));
            host.Mini.CloseAnimated();
            host.OpenFull();
            await Task.Delay(2500);
            Save(host.Full, Path.Combine(dir, "completa.png"));
            foreach (var (v, nome) in new[] { (FullWindow.View.Agents, "agentes"), (FullWindow.View.Commands, "comandos"), (FullWindow.View.Usage, "uso"), (FullWindow.View.Health, "saude"), (FullWindow.View.Models, "modelos"), (FullWindow.View.Overview, "visao"), (FullWindow.View.Predio, "predio") })
            {
                host.Full.ShowView(v, animate: false);
                await Task.Delay(v == FullWindow.View.Predio ? 24000 : 2200); // no prédio, os bonequinhos sobem a escada antes
                Save(host.Full, Path.Combine(dir, nome + ".png"));
            }
        }
        catch (Exception ex) { await File.WriteAllTextAsync(Path.Combine(dir, "erro.txt"), ex.ToString()); }
        desk.Shutdown();
    }

    static async Task Demo(IClassicDesktopStyleApplicationLifetime desk, string dir)
    {
        try
        {
            var now = DateTimeOffset.UtcNow;
            var host = new HudHost(desk);
            var ids = new[] { "CODEX", "HERMES", "OPENCODE", "OPENCLAW", "QWEN", "CLAUDE", "DROID" };
            var agents = ids.Select(id => (id, id == "CODEX" ? "WORKING" : "IDLE", (string?)"Demonstração do Agent Control")).ToList();
            var limits = ids.ToDictionary(id => id, id => id == "CODEX"
                ? new AgentQuota(id, "OpenAI / ChatGPT", "live", 44, [new("5 horas", 44, 300, now.AddHours(2).ToUnixTimeSeconds()), new("7 dias", 76, 10080, now.AddDays(2).ToUnixTimeSeconds())], now.ToString("O"), "Dados de demonstração.")
                : new AgentQuota(id, "NVIDIA / fila compartilhada", "unavailable", null, [], now.ToString("O"), "Saldo não disponibilizado pelo provedor."));
            host.SetPreview(new HudSnapshot(true, "DEMO-GOAL", 3, 8, agents, [("CLAUDE", 12, .6), ("QWEN", 8, .4)], [("JARVIS", "Demonstração: o time está conectado.", now.ToString("O"))], 0, 4096, 27, false, [], null, null, null, 0) { Limits = limits });
            host.Hud.ShowStrip();
            await Task.Delay(2000);
            Save(host.Hud, Path.Combine(dir, "hud-bar.png"));
            host.Hud.Expand(0);
            await Task.Delay(2200);
            Save(host.Hud, Path.Combine(dir, "hud-panel.png"));
            host.Hud.Select(4);
            await Task.Delay(2000);
            Save(host.Hud, Path.Combine(dir, "hud-health.png"));
        }
        catch (Exception ex) { await File.WriteAllTextAsync(Path.Combine(dir, "erro.txt"), ex.ToString()); }
        desk.Shutdown();
    }

    static void Save(Window w, string file)
    {
        if (w.Content is not Control c || c.Bounds.Width <= 0) return;
        var scale = 1.0; // Exportação em pixels lógicos, independente do DPI do monitor.
        using var bmp = new RenderTargetBitmap(new PixelSize((int)(c.Bounds.Width * scale), (int)(c.Bounds.Height * scale)), new Vector(96 * scale, 96 * scale));
        bmp.Render(c);
        bmp.Save(file);
    }
}
