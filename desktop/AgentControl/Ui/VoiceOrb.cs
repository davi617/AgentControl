using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Threading;

namespace AgentControl.Ui;

/// <summary>
/// Orbe de voz (estilo modo voz do Grok): núcleo laranja que respira, anéis suaves e uma onda em volta
/// que se mexe conforme o "nível" (alto = alguém falando agora; baixo = ouvindo/esperando).
/// Desenhada na hora (sem imagem); para sozinha quando sai da tela. Com "reduzir animações", fica parada.
/// </summary>
public sealed class VoiceOrb : Control
{
    /// <summary>Nível desejado, 0..1. O desenho chega nele suave.</summary>
    public double Level { get; set; } = .2;
    double level;
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly DispatcherTimer timer;
    static readonly Color Hi = Color.Parse("#FDBA74"), Mid = Color.Parse("#F97316"), Lo = Color.Parse("#9A3412");

    public VoiceOrb(double size)
    {
        Width = size; Height = size;
        timer = new DispatcherTimer(TimeSpan.FromMilliseconds(33), DispatcherPriority.Render, (_, _) => { level += (Level - level) * .1; InvalidateVisual(); });
        AttachedToVisualTree += (_, _) => { if (!K.Reduced) timer.Start(); };
        DetachedFromVisualTree += (_, _) => timer.Stop();
    }

    public override void Render(DrawingContext ctx)
    {
        var c = new Point(Bounds.Width / 2, Bounds.Height / 2);
        var r0 = Math.Min(Bounds.Width, Bounds.Height) * .26;
        var t = K.Reduced ? 0 : clock.Elapsed.TotalSeconds;
        var lv = K.Reduced ? .2 : level;

        // anéis de fora, bem leves, cada um no seu ritmo
        for (var i = 3; i >= 1; i--)
        {
            var amp = lv * (.5 + .5 * Math.Sin(t * (1.6 + i * .7) + i * 1.3));
            var r = r0 * (1 + .2 * i + .3 * amp);
            ctx.DrawEllipse(new SolidColorBrush(Color.FromArgb((byte)(16 + 10 * (4 - i) + 30 * amp), Mid.R, Mid.G, Mid.B)), null, c, r, r);
        }

        // onda em volta do núcleo
        var rc = r0 * (1 + .08 * Math.Sin(t * 2.2) + .1 * lv * Math.Sin(t * 9));
        var geo = new StreamGeometry();
        using (var g = geo.Open())
        {
            const int n = 96;
            for (var k = 0; k <= n; k++)
            {
                var a = k * Math.PI * 2 / n;
                var wob = Math.Sin(a * 6 + t * 5) * Math.Sin(a * 3 - t * 3.1) + .5 * Math.Sin(a * 9 + t * 7.3);
                var rr = rc * 1.22 + rc * (.06 + .32 * lv) * wob;
                var p = new Point(c.X + rr * Math.Cos(a), c.Y + rr * Math.Sin(a));
                if (k == 0) g.BeginFigure(p, false); else g.LineTo(p);
            }
            g.EndFigure(true);
        }
        ctx.DrawGeometry(null, new Pen(new SolidColorBrush(Color.FromArgb((byte)(110 + 120 * lv), Hi.R, Hi.G, Hi.B)), 2), geo);

        // núcleo com gradiente
        var core = new RadialGradientBrush
        {
            GradientOrigin = new RelativePoint(.35, .3, RelativeUnit.Relative),
            GradientStops = { new GradientStop(Hi, 0), new GradientStop(Mid, .55), new GradientStop(Lo, 1) },
        };
        ctx.DrawEllipse(core, null, c, rc, rc);
        // brilho
        ctx.DrawEllipse(new SolidColorBrush(Color.FromArgb(60, 255, 255, 255)), null, new Point(c.X - rc * .32, c.Y - rc * .38), rc * .32, rc * .2);
    }
}
