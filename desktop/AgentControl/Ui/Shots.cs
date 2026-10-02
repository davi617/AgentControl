using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media.Imaging;

namespace AgentControl.Ui;

/// <summary>Conferência visual (--print &lt;pasta&gt;): abre cada tela com dados reais, salva PNG e fecha.</summary>
public static class Shots
{
    public static async Task RunAsync(IClassicDesktopStyleApplicationLifetime desk, string dir)
    {
        Directory.CreateDirectory(dir);
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
            for (var t = 0; t < 5; t++)
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
            foreach (var (v, nome) in new[] { (FullWindow.View.Agents, "agentes"), (FullWindow.View.Commands, "comandos"), (FullWindow.View.Usage, "uso"), (FullWindow.View.Health, "saude"), (FullWindow.View.Models, "modelos"), (FullWindow.View.Overview, "visao") })
            {
                host.Full.ShowView(v, animate: false);
                await Task.Delay(2200);
                Save(host.Full, Path.Combine(dir, nome + ".png"));
            }
        }
        catch (Exception ex) { await File.WriteAllTextAsync(Path.Combine(dir, "erro.txt"), ex.ToString()); }
        desk.Shutdown();
    }

    static void Save(Window w, string file)
    {
        if (w.Content is not Control c || c.Bounds.Width <= 0) return;
        var scale = w.RenderScaling;
        using var bmp = new RenderTargetBitmap(new PixelSize((int)(c.Bounds.Width * scale), (int)(c.Bounds.Height * scale)), new Vector(96 * scale, 96 * scale));
        bmp.Render(c);
        bmp.Save(file);
    }
}
