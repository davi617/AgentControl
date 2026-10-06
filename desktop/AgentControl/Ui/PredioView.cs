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
/// camiseta, calça e tênis sorteados pelo nome. O AgentC passeia como mascote. Para trocar de andar todo mundo pega um
/// dos dois elevadores da sala do canto (chama, espera na marca, entra, sai no andar certo). Mesma lógica de public/predio.js.
/// </summary>
public sealed class PredioView : Control
{
    const double W = 1200, H = 720, CorrY0 = 310, CorrY1 = 410, Speed = 95;
    const int PerFloor = 8;
    static readonly (double A, double B)[] Top = [(30, 320), (320, 610), (610, 890), (890, 1170)];
    static readonly (double A, double B)[] Bottom = [(30, 330), (330, 640), (640, 940)];
    // elevador: dois na sala do canto, portas na parede do fundo; cabem 4 em cada cabine
    static readonly double[] CarX = [1060, 1132];
    const double DoorHalf = 30, DoorTop = 430, CabY = 503, BlockX0 = 1024, BlockX1 = 1168, BlockY0 = 408, BlockY1 = 506;
    static readonly (double X, double Y)[] Slots = [(-14, 0), (14, 0), (-4, -1), (6, -1)];
    static readonly Point[] WaitSpots = [new(1040, 552), new(1078, 556), new(1114, 552), new(1152, 556), new(1058, 592), new(1096, 596), new(1134, 592), new(1020, 600)];
    static readonly Point LobbyPass = new(995, 530);

    // ---------- modelo ----------
    sealed record Furn(string T, double X, double Y, double Wd = 0, double Ht = 0, string? Col = null);
    sealed class Room
    {
        public string Name = ""; public double X0, X1, Y0, Y1; public bool IsTop, Lobby, Idle, Sleep, Green, Boss, Meeting, Queue, Board, Office;
        public double? DoorX;
        public List<Furn> Furniture = []; public List<Point> Spots = []; public List<Point> Desks = []; public HashSet<int> Sit = [];
        public Point Door => new(DoorX ?? (X0 + X1) / 2, IsTop ? CorrY0 : CorrY1);
        public Point Inside => new(Door.X, IsTop ? Door.Y - 26 : Door.Y + 26);
        public bool Contains(double x, double y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1;
    }
    sealed class Floor { public string Kind = "", Name = ""; public List<Room> Rooms = []; }
    // chefe: Pants = paletó, Shirt = camisa, Cap = gravata
    sealed record Look(bool Boss, Color Skin, Color Hair, string Style, Color Shirt, Color Pants, Color Shoes, Color Cap, string Top, string Acc)
    {
        /// <summary>Personagem salvo de terno: paletó e gravata separados da calça e do boné.</summary>
        public Color? Jacket { get; init; }
        public Color? Tie { get; init; }
    }
    /// <summary>Ponto do caminho. Wait = marca de espera do elevador; Elevator = pedir o elevador para o andar To; Board = entrar nesta cabine.</summary>
    sealed record Way(int Floor, double X, double Y)
    {
        public bool Wait { get; init; }
        public bool Elevator { get; init; }
        public int To { get; init; } = -1;
        public Car? Board { get; init; }
    }
    sealed class Person
    {
        public string Id = ""; public bool IsBoss, IsPet; public Look Look = null!;
        public int Floor; public double X, Y; public List<Way> Path = []; public Way? Target, Back;
        public Car? InCar, BoardingCar; public Point? WaitSpot; public bool FaceUp;
        public bool Moving, Sitting, Typing; public int Face = 1; public double Phase, Lane, Celebrate, BackAt, WanderAt, ChatAt;
        public string Mood = "parado"; public string? Task, Status; public bool Party;
        public (string Text, double Until)? Bubble;
    }
    sealed class Bit { public int Floor; public double X, Y, Vx, Vy, Life, R; public Color C; }
    sealed class Rider { public Person O = null!; public int To; }
    sealed class Car { public int I; public double X, Pos, Door, Timer; public int Dir; public string State = "idle"; public HashSet<int> Stops = []; public List<Rider> Riders = []; public HashSet<string> Boarding = []; }

    /// <summary>
    /// Os dois elevadores, sem desenho (mesma simulação de createElevators no predio.js). Cada cabine: idle (parada,
    /// porta fechada) → opening → open → closing → idle, ou moving entre andares. Chamadas ficam em Calls até abrir ali.
    /// </summary>
    sealed class Lift
    {
        public const int Cap = 4;
        const double SpeedF = .75, DoorTime = .55, Hold = 1.6;
        public readonly List<Car> Cars;
        public readonly HashSet<int> Calls = [];
        int n;
        public Lift(int floors) { n = floors; Cars = CarX.Select((x, i) => new Car { I = i, X = x, Pos = Math.Min(i, floors - 1) }).ToList(); }
        static int At(Car c) => (int)Math.Round(c.Pos);
        static bool Near(double a, double b) => Math.Abs(a - b) < 1e-6;
        static bool Full(Car c) => c.Riders.Count + c.Boarding.Count >= Cap;
        static bool Covers(Car c, int f) => c.Stops.Contains(f) || (At(c) == f && Near(c.Pos, f) && c.State is not ("idle" or "moving") && !Full(c));
        public void SetFloors(int floors)
        {
            n = floors;
            foreach (var c in Cars) { if (c.Pos > n - 1) { c.Pos = n - 1; c.State = "idle"; c.Door = 0; } c.Stops.RemoveWhere(f => f >= n); }
            Calls.RemoveWhere(f => f >= n);
        }
        /// <summary>Alguém apertou o botão no andar f. Se a porta estiver fechando ali e ainda couber gente, ela abre de novo.</summary>
        public void Call(int f)
        {
            if (f < 0 || f >= n) return;
            Calls.Add(f);
            foreach (var c in Cars) if (c.State == "closing" && At(c) == f && Near(c.Pos, f) && !Full(c)) c.State = "opening";
        }
        public Car? OpenAt(int f) => Cars.FirstOrDefault(c => c.State == "open" && At(c) == f && Near(c.Pos, f) && !Full(c));
        public static int ArrivedAt(Car c) => c.State == "open" && Near(c.Pos, At(c)) ? At(c) : -1;
        public void Step(double dt)
        {
            foreach (var f in Calls.ToList())
            {
                if (Cars.Any(c => Covers(c, f))) continue;
                var free = Cars.Where(c => !Full(c)).ToList();
                var pick = free.Where(c => c.State == "idle" && c.Stops.Count == 0).OrderBy(c => Math.Abs(c.Pos - f)).FirstOrDefault()
                    ?? free.Where(c => c.State == "moving" && Math.Sign(f - c.Pos) == c.Dir).OrderBy(c => Math.Abs(c.Pos - f)).FirstOrDefault();
                pick?.Stops.Add(f);
            }
            foreach (var c in Cars)
            {
                switch (c.State)
                {
                    case "idle":
                    {
                        if (c.Stops.Count == 0) { c.Dir = 0; break; }
                        if (c.Stops.Contains(At(c))) { c.State = "opening"; break; }
                        var ahead = c.Dir != 0 ? c.Stops.Where(f => Math.Sign(f - c.Pos) == c.Dir).ToList() : [];
                        var pool = ahead.Count > 0 ? ahead : c.Stops.ToList();
                        var next = pool.OrderBy(f => Math.Abs(f - c.Pos)).First();
                        c.Dir = Math.Sign(next - c.Pos); c.State = "moving";
                        break;
                    }
                    case "moving":
                    {
                        var target = c.Dir > 0 ? Math.Floor(c.Pos + 1e-6) + 1 : Math.Ceiling(c.Pos - 1e-6) - 1;
                        c.Pos += c.Dir * SpeedF * dt;
                        if ((c.Dir > 0 && c.Pos >= target - 1e-6) || (c.Dir < 0 && c.Pos <= target + 1e-6) || target < 0 || target > n - 1)
                        {
                            var f = (int)Math.Clamp(target, 0, n - 1);
                            var claim = Calls.Contains(f) && !Full(c) && !Cars.Any(o => o != c && o.Stops.Contains(f));
                            if (c.Stops.Contains(f) || claim || f == 0 || f == n - 1) { c.Pos = f; c.State = c.Stops.Contains(f) || claim ? "opening" : "idle"; }
                        }
                        break;
                    }
                    case "opening":
                        c.Door = Math.Min(1, c.Door + dt / DoorTime);
                        if (c.Door >= 1) { c.State = "open"; c.Timer = Hold; c.Stops.Remove(At(c)); Calls.Remove(At(c)); }
                        break;
                    case "open":
                        c.Timer -= dt;
                        if (c.Boarding.Count > 0) c.Timer = Math.Max(c.Timer, .5);
                        if (c.Timer <= 0) c.State = "closing";
                        break;
                    case "closing":
                        c.Door = Math.Max(0, c.Door - dt / DoorTime);
                        if (c.Door <= 0) c.State = "idle";
                        break;
                }
            }
        }
    }

    static readonly Color[] SkinC = Cols("#F5D0B5", "#E8B894", "#D49A6A", "#B97A4F", "#8D5A3B", "#6B4026");
    static readonly Color[] HairC = Cols("#1F1A17", "#3B2A20", "#6B4423", "#A0522D", "#D6B370", "#E5E5E5", "#B45309", "#7C3AED");
    static readonly Color[] ShirtC = Cols("#EF4444", "#F97316", "#EAB308", "#22C55E", "#14B8A6", "#3B82F6", "#6366F1", "#A855F7", "#EC4899", "#F4F4F5", "#27272A", "#0EA5E9");
    static readonly Color[] PantsC = Cols("#1E3A8A", "#1E40AF", "#27272A", "#52525B", "#A16207", "#3F3F46", "#334155");
    static readonly Color[] ShoesC = Cols("#F4F4F5", "#EF4444", "#22C55E", "#3B82F6", "#111111", "#F97316", "#A855F7");
    static readonly string[] Styles = ["curto", "longo", "careca", "bone", "coque", "topete", "cacheado", "rabo"];
    static readonly string[] Tops = ["camiseta", "camiseta", "listrada", "moletom", "polo"];
    static readonly string[] Accs = ["nenhum", "nenhum", "nenhum", "nenhum", "nenhum", "oculos", "oculos", "fone", "barba", "barba"];
    static readonly (string Q, string R)[] Chatter = [("Bora um café?", "Bora! ☕"), ("Viu o deploy?", "Passou liso ✓"), ("Que bug chato…", "Te ajudo depois"), ("Bom trabalho hoje!", "Valeu! 🙌"), ("O chefe aprovou?", "Ainda não 😅"), ("Terminei a minha", "Boa! 🎉")];
    public static readonly Dictionary<string, (string Label, Color Color)> Moods = new()
    {
        ["trabalhando"] = ("trabalhando", K.C("#22C55E")), ["revisando"] = ("revisando", K.C("#F59E0B")), ["travado"] = ("travado", K.C("#EF4444")),
        ["terminou"] = ("terminou", K.C("#38BDF8")), ["parado"] = ("parado", K.C("#71717A")), ["chamada"] = ("na chamada", K.C("#F97316")), ["chefe"] = ("chefe (você)", K.C("#DC2626")),
    };

    static Color[] Cols(params string[] h) => h.Select(K.C).ToArray();

    // personagens salvos no servidor (feitos no editor da sala, com ou sem foto): id → cores e estilos
    Dictionary<string, Dictionary<string, string>> saved = [];
    Look LookOf(string id, bool boss) => saved.TryGetValue(id, out var c) && FromSaved(c) is { } l ? l : LookFor(id, boss, salt);
    static Look? FromSaved(Dictionary<string, string> c)
    {
        try
        {
            string S(string k) => c.TryGetValue(k, out var v) ? v : "";
            var top = S("top"); var terno = top == "terno";
            if (!Styles.Contains(S("style"))) return null;
            return new Look(terno, K.C(S("skin")), K.C(S("hair")), S("style"), terno ? K.C("#F4F4F5") : K.C(S("shirt")), K.C(S("pants")), K.C(S("shoes")), K.C(S("cap")), top, S("acc"))
            { Jacket = terno ? K.C(S("shirt")) : null, Tie = terno ? K.C("#DC2626") : null };
        }
        catch { return null; }
    }
    static uint Seed(string s) { uint h = 2166136261; foreach (var c in s) { h ^= c; h *= 16777619; } return h; }

    static Look LookFor(string name, bool boss, int salt)
    {
        var r = new Random((int)(Seed(name) + (uint)(salt * 7919)));
        T Pick<T>(T[] a) => a[r.Next(a.Length)];
        if (boss) return new Look(true, Pick(SkinC), Pick(HairC[..6]), Pick(new[] { "curto", "topete", "careca" }), K.C("#F4F4F5"), K.C("#1E293B"), K.C("#111111"), K.C("#DC2626"), "terno", "nenhum");
        return new Look(false, Pick(SkinC), Pick(HairC), Pick(Styles), Pick(ShirtC), Pick(PantsC), Pick(ShoesC), Pick(ShirtC), Pick(Tops), Pick(Accs));
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
        // sala dos elevadores (mesmo canto em todo andar): porta do corredor à esquerda, elevadores na parede do fundo
        var lobby = new Room { Name = "Elevadores", X0 = 940, X1 = 1170, Y0 = CorrY1, Y1 = 690, Lobby = true, DoorX = 985 };
        lobby.Furniture.AddRange([new("tapete", 1096, 574, 160, 74, "#334155"), new("banco", 1010, 660), new("planta", 1148, 660), new("planta", 962, 462)]);
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
            f.Rooms = [rec, copa, desc, jogos, jardim, banh, corr, lobby];
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
            f.Rooms = [chefe, reun, aprov, sec, lounge, arq, lobby];
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
            f.Rooms.AddRange([copa, foco, imp, lobby]);
        }
        return f;
    }

    static Room? RoomAt(Floor f, double x, double y) => f.Rooms.FirstOrDefault(r => r.Contains(x, y));
    static Point CorridorAt(double x, double lane) => new(x, (CorrY0 + CorrY1) / 2 + lane);

    // na sala do elevador dá a volta pela frente dos elevadores, sem passar por cima das portas
    static IEnumerable<Way> Leave(int f, Room r, double lane)
    {
        if (r.Lobby) yield return new(f, LobbyPass.X, LobbyPass.Y);
        yield return new(f, r.Inside.X, r.Inside.Y);
        yield return new(f, r.Door.X, CorridorAt(0, lane).Y);
    }
    static IEnumerable<Way> Enter(int f, Room r, double lane)
    {
        yield return new(f, r.Door.X, CorridorAt(0, lane).Y);
        yield return new(f, r.Inside.X, r.Inside.Y);
        if (r.Lobby) yield return new(f, LobbyPass.X, LobbyPass.Y);
    }

    /// <summary>
    /// Caminho pela porta e pelo corredor. Se mudar de andar, vai até a sala do elevador e termina numa marca de espera
    /// (Wait) e no pedido de elevador (Elevator); o resto é refeito quando sair da cabine no andar novo.
    /// </summary>
    List<Way> Route(Way from, Way to, double lane)
    {
        var pts = new List<Way>();
        if (from.Floor >= floors.Count || to.Floor >= floors.Count) return [new(to.Floor, to.X, to.Y)];
        Floor fa = floors[from.Floor], fb = floors[to.Floor];
        var ra = RoomAt(fa, from.X, from.Y); var rb = RoomAt(fb, to.X, to.Y);
        if (!(from.Floor == to.Floor && ra is not null && ra == rb))
        {
            if (from.Floor != to.Floor)
            {
                var la = fa.Rooms.First(r => r.Lobby);
                if (ra != la) { if (ra is not null) pts.AddRange(Leave(from.Floor, ra, lane)); pts.AddRange(Enter(from.Floor, la, lane)); }
                pts.Add(new(from.Floor, WaitSpots[0].X, WaitSpots[0].Y) { Wait = true });
                pts.Add(new(from.Floor, 0, 0) { Elevator = true, To = to.Floor });
                return pts;
            }
            if (ra is not null) pts.AddRange(Leave(from.Floor, ra, lane));
            if (rb is not null) pts.AddRange(Enter(to.Floor, rb, lane));
        }
        pts.Add(new(to.Floor, to.X, to.Y));
        return pts;
    }

    // ---------- estado ----------
    List<Floor> floors = [MakeFloor("terreo", 0), MakeFloor("diretoria", 1), MakeFloor("time", 2)];
    readonly Dictionary<string, Person> people = [];
    readonly List<Bit> confetti = [];
    readonly Person pet = new() { Id = "AgentC", IsPet = true, X = 600, Y = 360, Face = 1, Lane = 12 };
    Lift lift = new(3);
    readonly Dictionary<string, Person> waiting = []; // "andar:marca" → quem está ali
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
    public void Reroll() { salt++; foreach (var p in people.Values) p.Look = LookOf(p.Id, p.IsBoss); }

    Person Ensure(string id, bool boss = false)
    {
        if (people.TryGetValue(id, out var p)) return p;
        // todo mundo chega pela recepção do térreo
        p = new Person { Id = id, IsBoss = boss, Look = LookOf(id, boss), X = 120 + rnd.NextDouble() * 110, Y = 250, Phase = rnd.NextDouble() * 6, Lane = (rnd.NextDouble() - .5) * 30, WanderAt = Now + 20 + rnd.NextDouble() * 40, ChatAt = Now + 10 };
        people[id] = p;
        return p;
    }

    void GoTo(Person p, Way t)
    {
        if (p.Target is { } o && o.Floor == t.Floor && Math.Abs(o.X - t.X) < 2 && Math.Abs(o.Y - t.Y) < 2) return;
        p.Target = t; p.Sitting = false;
        // dentro da cabine: só troca o andar de saída; o caminho é refeito quando a porta abrir
        if (p.InCar is { } c) { var r = c.Riders.FirstOrDefault(x => x.O == p); if (r is not null) r.To = t.Floor; c.Stops.Add(t.Floor); p.Path.Clear(); return; }
        LeaveQueue(p);
        p.Path = Route(new(p.Floor, p.X, p.Y), t, p.Lane);
    }

    // ---------- elevador: marcas de espera, entrar e sair ----------
    void LeaveQueue(Person o)
    {
        if (o.BoardingCar is { } c) { c.Boarding.Remove(o.Id); o.BoardingCar = null; }
        foreach (var k in waiting.Where(kv => kv.Value == o).Select(kv => kv.Key).ToList()) waiting.Remove(k);
        o.WaitSpot = null;
    }

    Point WaitSpotFor(Person o)
    {
        for (var i = 0; i < WaitSpots.Length; i++)
        {
            var key = $"{o.Floor}:{i}";
            if (!waiting.TryGetValue(key, out var who) || who == o) { waiting[key] = o; return WaitSpots[i]; }
        }
        var w = WaitSpots[rnd.Next(WaitSpots.Length)];
        return new(w.X + (rnd.NextDouble() - .5) * 20, w.Y + 30);
    }

    /// <summary>Anda pelo caminho, incluindo o elevador. Devolve true quando chega no fim do caminho neste passo.</summary>
    bool Travel(Person o, double dt, double speed)
    {
        if (o.InCar is { } c)
        {
            var slot = c.Riders.FindIndex(r => r.O == o);
            if (slot < 0) { o.InCar = null; return false; }
            var f = (int)Math.Round(c.Pos);
            if (o.Floor != f) { o.Floor = f; if (!o.IsPet) FloorsChanged?.Invoke(); }
            var sl = Slots[slot % Slots.Length];
            o.X = c.X + sl.X; o.Y = CabY + sl.Y; o.Moving = false; o.FaceUp = false; o.Face = 1;
            var rd = c.Riders[slot];
            if (Lift.ArrivedAt(c) == rd.To && c.Door > .85)
            {
                c.Riders.RemoveAt(slot);
                o.InCar = null; o.Floor = rd.To; o.X = c.X + (slot % 2 == 1 ? 10 : -10);
                var outW = new Way(rd.To, o.X, 546);
                var path = new List<Way> { outW };
                if (o.Target is { } tg) path.AddRange(Route(outW, tg, o.Lane).Where(n => !(n.Floor == outW.Floor && Math.Abs(n.X - outW.X) < 1 && Math.Abs(n.Y - outW.Y) < 1)));
                o.Path = path;
                if (!o.IsPet) FloorsChanged?.Invoke();
            }
            return false;
        }
        if (o.Path.Count == 0) return false;
        var n = o.Path[0];
        if (n.Elevator)
        {
            o.Moving = false; o.FaceUp = true;
            if (n.To == o.Floor) { o.Path.RemoveAt(0); LeaveQueue(o); if (o.Target is { } tg) o.Path = Route(new(o.Floor, o.X, o.Y), tg, o.Lane); return false; }
            lift.Call(o.Floor);
            if (lift.OpenAt(o.Floor) is { } car)
            {
                LeaveQueue(o);
                o.BoardingCar = car; car.Boarding.Add(o.Id);
                var slot = car.Riders.Count + car.Boarding.Count - 1;
                o.Path.Insert(0, new Way(o.Floor, car.X + Slots[slot % Slots.Length].X, CabY) { Board = car });
            }
            return false;
        }
        if (n.Wait && o.WaitSpot is null) { var w = WaitSpotFor(o); o.WaitSpot = w; n = o.Path[0] = n with { X = w.X, Y = w.Y }; }
        if (n.Floor != o.Floor) { o.Floor = n.Floor; o.X = n.X; o.Y = n.Y; o.Path.RemoveAt(0); if (!o.IsPet) FloorsChanged?.Invoke(); return false; }
        double dx = n.X - o.X, dy = n.Y - o.Y, d = Math.Sqrt(dx * dx + dy * dy), v = speed * dt;
        o.Moving = true;
        if (Math.Abs(dx) > .5) o.Face = dx < 0 ? -1 : 1;
        o.FaceUp = dy < -Math.Abs(dx) * .9;
        if (d > v) { o.X += dx / d * v; o.Y += dy / d * v; return false; }
        o.X = n.X; o.Y = n.Y; o.Path.RemoveAt(0);
        if (n.Board is { } bc)
        {
            bc.Boarding.Remove(o.Id); o.BoardingCar = null;
            if (bc.State is "open" or "opening")
            {
                var e = o.Path.Count > 0 ? o.Path[0] : null;
                var to = e is { Elevator: true } ? e.To : o.Target?.Floor ?? o.Floor;
                if (e is { Elevator: true }) o.Path.RemoveAt(0);
                bc.Riders.Add(new Rider { O = o, To = to }); bc.Stops.Add(to); o.InCar = bc; o.Moving = false;
            }
            else o.Path.Insert(0, new Way(o.Floor, o.X, 546)); // a porta fechou na cara: volta para a marca e chama de novo
            return false;
        }
        return o.Path.Count == 0;
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
        if (!LooksEqual(saved, s.Looks)) { saved = s.Looks; foreach (var p in people.Values) p.Look = LookOf(p.Id, p.IsBoss); }
        foreach (var id in people.Keys.Where(k => k != "VOCÊ" && !ids.Contains(k)).ToList()) people.Remove(id);
        var need = 2 + Math.Max(1, (int)Math.Ceiling(s.Agents.Count / (double)PerFloor));
        if (floors.Count != need)
        {
            floors = [MakeFloor("terreo", 0), MakeFloor("diretoria", 1)];
            for (var n = 2; n < need; n++) floors.Add(MakeFloor("time", n));
            ViewFloor = Math.Min(ViewFloor, floors.Count - 1);
            lift.SetFloors(floors.Count);
            foreach (var c in lift.Cars) foreach (var r in c.Riders.Where(r => r.To >= floors.Count)) { r.To = floors.Count - 1; c.Stops.Add(r.To); }
            foreach (var p in people.Values.Where(p => p.Floor >= floors.Count && p.InCar is null)) { LeaveQueue(p); p.Floor = 0; p.X = 175; p.Y = 250; p.Path.Clear(); p.Target = null; }
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

    static bool LooksEqual(Dictionary<string, Dictionary<string, string>> a, Dictionary<string, Dictionary<string, string>> b) =>
        a.Count == b.Count && a.All(kv => b.TryGetValue(kv.Key, out var o) && o.Count == kv.Value.Count && kv.Value.All(f => o.TryGetValue(f.Key, out var v) && v == f.Value));

    static string Trim(string s, int n) { s = System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ").Trim(); return s.Length > n ? s[..n] + "…" : s; }

    // ---------- movimento ----------
    void Tick()
    {
        var now = Now; var dt = Math.Min(.1, now - last); last = now;
        Wander(now);
        lift.Step(dt);
        foreach (var p in people.Values) Step(p, dt, now);
        StepPet(dt, now);
        for (var i = confetti.Count - 1; i >= 0; i--) { var c = confetti[i]; c.Life -= dt; c.Vy += 260 * dt; c.X += c.Vx * dt; c.Y += c.Vy * dt; c.R += dt * 8; if (c.Life <= 0) confetti.RemoveAt(i); }
        InvalidateVisual();
    }

    void Wander(double now)
    {
        var boss = people["VOCÊ"];
        if (pending > 0 && boss.Path.Count == 0 && boss.InCar is null && !inCall && now > boss.WanderAt)
        {
            boss.WanderAt = now + 45 + rnd.NextDouble() * 30;
            boss.Back = new(1, 175, 92);
            GoTo(boss, new(1, 975, 260));
            boss.Bubble = ($"{pending} aprovação(ões) esperando…", now + 4);
        }
        var idle = people.Values.Where(q => !q.IsBoss && q.Path.Count == 0 && q.InCar is null && !q.Typing && now > q.ChatAt && (q.Bubble is null || q.Bubble.Value.Until < now)).ToList();
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
            if (p.Path.Count > 0 || p.InCar is not null || now < p.WanderAt || p.Mood is "chamada" or "travado") continue;
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
        if (p.Path.Count == 0 && p.InCar is null)
        {
            p.Moving = false; p.FaceUp = false;
            if (p.Back is { } b && now > p.BackAt && p.BackAt > 0) { p.Back = null; p.BackAt = 0; GoTo(p, b); return; }
            if (p.Back is not null && p.BackAt == 0) p.BackAt = now + 6 + rnd.NextDouble() * 6;
            var r = RoomAt(floors[p.Floor], p.X, p.Y);
            p.Sitting = r is not null && (r.Desks.Any(d => Math.Abs(d.X - p.X) < 3 && Math.Abs(d.Y - p.Y) < 3) || r.Sit.Any(si => si < r.Spots.Count && Math.Abs(r.Spots[si].X - p.X) < 3 && Math.Abs(r.Spots[si].Y - p.Y) < 3));
            p.Typing = p.Sitting && p.Mood is "trabalhando" or "revisando" && p.Back is null;
            if (p.Mood == "travado") p.Face = -1;
            return;
        }
        if (Travel(p, dt, Speed * (p.IsBoss ? .85 : 1)) && p.Mood == "terminou") { p.Celebrate = 1.6; if (p.Party) { p.Party = false; Burst(p.Floor, p.X, p.Y - 30); } }
    }

    void Burst(int floor, double x, double y)
    {
        Color[] c = Cols("#F97316", "#FACC15", "#22C55E", "#38BDF8", "#F472B6", "#A855F7");
        for (var i = 0; i < 36; i++) confetti.Add(new Bit { Floor = floor, X = x, Y = y, Vx = (rnd.NextDouble() - .5) * 160, Vy = -60 - rnd.NextDouble() * 140, Life = 1.6 + rnd.NextDouble(), C = c[i % 6], R = rnd.NextDouble() * 6 });
    }

    void StepPet(double dt, double now)
    {
        if (pet.Path.Count == 0 && pet.InCar is null)
        {
            pet.Moving = false; pet.FaceUp = false;
            if (now < petRest) return;
            petRest = now + 2.5 + rnd.NextDouble() * 6;
            var floor = rnd.NextDouble() < .15 ? rnd.Next(floors.Count) : pet.Floor;
            var rooms = floors[floor].Rooms.Where(r => !r.Lobby).ToList(); var r = rooms[rnd.Next(rooms.Count)];
            var t = rnd.NextDouble() < .3 ? CorridorAt(80 + rnd.NextDouble() * 840, (rnd.NextDouble() - .5) * 50) : new Point(r.X0 + 30 + rnd.NextDouble() * (r.X1 - r.X0 - 60), r.Y0 + 60 + rnd.NextDouble() * (r.Y1 - r.Y0 - 100));
            pet.Target = new(floor, t.X, t.Y);
            LeaveQueue(pet);
            pet.Path = Route(new(pet.Floor, pet.X, pet.Y), pet.Target, 12);
            return;
        }
        Travel(pet, dt, 70);
    }

    // ---------- clique ----------
    (double S, double Ox, double Oy) Fit() { var s = Math.Min(Bounds.Width / W, Bounds.Height / H); return (s, (Bounds.Width - W * s) / 2, (Bounds.Height - H * s) / 2); }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        var (s, ox, oy) = Fit(); var pt = e.GetPosition(this);
        double x = (pt.X - ox) / s, y = (pt.Y - oy) / s;
        var hit = people.Values.Where(Shown).OrderBy(p => Math.Abs(p.X - x) + Math.Abs(p.Y - 30 - y)).FirstOrDefault(p => Math.Abs(p.X - x) < 18 && Math.Abs(p.Y - 30 - y) < 38);
        if (hit is not null)
        {
            if (e.ClickCount >= 2 && !hit.IsBoss) { OrderRequested?.Invoke(hit.Id); return; }
            Selected = hit.Id; InvalidateVisual(); return;
        }
        if (Shown(pet) && Math.Abs(pet.X - x) < 18 && Math.Abs(pet.Y - 10 - y) < 20)
        {
            string[] f = ["Oi! Eu sou o AgentC 🤖", "Cuido do time pra você.", "Psiu: tem café na copa ☕", "Me faz cócegas não! 😆"];
            pet.Bubble = (f[rnd.Next(f.Length)], Now + 3.5); petRest = Now + 3.5;
            if (pet.InCar is null) { LeaveQueue(pet); pet.Path.Clear(); }
            return;
        }
        // tocar na sala do elevador sobe (perto das portas) ou desce (perto do banco)
        if (x > 940 && y > CorrY1) { GoFloor(y < 580 ? ViewFloor + 1 : ViewFloor - 1); return; }
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
            DrawElevators(g, t);
            // móveis + pessoas, de cima para baixo (quem está atrás da mesa fica atrás dela)
            var items = new List<(double Y, Action Draw)>();
            foreach (var r in f.Rooms) foreach (var fu in r.Furniture.Where(x => x.T is not ("tapete" or "arte"))) { var fu2 = fu; items.Add((fu.Y + (fu.T.StartsWith("mesa") ? 14 : 0), () => DrawFurn(g, fu2, t, night))); }
            foreach (var p in people.Values.Where(p => p.Floor == ViewFloor && p.InCar is null)) { var p2 = p; items.Add((p.Y, () => DrawPerson(g, p2, t))); }
            if (pet.Floor == ViewFloor && pet.InCar is null) items.Add((pet.Y, () => DrawPet(g, t)));
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
            g.DrawRectangle(B(r.Green ? "#132A1A" : r.Lobby ? "#141417" : r.Boss ? "#1E1914" : r.Meeting ? "#16151F" : "#151518"), null, new Rect(r.X0 + 3, r.Y0 + 3, r.X1 - r.X0 - 6, r.Y1 - r.Y0 - 6));
            for (var y = r.Y0 + 24; y < r.Y1; y += 24) g.DrawLine(faint, new Point(r.X0 + 4, y), new Point(r.X1 - 4, y));
            if (r.Lobby)
            {
                // bloco dos elevadores na parede do fundo: moldura das portas, visores e o painel de botões
                g.DrawRectangle(B("#2A2A30"), null, new Rect(BlockX0, BlockY0, BlockX1 - BlockX0, BlockY1 - BlockY0));
                g.DrawRectangle(B("#36363E"), null, new Rect(BlockX0, BlockY1 - 4, BlockX1 - BlockX0, 4));
                foreach (var cx in CarX)
                {
                    g.DrawRectangle(B("#52525B"), null, new Rect(cx - DoorHalf - 4, DoorTop - 4, DoorHalf * 2 + 8, BlockY1 - DoorTop + 4));
                    g.DrawRectangle(B("#09090B"), null, new Rect(cx - 13, BlockY0 + 3, 26, DoorTop - 9 - BlockY0));
                }
                g.DrawRectangle(B("#52525B"), null, new Rect((CarX[0] + CarX[1]) / 2 - 4, 452, 8, 24));
                if (ViewFloor < floors.Count - 1) Text(g, "▲ sobe", 985, 560, 11, B("#A1A1AA"));
                if (ViewFloor > 0) Text(g, "▼ desce", 985, 600, 11, B("#A1A1AA"));
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

    // formas do bonequinho (as mesmas do design no Claude Design e do predio.js); criadas na primeira vez que desenha
    static Dictionary<string, Geometry>? shapes;
    static Dictionary<string, Geometry> Sh => shapes ??= new()
    {
        ["cap"] = Geometry.Parse("M-11 -49 C-11.7 -58.6 -6 -62.7 0.5 -62.5 C7 -62.3 11.7 -58 11 -49 C9.6 -53.8 6 -55.7 1.5 -55.3 C-2.5 -56.6 -8 -55 -11 -49 Z"),
        ["longo"] = Geometry.Parse("M-11.8 -52 C-12.8 -44 -12.4 -38 -9.2 -34.6 L9.2 -34.6 C12.4 -38 12.8 -44 11.8 -52 Z"),
        ["bone"] = Geometry.Parse("M-11.3 -50 C-11.3 -60.6 -5.6 -63.8 0 -63.8 C5.6 -63.8 11.3 -60.6 11.3 -50 Z"),
        ["aba"] = Geometry.Parse("M2 -51.6 L15.2 -50.2 C15.8 -48.6 14.6 -47.8 13 -47.8 L2 -48.8 Z"),
        ["barba"] = Geometry.Parse("M-8.8 -48 C-8.2 -40.4 -4 -38.4 0 -38.4 C4 -38.4 8.2 -40.4 8.8 -48 C6.2 -44.4 3.6 -43.6 0 -43.4 C-3.6 -43.6 -6.2 -44.4 -8.8 -48 Z"),
        ["gola"] = Geometry.Parse("M-3.6 -39.5 Q0 -35.4 3.6 -39.5 Z"),
        ["capuz"] = Geometry.Parse("M-7.2 -39.4 Q0 -33.6 7.2 -39.4 Q5 -42.8 0 -43 Q-5 -42.8 -7.2 -39.4 Z"),
        ["poloL"] = Geometry.Parse("M-4.8 -39.5 L0 -36 L-1.2 -33.4 L-6 -37.6 Z"), ["poloR"] = Geometry.Parse("M4.8 -39.5 L0 -36 L1.2 -33.4 L6 -37.6 Z"),
        ["camisaV"] = Geometry.Parse("M-4.8 -39.5 L4.8 -39.5 L0 -28.4 Z"),
        ["lapelaL"] = Geometry.Parse("M-4.8 -39.5 L-7.4 -37.8 L-3.4 -30.6 L-1 -33 Z"), ["lapelaR"] = Geometry.Parse("M4.8 -39.5 L7.4 -37.8 L3.4 -30.6 L1 -33 Z"),
        ["gravata"] = Geometry.Parse("M-1.4 -36.6 L1.4 -36.6 L2.6 -25.8 L0 -23 L-2.6 -25.8 Z"), ["gravataSombra"] = Geometry.Parse("M0.2 -36.6 L1.4 -36.6 L2.6 -25.8 L0.2 -23.2 Z"),
        ["lenco"] = Geometry.Parse("M4.6 -34 L7.6 -34 L7.2 -32.2 L5.6 -31.6 Z"),
        ["fone"] = Geometry.Parse("M-11.4 -50 C-11.4 -65 11.4 -65 11.4 -50"),
    };

    static StreamGeometry Curve(Point a, Point ctl, Point b, bool closed)
    {
        var g = new StreamGeometry();
        using var c = g.Open();
        c.BeginFigure(a, closed); c.QuadraticBezierTo(ctl, b); c.EndFigure(closed);
        return g;
    }

    /// <summary>
    /// Bonequinho: cabeça grande com contorno, olhos, sobrancelha e bochecha; roupa sorteada (camiseta, listrada, moletom
    /// ou polo) ou terno com gravata vermelha (chefe). Anda balançando braços e pernas, fica de costas quando sobe a tela
    /// ou espera o elevador, senta e digita na mesa, comemora com os braços para cima e dorme no sofá.
    /// </summary>
    void DrawPerson(DrawingContext g, Person p, double t)
    {
        var L = p.Look; var S = Sh;
        var walk = p.Moving ? Math.Sin(t * 11 + p.Phase) : 0;
        var cel = p.Celebrate > 0; var sit = !p.Moving && p.Sitting; var back = p.FaceUp && !sit; var sleep = p.Mood == "parado" && sit;
        var bob = p.Moving ? Math.Abs(walk) * 1.4 : cel ? Math.Abs(Math.Sin(t * 10)) * 9 : Math.Sin(t * 2 + p.Phase) * .35;
        var boss = L.Boss; var st = L.Style; var top = L.Top;
        var torso = B(boss ? L.Jacket ?? L.Pants : L.Shirt);
        var fore = !boss && top != "moletom" ? B(L.Skin) : torso;
        IBrush skin = B(L.Skin), hair = B(L.Hair);
        var outline = new Pen(new SolidColorBrush(Color.FromArgb(128, 20, 16, 12)), .7);
        void Rr(double x, double y, double w, double h, double r, IBrush b, IPen? pen = null) => g.DrawRectangle(b, pen, new Rect(x, y, w, h), r, r);
        void Ell(double x, double y, double rx, double ry, double rot, IBrush b) { using (g.PushTransform(Matrix.CreateRotation(rot) * Matrix.CreateTranslation(x, y))) g.DrawEllipse(b, null, new Point(0, 0), rx, ry); }
        IBrush A(byte a, byte r, byte gg, byte b) => new SolidColorBrush(Color.FromArgb(a, r, gg, b));

        using var _ = g.PushTransform(Matrix.CreateScale(1.1, 1.1) * Matrix.CreateTranslation(p.X, p.Y));
        g.DrawEllipse(A(77, 0, 0, 0), null, new Point(0, .5), 12.5, 4);
        using var __ = g.PushTransform(Matrix.CreateScale(p.Face < 0 ? -1 : 1, 1) * Matrix.CreateTranslation(0, -bob + (sit ? 7 : 0)));

        // cabelo que fica atrás da cabeça
        if (!back && st == "rabo") Ell(-11.6, -49, 3.6, 7.5, .35, hair);
        if (!back && st == "longo") g.DrawGeometry(hair, null, S["longo"]);
        if (st == "cacheado") { Dot(g, 0, -53, 13.8, hair); Dot(g, -12, -47, 4.4, hair); Dot(g, 12, -47, 4.4, hair); }

        // pernas e tênis
        double legH = sit ? 10 : 18.5, sw = walk * 2.2;
        (double X, double H)[] legs = [(-7.6 + sw, legH - Math.Max(0, walk) * 1.6), (1.4 - sw, legH - Math.Max(0, -walk) * 1.6)];
        foreach (var (x, h) in legs) Rr(x, -20.5, 6.2, h, 2.2, B(L.Pants));
        foreach (var (x, h) in legs)
        {
            double sx = x - .6 + (back ? 0 : .8), sy = -20.5 + h - 3;
            Rr(sx, sy, 8.6, 5, 2.4, B(L.Shoes), new Pen(new SolidColorBrush(Color.FromArgb(115, 20, 16, 12)), .6));
            Rr(sx, sy + 4, 8.6, 1.1, .5, boss ? B("#0A0A0A") : A(235, 255, 255, 255));
        }

        // pescoço e tronco
        g.DrawRectangle(skin, null, new Rect(-2.6, -42, 5.2, 4.5));
        Rr(-9.6, -39.5, 19.2, 21.5, 5.5, torso, outline);
        Rr(4.2, -39, 5, 20.6, 4, A(36, 0, 0, 0));
        g.DrawRectangle(A(36, 0, 0, 0), null, new Rect(-9.6, -21, 19.2, 3));
        if (back) { if (top == "moletom") g.DrawGeometry(A(56, 0, 0, 0), null, S["capuz"]); }
        else if (top == "terno")
        {
            g.DrawGeometry(B(L.Shirt), null, S["camisaV"]); g.DrawGeometry(B("#0F172A"), null, S["lapelaL"]); g.DrawGeometry(B("#0F172A"), null, S["lapelaR"]);
            var tie = B(L.Tie ?? L.Cap);
            Rr(-1.7, -39.2, 3.4, 2.8, .9, tie); g.DrawGeometry(tie, null, S["gravata"]); g.DrawGeometry(A(46, 0, 0, 0), null, S["gravataSombra"]);
            g.DrawGeometry(B("#F4F4F5"), null, S["lenco"]); Dot(g, -3.2, -24.4, .75, B("#0F172A"));
        }
        else if (top == "listrada")
        {
            g.DrawRectangle(A(153, 255, 255, 255), null, new Rect(-9.4, -33.4, 18.8, 2.2)); g.DrawRectangle(A(153, 255, 255, 255), null, new Rect(-9.4, -27.4, 18.8, 2.2));
            g.DrawGeometry(skin, null, S["gola"]);
        }
        else if (top == "moletom")
        {
            g.DrawGeometry(A(56, 0, 0, 0), null, S["capuz"]);
            Rr(-2.3, -37, .9, 5.4, .4, B("#F4F4F5")); Rr(1.4, -37, .9, 5.4, .4, B("#F4F4F5"));
            Rr(-6, -27.4, 12, 6, 2, A(36, 0, 0, 0));
        }
        else if (top == "polo")
        {
            g.DrawGeometry(A(224, 255, 255, 255), null, S["poloL"]); g.DrawGeometry(A(224, 255, 255, 255), null, S["poloR"]);
            Dot(g, 0, -32.6, .65, A(102, 0, 0, 0)); Dot(g, 0, -30, .65, A(102, 0, 0, 0));
        }
        else g.DrawGeometry(skin, null, S["gola"]);

        // braços: balançam andando, vão para a frente digitando, sobem comemorando
        double aL = 5, aR = -5;
        if (p.Moving) { aL = 24 * walk; aR = -24 * walk; }
        else if (sit) { var ty = p.Typing ? Math.Sin(t * 22) * 6 : 0; aL = -32 + ty; aR = 32 - ty; }
        if (cel) { var w = Math.Sin(t * 12) * 12; aL = 150 + w; aR = -150 - w; }
        foreach (var (side, deg) in new[] { (-1, aL), (1, aR) })
        {
            var px = 11.4 * side;
            using (g.PushTransform(Matrix.CreateTranslation(-px, 36) * Matrix.CreateRotation(deg * Math.PI / 180) * Matrix.CreateTranslation(px, -36)))
            {
                Rr(side < 0 ? -13.8 : 9, -38, 4.8, 9, 2.4, torso);
                Rr(side < 0 ? -13.6 : 9.2, -31, 4.4, 8.4, 2.2, fore);
                Dot(g, px, -22.4, 2.5, skin);
            }
        }

        // cabeça
        Dot(g, -10.3, -49.2, 2.3, skin); Dot(g, 10.3, -49.2, 2.3, skin);
        g.DrawEllipse(skin, outline, new Point(0, -50), 10.6, 10.6);
        if (back)
        {
            if (st is not ("careca" or "bone"))
            {
                Dot(g, 0, -50.4, 11, hair);
                if (st == "longo") g.DrawGeometry(hair, null, S["longo"]);
                if (st == "rabo") Ell(0, -41, 3.4, 7, 0, hair);
                if (st == "coque") Dot(g, 0, -63.6, 4.9, hair);
            }
            if (st == "bone") g.DrawGeometry(B(L.Cap), null, S["bone"]);
            if (st == "careca") Ell(-3.6, -57.2, 3.2, 1.6, 0, A(89, 255, 255, 255));
        }
        else
        {
            const double fx = 1.2;
            if (L.Acc == "barba") g.DrawGeometry(L.Hair == K.C("#7C3AED") || L.Hair == K.C("#E5E5E5") ? B("#3B2A20") : hair, null, S["barba"]);
            var ink = B("#1B1B1F");
            var blink = (t + p.Phase) % 4 < .12;
            if (sleep || blink)
                foreach (var ex in new[] { -3.7, 3.7 })
                {
                    var y = sleep ? -51.4 : -50.4;
                    g.DrawGeometry(null, new Pen(ink, .9, lineCap: PenLineCap.Round), Curve(new(ex + fx - 1.6, y + .7), new(ex + fx, y + 2.4), new(ex + fx + 1.6, y + .7), false));
                }
            else
                foreach (var ex in new[] { -3.7, 3.7 })
                {
                    g.DrawEllipse(Brushes.White, null, new Point(ex + fx, -50.4), 2.3, 2.7);
                    Dot(g, ex + fx * 1.5, -50.1, 1.45, ink);
                    Dot(g, ex + .5 + fx * 1.5, -50.8, .45, Brushes.White);
                }
            var brow = L.Hair == K.C("#E5E5E5") ? B("#A1A1AA") : hair;
            var worried = p.Mood == "travado";
            foreach (var (bx, rot) in new[] { (-5.7, worried ? .35 : 0), (1.9, worried ? -.35 : 0) })
                using (g.PushTransform(Matrix.CreateRotation(rot) * Matrix.CreateTranslation(bx + fx + 1.9, -55))) Rr(-1.9, -.55, 3.8, 1.1, .55, brow);
            Ell(fx * 1.7, -47.6, .9, .7, 0, A(36, 0, 0, 0));
            Dot(g, -6.6 + fx, -46.4, 1.8, A(82, 244, 114, 182)); Dot(g, 6.6 + fx, -46.4, 1.8, A(82, 244, 114, 182));
            var lip = new Pen(B("#5B2A1F"), .95, lineCap: PenLineCap.Round);
            if (cel) g.DrawGeometry(B("#7F1D1D"), null, Curve(new(-2.8 + fx, -45.6), new(fx, -40.4), new(2.8 + fx, -45.6), true));
            else if (worried) g.DrawGeometry(null, lip, Curve(new(-2.3 + fx, -43.8), new(fx, -45.8), new(2.3 + fx, -43.8), false));
            else if (sleep) g.DrawEllipse(null, lip, new Point(fx, -44.4), 1, 1);
            else g.DrawGeometry(null, lip, Curve(new(-2.5 + fx, -45.3), new(fx, -42.6), new(2.5 + fx, -45.3), false));

            if (st is "curto" or "longo" or "coque" or "topete" or "rabo") g.DrawGeometry(hair, null, S["cap"]);
            if (st == "topete") Ell(3, -60.6, 7.6, 4.2, -.31, hair);
            if (st == "coque") Dot(g, 0, -63.6, 4.9, hair);
            if (st == "cacheado") { Dot(g, -7, -58, 4.3, hair); Dot(g, -1.8, -60.6, 4.5, hair); Dot(g, 3.8, -60, 4.4, hair); Dot(g, 8.2, -57, 4, hair); }
            if (st == "bone") { g.DrawGeometry(B(L.Cap), null, S["bone"]); g.DrawGeometry(B(L.Cap), null, S["aba"]); g.DrawGeometry(A(51, 0, 0, 0), null, S["aba"]); Dot(g, 0, -63.4, 1.3, A(64, 0, 0, 0)); }
            if (st == "careca") Ell(-3.6, -57.2, 3.2, 1.6, 0, A(89, 255, 255, 255));
            if (L.Acc == "oculos")
            {
                var frame = new Pen(B("#18181B"), .9);
                foreach (var ex in new[] { -3.7, 3.7 }) g.DrawEllipse(A(46, 186, 230, 253), frame, new Point(ex + fx, -50.4), 3.4, 3.4);
                g.DrawRectangle(B("#18181B"), null, new Rect(-.7 + fx, -51, 1.4, .9));
            }
        }
        if (L.Acc == "fone")
        {
            g.DrawGeometry(null, new Pen(B("#27272A"), 2.2), S["fone"]);
            Rr(-13.6, -53.4, 4.4, 7.4, 2.2, B("#F97316")); Rr(9.2, -53.4, 4.4, 7.4, 2.2, B("#F97316"));
        }
    }

    /// <summary>Está à vista neste andar? Quem está na cabine só aparece com a porta aberta.</summary>
    bool Shown(Person o) => o.Floor == ViewFloor && (o.InCar is null || (Math.Abs(o.InCar.Pos - ViewFloor) < 1e-6 && o.InCar.Door > .3));

    /// <summary>Portas de correr, cabine (com quem está dentro), visor do andar e botão de chamada.</summary>
    void DrawElevators(DrawingContext g, double t)
    {
        foreach (var c in lift.Cars)
        {
            var open = Math.Abs(c.Pos - ViewFloor) < 1e-6 ? c.Door : 0;
            double x0 = c.X - DoorHalf, x1 = c.X + DoorHalf, y0 = DoorTop, y1 = BlockY1;
            if (open > .01)
                using (g.PushClip(new Rect(c.X - DoorHalf * open, y0, 2 * DoorHalf * open, y1 - y0)))
                {
                    g.DrawRectangle(B("#3B3B44"), null, new Rect(x0, y0, x1 - x0, y1 - y0));
                    g.DrawRectangle(B("#26262B"), null, new Rect(x0, y1 - 14, x1 - x0, 14));
                    g.DrawRectangle(new SolidColorBrush(Color.FromArgb(90, 250, 204, 21)), null, new Rect(x0 + 6, y0 + 2, x1 - x0 - 12, 3));
                    foreach (var r in c.Riders.OrderBy(r => r.O.Y)) { if (r.O.IsPet) DrawPet(g, t); else DrawPerson(g, r.O, t); }
                }
            var w = DoorHalf * (1 - open);
            if (w > .2)
            {
                g.DrawRectangle(B("#A1A1AA"), null, new Rect(x0, y0, w, y1 - y0));
                g.DrawRectangle(B("#B4B4BC"), null, new Rect(x1 - w, y0, w, y1 - y0));
                var shine = new SolidColorBrush(Color.FromArgb(56, 255, 255, 255));
                g.DrawRectangle(shine, null, new Rect(x0 + w * .3, y0 + 4, 3, y1 - y0 - 10)); g.DrawRectangle(shine, null, new Rect(x1 - w * .7, y0 + 4, 3, y1 - y0 - 10));
                var seam = new SolidColorBrush(Color.FromArgb(89, 0, 0, 0));
                g.DrawRectangle(seam, null, new Rect(x0 + w - 1, y0, 1, y1 - y0)); g.DrawRectangle(seam, null, new Rect(x1 - w, y0, 1, y1 - y0));
            }
            // visor: andar onde a cabine está e a seta enquanto anda
            var fl = (int)Math.Round(c.Pos);
            var txt = (c.State == "moving" ? (c.Dir > 0 ? "▲" : "▼") : "") + (fl == 0 ? "T" : fl.ToString(CultureInfo.InvariantCulture));
            Text(g, txt, c.X, (BlockY0 + 3 + DoorTop - 6) / 2 + .5, 9.5, B(c.State == "moving" ? "#FB923C" : "#4ADE80"));
        }
        // botão de chamada: acende quando alguém espera neste andar
        var bx = (CarX[0] + CarX[1]) / 2; var lit = lift.Calls.Contains(ViewFloor);
        Dot(g, bx, 459, 2.4, B(lit && ViewFloor < floors.Count - 1 ? "#FB923C" : "#71717A"));
        Dot(g, bx, 469, 2.4, B(lit && ViewFloor > 0 ? "#FB923C" : "#71717A"));
    }

    static StreamGeometry Geo(params Point[] pts)
    {
        var g = new StreamGeometry();
        using var c = g.Open();
        c.BeginFigure(pts[0], true); foreach (var p in pts.Skip(1)) c.LineTo(p); c.EndFigure(true);
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
        // quem está na fila ou dentro do elevador não mostra o nome (vira um contador), a não ser o selecionado ou quem fala
        bool Quiet(Person q) => (q.InCar is not null || q.BoardingCar is not null || q.Path.FirstOrDefault()?.Elevator == true) && Selected != q.Id && !(q.Bubble is { } qb && qb.Until > now);
        var queue = people.Values.Count(q => q.Floor == ViewFloor && q.InCar is null && (q.BoardingCar is not null || q.Path.FirstOrDefault()?.Elevator == true));
        if (queue > 0)
        {
            var qt = new FormattedText($"{queue} esperando o elevador", CultureInfo.CurrentCulture, FlowDirection.LeftToRight, Semi, 10, B("#0A0A0A"));
            var qw = qt.Width + 14;
            g.DrawRectangle(new SolidColorBrush(Color.FromArgb(235, 249, 115, 22)), null, new Rect(1078 - qw / 2, 619, qw, 18), 9, 9);
            g.DrawText(qt, new Point(1078 - qt.Width / 2, 628 - qt.Height / 2));
        }
        foreach (var p in people.Values.Where(p => Shown(p) && !Quiet(p)).OrderBy(p => p.Y))
        {
            var name = p.IsBoss ? "VOCÊ · chefe" : K.Nice(p.Id).ToUpperInvariant();
            var ft = new FormattedText(name, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, Bold, 10.5, Brushes.White);
            var w = ft.Width + 18; var y = p.Y + 6;
            while (placed.Any(r => Math.Abs(r.X - p.X) < (r.W + w) / 2 + 2 && Math.Abs(r.Y - y) < 17)) y += 17;
            placed.Add((p.X, y, w));
            g.DrawRectangle(new SolidColorBrush(Selected == p.Id ? Color.FromArgb(242, 249, 115, 22) : Color.FromArgb(210, 9, 9, 11)), null, new Rect(p.X - w / 2, y, w, 16), 8, 8);
            Dot(g, p.X - w / 2 + 8, y + 8, 3, B(Moods.TryGetValue(p.Mood, out var m) ? m.Color : K.C("#71717A")));
            g.DrawText(ft, new Point(p.X - w / 2 + 13, y + 8 - ft.Height / 2));
            var hy = p.Y - 84;
            if (p.Bubble is { } bb && bb.Until > now) Bubble(g, p.X, hy, bb.Text, Color.FromArgb(246, 250, 250, 250));
            else
            {
                string? icon = p.Mood == "travado" ? (Math.Sin(t * 6) > -.3 ? "!" : null) : p.Mood == "parado" && p.Sitting ? new string('z', 1 + (int)(t * 1.5) % 3) : p.Typing ? new string('.', 1 + (int)(t * 3) % 3) : p.Celebrate > 0 ? "✓" : null;
                if (icon is not null) Text(g, icon, p.X + (icon.StartsWith('z') ? 10 : 0), hy + 10, 14, B(p.Mood == "travado" ? "#EF4444" : p.Celebrate > 0 ? "#22C55E" : "#A1A1AA"));
            }
        }
        if (Shown(pet) && pet.Bubble is { } pb && pb.Until > now) Bubble(g, pet.X, pet.Y - 52, pb.Text, Color.FromArgb(248, 253, 186, 116));
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
