using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace AgentControl.Core;

/// <summary>
/// Tudo que muda entre Windows, Linux e macOS fica aqui: portas escutando, matar processo,
/// RAM livre, abrir link/app, achar executável e onde guardar os dados do app.
/// </summary>
public static class Platform
{
    public static readonly bool Win = OperatingSystem.IsWindows();
    public static readonly bool Mac = OperatingSystem.IsMacOS();
    public static readonly bool Linux = OperatingSystem.IsLinux();
    public static string Name => Win ? "Windows" : Mac ? "macOS" : "Linux";

    /// <summary>%APPDATA%\AgentControl · ~/Library/Application Support/AgentControl · ~/.config/agent-control</summary>
    public static string DataDir
    {
        get
        {
            var d = Win ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AgentControl")
                : Mac ? Path.Combine(Home, "Library", "Application Support", "AgentControl")
                : Path.Combine(Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") is { Length: > 0 } x ? x : Path.Combine(Home, ".config"), "agent-control");
            Directory.CreateDirectory(d);
            return d;
        }
    }

    public static string Home => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    /// <summary>Pasta dos agentes (loops, lançadores, modelos): ~/.config/dw-agents nos três sistemas.</summary>
    public static string AgentsDir => Path.Combine(Home, ".config", "dw-agents");

    /// <summary>Expande %VAR% (Windows), $VAR e ~ (Linux/macOS).</summary>
    public static string Expand(string p)
    {
        if (string.IsNullOrEmpty(p)) return p;
        p = Environment.ExpandEnvironmentVariables(p);
        if (p.StartsWith('~')) p = Home + p[1..];
        return Regex.Replace(p, @"\$(\w+)|\$\{(\w+)\}", m => Environment.GetEnvironmentVariable(m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value) ?? m.Value);
    }

    // ---------------- executáveis ----------------

    /// <summary>
    /// Acha um programa (node, npm, pwsh…). No macOS um app aberto pelo Finder não herda o PATH do terminal,
    /// então também olha os lugares comuns do Homebrew, nvm, volta e fnm.
    /// </summary>
    public static string? Which(string name)
    {
        if (Path.IsPathRooted(name)) return File.Exists(name) ? name : null;
        var exts = Win ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE;.CMD;.BAT").Split(';').Prepend("") : [""];
        var dirs = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator).ToList();
        if (!Win)
        {
            dirs.AddRange(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", Path.Combine(Home, ".volta", "bin"), Path.Combine(Home, ".local", "bin"), Path.Combine(Home, ".npm-global", "bin"), Path.Combine(Home, "bin")]);
            foreach (var root in new[] { Path.Combine(Home, ".nvm", "versions", "node"), Path.Combine(Home, ".local", "share", "fnm", "node-versions") })
                try { dirs.AddRange(Directory.GetDirectories(root).OrderByDescending(x => x).Select(v => Directory.Exists(Path.Combine(v, "bin")) ? Path.Combine(v, "bin") : Path.Combine(v, "installation", "bin"))); } catch { }
        }
        foreach (var d in dirs.Where(d => d.Length > 0).Distinct())
            foreach (var e in exts)
            {
                var f = Path.Combine(d, name + e);
                if (File.Exists(f)) return f;
            }
        return null;
    }

    /// <summary>Roda um comando curto e devolve a saída (ou "" se falhar).</summary>
    public static string Run(string file, params string[] args)
    {
        try
        {
            var psi = new ProcessStartInfo(Which(file) ?? file) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi)!;
            var o = p.StandardOutput.ReadToEndAsync();
            if (!p.WaitForExit(5000)) { try { p.Kill(true); } catch { } }
            return o.Wait(1000) ? o.Result : "";
        }
        catch { return ""; }
    }

    // ---------------- portas ----------------

    /// <summary>Endereços e PIDs escutando numa porta TCP (netstat no Windows, ss/proc no Linux, lsof no macOS).</summary>
    public static List<(string Address, int Pid)> Listeners(int port)
    {
        var r = new List<(string, int)>();
        try
        {
            if (Win)
            {
                foreach (var line in Run("netstat", "-ano", "-p", "TCP").Split('\n').Concat(Run("netstat", "-ano", "-p", "TCPv6").Split('\n')))
                {
                    var m = Regex.Match(line, @"^\s*TCP\s+(\S+):(\d+)\s+\S+\s+(LISTENING|ESCUTANDO|ABH\S*|ECOUTE)\s+(\d+)", RegexOptions.IgnoreCase);
                    if (m.Success && int.Parse(m.Groups[2].Value) == port) r.Add((m.Groups[1].Value, int.Parse(m.Groups[4].Value)));
                }
            }
            else if (Mac)
            {
                // node    1234 dono   20u  IPv4 0x...  0t0  TCP 127.0.0.1:20128 (LISTEN)
                foreach (var line in Run("lsof", "-nP", $"-iTCP:{port}", "-sTCP:LISTEN").Split('\n').Skip(1))
                {
                    var m = Regex.Match(line, @"^\S+\s+(\d+)\s.*TCP\s+(\S+):(\d+)\s+\(LISTEN\)");
                    if (m.Success && int.Parse(m.Groups[3].Value) == port) r.Add((m.Groups[2].Value == "*" ? "0.0.0.0" : m.Groups[2].Value, int.Parse(m.Groups[1].Value)));
                }
            }
            else
            {
                // LISTEN 0 511 127.0.0.1:20128 0.0.0.0:* users:(("node",pid=1234,fd=21))
                var ss = Run("ss", "-ltnpH");
                if (ss.Length > 0)
                    foreach (var line in ss.Split('\n'))
                    {
                        var m = Regex.Match(line, @"^\S+\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+(?:.*pid=(\d+))?");
                        if (m.Success && int.Parse(m.Groups[2].Value) == port) r.Add((m.Groups[1].Value == "*" ? "0.0.0.0" : m.Groups[1].Value, m.Groups[3].Success ? int.Parse(m.Groups[3].Value) : 0));
                    }
                else r.AddRange(ProcNetTcp(port));
            }
        }
        catch { }
        return r;
    }

    /// <summary>Linux sem o "ss": lê /proc/net/tcp(6) direto (sem PID).</summary>
    static IEnumerable<(string, int)> ProcNetTcp(int port)
    {
        foreach (var f in new[] { "/proc/net/tcp", "/proc/net/tcp6" })
        {
            if (!File.Exists(f)) continue;
            foreach (var line in File.ReadLines(f).Skip(1))
            {
                var c = line.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (c.Length < 4 || c[3] != "0A") continue; // 0A = LISTEN
                var lp = c[1].Split(':');
                if (Convert.ToInt32(lp[1], 16) != port) continue;
                var ip = lp[0];
                var addr = ip.Length == 8 ? string.Join('.', Enumerable.Range(0, 4).Select(i => Convert.ToInt32(ip.Substring(6 - i * 2, 2), 16)))
                    : ip.TrimStart('0').Length == 0 ? "[::]" : ip == "00000000000000000000000001000000" ? "[::1]" : "[" + ip + "]";
                yield return (addr, 0);
            }
        }
    }

    /// <summary>Exposto = escutando em todas as interfaces (0.0.0.0, [::], *), não só no loopback.</summary>
    public static bool IsExposed(string address) => address is "0.0.0.0" or "[::]" or "*" or "::" or "[::0]";

    public static void Kill(int pid)
    {
        if (Win) { Run("taskkill", "/PID", pid.ToString(), "/T", "/F"); return; }
        try { Process.GetProcessById(pid).Kill(entireProcessTree: true); } catch { }
    }

    // ---------------- iniciar em segundo plano ----------------

    /// <summary>
    /// Roda um comando longo em segundo plano com a saída no log. Fechar o app NÃO derruba o serviço
    /// (Windows: cmd sem janela; Linux/macOS: nohup, e o processo fica com o init).
    /// </summary>
    public static void StartDetached(string workDir, string exe, IReadOnlyList<string> args, string log)
    {
        if (Win)
        {
            var cmd = string.Join(' ', new[] { exe }.Concat(args).Select(Quote));
            var psi = new ProcessStartInfo("cmd.exe", $"/d /s /c \"{cmd} >> \"{log}\" 2>&1\"") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = workDir, WindowStyle = ProcessWindowStyle.Hidden,
                // Não herda o console/a saída de quem ligou (senão um terminal que rodou "--time" fica preso até o servidor parar).
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            Process.Start(psi);
            return;
        }
        var line = $"cd {ShQ(workDir)} && nohup {string.Join(' ', new[] { exe }.Concat(args).Select(ShQ))} >> {ShQ(log)} 2>&1 < /dev/null &";
        var sh = new ProcessStartInfo("/bin/sh") { UseShellExecute = false, CreateNoWindow = true };
        sh.ArgumentList.Add("-c"); sh.ArgumentList.Add(line);
        Process.Start(sh)?.WaitForExit(3000);
    }

    static string Quote(string s) => s.Contains(' ') || s.Contains('"') ? $"\"{s.Replace("\"", "\\\"")}\"" : s;
    static string ShQ(string s) => "'" + s.Replace("'", "'\\''") + "'";

    // ---------------- abrir coisas ----------------

    /// <summary>Abre link, arquivo ou pasta no programa padrão do sistema.</summary>
    public static bool Open(string target)
    {
        try
        {
            if (Win) Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            else Process.Start(new ProcessStartInfo(Mac ? "open" : "xdg-open") { ArgumentList = { target }, UseShellExecute = false });
            return true;
        }
        catch { return false; }
    }

    /// <summary>Abre uma página local "como app" (janela própria, sem barra de endereço) se achar Edge/Chrome/Chromium.</summary>
    public static void OpenAppWindow(string url)
    {
        try
        {
            if (Win)
            {
                var edge = new[] { Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.ProgramFiles }
                    .Select(f => Path.Combine(Environment.GetFolderPath(f), @"Microsoft\Edge\Application\msedge.exe")).FirstOrDefault(File.Exists);
                if (edge is not null) { Process.Start(new ProcessStartInfo(edge, $"--app={url}") { UseShellExecute = false }); return; }
            }
            else if (Mac)
            {
                foreach (var app in new[] { "Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium" })
                    if (Directory.Exists($"/Applications/{app}.app")) { Process.Start(new ProcessStartInfo("open") { ArgumentList = { "-na", app, "--args", $"--app={url}" }, UseShellExecute = false }); return; }
            }
            else
            {
                foreach (var b in new[] { "google-chrome", "chromium", "chromium-browser", "microsoft-edge", "brave-browser" })
                    if (Which(b) is { } p) { Process.Start(new ProcessStartInfo(p) { ArgumentList = { $"--app={url}" }, UseShellExecute = false }); return; }
            }
        }
        catch { }
        Open(url);
    }

    /// <summary>
    /// Lê um texto em voz alta com a voz do sistema e espera terminar (chamada no painel).
    /// O texto vai por variável de ambiente, nunca dentro do comando.
    /// </summary>
    public static async Task SpeakAsync(string text, CancellationToken ct = default)
    {
        // A fala vem do modelo: começando com "-" o say/spd-say/espeak leriam como opção.
        text = text.TrimStart('-', ' ', '\t', '\r', '\n');
        if (string.IsNullOrWhiteSpace(text)) return;
        ProcessStartInfo psi;
        if (Win)
        {
            psi = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true };
            foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-Command",
                "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
                "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'pt*' } | Select-Object -First 1; " +
                "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; $s.Speak($env:AC_FALA)" }) psi.ArgumentList.Add(a);
        }
        else if (Mac) psi = new ProcessStartInfo("say") { ArgumentList = { text }, UseShellExecute = false };
        else if (Which("spd-say") is { } spd) psi = new ProcessStartInfo(spd) { ArgumentList = { "-w", "-l", "pt", text }, UseShellExecute = false };
        else if ((Which("espeak-ng") ?? Which("espeak")) is { } es) psi = new ProcessStartInfo(es) { ArgumentList = { "-v", "pt-br", text }, UseShellExecute = false };
        else return;
        psi.Environment["AC_FALA"] = text;
        try
        {
            using var p = Process.Start(psi);
            if (p is null) return;
            using var reg = ct.Register(() => { try { p.Kill(); } catch { } });
            await p.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(90));
        }
        catch { }
    }

    // ---------------- memória ----------------

    [StructLayout(LayoutKind.Sequential)]
    struct MemoryStatus
    {
        public uint Length; public uint MemoryLoad; public ulong TotalPhysical; public ulong AvailablePhysical;
        public ulong TotalPageFile; public ulong AvailablePageFile; public ulong TotalVirtual; public ulong AvailableVirtual; public ulong AvailableExtendedVirtual;
    }
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);

    /// <summary>RAM livre de verdade (o que dá para usar sem o sistema começar a trocar para o disco).</summary>
    public static long FreeRamMb()
    {
        try
        {
            if (Win)
            {
                var s = new MemoryStatus { Length = (uint)Marshal.SizeOf<MemoryStatus>() };
                return GlobalMemoryStatusEx(ref s) ? (long)(s.AvailablePhysical / 1048576) : 0;
            }
            if (Linux)
            {
                var m = Regex.Match(File.ReadAllText("/proc/meminfo"), @"MemAvailable:\s+(\d+)");
                return m.Success ? long.Parse(m.Groups[1].Value) / 1024 : 0;
            }
            // macOS: páginas livres + inativas + especulativas (o mesmo que o Monitor de Atividade chama de disponível)
            var vm = Run("vm_stat");
            var page = Regex.Match(vm, @"page size of (\d+)") is { Success: true } pm ? long.Parse(pm.Groups[1].Value) : 4096;
            long Pages(string k) => Regex.Match(vm, k + @":\s+(\d+)") is { Success: true } x ? long.Parse(x.Groups[1].Value) : 0;
            return (Pages("Pages free") + Pages("Pages inactive") + Pages("Pages speculative")) * page / 1048576;
        }
        catch { return 0; }
    }

    // ---------------- loops dos agentes ----------------

    /// <summary>
    /// O loop do agente está rodando? Windows: o loop segura o mutex AgentLoop-&lt;agente&gt;.
    /// Linux/macOS: tools/agentes/agent-loop.sh grava o PID em ~/.config/dw-agents/night-logs/&lt;agente&gt;.pid.
    /// </summary>
    public static bool LoopAlive(string agent)
    {
        if (Win)
        {
            try { if (Mutex.TryOpenExisting("AgentLoop-" + agent, out var m)) { m.Dispose(); return true; } } catch { }
            return false;
        }
        try
        {
            var f = Path.Combine(AgentsDir, "night-logs", agent + ".pid");
            if (!File.Exists(f) || !int.TryParse(File.ReadAllText(f).Trim(), out var pid)) return false;
            using var p = Process.GetProcessById(pid);
            return !p.HasExited;
        }
        catch { return false; }
    }

    // ---------------- janelas de outros apps ----------------

    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    /// <summary>Traz a janela de um app já aberto para frente.</summary>
    public static void Focus(Process p, string appName)
    {
        try
        {
            if (Win) { if (p.MainWindowHandle != IntPtr.Zero) { ShowWindow(p.MainWindowHandle, 9); SetForegroundWindow(p.MainWindowHandle); } }
            else if (Mac) Process.Start(new ProcessStartInfo("open") { ArgumentList = { "-a", appName }, UseShellExecute = false });
            else if (Which("wmctrl") is { } w) Process.Start(new ProcessStartInfo(w) { ArgumentList = { "-a", appName }, UseShellExecute = false });
        }
        catch { }
    }

    // ---------------- mouse e acessibilidade ----------------

    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);

    /// <summary>Posição do mouse na tela (pixels). Só o Windows deixa ler fora das nossas janelas; nos outros, null.</summary>
    public static (int X, int Y)? Cursor()
    {
        if (!Win) return null;
        try { return GetCursorPos(out var p) ? (p.X, p.Y) : null; } catch { return null; }
    }

    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, out bool value, uint winIni);

    /// <summary>
    /// "Reduzir animações": Windows (efeitos de animação desligados), ou AGENTC_REDUCED_MOTION=1 em qualquer sistema.
    /// </summary>
    public static bool ReducedMotion()
    {
        if (Environment.GetEnvironmentVariable("AGENTC_REDUCED_MOTION") is "1" or "true") return true;
        if (Win) { try { return SystemParametersInfo(0x1042, 0, out var on, 0) && !on; } catch { } } // SPI_GETCLIENTAREAANIMATION
        if (Mac) return Run("defaults", "read", "com.apple.universalaccess", "reduceMotion").Trim() == "1";
        return false;
    }
}
