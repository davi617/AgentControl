using System.IO.Pipes;

namespace AgentControl.Core;

/// <summary>
/// Aviso entre o Launcher e o HUD (processos separados): "abre a tela completa", "mostra o AgentC".
/// Pipe nomeado: no Windows é um pipe do sistema; no Linux/macOS o .NET usa um socket local em /tmp.
/// Só aceita conexões do próprio usuário na própria máquina (nada de rede).
/// </summary>
public static class Signal
{
    static string Pipe => "AgentControl.Hud." + Environment.UserName;

    /// <summary>HUD: escuta para sempre em segundo plano e chama [onMessage] com cada palavra recebida.</summary>
    public static void Listen(Action<string> onMessage)
    {
        new Thread(() =>
        {
            while (true)
            {
                try
                {
                    using var server = new NamedPipeServerStream(Pipe, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.CurrentUserOnly);
                    server.WaitForConnection();
                    using var r = new StreamReader(server);
                    var msg = r.ReadLine();
                    if (!string.IsNullOrWhiteSpace(msg)) onMessage(msg.Trim());
                }
                catch { Thread.Sleep(500); }
            }
        }) { IsBackground = true, Name = "agentc-signal" }.Start();
    }

    /// <summary>Launcher: manda uma palavra para o HUD. false = HUD não está aberto.</summary>
    public static bool Send(string msg, int timeoutMs = 1500)
    {
        try
        {
            using var c = new NamedPipeClientStream(".", Pipe, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            c.Connect(timeoutMs);
            using var w = new StreamWriter(c) { AutoFlush = true };
            w.WriteLine(msg);
            return true;
        }
        catch { return false; }
    }
}
