using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Threading;
using AgentControl.Core;

namespace AgentControl.Ui;

/// <summary>
/// Modo Prédio na tela completa (desenhado aqui mesmo, sem navegador): cada agente é um bonequinho que anda pelos
/// andares de um escritório. Cada tela é um andar. Trabalhando → mesa; travado ou esperando aprovação → sala do chefe;
/// terminou → copa; parado → sofá; na chamada → reunião. O chefe (você) usa terno e gravata vermelha; os agentes,
/// camiseta, calça e tênis sorteados pelo nome. O AgentC passeia como mascote. Mesma lógica de public/predio.js.
/// </summary>
public sealed class PredioView : Control
{
    const double W = 1200, H = 720, CorrY0 = 310, CorrY1 = 410, Speed = 95;
    const int PerFloor = 8;
    static readonly (double A, double B)[] Top = [(30, 320), (320, 610), (610, 890), (890, 1170)];
    static readonly (double A, double B)[] Bottom = [(30, 330), (330, 640), (640, 940)];

    // ---------- modelo ----------
    sealed record Furn(string T, double X, double Y, double Wd = 0, double Ht = 0, string? Col = null);
    sealed class Room
    {
        public string Name = ""; public double X0, X1, Y0, Y1; public bool IsTop, Stairs, Idle, Sleep, Green, Boss, Meeting, Queue, Board, Office;
        public List<Furn> Furniture = []; public List<Point> Spots = []; public List<Point> Desks = []; public HashSet<int> Sit = [];
        public Point Door => new((X0 + X1) / 2, IsTop ? CorrY0 : CorrY1);
        public Point Inside => new(Door.X, IsTop ? Door.Y - 26 : Door.Y + 26);
        public bool Contains(double x, double y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1;
    }
    sealed class Floor { public string Kind = "", Name = ""; public List<Room> Rooms = []; }
    sealed record Look(bool Boss, Color Skin, Color Hair, string Style, Color Shirt, Color Pants, Color Shoes, Color Cap);
    sealed record Way(int Floor, double X, double Y);
    sealed class Person
    {
        public string Id = ""; public bool IsBoss; public Look Look = null!;
        public int Floor; public double X, Y; public List<Way> Path = []; public Way? Target, Back;
        public bool Moving, Sitting, Typing; public int Face = 1; public double Phase, Lane, Celebrate, BackAt, WanderAt, ChatAt;
        public string Mood = "parado"; public string? Task, Status; public bool Party;
        public (string Text, double Until)? Bubble;
    }
    sealed class Bit { public int Floor; public double X, Y, Vx, Vy, Life, R; public Color C; }

    static readonly Color[] SkinC = Cols("#F5D0B5", "#E8B894", "#D49A6A", "#B97A4F", "#8D5A3B", "#6B4026");
    static readonly Color[] HairC = Cols("#1F1A17", "#3B2A20", "#6B4423", "#A0522D", "#D6B370", "#E5E5E5", "#B45309", "#7C3AED");
    static readonly Color[] ShirtC = Cols("#EF4444", "#F97316", "#EAB308", "#22C55E", "#14B8A6", "#3B82F6", "#6366F1", "#A855F7", "#EC4899", "#F4F4F5", "#27272A", "#0EA5E9");
    static readonly Color[] PantsC = Cols("#1E3A8A", "#1E40AF", "#27272A", "#52525B", "#A16207", "#3F3F46", "#334155");
    static readonly Color[] ShoesC = Cols("#F4F4F5", "#EF4444", "#22C55E", "#3B82F6", "#111111", "#F97316", "#A855F7");
    static readonly string[] Styles = ["curto", "longo", "careca", "bone", "coque", "topete"];
    static readonly (string Q, string R)[] Chatter = [("Bora um café?", "Bora! ☕"), ("Viu o deploy?", "Passou liso ✓"), ("Que bug chato…", "Te ajudo depois"), ("Bom trabalho hoje!", "Valeu! 🙌"), ("O chefe aprovou?", "Ainda não 😅"), ("Terminei a minha", "Boa! 🎉")];
    public static readonly Dictionary<string, (string Label, Color Color)> Moods = new()
    {
        ["trabalhando"] = ("trabalhando", K.C("#22C55E")), ["revisando"] = ("revisando", K.C("#F59E0B")), ["travado"] = ("travado", K.C("#EF4444")),
        ["terminou"] = ("terminou", K.C("#38BDF8")), ["parado"] = ("parado", K.C("#71717A")), ["chamada"] = ("na chamada", K.C("#F97316")), ["chefe"] = ("chefe (você)", K.C("#DC2626")),
    };

    static Color[] Cols(params string[] h) => h.Select(K.C).ToArray();
    static uint Seed(string s) { uint h = 2166136261; foreach (var c in s) { h ^= c; h *= 16777619; } return h; }

    static Look LookFor(string name, bool boss, int salt)
    {
        var r = new Random((int)(Seed(name) + (uint)(salt * 7919)));
        T Pick<T>(T[] a) => a[r.Next(a.Length)];
        if (boss) return new Look(true, Pick(SkinC), Pick(HairC[..6]), Pick(new[] { "curto", "topete", "careca" }), K.C("#F4F4F5"), K.C("#1E293B"), K.C("#111111"), K.C("#DC2626"));
        return new Look(false, Pick(SkinC), Pick(HairC), Pick(Styles), Pick(ShirtC), Pick(PantsC), Pick(ShoesC), Pick(ShirtC));
    }

    /// <summary>Status do STATUS.md + estado do loop → onde o bonequinho vai.</summary>
    public static string MoodOf(string? report, string? loop, string? ts)
    {
        var st = (report ?? "").ToUpperInvariant();
        if (new[] { "BLOCKED", "FAILED", "AWAITING", "VIOLATION", "NEEDS" }.Any(st.StartsWith)) return "travado";
        if ((loop ?? "") == "WORKING" || st.StartsWith("WORKING") || st.StartsWith("ACK")) return loop is "OFF" or "PAUSED" ? "parado" : "trabalhando";
        if (new[] { "REVIEW", "QUEUED", "ASSIGNED" }.Any(st.StartsWith)) return "revisando";
        if (st.StartsWith("DONE")) return DateTime.TryParse(ts, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var when) && DateTime.Now - when > TimeSpan.FromHours(6) ? "parado" : "terminou";
        return "parado";
    }

    static Room R(string name, double a, double b, bool top) => new() { Name = name, X0 = a, X1 = b, IsTop = top, Y0 = top ? 30 : CorrY1, Y1 = top ? CorrY0 : 690 };
    static List<Point> Seats(double x0, double x1, int n, double y) => Enumerable.Range(1, n).Select(i => new Point(x0 + i * (x1 - x0) / (n + 1), y)).ToList();

    static Floor MakeFloor(string kind, int n)
    {
        var f = new Floor { Kind = kind };
        var stairs = new Room { Name = "Escada", X0 = 940, X1 = 1170, Y0 = CorrY1, Y1 = 690, Stairs = true };
        var mes = DateTime.Now.Month;
        if (kind == "terreo")
        {
            f.Name = "Térreo";
            var rec = R("Recepção", 30, 320, true); rec.Furniture.AddRange([new("tapete", 175, 215, 210, 90, "#7C2D12"), new("balcao", 175, 150), new("planta", 60, 60), new("planta", 290, 60), new("letreiro", 175, 44), new("aquario", 75, 250)]);
            if (mes == 10) rec.Furniture.AddRange([new("abobora", 110, 120), new("abobora", 245, 120)]);
            rec.Spots = [new(175, 210), new(120, 250), new(230, 250)];
            var copa = R("Copa", 320, 610, true); copa.Idle = true; copa.Furniture.AddRange([new("tapete", 465, 220, 200, 120, "#78350F"), new("cafe", 360, 70), new("vending", 430, 72), new("geladeira", 570, 80), new("mesa", 465, 190, 140, 60)]);
            copa.Spots = [new(410, 175), new(520, 175), new(410, 265), new(520, 265), new(365, 120)];
            var desc = R("Descanso", 610, 890, true); desc.Idle = desc.Sleep = true; desc.Furniture.AddRange([new("tapete", 750, 175, 230, 200, "#3B0764"), new("sofa", 750, 90, 190), new("sofa", 750, 240, 190), new("tv", 750, 40), new("planta", 860, 280), new("luminaria", 650, 180), new("arte", 860, 40, 0, 0, "#F472B6")]);
            desc.Spots = [new(690, 115), new(750, 115), new(810, 115), new(690, 265), new(750, 265), new(810, 265)]; desc.Sit = [0, 1, 2, 3, 4, 5];
            var jogos = R("Jogos", 890, 1170, true); jogos.Idle = true; jogos.Furniture.AddRange([new("tapete", 1030, 160, 200, 120, "#1E3A8A"), new("pingpong", 1030, 160), new("fliperama", 1130, 80), new("arte", 950, 40, 0, 0, "#22D3EE")]);
            jogos.Spots = [new(935, 160), new(1125, 160), new(1120, 120)];
            var jardim = R("Jardim", 30, 330, false); jardim.Idle = jardim.Green = true; jardim.Furniture.AddRange([new("arvore", 90, 520), new("arvore", 270, 610), new("banco", 180, 520), new("flores", 120, 610), new("flores", 250, 470)]);
            jardim.Spots = [new(155, 545), new(205, 545), new(180, 640)]; jardim.Sit = [0, 1];
            var banh = R("Banheiros", 330, 640, false); banh.Furniture.AddRange([new("pia", 400, 660), new("pia", 470, 660), new("cabine", 560, 470), new("cabine", 610, 470)]);
            banh.Spots = [new(400, 620), new(470, 620)];
            var corr = R("Correio", 640, 940, false); corr.Furniture.AddRange([new("estante", 700, 470), new("estante", 880, 470), new("caixas", 790, 640)]);
            corr.Spots = [new(760, 560), new(830, 560)];
            f.Rooms = [rec, copa, desc, jogos, jardim, banh, corr, stairs];
        }
        else if (kind == "diretoria")
        {
            f.Name = "1º andar · Diretoria";
            var chefe = R("Sala do chefe", 30, 320, true); chefe.Boss = chefe.Queue = true;
            chefe.Furniture.AddRange([new("tapete", 175, 160, 230, 120, "#7F1D1D"), new("mesaChefe", 175, 110), new("quadro", 175, 38), new("planta", 55, 60), new("planta", 295, 60), new("trofeus", 60, 165), new("luminaria", 290, 170)]);
            chefe.Spots = [new(115, 215), new(175, 225), new(235, 215), new(85, 270), new(265, 270)];
            var reun = R("Reunião", 320, 890, true); reun.Meeting = true;
            reun.Furniture.AddRange([new("tapete", 605, 172, 430, 170, "#1E293B"), new("mesa", 605, 165, 380, 80), new("telao", 605, 40), new("luminaria", 410, 60), new("luminaria", 800, 60)]);
            reun.Spots = [.. Seats(415, 795, 5, 112), .. Seats(415, 795, 5, 232)]; reun.Sit = [.. Enumerable.Range(0, 10)];
            var aprov = R("Aprovações", 890, 1170, true); aprov.Board = true; aprov.Furniture.AddRange([new("tapete", 1030, 225, 180, 90, "#14532D"), new("painel", 1030, 45), new("mesa", 1030, 190, 120, 50), new("planta", 1140, 280)]);
            aprov.Spots = [new(975, 260), new(1085, 260)];
            var sec = R("Secretaria", 30, 330, false); sec.Furniture.AddRange([new("mesa", 180, 540, 150, 50), new("arquivo", 60, 470), new("arquivo", 300, 470), new("arte", 180, 428, 0, 0, "#60A5FA")]); sec.Spots = [new(180, 600)];
            var lounge = R("Lounge", 330, 640, false); lounge.Idle = true; lounge.Furniture.AddRange([new("tapete", 485, 560, 230, 90, "#4C1D95"), new("sofa", 485, 520, 200), new("cafe", 600, 660), new("planta", 360, 660), new("arte", 390, 428, 0, 0, "#FB923C")]);
            lounge.Spots = [new(425, 545), new(485, 545), new(545, 545)]; lounge.Sit = [0, 1, 2];
            var arq = R("Arquivo", 640, 940, false); arq.Furniture.AddRange([new("estante", 690, 470), new("estante", 790, 470), new("estante", 890, 470)]); arq.Spots = [new(790, 600)];
            f.Rooms = [chefe, reun, aprov, sec, lounge, arq, stairs];
        }
        else
        {
            f.Name = $"{n}º andar · Time";
            string[] rug = ["#1E3A8A", "#14532D", "#7C2D12", "#4C1D95"], art = ["#F472B6", "#22D3EE", "#FACC15", "#A3E635"];
            for (var i = 0; i < 4; i++)
            {
                var (a, b) = Top[i];
                var r = R($"Sala {n}{(char)('A' + i)}", a, b, true); r.Office = true;
                r.Desks = Seats(a, b, 2, 120);
                r.Furniture.Add(new("tapete", (a + b) / 2, 205, b - a - 70, 70, rug[i]));
                foreach (var d in r.Desks) r.Furniture.Add(new("mesaPc", d.X, d.Y + 12));
                r.Furniture.AddRange([new("planta", b - 25, 55), new("arte", a + 34, 40, 0, 0, art[i]), new("quadroTarefas", (a + b) / 2, 44)]);
                r.Spots = [new((a + b) / 2, 260)];
                f.Rooms.Add(r);
            }
            var copa = R($"Copa {n}", 30, 330, false); copa.Idle = true; copa.Furniture.AddRange([new("tapete", 190, 545, 170, 100, "#78350F"), new("cafe", 70, 660), new("mesa", 190, 540, 120, 55), new("geladeira", 300, 650), new("vending", 240, 655)]);
            copa.Spots = [new(150, 530), new(230, 530), new(75, 615)];
            var foco = R("Sala de foco", 330, 640, false); foco.Furniture.AddRange([new("mesaPc", 420, 542), new("mesaPc", 550, 542), new("quadroBranco", 485, 428), new("luminaria", 370, 640), new("luminaria", 600, 640)]);
            foco.Spots = [new(420, 530), new(550, 530)]; foco.Sit = [0, 1];
            var imp = R("Impressora", 640, 940, false); imp.Furniture.AddRange([new("impressora", 700, 470), new("arquivo", 900, 470), new("planta", 670, 665)]); imp.Spots = [new(700, 530)];
            f.Rooms.AddRange([copa, foco, imp, stairs]);
        }
        return f;
    }

    static Room? RoomAt(Floor f, double x, double y) => f.Rooms.FirstOrDefault(r => r.Contains(x, y));
    static Point CorridorAt(double x, double lane) => new(x, (CorrY0 + CorrY1) / 2 + lane);

    /// <summary>Caminho pela porta, pelo corredor e, se mudar de andar, pela escada.</summary>
    List<Way> Route(Way from, Way to, double lane)
    {
        var pts = new List<Way>();
        if (from.Floor >= floors.Count || to.Floor >= floors.Count) return [to];
        Floor fa = floors[from.Floor], fb = floors[to.Floor];
        var ra = RoomAt(fa, from.X, from.Y); var rb = RoomAt(fb, to.X, to.Y);
        Way W(int fl, Point p) => new(fl, p.X, p.Y);
        if (!(from.Floor == to.Floor && ra is not null && ra == rb))
        {
            if (ra is not null) { pts.Add(W(from.Floor, ra.Inside)); pts.Add(W(from.Floor, CorridorAt(ra.Door.X, lane))); }
            if (from.Floor != to.Floor)
            {
                var sa = fa.Rooms.First(r => r.Stairs); var sb = fb.Rooms.First(r => r.Stairs);
                pts.Add(W(from.Floor, CorridorAt(sa.Door.X, lane))); pts.Add(W(from.Floor, sa.Inside)); pts.Add(new(from.Floor, (sa.X0 + sa.X1) / 2, 600));
                pts.Add(new(to.Floor, (sb.X0 + sb.X1) / 2, 600)); pts.Add(W(to.Floor, sb.Inside)); pts.Add(W(to.Floor, CorridorAt(sb.Door.X, lane)));
            }
            if (rb is not null) { pts.Add(W(to.Floor, CorridorAt(rb.Door.X, lane))); pts.Add(W(to.Floor, rb.Inside)); }
        }
        pts.Add(to);
        return pts;
    }

    // ---------- estado ----------
    List<Floor> floors = [MakeFloor("terreo", 0), MakeFloor("diretoria", 1), MakeFloor("time", 2)];
    readonly Dictionary<string, Person> people = [];
    readonly List<Bit> confetti = [];
    readonly Person pet = new() { Id = "AgentC", X = 600, Y = 360, Face = 1 };
    readonly Random rnd = new();
    readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromMilliseconds(33) };
    readonly DateTime started = DateTime.Now;
    double last, petRest;
    int salt, pending;
    bool inCall;
    IReadOnlyList<string> callWho = [];
    string lastChatKey = "";
    public int ViewFloor { get; private set; } = 2;
    public string? Selected { get; private set; }
    /// <summary>Andares e quantos bonequinhos tem em cada um (para as abas em cima).</summary>
    public IReadOnlyList<(string Name, int Count)> FloorInfo => floors.Select((f, i) => (f.Name, people.Values.Count(p => p.Floor == i))).ToList();
    public event Action? FloorsChanged;
    /// <summary>Clique duplo num agente: a tela completa abre Comandos já com ele como destino.</summary>
    public event Action<string>? OrderRequested;

    public PredioView()
    {
        ClipToBounds = true; Focusable = true;
        timer.Tick += (_, _) => Tick();
        AttachedToVisualTree += (_, _) => { last = Now; timer.Start(); };
        DetachedFromVisualTree += (_, _) => timer.Stop();
        Ensure("VOCÊ", true);
    }

    double Now => (DateTime.Now - started).TotalSeconds;

    public void GoFloor(int i) { ViewFloor = Math.Clamp(i, 0, floors.Count - 1); FloorsChanged?.Invoke(); InvalidateVisual(); }
    public void Reroll() { salt++; foreach (var p in people.Values) p.Look = LookFor(p.Id, p.IsBoss, salt); }

    Person Ensure(string id, bool boss = false)
    {
        if (people.TryGetValue(id, out var p)) return p;
        var s = floors[0].Rooms.First(r => r.Stairs);
        p = new Person { Id = id, IsBoss = boss, Look = LookFor(id, boss, salt), X = (s.X0 + s.X1) / 2, Y = 600, Phase = rnd.NextDouble() * 6, Lane = (rnd.NextDouble() - .5) * 30, WanderAt = Now + 20 + rnd.NextDouble() * 40, ChatAt = Now + 10 };
        people[id] = p;
        return p;
    }

    void GoTo(Person p, Way t)
    {
        if (p.Target is { } o && o.Floor == t.Floor && Math.Abs(o.X - t.X) < 2 && Math.Abs(o.Y - t.Y) < 2) return;
        p.Target = t; p.Path = Route(new(p.Floor, p.X, p.Y), t, p.Lane); p.Sitting = false;
    }

    Way DeskOf(int index)
    {
        var fi = 2 + index / PerFloor; var slot = index % PerFloor;
        var r = floors[fi].Rooms[slot / 2];
        var d = r.Desks[slot % 2];
        return new(fi, d.X, d.Y);
    }

    Way? SpotIn(int floor, Func<Room, bool> filter, string id, HashSet<string> taken)
    {
        var all = floors[floor].Rooms.Where(filter).SelectMany(r => r.Spots.Select(s => new Way(floor, s.X, s.Y))).ToList();
        if (all.Count == 0) return null;
        var start = (int)(Seed(id) % (uint)all.Count);
        for (var i = 0; i < all.Count; i++) { var s = all[(start + i) % all.Count]; if (taken.Add($"{s.Floor}:{s.X}:{s.Y}")) return s; }
        return all[start];
    }

    /// <summary>Dados novos do servidor: cria/atualiza os bonequinhos e manda cada um para o lugar certo.</summary>
    public void Update(HudSnapshot s)
    {
        var ids = s.Agents.Select(a => a.Id).ToHashSet();
        foreach (var id in people.Keys.Where(k => k != "VOCÊ" && !ids.Contains(k)).ToList()) people.Remove(id);
        var need = 2 + Math.Max(1, (int)Math.Ceiling(s.Agents.Count / (double)PerFloor));
        if (floors.Count != need)
        {
            floors = [MakeFloor("terreo", 0), MakeFloor("diretoria", 1)];
            for (var n = 2; n < need; n++) floors.Add(MakeFloor("time", n));
            ViewFloor = Math.Min(ViewFloor, floors.Count - 1);
            foreach (var p in people.Values.Where(p => p.Floor >= floors.Count)) { p.Floor = 0; p.Path.Clear(); }
        }
        pending = s.Pending; inCall = s.CallActive; callWho = s.CallWho;
        var dir = floors[1];
        var reun = dir.Rooms.First(r => r.Meeting); var chefe = dir.Rooms.First(r => r.Queue);
        var boss = Ensure("VOCÊ", true);
        boss.Mood = "chefe";
        GoTo(boss, inCall ? new(1, 380, 170) : new(1, 175, 92));
        var taken = new HashSet<string>();
        int i = 0, ci = 0, qi = 0;
        foreach (var a in s.Agents)
        {
            var p = Ensure(a.Id); var idx = i++;
            p.Task = a.Task;
            s.Reports.TryGetValue(a.Id, out var rep);
            p.Status = string.IsNullOrEmpty(rep.Status) ? a.Status : rep.Status;
            var before = p.Mood;
            p.Mood = inCall && callWho.Contains(a.Id, StringComparer.OrdinalIgnoreCase) ? "chamada" : MoodOf(rep.Status, a.Status, rep.Ts);
            if (before != "terminou" && p.Mood == "terminou" && p.Target is not null) p.Party = true;
            switch (p.Mood)
            {
                case "chamada": { var sp = reun.Spots[ci++ % reun.Spots.Count]; GoTo(p, new(1, sp.X, sp.Y)); break; }
                case "trabalhando" or "revisando": GoTo(p, DeskOf(idx)); break;
                case "travado": { var sp = chefe.Spots[qi++ % chefe.Spots.Count]; GoTo(p, new(1, sp.X, sp.Y)); break; }
                case "terminou": GoTo(p, SpotIn(0, r => r.Name is "Copa" or "Jogos", p.Id, taken) ?? DeskOf(idx)); break;
                default: GoTo(p, SpotIn(0, r => r.Sleep || r.Green, p.Id, taken) ?? DeskOf(idx)); break;
            }
        }
        // falas novas da sala viram balão em cima de quem falou
        if (s.Chat.Count > 0)
        {
            var c = s.Chat[0]; var key = c.Ts + c.Agent + c.Text.Length;
            if (key != lastChatKey && lastChatKey != "")
            {
                var who = c.Agent is "USUARIO" or "DONO" ? "VOCÊ" : c.Agent;
                if (people.TryGetValue(who, out var p)) p.Bubble = (Trim(c.Text, 80), Now + 7);
            }
            lastChatKey = key;
        }
        FloorsChanged?.Invoke();
    }

    static string Trim(string s, int n) { s = System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ").Trim(); return s.Length > n ? s[..n] + "…" : s; }

    // ---------- movimento ----------
    void Tick()
    {
        var now = Now; var dt = Math.Min(.1, now - last); last = now;
        Wander(now);
        foreach (var p in people.Values) Step(p, dt, now);
        StepPet(dt, now);
        for (var i = confetti.Count - 1; i >= 0; i--) { var c = confetti[i]; c.Life -= dt; c.Vy += 260 * dt; c.X += c.Vx * dt; c.Y += c.Vy * dt; c.R += dt * 8; if (c.Life <= 0) confetti.RemoveAt(i); }
        InvalidateVisual();
    }

    void Wander(double now)
    {
        var boss = people["VOCÊ"];
        if (pending > 0 && boss.Path.Count == 0 && !inCall && now > boss.WanderAt)
        {
            boss.WanderAt = now + 45 + rnd.NextDouble() * 30;
            boss.Back = new(1, 175, 92);
            GoTo(boss, new(1, 975, 260));
            boss.Bubble = ($"{pending} aprovação(ões) esperando…", now + 4);
        }
        var idle = people.Values.Where(q => !q.IsBoss && q.Path.Count == 0 && !q.Typing && now > q.ChatAt && (q.Bubble is null || q.Bubble.Value.Until < now)).ToList();
        for (var a = 0; a < idle.Count; a++)
            for (var b = a + 1; b < idle.Count; b++)
            {
                var x = idle[a]; var y = idle[b];
                if (x.Floor != y.Floor || Math.Abs(x.X - y.X) + Math.Abs(x.Y - y.Y) > 130 || rnd.NextDouble() > .02) continue;
                var (q, r) = Chatter[rnd.Next(Chatter.Length)];
                x.Bubble = (q, now + 3); y.Bubble = (r, now + 5); x.Face = y.X > x.X ? 1 : -1; y.Face = -x.Face;
                x.ChatAt = y.ChatAt = now + 40 + rnd.NextDouble() * 40;
            }
        var idx = 0;
        foreach (var p in people.Values.Where(p => !p.IsBoss))
        {
            var i = idx++;
            if (p.Path.Count > 0 || now < p.WanderAt || p.Mood is "chamada" or "travado") continue;
            p.WanderAt = now + 25 + rnd.NextDouble() * 50;
            if (p.Mood is "trabalhando" or "revisando" && p.Floor >= 2 && rnd.NextDouble() < .25)
            {
                var copa = floors[p.Floor].Rooms.First(r => r.Idle);
                var sp = copa.Spots[rnd.Next(copa.Spots.Count)];
                p.Back = p.Target; GoTo(p, new(p.Floor, sp.X, sp.Y));
            }
            else if (p.Mood == "terminou" || (p.Mood == "parado" && rnd.NextDouble() < .3))
            {
                var rooms = floors[0].Rooms.Where(r => r.Idle).ToList(); var r = rooms[rnd.Next(rooms.Count)];
                var sp = r.Spots[rnd.Next(r.Spots.Count)];
                GoTo(p, new(0, sp.X, sp.Y));
            }
        }
    }

    void Step(Person p, double dt, double now)
    {
        if (p.Celebrate > 0) p.Celebrate -= dt;
        if (p.Path.Count == 0)
        {
            p.Moving = false;
            if (p.Back is { } b && now > p.BackAt && p.BackAt > 0) { p.Back = null; p.BackAt = 0; GoTo(p, b); return; }
            if (p.Back is not null && p.BackAt == 0) p.BackAt = now + 6 + rnd.NextDouble() * 6;
            var r = RoomAt(floors[p.Floor], p.X, p.Y);
            p.Sitting = r is not null && (r.Desks.Any(d => Math.Abs(d.X - p.X) < 3 && Math.Abs(d.Y - p.Y) < 3) || r.Sit.Any(si => si < r.Spots.Count && Math.Abs(r.Spots[si].X - p.X) < 3 && Math.Abs(r.Spots[si].Y - p.Y) < 3));
            p.Typing = p.Sitting && p.Mood is "trabalhando" or "revisando" && p.Back is null;
            if (p.Mood == "travado") p.Face = -1;
            return;
        }
        var n = p.Path[0];
        if (n.Floor != p.Floor) { p.Floor = n.Floor; p.X = n.X; p.Y = n.Y; p.Path.RemoveAt(0); FloorsChanged?.Invoke(); return; }
        double dx = n.X - p.X, dy = n.Y - p.Y, d = Math.Sqrt(dx * dx + dy * dy), v = Speed * (p.IsBoss ? .85 : 1) * dt;
        p.Moving = true; if (Math.Abs(dx) > .5) p.Face = dx < 0 ? -1 : 1;
        if (d <= v)
        {
            p.X = n.X; p.Y = n.Y; p.Path.RemoveAt(0);
            if (p.Path.Count == 0 && p.Mood == "terminou") { p.Celebrate = 1.6; if (p.Party) { p.Party = false; Burst(p.Floor, p.X, p.Y - 30); } }
        }
        else { p.X += dx / d * v; p.Y += dy / d * v; }
    }

    void Burst(int floor, double x, double y)
    {
        Color[] c = Cols("#F97316", "#FACC15", "#22C55E", "#38BDF8", "#F472B6", "#A855F7");
        for (var i = 0; i < 36; i++) confetti.Add(new Bit { Floor = floor, X = x, Y = y, Vx = (rnd.NextDouble() - .5) * 160, Vy = -60 - rnd.NextDouble() * 140, Life = 1.6 + rnd.NextDouble(), C = c[i % 6], R = rnd.NextDouble() * 6 });
    }

    void StepPet(double dt, double now)
    {
        if (pet.Path.Count == 0)
        {
            pet.Moving = false;
            if (now < petRest) return;
            petRest = now + 2.5 + rnd.NextDouble() * 6;
            var floor = rnd.NextDouble() < .15 ? rnd.Next(floors.Count) : pet.Floor;
            var rooms = floors[floor].Rooms.Where(r => !r.Stairs).ToList(); var r = rooms[rnd.Next(rooms.Count)];
            var t = rnd.NextDouble() < .3 ? CorridorAt(80 + rnd.NextDouble() * 840, (rnd.NextDouble() - .5) * 50) : new Point(r.X0 + 30 + rnd.NextDouble() * (r.X1 - r.X0 - 60), r.Y0 + 60 + rnd.NextDouble() * (r.Y1 - r.Y0 - 100));
            pet.Path = Route(new(pet.Floor, pet.X, pet.Y), new(floor, t.X, t.Y), 12);
            return;
        }
        var n = pet.Path[0];
        if (n.Floor != pet.Floor) { pet.Floor = n.Floor; pet.X = n.X; pet.Y = n.Y; pet.Path.RemoveAt(0); return; }
        double dx = n.X - pet.X, dy = n.Y - pet.Y, d = Math.Sqrt(dx * dx + dy * dy), v = 70 * dt;
        pet.Moving = true; if (Math.Abs(dx) > .5) pet.Face = dx < 0 ? -1 : 1;
        if (d <= v) { pet.X = n.X; pet.Y = n.Y; pet.Path.RemoveAt(0); } else { pet.X += dx / d * v; pet.Y += dy / d * v; }
    }

    // ---------- clique ----------
    (double S, double Ox, double Oy) Fit() { var s = Math.Min(Bounds.Width / W, Bounds.Height / H); return (s, (Bounds.Width - W * s) / 2, (Bounds.Height - H * s) / 2); }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        var (s, ox, oy) = Fit(); var pt = e.GetPosition(this);
        double x = (pt.X - ox) / s, y = (pt.Y - oy) / s;
        var hit = people.Values.Where(p => p.Floor == ViewFloor).OrderBy(p => Math.Abs(p.X - x) + Math.Abs(p.Y - 25 - y)).FirstOrDefault(p => Math.Abs(p.X - x) < 18 && Math.Abs(p.Y - 25 - y) < 34);
        if (hit is not null)
        {
            if (e.ClickCount >= 2 && !hit.IsBoss) { OrderRequested?.Invoke(hit.Id); return; }
            Selected = hit.Id; InvalidateVisual(); return;
        }
        if (pet.Floor == ViewFloor && Math.Abs(pet.X - x) < 18 && Math.Abs(pet.Y - 10 - y) < 20)
        {
            string[] f = ["Oi! Eu sou o AgentC 🤖", "Cuido do time pra você.", "Psiu: tem café na copa ☕", "Me faz cócegas não! 😆"];
            pet.Bubble = (f[rnd.Next(f.Length)], Now + 3.5); petRest = Now + 3.5; pet.Path.Clear(); return;
        }
        if (x > 940 && y > CorrY1) { GoFloor(y < 560 ? ViewFloor + 1 : ViewFloor - 1); return; }
        Selected = null;
    }

    // ---------- desenho ----------
    static readonly Dictionary<string, IBrush> brushes = [];
    static IBrush B(string hex) { if (!brushes.TryGetValue(hex, out var b)) brushes[hex] = b = new SolidColorBrush(K.C(hex)); return b; }
    static IBrush B(Color c) => new SolidColorBrush(c);
    static readonly Typeface Bold = new(K.Ui, FontStyle.Normal, FontWeight.Bold), Semi = new(K.Ui, FontStyle.Normal, FontWeight.SemiBold);

    static void Text(DrawingContext g, string s, double x, double y, double size, IBrush brush, bool bold = true, double align = .5)
    {
        var ft = new FormattedText(s, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, bold ? Bold : Semi, size, brush);
        g.DrawText(ft, new Point(x - ft.Width * align, y - ft.Height / 2));
    }
    static void Box(DrawingContext g, double x, double y, double w, double h, IBrush fill, double r = 4, IPen? pen = null) => g.DrawRectangle(fill, pen, new Rect(x - w / 2, y - h / 2, w, h), r, r);
    static void Dot(DrawingContext g, double x, double y, double r, IBrush fill) => g.DrawEllipse(fill, null, new Point(x, y), r, r);

    public override void Render(DrawingContext g)
    {
        var (s, ox, oy) = Fit();
        if (s <= 0) return;
        var t = Now;
        var hour = DateTime.Now.Hour; var night = hour >= 19 || hour < 6;
        var f = floors[ViewFloor];
        g.DrawRectangle(B("#0B0B0C"), null, new Rect(Bounds.Size));
        using (g.PushTransform(Matrix.CreateScale(s, s) * Matrix.CreateTranslation(ox, oy)))
        {
            DrawRooms(g, f, night);
            // móveis + pessoas, de cima para baixo (quem está atrás da mesa fica atrás dela)
            var items = new List<(double Y, Action Draw)>();
            foreach (var r in f.Rooms) foreach (var fu in r.Furniture.Where(x => x.T is not ("tapete" or "arte"))) { var fu2 = fu; items.Add((fu.Y + (fu.T.StartsWith("mesa") ? 14 : 0), () => DrawFurn(g, fu2, t, night))); }
            foreach (var p in people.Values.Where(p => p.Floor == ViewFloor)) { var p2 = p; items.Add((p.Y, () => DrawPerson(g, p2, t))); }
            if (pet.Floor == ViewFloor) items.Add((pet.Y, () => DrawPet(g, t)));
            foreach (var it in items.OrderBy(i => i.Y)) it.Draw();
            Overlays(g, f, t);
            foreach (var c in confetti.Where(c => c.Floor == ViewFloor))
                using (g.PushTransform(Matrix.CreateRotation(c.R) * Matrix.CreateTranslation(c.X, c.Y)))
                using (g.PushOpacity(Math.Min(1, c.Life))) g.DrawRectangle(B(c.C), null, new Rect(-3, -1.5, 6, 3));
            Tags(g, t);
            if (night) g.DrawRectangle(new SolidColorBrush(Color.FromArgb(46, 10, 15, 40)), null, new Rect(0, 0, W, H));
        }
        if (Selected is { } sel && people.TryGetValue(sel, out var ps)) Card(g, ps);
    }

    void DrawRooms(DrawingContext g, Floor f, bool night)
    {
        g.DrawRectangle(B("#17171A"), null, new Rect(30, 30, 1140, 660));
        g.DrawRectangle(B("#1F1F23"), null, new Rect(30, CorrY0, 1140, CorrY1 - CorrY0));
        var faint = new Pen(new SolidColorBrush(Color.FromArgb(10, 255, 255, 255)), 1);
        for (double x = 60; x < 1170; x += 60) g.DrawLine(faint, new Point(x, CorrY0 + 8), new Point(x, CorrY1 - 8));
        foreach (var r in f.Rooms)
        {
            g.DrawRectangle(B(r.Green ? "#132A1A" : r.Stairs ? "#141416" : r.Boss ? "#1E1914" : r.Meeting ? "#16151F" : "#151518"), null, new Rect(r.X0 + 3, r.Y0 + 3, r.X1 - r.X0 - 6, r.Y1 - r.Y0 - 6));
            for (var y = r.Y0 + 24; y < r.Y1; y += 24) g.DrawLine(faint, new Point(r.X0 + 4, y), new Point(r.X1 - 4, y));
            if (r.Stairs)
            {
                for (var y = r.Y0 + 40; y < r.Y1 - 10; y += 22) g.DrawRectangle(B("#26262B"), null, new Rect(r.X0 + 30, y, r.X1 - r.X0 - 60, 12));
                if (ViewFloor < floors.Count - 1) Text(g, "▲ sobe", (r.X0 + r.X1) / 2, r.Y1 - 46, 12, B("#A1A1AA"));
                if (ViewFloor > 0) Text(g, "▼ desce", (r.X0 + r.X1) / 2, r.Y1 - 30, 12, B("#A1A1AA"));
            }
            foreach (var fu in r.Furniture)
            {
                if (fu.T == "tapete")
                {
                    var rect = new Rect(fu.X - fu.Wd / 2, fu.Y - fu.Ht / 2, fu.Wd, fu.Ht);
                    using (g.PushOpacity(.55)) g.DrawRectangle(B(fu.Col!), null, rect, 14, 14);
                    using (g.PushOpacity(.35)) g.DrawRectangle(null, new Pen(Brushes.White, 1.5, new DashStyle([3, 3], 0)), rect.Deflate(6), 10, 10);
                }
                else if (fu.T == "arte")
                {
                    g.DrawRectangle(B("#A16207"), null, new Rect(fu.X - 19, fu.Y - 11, 38, 22));
                    g.DrawRectangle(B(fu.Col!), null, new Rect(fu.X - 17, fu.Y - 9, 34, 18));
                    Dot(g, fu.X - 7, fu.Y - 2, 4, new SolidColorBrush(Color.FromArgb(140, 255, 255, 255)));
                }
            }
        }
        var wall = new Pen(B("#3F3F46"), 5, lineCap: PenLineCap.Square);
        g.DrawRectangle(null, wall, new Rect(30, 30, 1140, 660));
        foreach (var r in f.Rooms)
        {
            var yw = r.IsTop ? CorrY0 : CorrY1;
            g.DrawLine(wall, new Point(r.X0, yw), new Point(r.Door.X - 34, yw)); g.DrawLine(wall, new Point(r.Door.X + 34, yw), new Point(r.X1, yw));
            if (r.X0 > 30) g.DrawLine(wall, new Point(r.X0, r.Y0), new Point(r.X0, r.Y1));
        }
        var win = new SolidColorBrush(night ? Color.FromArgb(140, 250, 204, 21) : Color.FromArgb(180, 125, 211, 252));
        for (double x = 80; x < 1150; x += 140) { g.DrawRectangle(win, null, new Rect(x, 26, 70, 8)); g.DrawRectangle(win, null, new Rect(x, 686, 70, 8)); }
        foreach (var r in f.Rooms) Text(g, r.Name.ToUpperInvariant(), (r.X0 + r.X1) / 2, r.IsTop ? r.Y1 - 14 : r.Y1 - 16, 12.5, new SolidColorBrush(Color.FromArgb(97, 244, 244, 245)));
        Text(g, DateTime.Now.ToString("HH:mm"), 600, (CorrY0 + CorrY1) / 2, 22, new SolidColorBrush(Color.FromArgb(46, 244, 244, 245)));
    }

    void DrawFurn(DrawingContext g, Furn f, double t, bool night)
    {
        switch (f.T)
        {
            case "mesaPc": Box(g, f.X, f.Y, 84, 30, B("#8B5E3C")); Box(g, f.X, f.Y - 6, 30, 16, B("#18181B"), 2); Box(g, f.X, f.Y - 6, 26, 12, B(night ? "#60A5FA" : "#3B82F6"), 1); Box(g, f.X + 26, f.Y + 4, 10, 6, B("#D4D4D8"), 2); break;
            case "mesaChefe": Box(g, f.X, f.Y, 170, 46, B("#5B3A21"), 6); Box(g, f.X - 40, f.Y - 4, 34, 18, B("#18181B"), 2); Box(g, f.X - 40, f.Y - 4, 30, 14, B("#60A5FA"), 1); Box(g, f.X + 45, f.Y, 22, 14, B("#F4F4F5"), 2); Dot(g, f.X + 70, f.Y - 8, 5, B("#B91C1C")); break;
            case "mesa": Box(g, f.X, f.Y, f.Wd > 0 ? f.Wd : 120, f.Ht > 0 ? f.Ht : 60, B("#A16207"), 8); break;
            case "balcao": Box(g, f.X, f.Y, 200, 40, B("#7C2D12"), 8); Box(g, f.X, f.Y - 10, 200, 12, B("#F97316"), 4); break;
            case "cafe": Box(g, f.X, f.Y, 34, 30, B("#3F3F46")); Dot(g, f.X, f.Y - 2, 5, B("#78350F")); if (Math.Sin(t * 2) > 0) Dot(g, f.X + 6, f.Y - 22 - t * 10 % 8, 2.5, new SolidColorBrush(Color.FromArgb(90, 255, 255, 255))); break;
            case "geladeira": Box(g, f.X, f.Y, 38, 50, B("#E4E4E7"), 5, new Pen(B("#A1A1AA"))); break;
            case "sofa": Box(g, f.X, f.Y, f.Wd > 0 ? f.Wd : 180, 34, B("#7C3AED"), 10); Box(g, f.X, f.Y - 14, f.Wd > 0 ? f.Wd : 180, 12, B("#6D28D9"), 6); break;
            case "tv": Box(g, f.X, f.Y, 120, 14, B("#0A0A0A"), 3); Box(g, f.X, f.Y, 112, 8, B(night ? "#F97316" : "#1E3A8A"), 2); break;
            case "planta": Dot(g, f.X, f.Y + 6, 10, B("#78350F")); Dot(g, f.X - 6, f.Y - 4, 9, B("#16A34A")); Dot(g, f.X + 6, f.Y - 6, 9, B("#22C55E")); Dot(g, f.X, f.Y - 12, 8, B("#15803D")); break;
            case "arvore": Dot(g, f.X, f.Y, 34, B("#166534")); Dot(g, f.X - 12, f.Y - 10, 22, B("#15803D")); Dot(g, f.X + 14, f.Y + 6, 20, B("#22C55E")); break;
            case "banco": Box(g, f.X, f.Y, 110, 18, B("#92400E"), 5); break;
            case "flores": { string[] c = ["#F472B6", "#FACC15", "#F87171", "#C084FC", "#FB923C"]; for (var i = 0; i < 5; i++) Dot(g, f.X + Math.Cos(i * 1.3) * 12, f.Y + Math.Sin(i * 1.3) * 8, 3.5, B(c[i])); break; }
            case "pingpong": Box(g, f.X, f.Y, 150, 80, B("#15803D"), 6, new Pen(B("#F4F4F5"))); Box(g, f.X, f.Y, 3, 80, B("#F4F4F5"), 0); Dot(g, f.X + Math.Sin(t * 3) * 60, f.Y + Math.Cos(t * 5) * 20, 3.5, Brushes.White); break;
            case "fliperama": Box(g, f.X, f.Y, 40, 46, B("#1E1B4B"), 5); Box(g, f.X, f.Y - 6, 30, 20, new SolidColorBrush(HsvColor.FromHsv(t * 80 % 360, .7, .95).ToRgb()), 2); break;
            case "pia": Box(g, f.X, f.Y, 50, 26, B("#E4E4E7"), 6); Dot(g, f.X, f.Y, 6, B("#93C5FD")); break;
            case "cabine": Box(g, f.X, f.Y, 44, 90, B("#A1A1AA"), 3, new Pen(B("#71717A"))); break;
            case "estante": { Box(g, f.X, f.Y, 90, 26, B("#78350F"), 3); string[] c = ["#EF4444", "#3B82F6", "#EAB308", "#22C55E"]; for (var i = -3; i <= 3; i++) Box(g, f.X + i * 11, f.Y, 8, 18, B(c[(i + 3) % 4]), 1); break; }
            case "caixas": Box(g, f.X - 20, f.Y, 34, 30, B("#B45309"), 3); Box(g, f.X + 18, f.Y + 4, 30, 26, B("#D97706"), 3); break;
            case "arquivo": Box(g, f.X, f.Y, 44, 30, B("#52525B"), 3, new Pen(B("#3F3F46"))); break;
            case "quadro": Box(g, f.X, f.Y, 140, 14, B("#F4F4F5"), 2); break;
            case "quadroBranco": Box(g, f.X, f.Y, 150, 10, B("#F4F4F5"), 2); break;
            case "quadroTarefas": Box(g, f.X, f.Y, 140, 26, B("#F4F4F5"), 3, new Pen(B("#A1A1AA"))); break;
            case "telao": Box(g, f.X, f.Y, 260, 16, B("#0A0A0A"), 3); break;
            case "painel": Box(g, f.X, f.Y, 200, 18, B("#0A0A0A"), 3); break;
            case "impressora": Box(g, f.X, f.Y, 60, 36, B("#D4D4D8"), 5); Box(g, f.X, f.Y + 4, 40, 6, B("#F4F4F5"), 1); break;
            case "vending": { Box(g, f.X, f.Y, 40, 52, B("#B91C1C"), 5); Box(g, f.X - 5, f.Y - 4, 22, 34, B("#0F172A"), 2); string[] c = ["#FACC15", "#22C55E", "#38BDF8"]; for (var i = 0; i < 3; i++) Box(g, f.X - 5, f.Y - 14 + i * 10, 18, 4, B(c[i]), 1); break; }
            case "aquario": { Box(g, f.X, f.Y, 56, 34, B("#0C4A6E"), 5, new Pen(B("#38BDF8"))); string[] c = ["#F97316", "#FACC15", "#F472B6"]; for (var i = 0; i < 3; i++) Dot(g, f.X - 18 + (t * (8 + i * 5) + i * 17) % 36, f.Y - 6 + i * 6, 2.6, B(c[i])); break; }
            case "luminaria":
                Dot(g, f.X, f.Y + 8, 7, B("#3F3F46")); Box(g, f.X, f.Y - 6, 3, 26, B("#52525B"), 1);
                if (night) g.DrawEllipse(new RadialGradientBrush { GradientStops = { new GradientStop(Color.FromArgb(90, 253, 224, 71), 0), new GradientStop(Color.FromArgb(0, 253, 224, 71), 1) } }, null, new Point(f.X, f.Y - 18), 70, 70);
                Dot(g, f.X, f.Y - 18, 9, B(night ? "#FDE047" : "#FEF3C7")); break;
            case "trofeus": Box(g, f.X, f.Y, 34, 90, B("#78350F"), 3); for (var i = 0; i < 3; i++) { Dot(g, f.X, f.Y - 28 + i * 28, 7, B("#FACC15")); Box(g, f.X, f.Y - 20 + i * 28, 8, 5, B("#CA8A04"), 1); } break;
            case "abobora": Dot(g, f.X, f.Y, 11, B("#EA580C")); Dot(g, f.X - 6, f.Y, 8, B("#F97316")); Dot(g, f.X + 6, f.Y, 8, B("#F97316")); Box(g, f.X, f.Y - 12, 3, 6, B("#166534"), 1); break;
            case "letreiro": { var on = !night || Math.Sin(t * 7) > -.92; Text(g, "AGENT CONTROL", f.X, f.Y + 4, 12, B(on ? "#FDBA74" : "#7C2D12")); break; }
        }
    }

    void DrawPerson(DrawingContext g, Person p, double t)
    {
        var L = p.Look;
        var walk = p.Moving ? Math.Sin(t * 12 + p.Phase) : 0;
        var bob = p.Moving ? Math.Abs(walk) * 1.6 : p.Celebrate > 0 ? Math.Abs(Math.Sin(t * 10)) * 10 : 0;
        var sit = !p.Moving && p.Sitting;
        var sleep = p.Mood == "parado" && sit;
        using var _ = g.PushTransform(Matrix.CreateScale(1.25, 1.25) * Matrix.CreateTranslation(p.X, p.Y));
        g.DrawEllipse(new SolidColorBrush(Color.FromArgb(70, 0, 0, 0)), null, new Point(0, 0), 11, 4);
        using var __ = g.PushTransform(Matrix.CreateTranslation(0, -bob - (sit ? 6 : 0)));
        double legY = -17, legH = sit ? 9 : 16;
        foreach (var side in new[] { -1, 1 })
        {
            var off = p.Moving ? walk * 3.5 * side * .4 : 0;
            g.DrawRectangle(B(L.Pants), null, new Rect(side * 4.5 - 3 + off, legY, 6, legH), 2, 2);
            var sx = side * 4.5 - 3.5 + off + (p.Face < 0 ? -1.5 : 1.5);
            g.DrawRectangle(B(L.Shoes), null, new Rect(sx, legY + legH - 2, 8, 4.5), 2, 2);
            g.DrawRectangle(Brushes.White, null, new Rect(sx, legY + legH + 1.6, 8, 1));
        }
        if (L.Boss)
        {
            g.DrawRectangle(B(L.Pants), null, new Rect(-9, -34, 18, 19), 4, 4);
            g.DrawGeometry(B(L.Shirt), null, Geo(new(-4, -34), new(4, -34), new(0, -24)));
            g.DrawGeometry(B(L.Cap), null, Geo(new(-1.6, -33), new(1.6, -33), new(2.4, -22), new(0, -19), new(-2.4, -22)));
        }
        else
        {
            g.DrawRectangle(B(L.Shirt), null, new Rect(-8.5, -34, 17, 18), 4, 4);
            g.DrawRectangle(new SolidColorBrush(Color.FromArgb(30, 0, 0, 0)), null, new Rect(-8.5, -19, 17, 3));
        }
        var arm = p.Moving ? walk * 5 : p.Typing ? Math.Sin(t * 22) * 1.5 : 0;
        var up = p.Celebrate > 0 ? -14 : 0;
        var armPen = new Pen(B(L.Boss ? L.Pants : L.Shirt), 4.2, lineCap: PenLineCap.Round);
        g.DrawLine(armPen, new Point(-9, -31), new Point(-11 - arm * .3, -21 + arm + up));
        g.DrawLine(armPen, new Point(9, -31), new Point(11 - arm * .3, -21 - arm + up));
        Dot(g, -11 - arm * .3, -20 + arm + up, 2.3, B(L.Skin)); Dot(g, 11 - arm * .3, -20 - arm + up, 2.3, B(L.Skin));
        Dot(g, 0, -43, 9, B(L.Skin));
        var hair = B(L.Hair);
        switch (L.Style)
        {
            case "careca": break;
            case "longo": g.DrawGeometry(hair, null, Cap(-45, 9.6)); g.DrawRectangle(hair, null, new Rect(-9.6, -45, 3.2, 12)); g.DrawRectangle(hair, null, new Rect(6.4, -45, 3.2, 12)); break;
            case "bone": g.DrawGeometry(B(L.Cap), null, Cap(-45, 9.4)); g.DrawRectangle(B(L.Cap), null, new Rect(p.Face < 0 ? -15 : 3, -46, 12, 3)); break;
            case "coque": g.DrawGeometry(hair, null, Cap(-45, 9.4)); Dot(g, 0, -55, 4.5, hair); break;
            case "topete": g.DrawGeometry(hair, null, Cap(-45, 9.4)); g.DrawEllipse(hair, null, new Point(p.Face * 3, -53), 6, 3.5); break;
            default: g.DrawGeometry(hair, null, Cap(-45, 9.4)); break;
        }
        var ink = B("#18181B");
        var blink = (t + p.Phase) % 4 < .12;
        if (sleep) { g.DrawRectangle(ink, null, new Rect(-5 + p.Face, -43, 3.5, 1.2)); g.DrawRectangle(ink, null, new Rect(1.5 + p.Face, -43, 3.5, 1.2)); }
        else if (!blink) { g.DrawRectangle(ink, null, new Rect(-4 + p.Face * 1.6, -45, 2, 3)); g.DrawRectangle(ink, null, new Rect(2 + p.Face * 1.6, -45, 2, 3)); }
        if (p.Mood == "travado") g.DrawRectangle(ink, null, new Rect(-2 + p.Face, -38.5, 4, 1.2));
        else g.DrawLine(new Pen(ink, 1), new Point(-2 + p.Face * 1.2, -39), new Point(2 + p.Face * 1.2, -39));
    }

    static StreamGeometry Geo(params Point[] pts)
    {
        var g = new StreamGeometry();
        using var c = g.Open();
        c.BeginFigure(pts[0], true); foreach (var p in pts.Skip(1)) c.LineTo(p); c.EndFigure(true);
        return g;
    }
    static StreamGeometry Cap(double cy, double r)
    {
        var g = new StreamGeometry();
        using var c = g.Open();
        c.BeginFigure(new Point(-r, cy), true); c.ArcTo(new Point(r, cy), new Size(r, r), 0, false, SweepDirection.Clockwise); c.EndFigure(true);
        return g;
    }

    void DrawPet(DrawingContext g, double t)
    {
        using var _ = g.PushTransform(Matrix.CreateScale(1.1, 1.1) * Matrix.CreateTranslation(pet.X, pet.Y - 4 - Math.Abs(Math.Sin(t * 6)) * (pet.Moving ? 3 : 1)));
        g.DrawEllipse(new SolidColorBrush(Color.FromArgb(70, 0, 0, 0)), null, new Point(0, 4), 9, 3);
        var hex = Geo(Enumerable.Range(0, 6).Select(i => { var a = Math.PI / 6 + i * Math.PI / 3; return new Point(Math.Cos(a) * 11, -10 + Math.Sin(a) * 11); }).ToArray());
        g.DrawGeometry(B("#141414"), new Pen(B("#F97316"), 2.6), hex);
        var eye = B("#F4F4F4");
        if (t % 3.5 < .12) { g.DrawRectangle(eye, null, new Rect(-5 + pet.Face, -10, 3.5, 1.2)); g.DrawRectangle(eye, null, new Rect(1.5 + pet.Face, -10, 3.5, 1.2)); }
        else { g.DrawRectangle(eye, null, new Rect(-4.5 + pet.Face, -14, 3, 7), 1.5, 1.5); g.DrawRectangle(eye, null, new Rect(1.5 + pet.Face, -14, 3, 7), 1.5, 1.5); }
    }

    void Overlays(DrawingContext g, Floor f, double t)
    {
        if (f.Kind == "diretoria")
        {
            Text(g, pending > 0 ? $"{pending} esperando você" : "nada pendente", 1030, 45, 12, B(pending > 0 ? "#F87171" : "#4ADE80"));
            Text(g, inCall ? "● chamada ao vivo" : "sala livre", 605, 40, 12, B(inCall ? "#FB923C" : "#71717A"));
            Text(g, $"{people.Values.Count(p => p.Mood == "terminou")} ✓ hoje", 60, 222, 10, B("#FACC15"));
        }
        if (f.Kind == "time")
            foreach (var r in f.Rooms.Where(r => r.Office))
            {
                var lines = people.Values.Where(q => q.Target is { } tg && tg.Floor == ViewFloor && r.Desks.Any(d => Math.Abs(d.X - tg.X) < 1 && Math.Abs(d.Y - tg.Y) < 1)).Select(q => Trim($"{q.Id}: {q.Task ?? "esperando ordem"}", 26)).Take(2).ToList();
                for (var i = 0; i < lines.Count; i++) Text(g, lines[i], (r.X0 + r.X1) / 2, 39 + i * 10, 8.5, B("#18181B"), false);
            }
    }

    void Tags(DrawingContext g, double t)
    {
        var now = Now;
        var placed = new List<(double X, double Y, double W)>();
        foreach (var p in people.Values.Where(p => p.Floor == ViewFloor).OrderBy(p => p.Y))
        {
            var name = p.IsBoss ? "VOCÊ · chefe" : K.Nice(p.Id).ToUpperInvariant();
            var ft = new FormattedText(name, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, Bold, 10.5, Brushes.White);
            var w = ft.Width + 18; var y = p.Y + 6;
            while (placed.Any(r => Math.Abs(r.X - p.X) < (r.W + w) / 2 + 2 && Math.Abs(r.Y - y) < 17)) y += 17;
            placed.Add((p.X, y, w));
            g.DrawRectangle(new SolidColorBrush(Selected == p.Id ? Color.FromArgb(242, 249, 115, 22) : Color.FromArgb(210, 9, 9, 11)), null, new Rect(p.X - w / 2, y, w, 16), 8, 8);
            Dot(g, p.X - w / 2 + 8, y + 8, 3, B(Moods.TryGetValue(p.Mood, out var m) ? m.Color : K.C("#71717A")));
            g.DrawText(ft, new Point(p.X - w / 2 + 13, y + 8 - ft.Height / 2));
            var hy = p.Y - 80;
            if (p.Bubble is { } bb && bb.Until > now) Bubble(g, p.X, hy, bb.Text, Color.FromArgb(246, 250, 250, 250));
            else
            {
                string? icon = p.Mood == "travado" ? (Math.Sin(t * 6) > -.3 ? "!" : null) : p.Mood == "parado" && p.Sitting ? new string('z', 1 + (int)(t * 1.5) % 3) : p.Typing ? new string('.', 1 + (int)(t * 3) % 3) : p.Celebrate > 0 ? "✓" : null;
                if (icon is not null) Text(g, icon, p.X + (icon.StartsWith('z') ? 10 : 0), hy + 10, 14, B(p.Mood == "travado" ? "#EF4444" : p.Celebrate > 0 ? "#22C55E" : "#A1A1AA"));
            }
        }
        if (pet.Floor == ViewFloor && pet.Bubble is { } pb && pb.Until > now) Bubble(g, pet.X, pet.Y - 52, pb.Text, Color.FromArgb(248, 253, 186, 116));
    }

    static void Bubble(DrawingContext g, double x, double y, string text, Color bg)
    {
        var ft = new FormattedText(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, Semi, 11, B("#18181B")) { MaxTextWidth = 200, MaxLineCount = 1, Trimming = TextTrimming.CharacterEllipsis };
        var w = Math.Min(220, ft.Width + 18); var bx = Math.Clamp(x - w / 2, 4, W - w - 4);
        g.DrawRectangle(new SolidColorBrush(bg), null, new Rect(bx, y - 22, w, 22), 10, 10);
        g.DrawGeometry(new SolidColorBrush(bg), null, Geo(new(x - 5, y), new(x + 5, y), new(x, y + 7)));
        g.DrawText(ft, new Point(bx + 9, y - 11 - ft.Height / 2));
    }

    void Card(DrawingContext g, Person p)
    {
        var w = 280.0; var x = Bounds.Width - w - 14; var y = 14.0;
        var lines = new List<(string K, string V)> { ("andar", floors[p.Floor].Name) };
        if (!p.IsBoss) { lines.Add(("estado", Moods.TryGetValue(p.Mood, out var m) ? m.Label : p.Mood)); if (!string.IsNullOrEmpty(p.Task)) lines.Add(("tarefa", Trim(p.Task!, 40))); if (!string.IsNullOrEmpty(p.Status)) lines.Add(("status", p.Status!)); }
        else lines.Add(("aprovações", pending > 0 ? $"{pending} esperando você" : "nenhuma"));
        var h = 46 + lines.Count * 20 + (p.IsBoss ? 0 : 22);
        g.DrawRectangle(B("#141416"), new Pen(B("#333333")), new Rect(x, y, w, h), 14, 14);
        Text(g, p.IsBoss ? "Você (chefe)" : K.Nice(p.Id), x + 16, y + 22, 14, Brushes.White, true, 0);
        for (var i = 0; i < lines.Count; i++)
        {
            Text(g, lines[i].K, x + 16, y + 48 + i * 20, 11.5, B("#A1A1AA"), false, 0);
            Text(g, lines[i].V, x + 96, y + 48 + i * 20, 11.5, B("#E4E4E7"), false, 0);
        }
        if (!p.IsBoss) Text(g, "clique duas vezes para mandar uma ordem", x + 16, y + h - 14, 10.5, B("#FDBA74"), false, 0);
    }
}
