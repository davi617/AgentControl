using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace AgentControl.Ui;

/// <summary>
/// Caixinha de aprovação que desce da HUD do topo quando um agente pede algo protegido (comando J-xxx
/// esperando você). Aprovar / Recusar ali mesmo, sem abrir a aba Comandos. "Depois" esconde só este
/// pedido; ele continua contando na faixa até alguém decidir.
/// </summary>
public sealed class ApprovalWindow : Window
{
    readonly HudHost host;
    readonly Border shell;
    readonly TextBlock title = K.T("", 13.5, K.Text, FontWeight.SemiBold, K.Display);
    readonly TextBlock count = K.T("", 11, K.Muted);
    readonly TextBlock text = K.Wrap("", 12.5, K.Text2, maxLines: 5, lineHeight: 18);
    readonly TextBlock result = K.Wrap("", 12, K.Muted);
    readonly StackPanel buttons = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    readonly ContentControl avatar = new();
    readonly HashSet<string> later = [];
    (string Code, string Target, string Text)? current;
    bool busy, closing;

    public ApprovalWindow(HudHost host)
    {
        this.host = host;
        K.Floating(this);
        ShowActivated = false;
        SizeToContent = SizeToContent.Height;
        Width = 400; Title = "Agent Control · aprovação";

        var head = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), Margin = new Thickness(0, 0, 0, 10) };
        head.Children.Add(avatar);
        var col = new StackPanel { Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, Children = { title, count } };
        Grid.SetColumn(col, 1); head.Children.Add(col);
        var stack = new StackPanel { Children = { head, text, result.Also(r => r.Margin = new Thickness(0, 8, 0, 0)), buttons.Also(b => b.Margin = new Thickness(0, 12, 0, 0)) } };
        shell = new Border
        {
            Background = K.Surface, BorderBrush = new SolidColorBrush(Color.FromArgb(110, 245, 158, 11)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(16),
            Padding = new Thickness(14, 12, 14, 14), Margin = new Thickness(14, 6, 14, 14), Child = stack, BoxShadow = K.Shadow(28, 4, .55), Opacity = 0,
        };
        Content = shell;
        KeyDown += (_, e) => { if (e.Key == Key.Escape) Later(); };
    }

    /// <summary>A cada leitura do servidor: mostra o pedido mais antigo que ainda não foi decidido nem adiado.</summary>
    public void Update(IReadOnlyList<(string Code, string Target, string Text)> pending)
    {
        if (busy) return;
        later.IntersectWith(pending.Select(p => p.Code)); // decidido em outro lugar (celular, aba Comandos): esquece
        var next = pending.Where(p => !later.Contains(p.Code)).Cast<(string Code, string Target, string Text)?>().FirstOrDefault();
        if (next is null) { CloseAnimated(); return; }
        var waiting = pending.Count(p => !later.Contains(p.Code));
        if (current?.Code == next.Value.Code && IsVisible && !closing) { count.Text = Count(waiting); return; }
        current = next;
        Fill(next.Value, waiting);
        Open();
    }

    static string Count(int n) => n == 1 ? "esperando você" : $"esperando você · mais {n - 1} na fila";

    void Fill((string Code, string Target, string Text) c, int waiting)
    {
        avatar.Content = K.Avatar(c.Target, 30);
        title.Text = $"{K.Nice(c.Target)} pede aprovação · {c.Code}";
        count.Text = Count(waiting);
        text.Text = c.Text.Length > 400 ? c.Text[..400] + "…" : c.Text;
        result.Text = ""; result.IsVisible = false;
        buttons.Children.Clear();
        buttons.Children.Add(K.Button("Aprovar", K.ICheck, () => _ = Decide(true), height: 34));
        buttons.Children.Add(K.Button("Recusar", K.IClose, () => _ = Decide(false), primary: false, danger: true, height: 34));
        buttons.Children.Add(K.Button("Depois", null, Later, primary: false, height: 34));
    }

    async Task Decide(bool approve)
    {
        if (current is not { } c || busy) return;
        busy = true;
        buttons.IsEnabled = false;
        var reply = await host.Api.Decide(c.Code, approve);
        result.Text = reply; result.IsVisible = true;
        result.Foreground = reply.Contains("aprovad", StringComparison.OrdinalIgnoreCase) || reply.Contains("recusad", StringComparison.OrdinalIgnoreCase) ? K.Ok : K.Warn;
        host.Mascot.Say("AgentC", approve ? $"{c.Code} aprovado. {K.Nice(c.Target)} segue." : $"{c.Code} recusado. Aviso o {K.Nice(c.Target)}.");
        if (approve) host.Mascot.Nod(); else host.Mascot.Shake();
        await Task.Delay(1400);
        later.Add(c.Code); // até o servidor confirmar, não mostra de novo
        busy = false; buttons.IsEnabled = true; current = null;
        CloseAnimated();
        host.KickRefresh();
    }

    void Later()
    {
        if (current is { } c) later.Add(c.Code);
        current = null;
        CloseAnimated();
    }

    void Open()
    {
        closing = false;
        if (!IsVisible) Show();
        Place();
        K.Fade(shell, 1, 300, from: IsVisible && shell.Opacity > .5 ? shell.Opacity : 0);
        K.EnterUp(shell, 0, -14);
    }

    /// <summary>Logo abaixo da HUD do topo, centralizada com ela.</summary>
    void Place()
    {
        var hud = host.Hud;
        var (hx, hy) = K.PosDip(hud);
        var x = hx + hud.ClientSize.Width / 2 - Width / 2;
        var (wa, _) = K.WorkArea(hud);
        var y = Math.Min(hy + Math.Max(50, hud.ClientSize.Height - 10), wa.Bottom - 240); // painel aberto e alto: não sai da tela
        K.MoveTo(this, Math.Clamp(x, wa.Left, wa.Right - Width), y);
    }

    void CloseAnimated()
    {
        if (!IsVisible || closing) return;
        closing = true;
        K.Fade(shell, 0, 180, K.InQuad, done: () => { if (closing) Hide(); });
    }
}
