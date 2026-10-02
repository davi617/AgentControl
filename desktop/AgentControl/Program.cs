using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml.Styling;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;
using AgentControl.Core;
using AgentControl.Ui;

namespace AgentControl;

/// <summary>
/// Agent Control para PC (Windows, Linux e macOS).
///   (sem nada)        Launcher: liga os serviços e os agentes. Abre o HUD junto.
///   --hud             AgentC + HUD do topo + tela completa + ícone na bandeja (uma instância só).
///   --autostart       Logon: liga 9Router, fila e servidor sem janela, abre o HUD e sai.
///   --print &lt;pasta&gt;  Conferência visual: salva PNG de cada tela com dados reais e sai.
///   --send &lt;aviso&gt;   Manda um aviso para o HUD aberto: full, hud, mini, show ou esconder.
/// </summary>
public static class Program
{
    public enum Mode { Launcher, Hud, Print }
    public static Mode Current { get; private set; }
    public static string? PrintDir { get; private set; }

    [STAThread]
    public static int Main(string[] args)
    {
        bool Has(string a) => args.Contains(a, StringComparer.OrdinalIgnoreCase);
        if (Has("--autostart"))
        {
            var s = new Services();
            try { s.Load(); s.AutostartAsync().GetAwaiter().GetResult(); }
            catch (Exception ex) { s.Log($"AUTOSTART falhou: {ex.Message}"); }
            StartHud();
            return 0;
        }
        // Escolhe o time sem abrir janela (ex.: servidor sem tela): --time claude,hermes
        var ti = Array.FindIndex(args, a => a.Equals("--time", StringComparison.OrdinalIgnoreCase));
        if (ti >= 0 && ti + 1 < args.Length)
        {
            var s = new Services(); s.Load();
            s.Logged += Console.WriteLine;
            var err = s.SaveTeamAsync(args[ti + 1].Split(',', ';', ' ').ToList()).GetAwaiter().GetResult();
            Console.WriteLine(err ?? "ok");
            return err is null ? 0 : 1;
        }
        // Avisa o HUD aberto (full | hud | mini | show). Ex.: atalho de teclado do sistema chamando "AgentControl --send full".
        var si = Array.FindIndex(args, a => a.Equals("--send", StringComparison.OrdinalIgnoreCase));
        if (si >= 0 && si + 1 < args.Length) return Signal.Send(args[si + 1]) ? 0 : 1;
        var pi = Array.FindIndex(args, a => a.Equals("--print", StringComparison.OrdinalIgnoreCase));
        if (pi >= 0 && pi + 1 < args.Length) { Current = Mode.Print; PrintDir = Path.GetFullPath(args[pi + 1]); }
        else if (Has("--hud"))
        {
            Current = Mode.Hud;
            using var hudMutex = new Mutex(true, "AgentControl.Hud." + Environment.UserName, out var firstHud);
            if (!firstHud) { Signal.Send("show"); return 0; }
            return Build().StartWithClassicDesktopLifetime(args, ShutdownMode.OnExplicitShutdown);
        }
        else
        {
            Current = Mode.Launcher;
            using var mutex = new Mutex(true, "AgentControl.Launcher." + Environment.UserName, out var first);
            if (!first) return 0; // o segundo clique no atalho não abre outra janela
            StartHud();
            return Build().StartWithClassicDesktopLifetime(args, ShutdownMode.OnMainWindowClose);
        }
        return Build().StartWithClassicDesktopLifetime(args, ShutdownMode.OnExplicitShutdown);
    }

    /// <summary>
    /// avares://&lt;nome do exe&gt;/Assets/. Fica aqui e não no K: tocar no K (pincéis) antes do Avalonia subir
    /// cria o Dispatcher sem plataforma e o app cai com PlatformNotSupportedException.
    /// </summary>
    public static readonly string Res = $"avares://{typeof(Program).Assembly.GetName().Name}/Assets/";

    public static AppBuilder Build() => AppBuilder.Configure<App>().UsePlatformDetect().With(new FontManagerOptions { DefaultFamilyName = Res + "Fonts#Instrument Sans" }).LogToTrace();

    /// <summary>Liga o HUD em outro processo (se já estiver aberto, o novo só pede para ele aparecer e sai).</summary>
    public static void StartHud()
    {
        try { if (Environment.ProcessPath is { } exe) Process.Start(new ProcessStartInfo(exe) { ArgumentList = { "--hud" }, UseShellExecute = false }); } catch { }
    }

    public static WindowIcon? AppIcon()
    {
        try { return new WindowIcon(AssetLoader.Open(new Uri(Res + "agentc.ico"))); } catch { return null; }
    }
}

public sealed class App : Application
{
    public override void Initialize()
    {
        RequestedThemeVariant = ThemeVariant.Dark;
        Styles.Add(new FluentTheme());
        // Campos de texto sem a moldura do Fluent: o desenho de cada tela já faz a borda.
        foreach (var k in new[] { "TextControlBackground", "TextControlBackgroundPointerOver", "TextControlBackgroundFocused", "TextControlBorderBrush", "TextControlBorderBrushPointerOver", "TextControlBorderBrushFocused" })
            Resources[k] = Brushes.Transparent;
        Resources["TextControlForeground"] = K.Text; Resources["TextControlForegroundPointerOver"] = K.Text; Resources["TextControlForegroundFocused"] = K.Text;
        Resources["TextControlPlaceholderForeground"] = K.Faint; Resources["TextControlPlaceholderForegroundPointerOver"] = K.Faint; Resources["TextControlPlaceholderForegroundFocused"] = K.Faint;
        Resources["TextControlSelectionHighlightColor"] = K.Brand;
        Resources["ToolTipBackground"] = K.Raised; Resources["ToolTipForeground"] = K.Text2; Resources["ToolTipBorderBrush"] = K.Line;
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desk)
        {
            switch (Program.Current)
            {
                case Program.Mode.Launcher:
                    desk.MainWindow = new LauncherWindow();
                    break;
                case Program.Mode.Hud:
                    new HudHost(desk).Start();
                    break;
                case Program.Mode.Print:
                    _ = Shots.RunAsync(desk, Program.PrintDir!);
                    break;
            }
        }
        base.OnFrameworkInitializationCompleted();
    }
}
