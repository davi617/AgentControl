using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace AgentControl.Ui;

/// <summary>Mini janela que o AgentC "puxa": escolher para quem, escrever e mandar para a sala.</summary>
public sealed class MiniWindow : Window
{
    readonly HudHost host;
    readonly Border shell;
    readonly WrapPanel chips = new();
    readonly TextBox input;
    readonly TextBlock status = K.Wrap("Enter envia · Shift+Enter quebra a linha", 11.5, K.Faint);
    readonly StackPanel replies = new();
    string to = "TODOS", agentsSig = "", repliesSig = "";
    bool sending, closing;

    public MiniWindow(HudHost host)
    {
        this.host = host;
        K.Floating(this);
        ShowActivated = true;
        SizeToContent = SizeToContent.Height;
        Width = 352; Title = "Agent Control · mensagem";

        var head = new Grid { Margin = new Thickness(0, 0, 0, 14), Background = Brushes.Transparent, Cursor = new Cursor(StandardCursorType.SizeAll), ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        K.DragOrClick(this, head, null);
        head.Children.Add(K.Face(30));
        var title = new StackPanel { Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, Children = { K.T("Fale com os agentes", 14.5, K.Text, FontWeight.SemiBold, K.Display), K.T("A mensagem vai para a sala", 11.5, K.Muted) } };
        Grid.SetColumn(title, 1); head.Children.Add(title);
        var close = new Border { Width = 28, Height = 28, CornerRadius = new CornerRadius(8), Background = Brushes.Transparent, Child = K.Icon(K.IClose, 12, K.Muted) };
        close.Tip("Fechar (Esc)");
        K.Pressable(close, CloseAnimated);
        Grid.SetColumn(close, 2); head.Children.Add(close);

        input = new TextBox
        {
            Watermark = "Escreva para os agentes… (ou \"lembra que…\" para o AgentC)", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 70, MaxHeight = 150, FontSize = 13.5, FontFamily = K.Ui,
            Background = Brushes.Transparent, BorderThickness = new Thickness(0), CaretBrush = K.Brand, Padding = new Thickness(0),
        };
        input.AddHandler(KeyDownEvent, (_, e) =>
        {
            if (e.Key == Key.Enter && !e.KeyModifiers.HasFlag(KeyModifiers.Shift)) { e.Handled = true; _ = Send(); }
            else if (e.Key == Key.Escape) { e.Handled = true; CloseAnimated(); }
        }, RoutingStrategies.Tunnel);
        var well = new Border { Background = K.Raised, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 10), Child = input };
        input.GotFocus += (_, _) => well.BorderBrush = K.Brand;
        input.LostFocus += (_, _) => well.BorderBrush = K.Line;

        var stack = new StackPanel();
        stack.Children.Add(head);
        stack.Children.Add(K.Label("Para"));
        stack.Children.Add(chips);
        stack.Children.Add(new Border { Height = 12 });
        stack.Children.Add(well);
        stack.Children.Add(status.Also(t => t.Margin = new Thickness(2, 7, 0, 12)));
        stack.Children.Add(K.Button("Enviar", K.ISend, () => _ = Send()));
        stack.Children.Add(new Border { Height = 16 });
        stack.Children.Add(K.Label("Respostas recentes"));
        stack.Children.Add(replies);

        shell = new Border { Background = K.Surface, BorderBrush = K.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(18), Padding = new Thickness(16), Margin = new Thickness(14), Child = stack, BoxShadow = K.Shadow(28, 4, .55) };
        Content = shell;
        Deactivated += (_, _) => { if (string.IsNullOrEmpty(input.Text) && !sending) CloseAnimated(); };
    }

    public void Open(Window mascot)
    {
        closing = false;
        Refresh(force: true);
        Show(); Activate();
        Dispatcher.UIThread.Post(() =>
        {
            // À direita do AgentC, alinhada pela base; se não couber, à esquerda.
            var (wa, _) = K.WorkArea(this);
            var (mx, my) = K.PosDip(mascot);
            var h = Bounds.Height > 0 ? Bounds.Height : 420;
            var x = mx + mascot.Width + Width - 14 < wa.Right ? mx + mascot.Width - 10 : mx - Width + 10;
            K.MoveTo(this, x, Math.Clamp(my + mascot.Height - h + 8, wa.Top + 4, Math.Max(wa.Top + 4, wa.Bottom - h)));
            input.Focus();
        }, DispatcherPriority.Loaded);
        K.Fade(shell, 1, 260, from: 0);
        var s = K.Scale(shell); shell.RenderTransformOrigin = new RelativePoint(0, 1, RelativeUnit.Relative);
        K.Anim(s, "s", () => s.ScaleX, x => { s.ScaleX = x; s.ScaleY = x; }, 1, 560, K.Spring, .82);
    }

    public void CloseAnimated()
    {
        if (!IsVisible || closing) return;
        closing = true;
        var s = K.Scale(shell);
        K.Anim(s, "s", () => s.ScaleX, x => { s.ScaleX = x; s.ScaleY = x; }, .9, 160, K.InQuad);
        K.Fade(shell, 0, 160, K.InQuad, done: () => { if (closing) Hide(); });
    }

    public void Refresh(bool force = false)
    {
        var s = host.Snap;
        var ids = new[] { "TODOS" }.Concat(s.Agents.Select(a => a.Id).Where(id => id != "CHATGPT")).ToList();
        var sig = string.Join(",", ids) + to;
        if (force || sig != agentsSig)
        {
            agentsSig = sig;
            chips.Children.Clear();
            foreach (var id in ids) chips.Children.Add(Chip(id));
        }
        var rs = s.Chat.Where(c => c.Agent != "DONO").Take(3).ToList();
        var rsig = string.Join("|", rs.Select(r => r.Ts + r.Agent));
        if (!force && rsig == repliesSig) return;
        repliesSig = rsig;
        replies.Children.Clear();
        if (rs.Count == 0) replies.Children.Add(K.T("Nenhuma resposta ainda.", 12, K.Muted));
        foreach (var r in rs)
        {
            var row = new Grid { Margin = new Thickness(0, 4), ColumnDefinitions = new ColumnDefinitions("Auto,*") };
            row.Children.Add(K.Avatar(r.Agent, 22).Also(a => a.VerticalAlignment = VerticalAlignment.Top));
            var top = new DockPanel();
            var when = K.T(K.Ago(r.Ts), 10.5, K.Faint); DockPanel.SetDock(when, Dock.Right); top.Children.Add(when);
            top.Children.Add(K.T(K.Nice(r.Agent), 11.5, K.Text, FontWeight.SemiBold));
            var col = new StackPanel { Margin = new Thickness(9, 0, 0, 0), Children = { top, K.T(r.Text, 12, K.Text2) } };
            Grid.SetColumn(col, 1); row.Children.Add(col);
            replies.Children.Add(row);
            if (!force) K.EnterUp(row, 0, 8);
        }
    }

    Border Chip(string id)
    {
        var on = id == to;
        var bg = new SolidColorBrush(on ? K.C("#F97316") : K.C("#181818"));
        var b = new Border
        {
            Background = bg, CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 5, 10, 6), Margin = new Thickness(0, 0, 6, 6),
            BorderBrush = K.Line, BorderThickness = new Thickness(on ? 0 : 1), Child = K.T(id == "TODOS" ? "Todos" : K.Nice(id), 12, on ? K.OnBrand : K.Muted, FontWeight.SemiBold),
        };
        K.Pressable(b, () => { to = id; Refresh(force: true); input.Focus(); }, () => { if (to != id) K.AnimColor(bg, K.C("#222222"), 120); }, () => { if (to != id) K.AnimColor(bg, K.C("#181818"), 160); });
        return b;
    }

    async Task Send()
    {
        var text = (input.Text ?? "").Trim();
        if (text.Length == 0) { Flash("Escreva a mensagem primeiro.", K.Warn); return; }
        if (sending) return;
        // "lembra que…", "o que você lembra", "esquece": quem responde é o AgentC, sem ir para a sala.
        if (AgentControl.Core.Memory.Handle(text) is { } reply) { input.Text = ""; host.Mascot.Say("AgentC!", reply); Flash(reply, K.Ok); return; }
        sending = true;
        status.Text = "Enviando…"; status.Foreground = K.Muted;
        var err = await host.Api.SendChat(text, to);
        sending = false;
        if (err is null)
        {
            input.Text = "";
            Flash($"Enviado para {(to == "TODOS" ? "todos" : K.Nice(to))}. A resposta aparece aqui e no balão do AgentC.", K.Ok);
            host.KickRefresh();
        }
        else Flash($"Não enviei: {err}", K.Err);
    }

    void Flash(string text, IBrush color)
    {
        status.Text = text; status.Foreground = color;
        K.EnterUp(status, 0, 4);
    }
}
