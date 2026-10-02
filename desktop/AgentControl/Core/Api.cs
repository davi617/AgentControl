using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace AgentControl.Core;

/// <summary>Uma foto do estado do JARVIS para o HUD (tudo que as telas mostram).</summary>
public sealed record HudSnapshot(
    bool Online,
    string? Goal,
    int TasksDone,
    int TasksTotal,
    IReadOnlyList<(string Id, string Status, string? Task)> Agents,
    IReadOnlyList<(string Agent, int Req, double Share)> Usage,
    IReadOnlyList<(string Agent, string Text, string Ts)> Chat,
    int Pending,
    int RamFreeMb,
    int? Cpu,
    bool Paused,
    IReadOnlyList<string> Alerts,
    string? CallStatus,
    string? CallModo,
    string? CallTopic,
    int CallTurns)
{
    public static readonly HudSnapshot Offline = new(false, null, 0, 0, [], [], [], 0, 0, null, false, [], null, null, null, 0);
    public bool CallActive => CallStatus is "ATIVA" or "AGUARDANDO_DONO";
    public bool Working => Agents.Any(a => a.Status == "WORKING");
    /// <summary>O que o agente escreveu por último no STATUS.md (pode ser velho): status e quando.</summary>
    public Dictionary<string, (string Status, string Ts)> Reports { get; init; } = [];
    /// <summary>Há quantos minutos a rodada atual/última do loop começou.</summary>
    public Dictionary<string, int> LoopMinutes { get; init; } = [];
    public Dictionary<string, AgentQuota> Limits { get; init; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Cliente do JARVIS local (127.0.0.1:20150). Leitura é GET simples; escrita usa o mesmo caminho da
/// sala no navegador (Origin local + token CSRF de /api/session), então não precisa de token nenhum em disco.
/// </summary>
public sealed class HudApi
{
    public static string Base { get; set; } = "http://127.0.0.1:20150";
    // A fala da chamada pode levar até ~2,5 min (tentativas + modelo reserva no servidor).
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(170) };
    public string Project { get; private set; } = "main";
    string? csrf;
    HashSet<string> loopAgents = new(StringComparer.OrdinalIgnoreCase);

    public HudApi()
    {
        var settings = new LauncherSettings();
        try
        {
            var file = Path.Combine(Platform.DataDir, "settings.json");
            if (File.Exists(file)) settings = JsonSerializer.Deserialize<LauncherSettings>(File.ReadAllText(file), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? settings;
        }
        catch { /* A configuração inválida é explicada pelo Launcher. */ }
        Configure(settings);
    }

    public void Configure(LauncherSettings settings)
    {
        Base = $"http://127.0.0.1:{settings.JarvisPort}";
        Project = settings.JarvisProject;
        loopAgents = settings.LoopAgents.ToHashSet(StringComparer.OrdinalIgnoreCase);
        csrf = null;
    }


    static string Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    async Task<JsonElement?> Get(string path)
    {
        try
        {
            var sep = path.Contains('?') ? '&' : '?';
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var r = await http.GetAsync($"{Base}{path}{sep}project={Uri.EscapeDataString(Project)}", cts.Token);
            if (!r.IsSuccessStatusCode) return null;
            return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement.Clone();
        }
        catch { return null; }
    }

    public async Task<HudSnapshot> SnapshotAsync()
    {
        var state = await Get("/api/state");
        if (state is null) return HudSnapshot.Offline;
        var health = Get("/api/health");
        var usage = Get("/api/usage?dias=1");
        var limits = Get("/api/limits");
        var chat = Get("/api/chat");
        var cmds = Get("/api/commands");
        var call = Get("/api/call");
        await Task.WhenAll(health, usage, chat, cmds, call, limits);

        var s = state.Value;
        // Estado AO VIVO de cada loop (servidor lê o log do loop; este PC confere se o processo está vivo).
        // O STATUS.md pode ter dias: ele vira só o "último relatório" (Reports).
        var loops = new Dictionary<string, (string Estado, int Min)>();
        var paused0 = health.Result is { } h0 && h0.TryGetProperty("pausa", out var pz0) && pz0.TryGetProperty("paused", out var pp0) && pp0.GetBoolean();
        if (health.Result is { } hl && hl.TryGetProperty("loops", out var ls) && ls.ValueKind == JsonValueKind.Array)
            foreach (var l in ls.EnumerateArray())
                loops[Str(l, "agent").ToUpperInvariant()] = (Str(l, "estado"), l.TryGetProperty("minutos", out var mi) && mi.ValueKind == JsonValueKind.Number ? mi.GetInt32() : 0);
        var agents = new List<(string, string, string?)>();
        var reports = new Dictionary<string, (string, string)>();
        var loopMin = new Dictionary<string, int>();
        if (s.TryGetProperty("agents", out var ag) && ag.ValueKind == JsonValueKind.Array)
            foreach (var a in ag.EnumerateArray())
            {
                var latest = a.TryGetProperty("latest", out var l) && l.ValueKind == JsonValueKind.Object ? l : default;
                var id = Str(a, "id");
                var report = latest.ValueKind == JsonValueKind.Object ? Str(latest, "status") : "";
                reports[id] = (report, latest.ValueKind == JsonValueKind.Object ? Str(latest, "ts") : "");
                var status = report;
                if (loops.TryGetValue(id.ToUpperInvariant(), out var lp))
                {
                    loopMin[id] = lp.Min;
                    status = !Platform.LoopAlive(id.ToLowerInvariant()) ? "OFF"
                        : lp.Estado == "rodando" ? "WORKING"
                        : lp.Estado is "pausado" || paused0 ? "PAUSED"
                        : lp.Estado == "esperando RAM" ? "WAIT_RAM" : "IDLE";
                }
                else if (loopAgents.Contains(id))
                    status = !Platform.LoopAlive(id.ToLowerInvariant()) ? "OFF" : paused0 ? "PAUSED" : "IDLE";
                agents.Add((id, status, latest.ValueKind == JsonValueKind.Object ? Str(latest, "task") : null));
            }
        int done = 0, total = 0;
        if (s.TryGetProperty("tasks", out var ts) && ts.ValueKind == JsonValueKind.Array)
            foreach (var t in ts.EnumerateArray()) { total++; if (Str(t, "status").StartsWith("DONE", StringComparison.OrdinalIgnoreCase)) done++; }

        var use = new List<(string, int, double)>();
        if (usage.Result is { } u && u.TryGetProperty("agentes", out var ua) && ua.ValueKind == JsonValueKind.Array)
        {
            var rows = ua.EnumerateArray().Select(x => (Str(x, "agent"), x.TryGetProperty("req", out var q) ? q.GetInt32() : 0)).Where(x => x.Item2 > 0).ToList();
            var sum = Math.Max(1, rows.Sum(x => x.Item2));
            use.AddRange(rows.OrderByDescending(x => x.Item2).Select(x => (x.Item1, x.Item2, (double)x.Item2 / sum)));
        }

        var msgs = new List<(string, string, string)>();
        if (chat.Result is { ValueKind: JsonValueKind.Array } ch)
            foreach (var e in ch.EnumerateArray().Reverse().Take(8))
            {
                var body = Str(e, "body");
                var text = string.Join(" ", body.Split('\n').Where(x => !System.Text.RegularExpressions.Regex.IsMatch(x, @"^\s*-\s*(para|assunto|via)\s*:", System.Text.RegularExpressions.RegexOptions.IgnoreCase)).Select(x => x.Trim()).Where(x => x.Length > 0));
                msgs.Add((Str(e, "agent"), text.Length > 0 ? text : Str(e, "heading"), Str(e, "ts")));
            }

        var pending = 0;
        if (cmds.Result is { ValueKind: JsonValueKind.Array } cm)
            pending = cm.EnumerateArray().Count(c => Str(c, "approval") == "pending");

        int ram = 0; int? cpu = null; var paused = false; var alerts = new List<string>();
        if (health.Result is { } h)
        {
            if (h.TryGetProperty("ram", out var rm) && rm.TryGetProperty("livreMb", out var lm)) ram = lm.GetInt32();
            if (h.TryGetProperty("cpu", out var c) && c.ValueKind == JsonValueKind.Number) cpu = c.GetInt32();
            if (h.TryGetProperty("pausa", out var pz) && pz.TryGetProperty("paused", out var pp)) paused = pp.GetBoolean();
            if (h.TryGetProperty("alertas", out var al) && al.ValueKind == JsonValueKind.Array) alerts.AddRange(al.EnumerateArray().Select(x => x.GetString() ?? ""));
        }

        string? cst = null, cmodo = null, ctopic = null; var cturns = 0;
        if (call.Result is { ValueKind: JsonValueKind.Object } cl)
        {
            cst = Str(cl, "status"); cmodo = Str(cl, "modo"); ctopic = Str(cl, "topic");
            if (cl.TryGetProperty("turns", out var tu) && tu.ValueKind == JsonValueKind.Array) cturns = tu.GetArrayLength();
        }

        var goal = s.TryGetProperty("goal", out var g) && g.ValueKind == JsonValueKind.String ? g.GetString() : null;
        var quotas = new Dictionary<string, AgentQuota>(StringComparer.OrdinalIgnoreCase);
        if (limits.Result is { } lim && lim.TryGetProperty("agents", out var la) && la.ValueKind == JsonValueKind.Array)
            foreach (var row in la.EnumerateArray())
                try { var q = JsonSerializer.Deserialize<AgentQuota>(row.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }); if (q is not null) quotas[q.Agent] = q; } catch { }
        return new HudSnapshot(true, goal, done, total, agents, use, msgs, pending, ram, cpu, paused, alerts, cst, cmodo, ctopic, cturns) { Reports = reports, LoopMinutes = loopMin, Limits = quotas };
    }

    /// <summary>Pede a próxima fala da chamada. Devolve (quem, texto) ou null se ninguém falou (fim, pausa, esperando o dono).</summary>
    public async Task<(string Speaker, string Text)?> CallNext()
    {
        string? raw = null;
        var err = await Post("/api/call/next", new { project = Project }, t => raw = t);
        if (err is not null || raw is null) return null;
        try
        {
            var t = JsonDocument.Parse(raw).RootElement.GetProperty("turn");
            return t.ValueKind == JsonValueKind.Object ? (Str(t, "speaker"), Str(t, "text")) : null;
        }
        catch { return null; }
    }

    async Task<string?> Post(string path, object body, Action<string>? onBody = null)
    {
        try
        {
            if (csrf is null)
            {
                var sess = await Get("/api/session");
                csrf = sess is { } se ? Str(se, "csrf") : null;
                if (string.IsNullOrEmpty(csrf)) return "JARVIS desligado";
            }
            for (var attempt = 0; attempt < 2; attempt++)
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, Base + path) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };
                req.Headers.Add("Origin", Base);
                req.Headers.Add("X-Jarvis-Csrf", csrf);
                using var r = await http.SendAsync(req);
                if (r.IsSuccessStatusCode) { onBody?.Invoke(await r.Content.ReadAsStringAsync()); return null; }
                // JARVIS reiniciou: o token CSRF mudou. Pega outro e tenta de novo uma vez.
                if ((int)r.StatusCode == 403 && attempt == 0) { csrf = null; var sess = await Get("/api/session"); csrf = sess is { } se2 ? Str(se2, "csrf") : null; continue; }
                var txt = await r.Content.ReadAsStringAsync();
                try { return JsonDocument.Parse(txt).RootElement.GetProperty("error").GetString(); } catch { return $"HTTP {(int)r.StatusCode}"; }
            }
            return "recusado";
        }
        catch (Exception ex) { return ex.Message; }
    }

    /// <summary>Conversa da sala (mais antiga primeiro), para a tela de chat do PC.</summary>
    public async Task<List<(string Agent, string Text, string Ts)>> ChatAsync(int max = 80)
    {
        var list = new List<(string, string, string)>();
        if (await Get("/api/chat") is { ValueKind: JsonValueKind.Array } ch)
            foreach (var e in ch.EnumerateArray().Reverse().Take(max).Reverse())
            {
                var body = Str(e, "body");
                var text = string.Join("\n", body.Split('\n').Where(x => !System.Text.RegularExpressions.Regex.IsMatch(x, @"^\s*-\s*(para|assunto|via)\s*:", System.Text.RegularExpressions.RegexOptions.IgnoreCase)).Select(x => x.TrimEnd())).Trim();
                list.Add((Str(e, "agent"), text.Length > 0 ? text : Str(e, "heading"), Str(e, "ts")));
            }
        return list;
    }

    /// <summary>Modelo e força de cada agente (tela Agentes).</summary>
    public async Task<Dictionary<string, (string Model, string Effort)>> ModelsAsync()
    {
        var r = new Dictionary<string, (string, string)>();
        if (await Get("/api/models") is { ValueKind: JsonValueKind.Array } ms)
            foreach (var m in ms.EnumerateArray()) r[Str(m, "id")] = (Str(m, "current"), Str(m, "effort"));
        return r;
    }

    public sealed record Cmd(string Code, string Target, string Text, string Status, string? Approval, bool NeedsApproval, string When);

    /// <summary>Comandos J-xxx (mais novos primeiro).</summary>
    public async Task<List<Cmd>> CommandsAsync()
    {
        var r = new List<Cmd>();
        if (await Get("/api/commands") is { ValueKind: JsonValueKind.Array } cs)
            foreach (var c in cs.EnumerateArray().Reverse())
                r.Add(new Cmd(Str(c, "code"), Str(c, "target"), Str(c, "text"), Str(c, "status"),
                    c.TryGetProperty("approval", out var a) && a.ValueKind == JsonValueKind.String ? a.GetString() : null,
                    c.TryGetProperty("requires_approval", out var q) && q.ValueKind == JsonValueKind.Number && q.GetInt32() == 1, Str(c, "updated_at")));
        return r;
    }

    public Task<string?> SendCommand(string text, string to) => Post("/api/commands", new { project = Project, text, to });
    public Task<string?> Decide(string code, bool approve) => Post("/api/commands/decide", new { project = Project, code, decision = approve ? "approve" : "reject" });

    /// <summary>Uso dos últimos [dias]: pedidos/tokens por dia e por agente.</summary>
    public async Task<(List<(string Dia, int Req, long Tokens)> Days, List<(string Agent, int Req, long Tokens, int R429, int MsMedio)> Agents)> UsageAsync(int dias = 7)
    {
        var days = new List<(string, int, long)>();
        var ag = new List<(string, int, long, int, int)>();
        if (await Get($"/api/usage?dias={dias}") is { } u)
        {
            if (u.TryGetProperty("porDia", out var pd) && pd.ValueKind == JsonValueKind.Array)
                foreach (var d in pd.EnumerateArray()) days.Add((Str(d, "dia"), d.GetProperty("req").GetInt32(), d.GetProperty("tokens").GetInt64()));
            if (u.TryGetProperty("agentes", out var aa) && aa.ValueKind == JsonValueKind.Array)
                foreach (var a in aa.EnumerateArray())
                    ag.Add((Str(a, "agent"), a.GetProperty("req").GetInt32(), a.GetProperty("pin").GetInt64() + a.GetProperty("pout").GetInt64(), a.GetProperty("r429").GetInt32(), a.TryGetProperty("msMedio", out var ms) ? ms.GetInt32() : 0));
        }
        return (days, ag);
    }

    public sealed record ModelInfo(string Id, string Current, string Effort, List<string> Efforts, List<(string Id, string Label, string Note)> Options);

    /// <summary>Modelos que cada agente pode usar, o atual e a força (mesma tela "Modelos e força" do celular).</summary>
    public async Task<List<ModelInfo>> ModelOptionsAsync()
    {
        var r = new List<ModelInfo>();
        if (await Get("/api/models") is { ValueKind: JsonValueKind.Array } ms)
            foreach (var m in ms.EnumerateArray())
            {
                var eff = m.TryGetProperty("efforts", out var e) && e.ValueKind == JsonValueKind.Array ? e.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : [];
                var opts = m.TryGetProperty("options", out var o) && o.ValueKind == JsonValueKind.Array ? o.EnumerateArray().Select(x => (Str(x, "id"), Str(x, "label"), Str(x, "note"))).ToList() : [];
                r.Add(new ModelInfo(Str(m, "id"), Str(m, "current"), Str(m, "effort"), eff, opts));
            }
        return r;
    }

    public Task<string?> SetModel(string agent, string model, string? effort) => Post("/api/models", new { project = Project, agent, model, effort });

    public Task<string?> SendChat(string text, string to) => Post("/api/chat", new { project = Project, text, to });
    public Task<string?> StartGoal(string? goal) => Post("/api/call/start", new { project = Project, text = string.IsNullOrWhiteSpace(goal) ? "Tocar o Goal ativo" : goal, modo = "goal" });
    public Task<string?> EndCall() => Post("/api/call/end", new { project = Project });
    public Task<string?> Pause(bool on) => Post("/api/agents/pause", new { project = Project, on, agora = false });
}
