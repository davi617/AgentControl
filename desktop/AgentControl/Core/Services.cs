using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentControl.Core;

/// <summary>
/// Liga e desliga os serviços locais (9Router, fila anti-429 e servidor), os loops dos agentes e os apps.
/// Tudo escuta só em 127.0.0.1: o launcher se recusa a ligar algo exposto na rede e avisa se achar.
/// </summary>
public sealed class Services
{
    public string SettingsPath { get; } = Path.Combine(Platform.DataDir, "settings.json");
    public string LogPath { get; } = Path.Combine(Platform.DataDir, "launcher.log");
    public string LogsDir { get; } = Path.Combine(Platform.DataDir, "logs");
    public LauncherSettings Settings { get; private set; } = new();
    public event Action<string>? Logged;
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(3) };
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };

    public string JarvisUrl => $"http://127.0.0.1:{Settings.JarvisPort}";
    public string Node => Platform.Which(Platform.Expand(Settings.NodePath)) ?? Settings.NodePath;

    public void Load()
    {
        Directory.CreateDirectory(LogsDir);
        if (!File.Exists(SettingsPath)) { Settings = FirstRun(); Save(); }
        else Settings = JsonSerializer.Deserialize<LauncherSettings>(File.ReadAllText(SettingsPath), Json) ?? new();
        if (string.IsNullOrWhiteSpace(Settings.JarvisDir) || !File.Exists(Path.Combine(Platform.Expand(Settings.JarvisDir), "src", "main.ts")))
            Settings.JarvisDir = FindRepo() ?? Settings.JarvisDir;
        foreach (var app in Settings.Apps) app.DetectedPath = DetectPath(app);
    }

    public void Save() => File.WriteAllText(SettingsPath, JsonSerializer.Serialize(Settings, Json));

    /// <summary>
    /// Primeira vez: no Windows do dono traz os apps do launcher antigo (launcher/dist/settings.json);
    /// nos outros, começa com Obsidian, ChatGPT e Claude (o que não estiver instalado fica cinza).
    /// </summary>
    LauncherSettings FirstRun()
    {
        var s = new LauncherSettings { JarvisDir = FindRepo() ?? "" };
        var legacy = s.JarvisDir.Length > 0 ? Path.Combine(s.JarvisDir, "launcher", "dist", "settings.json") : "";
        if (Platform.Win && File.Exists(legacy))
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(legacy));
                if (doc.RootElement.TryGetProperty("Apps", out var apps))
                    s.Apps = JsonSerializer.Deserialize<List<ManagedApp>>(apps.GetRawText(), Json) ?? [];
                if (doc.RootElement.TryGetProperty("RouterCli", out var rc) && rc.GetString() is { Length: > 0 } cli) s.RouterCli = cli;
            }
            catch { }
        if (s.Apps.Count == 0) s.Apps = DefaultApps();
        return s;
    }

    static List<ManagedApp> DefaultApps() => Platform.Win
        ? [new() { Name = "Obsidian", ProcessName = "Obsidian", ExecutablePath = @"%LOCALAPPDATA%\Programs\Obsidian\Obsidian.exe" }, new() { Name = "ChatGPT", ProcessName = "ChatGPT" }, new() { Name = "Claude", ProcessName = "claude" }]
        : Platform.Mac
        ? [new() { Name = "Obsidian", ProcessName = "Obsidian" }, new() { Name = "ChatGPT", ProcessName = "ChatGPT" }, new() { Name = "Claude", ProcessName = "Claude" }]
        : [new() { Name = "Obsidian", ProcessName = "obsidian" }, new() { Name = "Terminal", ProcessName = "", AlwaysLaunch = true, ExecutablePath = "x-terminal-emulator" }];

    /// <summary>Repositório do Agent Control: sobe a partir do app até achar src/main.ts.</summary>
    static string? FindRepo()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Environment.CurrentDirectory })
        {
            var d = new DirectoryInfo(start);
            for (var i = 0; d is not null && i < 8; i++, d = d.Parent)
                if (File.Exists(Path.Combine(d.FullName, "src", "main.ts")) && File.Exists(Path.Combine(d.FullName, "src", "gate.ts"))) return d.FullName;
        }
        foreach (var guess in new[] { Path.Combine(Platform.Home, "AgentControl", "jarvis"), Path.Combine(Platform.Home, "agent-control"), Path.Combine(Platform.Home, "src", "agent-control") })
            if (File.Exists(Path.Combine(guess, "src", "main.ts"))) return guess;
        return null;
    }

    public void Log(string message)
    {
        var line = $"{DateTime.Now:HH:mm:ss}  {Redact(message)}";
        try { File.AppendAllText(LogPath, $"{DateTime.Now:yyyy-MM-dd} {line}{Environment.NewLine}"); } catch { }
        Logged?.Invoke(line);
    }

    /// <summary>Aviso só na tela (não vai para o launcher.log).</summary>
    public void Note(string message) => Logged?.Invoke($"{DateTime.Now:HH:mm:ss}  {message}");

    /// <summary>
    /// Log mais recente de um serviço ("9router", "gate", "jarvis"): na pasta do app, na do launcher antigo
    /// (launcher/dist/logs) ou em data/ do projeto (quando ligado à mão).
    /// </summary>
    public string? ServiceLog(string name)
    {
        var dirs = new[] { LogsDir, Path.Combine(Repo, "launcher", "dist", "logs"), Path.Combine(Repo, "data") };
        return dirs.Where(Directory.Exists).SelectMany(d => { try { return new DirectoryInfo(d).GetFiles($"{name}*.log"); } catch { return []; } })
            .OrderByDescending(f => f.LastWriteTime).FirstOrDefault()?.FullName;
    }

    /// <summary>Atalho de início automático (Windows: pasta Inicializar) que abre este app com --autostart.</summary>
    public static string? AutostartShortcut()
    {
        if (!Platform.Win) return null;
        var dir = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
        try
        {
            foreach (var lnk in Directory.GetFiles(dir, "*.lnk"))
            {
                var bytes = File.ReadAllBytes(lnk);
                var text = System.Text.Encoding.Unicode.GetString(bytes) + System.Text.Encoding.Latin1.GetString(bytes);
                if (text.Contains("JarvisLauncher.exe", StringComparison.OrdinalIgnoreCase) || text.Contains("AgentControl", StringComparison.OrdinalIgnoreCase)) return lnk;
            }
        }
        catch { }
        return null;
    }

    static string Redact(string s)
    {
        s = Regex.Replace(s, @"(Bearer\s+|sk-|nvapi-|AIza|eyJ)[A-Za-z0-9._\-]{8,}", "$1[REDACTED]");
        s = s.Replace(Platform.Home, "[HOME]", StringComparison.OrdinalIgnoreCase);
        return Regex.Replace(s, @"\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b", "[REDACTED]", RegexOptions.IgnoreCase);
    }

    string Repo => Platform.Expand(Settings.JarvisDir);

    // ---------------- serviços ----------------

    static ServiceState StateOf(int port)
    {
        var l = Platform.Listeners(port);
        if (l.Count == 0) return ServiceState.Off;
        return l.Any(x => Platform.IsExposed(x.Address)) ? ServiceState.Exposed : ServiceState.Online;
    }

    public ServiceState RouterState() => StateOf(Settings.RouterPort);
    public ServiceState GateState() => StateOf(Settings.GatePort);

    public async Task<ServiceState> JarvisStateAsync()
    {
        try
        {
            using var r = await Http.GetAsync($"{JarvisUrl}/api/projects");
            return r.IsSuccessStatusCode ? ServiceState.Online : ServiceState.Off;
        }
        catch { return ServiceState.Off; }
    }

    bool StartBackground(string name, string workDir, params string[] args)
    {
        var log = Path.Combine(LogsDir, $"{name}.log");
        try { File.AppendAllText(log, $"{Environment.NewLine}==== {DateTime.Now:yyyy-MM-dd HH:mm:ss} start ===={Environment.NewLine}"); }
        catch (IOException) { log = Path.Combine(LogsDir, $"{name}-{DateTime.Now:yyyyMMdd-HHmmss}.log"); }
        try
        {
            Platform.StartDetached(workDir, Node, args, log);
            Log($"{name}: iniciando (log em {log})");
            return true;
        }
        catch (Exception ex) { Log($"{name}: falhou ao iniciar: {ex.Message}"); return false; }
    }

    /// <summary>cli.js do 9Router: o do settings.json ou o da pasta global do npm.</summary>
    string? RouterCli()
    {
        var set = Platform.Expand(Settings.RouterCli);
        if (set.Length > 0 && File.Exists(set)) return set;
        var roots = new List<string>();
        if (Platform.Win) roots.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "node_modules"));
        if (Platform.Which("npm") is { } npm && Platform.Run(npm, "root", "-g").Trim() is { Length: > 0 } g) roots.Add(g);
        roots.AddRange(["/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules", "/usr/lib/node_modules", Path.Combine(Platform.Home, ".npm-global", "lib", "node_modules")]);
        return roots.Select(r => Path.Combine(r, "9router", "cli.js")).FirstOrDefault(File.Exists);
    }

    public async Task<bool> StartRouterAsync()
    {
        var state = RouterState();
        if (state == ServiceState.Exposed) { Log("9Router: JÁ RODANDO EXPOSTO NA REDE (0.0.0.0). Desligue e ligue por aqui para ficar só local."); return true; }
        if (state == ServiceState.Online) { Log("9Router: já está online (só local)."); return true; }
        if (RouterCli() is not { } cli) { Log("9Router: não achei o cli.js (instale com: npm i -g 9router, ou ajuste RouterCli no settings.json)."); return false; }
        // --host 127.0.0.1 é obrigatório: o padrão do 9Router é 0.0.0.0 (exposto na rede de casa).
        StartBackground("9router", Path.GetDirectoryName(cli)!, cli, "--host", "127.0.0.1", "--port", Settings.RouterPort.ToString(), "--no-browser", "--skip-update");
        for (var i = 0; i < 90; i++)
        {
            await Task.Delay(1000);
            state = RouterState();
            if (state != ServiceState.Off) { Log(state == ServiceState.Online ? "9Router: online em 127.0.0.1." : "9Router: ATENÇÃO, escutando fora do loopback!"); return true; }
        }
        Log("9Router: não respondeu em 90 s. Veja o log 9router.log.");
        return false;
    }

    /// <summary>Fila anti-429: os agentes falam com ela (porta 20129), e ela fala com o 9Router.</summary>
    public async Task<bool> StartGateAsync()
    {
        if (GateState() != ServiceState.Off) { Log("Fila anti-429: já está online."); return true; }
        if (!File.Exists(Path.Combine(Repo, "src", "gate.ts"))) { Log($"Fila anti-429: src/gate.ts não encontrado em {Repo}. Ajuste JarvisDir no settings.json."); return false; }
        StartBackground("gate", Repo, Path.Combine("src", "gate.ts"));
        for (var i = 0; i < 30; i++)
        {
            await Task.Delay(500);
            if (GateState() == ServiceState.Online) { Log($"Fila anti-429: online em 127.0.0.1:{Settings.GatePort}."); return true; }
        }
        Log("Fila anti-429: não respondeu em 15 s. Veja o log gate.log.");
        return false;
    }

    public async Task<bool> StartJarvisAsync()
    {
        if (await JarvisStateAsync() == ServiceState.Online) { Log("Servidor: já está online."); return true; }
        if (!File.Exists(Path.Combine(Repo, "src", "main.ts"))) { Log($"Servidor: src/main.ts não encontrado em {Repo}. Ajuste JarvisDir no settings.json."); return false; }
        StartBackground("jarvis", Repo, Path.Combine("src", "main.ts"));
        for (var i = 0; i < 40; i++)
        {
            await Task.Delay(500);
            if (await JarvisStateAsync() == ServiceState.Online) { Log($"Servidor: online em {JarvisUrl}."); return true; }
        }
        Log("Servidor: não respondeu em 20 s. Veja o log jarvis.log.");
        return false;
    }

    /// <summary>Logon (--autostart): liga os serviços sem janela.</summary>
    public async Task AutostartAsync()
    {
        Log($"AUTOSTART ({Platform.Name}): ligando serviços.");
        await StartRouterAsync();
        await StartGateAsync();
        await StartJarvisAsync();
        Log("AUTOSTART: pronto.");
    }

    public void StopPort(string name, int port)
    {
        var pids = Platform.Listeners(port).Select(x => x.Pid).Where(p => p > 0).Distinct().ToList();
        if (pids.Count == 0) { Log($"{name}: já estava desligado (ou sem permissão para ver o processo)."); return; }
        foreach (var pid in pids) { Platform.Kill(pid); Log($"{name}: desligado (PID {pid})."); }
    }

    // ---------------- agentes ----------------

    /// <summary>Liga os loops de todos os agentes (tools/ligar-agentes.ps1 no Windows, tools/agentes/ligar-agentes.sh nos outros).</summary>
    public bool StartAgents()
    {
        try
        {
            if (Platform.Win)
            {
                var ps1 = Path.Combine(Repo, "tools", "ligar-agentes.ps1");
                if (!File.Exists(ps1)) { Log($"Não achei {ps1}."); return false; }
                Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -File \"{ps1}\" -Agentes \"{string.Join(',', Settings.LoopAgents)}\"") { UseShellExecute = false, CreateNoWindow = true });
            }
            else
            {
                var sh = Path.Combine(Repo, "tools", "agentes", "ligar-agentes.sh");
                if (!File.Exists(sh)) { Log($"Não achei {sh}."); return false; }
                Platform.StartDetached(Repo, "/bin/bash", [sh, .. Settings.LoopAgents], Path.Combine(LogsDir, "agentes.log"));
            }
            Log("Agentes: ligando os loops…");
            return true;
        }
        catch (Exception ex) { Log($"Agentes: falhou: {ex.Message}"); return false; }
    }

    public int AgentsAlive() => Settings.LoopAgents.Count(Platform.LoopAlive);

    /// <summary>Agentes que o Agent Control já conhece (o usuário escolhe quais usar em Ajustes; dá para pôr outro pelo nome).</summary>
    public static readonly (string Id, string Name, string About, bool Loop)[] Catalog =
    [
        ("CLAUDE", "Claude Code", "CLI da Anthropic (claude -p)", true),
        ("CODEX", "Codex", "CLI da OpenAI (codex exec)", true),
        ("GEMINI", "Gemini CLI", "CLI do Google (gemini -p)", true),
        ("QWEN", "Qwen Code", "CLI do Qwen", true),
        ("OPENCODE", "OpenCode", "opencode run", true),
        ("OPENCLAW", "OpenClaw", "openclaw agent", true),
        ("HERMES", "Hermes", "hermes -z", true),
        ("DROID", "Droid", "Factory (droid exec)", true),
        ("GROK", "Grok CLI", "CLI da xAI (grok -p)", true),
        ("AIDER", "Aider", "aider --message", true),
        ("CURSOR", "Cursor Agent", "cursor-agent -p", true),
        ("AMP", "Amp", "CLI da Sourcegraph (amp -x)", true),
        ("CHATGPT", "ChatGPT", "app, sem loop: fala pela sala", false),
    ];

    string ConfigPath => Environment.GetEnvironmentVariable("JARVIS_CONFIG") is { Length: > 0 } c ? c : Path.Combine(Repo, "jarvis.config.json");

    // ---------------- acesso pelo celular e iPhone (Tailscale) ----------------

    /// <summary>IP deste PC no Tailscale (100.64.0.0/10) ou null se o Tailscale não estiver instalado/logado.</summary>
    public static string? TailscaleIp()
    {
        var exe = Platform.Win ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Tailscale", "tailscale.exe")
            : Platform.Mac && File.Exists("/Applications/Tailscale.app/Contents/MacOS/Tailscale") && Platform.Which("tailscale") is null ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
            : "tailscale";
        var ip = Platform.Run(exe, "ip", "-4").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault() ?? "";
        var m = System.Text.RegularExpressions.Regex.Match(ip, @"^100\.(\d+)\.\d+\.\d+$");
        return m.Success && int.Parse(m.Groups[1].Value) is >= 64 and <= 127 ? ip : null;
    }

    /// <summary>Como está o acesso de fora no jarvis.config.json: ligado, IP, porta e o token (lido do arquivo, nunca do log).</summary>
    public (bool On, string? Host, int Port, string? Token) RemoteInfo()
    {
        try
        {
            var root = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(ConfigPath))!;
            var r = root["remote"];
            var on = (bool?)r?["enabled"] == true;
            var host = (string?)r?["host"];
            var port = (int?)r?["port"] ?? (int?)root["port"] ?? Settings.JarvisPort;
            var tf = (string?)r?["tokenFile"] ?? "data/remote-token.txt";
            var full = Path.IsPathRooted(Platform.Expand(tf)) ? Platform.Expand(tf) : Path.Combine(Path.GetDirectoryName(ConfigPath)!, tf);
            var token = on && File.Exists(full) ? File.ReadAllText(full).Trim() : null;
            return (on, host, port, token);
        }
        catch { return (false, null, Settings.JarvisPort, null); }
    }

    /// <summary>
    /// Liga ou desliga o acesso pelo celular/iPhone: grava remote no jarvis.config.json (só o IP do Tailscale, nunca 0.0.0.0
    /// nem a rede de casa) e reinicia o servidor, que cria o token na primeira vez. Devolve null ou o erro.
    /// </summary>
    public async Task<string?> SetRemoteAsync(bool on)
    {
        string? ip = null;
        if (on && (ip = await Task.Run(TailscaleIp)) is null) return "Não achei o Tailscale ligado neste PC. Instale (tailscale.com/download), faça login e tente de novo.";
        try
        {
            var path = ConfigPath;
            var root = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(path))!.AsObject();
            var r = root["remote"] as System.Text.Json.Nodes.JsonObject ?? new System.Text.Json.Nodes.JsonObject();
            r["enabled"] = on;
            if (ip is not null) r["host"] = ip;
            r["tokenFile"] ??= "data/remote-token.txt";
            root["remote"] = r.DeepClone();
            File.Copy(path, path + ".bak", overwrite: true);
            File.WriteAllText(path, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + Environment.NewLine);
        }
        catch (Exception ex) { return $"Não consegui salvar o jarvis.config.json: {ex.Message}"; }
        Log(on ? $"Acesso pelo celular ligado em {ip} (só Tailscale, com token). Reiniciando o servidor." : "Acesso pelo celular desligado. Reiniciando o servidor.");
        if (await JarvisStateAsync() == ServiceState.Online) { StopPort("Servidor", Settings.JarvisPort); await Task.Delay(1500); }
        await StartJarvisAsync();
        return null;
    }

    /// <summary>Agentes do projeto no jarvis.config.json do servidor.</summary>
    public List<string> TeamFromConfig()
    {
        try
        {
            var root = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(ConfigPath))!;
            var proj = root["projects"]!.AsArray().FirstOrDefault(p => (string?)p!["id"] == Settings.JarvisProject) ?? root["projects"]!.AsArray().First();
            return proj!["agents"]!.AsArray().Select(a => ((string?)a!["id"] ?? "").ToUpperInvariant()).Where(x => x.Length > 0).ToList();
        }
        catch { return Settings.LoopAgents.Select(a => a.ToUpperInvariant()).ToList(); }
    }

    /// <summary>
    /// Salva o time escolhido: agentes do projeto no jarvis.config.json (mantém a worktree de quem já estava; novos
    /// ganham ~/AgentControl/agent-&lt;nome&gt;), loops no settings.json, para os loops de quem saiu
    /// e reinicia o servidor para ele ler a lista nova. Devolve null ou o erro.
    /// </summary>
    public async Task<string?> SaveTeamAsync(List<string> team)
    {
        team = team.Select(t => t.Trim().ToUpperInvariant()).Where(t => System.Text.RegularExpressions.Regex.IsMatch(t, "^[A-Z0-9_-]{2,24}$")).Distinct().ToList();
        if (team.Count == 0) return "Escolha pelo menos um agente.";
        try
        {
            var path = ConfigPath;
            // Quem acabou de baixar ainda não tem jarvis.config.json: começa pelo exemplo (sem dados de ninguém).
            var example = Path.Combine(Repo, "jarvis.config.example.json");
            if (!File.Exists(path) && File.Exists(example)) { File.Copy(example, path); Log("Criei o jarvis.config.json a partir do exemplo. Ajuste a pasta do vault nele se precisar."); }
            var root = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(path))!;
            var projects = root["projects"]!.AsArray();
            var proj = projects.FirstOrDefault(p => (string?)p!["id"] == Settings.JarvisProject) ?? projects.First()!;
            var old = proj!["agents"]!.AsArray().ToDictionary(a => ((string?)a!["id"] ?? "").ToUpperInvariant(), a => a!.DeepClone());
            var arr = new System.Text.Json.Nodes.JsonArray();
            foreach (var id in team)
            {
                if (old.TryGetValue(id, out var keep)) { arr.Add(keep); continue; }
                var node = new System.Text.Json.Nodes.JsonObject { ["id"] = id };
                if (Catalog.FirstOrDefault(c => c.Id == id) is not { Loop: false }) node["worktree"] = "~/AgentControl/agent-" + id.ToLowerInvariant() + "";
                arr.Add(node);
            }
            proj["agents"] = arr;
            File.Copy(path, path + ".bak", overwrite: true);
            File.WriteAllText(path, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }) + Environment.NewLine);
        }
        catch (Exception ex) { return $"Não consegui salvar o jarvis.config.json: {ex.Message}"; }

        var loops = team.Where(id => Catalog.FirstOrDefault(c => c.Id == id) is not { Loop: false }).Select(id => id.ToLowerInvariant()).ToList();
        foreach (var gone in Settings.LoopAgents.Except(loops).ToList()) if (Platform.LoopAlive(gone)) StopLoop(gone);
        Settings.LoopAgents = loops;
        Save();
        Log($"Time salvo: {string.Join(", ", team.Select(AgentControl.Ui.K.Nice))}. Reiniciando o servidor para ler a lista nova.");
        if (await JarvisStateAsync() == ServiceState.Online) { StopPort("Servidor", Settings.JarvisPort); await Task.Delay(1500); await StartJarvisAsync(); }
        return null;
    }

    /// <summary>Liga o loop de UM agente (se já estiver rodando, o novo sai sozinho pela trava).</summary>
    public bool StartLoop(string agent)
    {
        agent = agent.ToLowerInvariant();
        try
        {
            if (Platform.Win)
            {
                var root = Platform.AgentsDir;
                var launcher = Path.Combine(root, "launchers", $"{agent}-loop.cmd");
                if (!File.Exists(launcher)) launcher = Path.Combine(root, "launchers", $"{agent}.cmd");
                if (!File.Exists(launcher)) { Log($"{K(agent)}: sem lançador em {launcher}."); return false; }
                var loop = Path.Combine(Repo, "tools", "agentes", "agent-loop.ps1");
                Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{loop}\" -Agent {agent} -Launcher \"{launcher}\" -Sempre") { UseShellExecute = false, CreateNoWindow = true });
            }
            else Platform.StartDetached(Repo, "/bin/bash", [Path.Combine(Repo, "tools", "agentes", "agent-loop.sh"), agent], Path.Combine(LogsDir, "agentes.log"));
            Log($"{K(agent)}: ligando o loop.");
            return true;
        }
        catch (Exception ex) { Log($"{K(agent)}: falhou ao ligar: {ex.Message}"); return false; }
    }

    /// <summary>Para o loop de UM agente (e a rodada que ele estiver fazendo agora).</summary>
    public void StopLoop(string agent)
    {
        agent = agent.ToLowerInvariant();
        if (Platform.Win)
            Platform.Run("powershell.exe", "-NoProfile", "-Command",
                $"Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object {{ $_.CommandLine -match 'night-agent-loop\\.ps1' -and $_.CommandLine -match '-Agent {agent}( |$)' }} | ForEach-Object {{ taskkill.exe /PID $_.ProcessId /T /F | Out-Null }}");
        else
            try { if (int.TryParse(File.ReadAllText(Path.Combine(Platform.AgentsDir, "night-logs", agent + ".pid")).Trim(), out var pid)) Platform.Kill(pid); } catch { }
        Log($"{K(agent)}: loop parado.");
    }

    static string K(string agent) => AgentControl.Ui.K.Nice(agent);

    /// <summary>Pasta (worktree) do agente: ~/AgentControl/agent-&lt;agente&gt;.</summary>
    public static string Worktree(string agent) => Path.Combine(Platform.Home, "AgentControl", $"agent-{agent.ToLowerInvariant()}");

    /// <summary>Última linha do log do loop (RUN/EXIT/IDLE/PAUSED…) e o arquivo de saída da última rodada.</summary>
    public static (string State, DateTime? When, string? LastOut) LoopInfo(string agent)
    {
        var dir = Path.Combine(Platform.AgentsDir, "night-logs");
        agent = agent.ToLowerInvariant();
        string state = ""; DateTime? when = null;
        try
        {
            var last = File.ReadLines(Path.Combine(dir, agent + ".log")).Reverse().FirstOrDefault(l => l.StartsWith('['));
            var m = last is null ? null : Regex.Match(last, @"^\[([^\]]+)\]\s+(\S+)");
            if (m is { Success: true }) { state = m.Groups[2].Value; if (DateTime.TryParse(m.Groups[1].Value, out var t)) when = t; }
        }
        catch { }
        string? outLog = null;
        try { outLog = new DirectoryInfo(dir).GetFiles($"{agent}-*.out.log").OrderByDescending(f => f.LastWriteTime).FirstOrDefault()?.FullName; } catch { }
        return (state, when, outLog);
    }

    // ---------------- apps ----------------

    public void OpenJarvisWindow() { Platform.OpenAppWindow(JarvisUrl); Log("Sala aberta numa janela."); }

    public void OpenObsidianNote(string note)
    {
        var uri = $"obsidian://open?vault={Uri.EscapeDataString(Settings.ObsidianVault)}&file={Uri.EscapeDataString(note)}";
        Log(Platform.Open(uri) ? $"Obsidian: abrindo {note}." : "Obsidian: não abriu (está instalado?).");
    }

    public void OpenPath(string path)
    {
        try { if (!File.Exists(path) && !Directory.Exists(path)) File.WriteAllText(path, ""); } catch { }
        if (!Platform.Open(path)) Log($"Não abri {path}.");
    }

    public Process? FindProcess(ManagedApp app)
    {
        if (app.AlwaysLaunch || app.ProcessName.Length == 0) return null;
        try
        {
            var m = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(app.ProcessName));
            return m.FirstOrDefault(p => !Platform.Win || p.MainWindowHandle != IntPtr.Zero) ?? m.FirstOrDefault();
        }
        catch { return null; }
    }

    /// <summary>Caminho do app: o do settings, o de quem já está rodando, ou o lugar padrão de cada sistema.</summary>
    public string? DetectPath(ManagedApp app)
    {
        var exact = Platform.Expand(app.ExecutablePath);
        if (exact.Length > 0 && (File.Exists(exact) || Directory.Exists(exact))) return exact;
        if (exact.Length > 0 && !exact.Contains(Path.DirectorySeparatorChar) && Platform.Which(exact) is { } onPath) return onPath;
        try { if (FindProcess(app)?.MainModule?.FileName is { } f && File.Exists(f)) return f; } catch { }
        if (Platform.Win)
            foreach (var menu in new[] { Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu) })
                try
                {
                    var lnk = Directory.EnumerateFiles(menu, "*.lnk", SearchOption.AllDirectories).FirstOrDefault(x => Path.GetFileNameWithoutExtension(x).Equals(app.Name, StringComparison.OrdinalIgnoreCase));
                    if (lnk is not null) return lnk;
                }
                catch { }
        if (Platform.Mac)
            foreach (var dir in new[] { "/Applications", Path.Combine(Platform.Home, "Applications") })
                if (Directory.Exists(Path.Combine(dir, app.Name + ".app"))) return Path.Combine(dir, app.Name + ".app");
        if (Platform.Linux)
        {
            if (Platform.Which(app.Name.ToLowerInvariant()) is { } bin) return bin;
            foreach (var dir in new[] { "/usr/share/applications", "/var/lib/flatpak/exports/share/applications", Path.Combine(Platform.Home, ".local", "share", "applications") })
                try
                {
                    var desk = Directory.EnumerateFiles(dir, "*.desktop").FirstOrDefault(x => Path.GetFileNameWithoutExtension(x).Contains(app.Name, StringComparison.OrdinalIgnoreCase));
                    if (desk is not null) return desk;
                }
                catch { }
        }
        return null;
    }

    public bool OpenOrFocus(ManagedApp app)
    {
        if (FindProcess(app) is { } running) { Platform.Focus(running, app.Name); Log($"{app.Name}: já aberto; trazido para frente."); return true; }
        var path = app.DetectedPath ?? DetectPath(app);
        if (path is null) { Log($"{app.Name}: não achei. Ajuste ExecutablePath no settings.json."); return false; }
        try
        {
            if (Platform.Mac && path.EndsWith(".app")) Process.Start(new ProcessStartInfo("open") { ArgumentList = { "-a", path }, UseShellExecute = false });
            else if (Platform.Linux && path.EndsWith(".desktop")) Process.Start(new ProcessStartInfo(Platform.Which("gtk-launch") ?? "xdg-open") { ArgumentList = { Platform.Which("gtk-launch") is null ? path : Path.GetFileNameWithoutExtension(path) }, UseShellExecute = false });
            else Process.Start(new ProcessStartInfo(path) { Arguments = Platform.Expand(app.Arguments), UseShellExecute = Platform.Win, WorkingDirectory = Path.GetDirectoryName(path) ?? Platform.Home });
            Log($"{app.Name}: aberto.");
            return true;
        }
        catch (Exception ex) { Log($"{app.Name}: falhou ao abrir: {ex.Message}"); return false; }
    }
}
