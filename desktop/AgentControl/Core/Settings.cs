using System.Text.Json.Serialization;

namespace AgentControl.Core;

/// <summary>
/// settings.json do Agent Control. Fica na pasta de dados do usuário (não na pasta do app),
/// então sobreviver a atualizações e funcionar com o app instalado em /Applications ou /opt.
/// </summary>
public sealed class LauncherSettings
{
    public string NodePath { get; set; } = "node";
    /// <summary>cli.js do 9Router. Vazio = procura sozinho na pasta global do npm.</summary>
    public string RouterCli { get; set; } = "";
    public int RouterPort { get; set; } = 20128;
    public int GatePort { get; set; } = 20129; // fila anti-429 (src/gate.ts) na frente do 9Router
    /// <summary>Pasta do repositório (onde fica src/main.ts). Vazio = procura subindo a partir do app.</summary>
    public string JarvisDir { get; set; } = "";
    public int JarvisPort { get; set; } = 20150;
    public string JarvisProject { get; set; } = "main";
    public string ObsidianVault { get; set; } = "MEU_VAULT";
    public string SalaNote { get; set; } = "20-Operations/CHAT/SALA";
    /// <summary>Agentes com loop próprio (tools/ligar-agentes.*). Os outros aparecem só com o status.</summary>
    public List<string> LoopAgents { get; set; } = ["claude", "codex", "droid", "hermes", "openclaw", "opencode", "qwen"];
    public List<ManagedApp> Apps { get; set; } = [];
    // Chamada no painel do HUD (ajustes na aba Ajustes do Launcher).
    /// <summary>Modo que já vem marcado: debate, brainstorm, revisao ou goal.</summary>
    public string CallModo { get; set; } = "debate";
    /// <summary>Quem já vem marcado para entrar. Vazio = o time todo.</summary>
    public List<string> CallPeople { get; set; } = [];
    /// <summary>Os agentes falam um depois do outro sozinhos (desligado: botão "Próxima fala").</summary>
    public bool CallAutoAdvance { get; set; } = true;
    /// <summary>Lê cada fala em voz alta no PC.</summary>
    public bool CallVoice { get; set; }
}

public sealed class ManagedApp
{
    public string Name { get; set; } = "";
    public string ProcessName { get; set; } = "";
    public string ExecutablePath { get; set; } = "";
    public string Arguments { get; set; } = "";
    /// <summary>Scripts (ex.: War Room) não têm processo próprio para detectar: sempre abre uma janela nova.</summary>
    public bool AlwaysLaunch { get; set; }
    [JsonIgnore] public string? DetectedPath { get; set; }
}

public enum ServiceState { Off, Starting, Online, Exposed }
