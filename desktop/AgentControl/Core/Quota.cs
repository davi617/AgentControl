namespace AgentControl.Core;

public sealed record QuotaWindow(string Name, double RemainingPercent, int WindowMinutes, long? ResetsAt);
public sealed record AgentQuota(string Agent, string Provider, string Status, double? RemainingPercent,
    List<QuotaWindow> Windows, string? CheckedAt, string Detail)
{
    public bool Fresh => Status is "live" or "limited" && CheckedAt is not null
        && DateTimeOffset.TryParse(CheckedAt, out var at) && DateTimeOffset.UtcNow - at < TimeSpan.FromMinutes(2)
        && !Windows.Any(w => w.ResetsAt is { } r && DateTimeOffset.UtcNow.ToUnixTimeSeconds() >= r);
    public string Badge => Status == "limited" ? "limite" : RemainingPercent is { } n && Fresh ? $"{n:0}%" : Status == "stale" || RemainingPercent is not null ? "antigo" : "—";
    public string Description => Provider + " · " + Detail + (Windows.Count == 0 ? "" : "\n" + string.Join("\n", Windows.Select(w =>
        $"{w.Name}: {w.RemainingPercent:0}% restantes" + (w.ResetsAt is { } t ? $" · renova {DateTimeOffset.FromUnixTimeSeconds(t).ToLocalTime():dd/MM HH:mm}" : ""))))
        + (CheckedAt is { } s && DateTimeOffset.TryParse(s, out var d) ? $"\nLeitura {d.ToLocalTime():HH:mm:ss}" : "");
}
