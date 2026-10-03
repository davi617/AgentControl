using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentControl.Core;

/// <summary>
/// O que o AgentC lembra de você ("lembra que…", "anota…"). Fica só neste PC, em memoria.json na pasta de dados.
/// Nunca guarda o que parece segredo (chave, token, senha).
/// </summary>
public static class Memory
{
    public sealed record Note(string Text, DateTime When);
    static string FilePath => Path.Combine(Platform.DataDir, "memoria.json");
    static readonly Regex Secret = new(@"(senha|password|token|api[_ -]?key|sk-[a-z0-9]{8}|nvapi-|ghp_|bearer\s)", RegexOptions.IgnoreCase);

    public static List<Note> All()
    {
        try { return File.Exists(FilePath) ? JsonSerializer.Deserialize<List<Note>>(File.ReadAllText(FilePath)) ?? [] : []; } catch { return []; }
    }

    static void Save(List<Note> notes) { try { File.WriteAllText(FilePath, JsonSerializer.Serialize(notes)); } catch { } }

    /// <summary>Entende o pedido. Devolve a resposta do AgentC, ou null se não era com a memória (aí a mensagem vai para a sala).</summary>
    public static string? Handle(string text)
    {
        var t = text.Trim();
        var m = Regex.Match(t, @"^(agentc[,:]?\s+)?(lembr[ae](-se)?( de)?( que)?|anota( aí)?( que)?|guarda( que)?)\s+(?<x>.+)$", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        if (m.Success)
        {
            var x = m.Groups["x"].Value.Trim().TrimEnd('.');
            if (Secret.IsMatch(x)) return "Isso parece senha ou chave. Não guardo esse tipo de coisa.";
            var notes = All();
            notes.Add(new Note(x.Length > 300 ? x[..300] : x, DateTime.Now));
            Save(notes.TakeLast(50).ToList());
            return $"Anotado: {x}. Eu te lembro.";
        }
        if (Regex.IsMatch(t, @"^(agentc[,:]?\s+)?(o que (você|vc) lembra|minhas notas|mem[óo]ria)\??$", RegexOptions.IgnoreCase))
        {
            var notes = All();
            return notes.Count == 0 ? "Ainda não anotei nada. Diga \"lembra que…\" e eu guardo."
                : "Eu lembro: " + string.Join(" · ", notes.TakeLast(5).Select(n => n.Text));
        }
        if (Regex.IsMatch(t, @"^(agentc[,:]?\s+)?esquece( tudo)?\.?$", RegexOptions.IgnoreCase))
        {
            Save([]);
            return "Pronto, esqueci tudo.";
        }
        return null;
    }

    /// <summary>Um lembrete para o resumo do dia (o mais antigo dos últimos).</summary>
    public static string? Reminder() => All().TakeLast(5).FirstOrDefault()?.Text;
}
