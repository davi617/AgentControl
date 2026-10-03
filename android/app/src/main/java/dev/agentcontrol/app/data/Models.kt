package dev.agentcontrol.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class QuotaWindow(val name: String = "", val remainingPercent: Double = 0.0, val windowMinutes: Int = 0, val resetsAt: Long? = null)
@Serializable
data class AgentQuota(val agent: String, val provider: String = "", val status: String = "unavailable", val remainingPercent: Double? = null,
    val windows: List<QuotaWindow> = emptyList(), val checkedAt: String? = null, val detail: String = "")
@Serializable
data class LimitsSnap(val agents: List<AgentQuota> = emptyList(), val updatedAt: String = "", val refreshSeconds: Int = 60)

// Espelho das respostas da API do JARVIS (src/server.ts). Campos novos no servidor são ignorados.

@Serializable
data class Project(val id: String, val name: String, val goal: String? = null)

@Serializable
data class Entry(
    val id: Long,
    val agent: String,
    val kind: String,
    val heading: String = "",
    val body: String = "",
    val status: String? = null,
    val task: String? = null,
    val model: String? = null,
    val ts: String = "",
)

@Serializable
data class Command(
    val code: String,
    val target: String,
    val text: String,
    @SerialName("requires_approval") val requiresApproval: Int = 0,
    val approval: String? = null,
    val status: String,
    @SerialName("updated_by") val updatedBy: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
) {
    val pending: Boolean get() = approval == "pending"
}

@Serializable
data class Latest(
    val heading: String = "",
    val task: String? = null,
    val status: String? = null,
    val model: String? = null,
    val ts: String = "",
)

@Serializable
data class AgentView(
    val id: String,
    val model: String? = null,
    val statusFileMtime: String? = null,
    val vaultCopyStale: Boolean? = null,
    val done: Boolean = false,
    val latest: Latest? = null,
)

@Serializable
data class LockInfo(val name: String, val pid: Int? = null, val alive: Boolean = false)

@Serializable
data class TaskRow(val id: String, val owner: String, val status: String, val task: String, val gate: String = "")

@Serializable
data class JarvisState(
    val goal: String? = null,
    val agents: List<AgentView> = emptyList(),
    val locks: List<LockInfo> = emptyList(),
    val tasks: List<TaskRow> = emptyList(),
)

@Serializable
data class Summary(
    @SerialName("created_at") val createdAt: String,
    val model: String? = null,
    val status: String,
    val text: String,
)

@Serializable
data class SummaryResponse(val deterministic: String, val llm: List<Summary> = emptyList())

@Serializable
data class CommandResponse(val command: Command, val reply: String)

@Serializable
data class ErrorResponse(val error: String)

/** Formato que o chat espera: "- para:", "- assunto:", "- via:" no começo do corpo. */
data class ChatMeta(val para: String, val assunto: String?, val via: String?, val text: String)

fun Entry.chatMeta(): ChatMeta {
    fun field(k: String) = Regex("^\\s*-\\s*$k\\s*:\\s*(.+)$", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE))
        .find(body)?.groupValues?.get(1)?.trim()
    val text = body.replace(Regex("^\\s*-\\s*(para|assunto|via)\\s*:.*$", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)), "")
        .replace(Regex("\\*\\*(.+?)\\*\\*"), "$1")
        .trim()
    return ChatMeta(field("para") ?: "TODOS", field("assunto"), field("via"), text.ifEmpty { heading })
}

/** Versão do app publicada no PC (tools/publicar-app.ps1). */
@Serializable
data class AppVersion(val versionCode: Long, val versionName: String, val sha256: String, val size: Long)

// ---------- chamada de voz em grupo (/api/call/*) ----------
@Serializable
data class CallTurn(val n: Int, val speaker: String, val text: String, val ts: String)

@Serializable
data class CallParticipant(val id: String, val papel: String)

@Serializable
data class CallState(
    val id: String,
    val topic: String,
    val status: String, // ATIVA · AGUARDANDO_DONO · ENCERRADA
    val participants: List<CallParticipant> = emptyList(),
    val turns: List<CallTurn> = emptyList(),
    val attachments: List<CallAttachment> = emptyList(),
    val modo: String = "debate",
    val resumo: CallSummary? = null,
)

@Serializable
data class CallPerson(val id: String, val papel: String = "", val virtual: Boolean = false)

@Serializable
data class CallTask(val agente: String, val tarefa: String)

@Serializable
data class CallSummary(
    val status: String, // gerando · ok · erro
    val decisoes: List<String> = emptyList(),
    val tarefas: List<CallTask> = emptyList(),
    val pendencias: List<String> = emptyList(),
    val erro: String? = null,
)

@Serializable
data class CallAttachment(val name: String, val kind: String)

@Serializable
data class CallNext(val turn: CallTurn? = null, val call: CallState? = null)

// ---------- saúde (/api/health) ----------
@Serializable
data class GateSlot(val segundos: Int, val voz: Boolean = false)

@Serializable
data class GateInfo(
    val ok: Boolean,
    val inFlight: Int? = null,
    val queued: Int? = null,
    val voiceMode: Boolean? = null,
    val retried429: Int? = null,
    val cut: Int? = null,
    val ativos: List<GateSlot> = emptyList(),
    val travada: Boolean? = null,
    val erro: String? = null,
)

@Serializable
data class LoopInfo(val agent: String, val rodadas: Int, val timeouts: Int, val ultima: String? = null, val estado: String, val minutos: Int? = null)

@Serializable
data class RamInfo(val livreMb: Int, val totalMb: Int)

@Serializable
data class Health(
    val gate: GateInfo,
    val loops: List<LoopInfo> = emptyList(),
    val ram: RamInfo,
    val alertas: List<String> = emptyList(),
    val pausa: PauseInfo = PauseInfo(),
    val cpu: Int? = null, // % em uso agora
    val processos: List<Proc> = emptyList(), // os 5 que mais usam RAM
    val ligadoHaMin: Int? = null, // tempo desde que o PC ligou
    val disco: RamInfo? = null, // disco do vault (livreMb/totalMb)
)

// ---------- cérebro (vault do Obsidian, só leitura) ----------
@Serializable
data class NoteHit(val path: String, val title: String, val folder: String = "", val mtime: String = "", val snippet: String = "")

@Serializable
data class NoteSearch(val total: Int, val hits: List<NoteHit> = emptyList())

@Serializable
data class Note(val path: String, val title: String, val text: String, val links: List<String> = emptyList())
// ---------- modelos dos agentes CLAUDE e CODEX ----------
@Serializable
data class ModelOption(val id: String, val label: String, val note: String? = null, val efforts: List<String> = emptyList())

@Serializable
data class AgentModels(
    val id: String,
    val route: String = "",
    val current: String? = null,
    val effort: String? = null,
    val efforts: List<String> = emptyList(),
    val options: List<ModelOption> = emptyList(),
    val note: String? = null,
)

@Serializable
data class PauseInfo(val paused: Boolean = false, val agora: Boolean = false, val desde: String? = null)
// ---------- notas rápidas, favoritos, atalhos, busca, estatísticas ----------
@Serializable
data class QuickNote(val id: Long, val text: String, @SerialName("created_at") val createdAt: String = "", val done: Int = 0)

@Serializable
data class Favorite(val path: String, val title: String, @SerialName("added_at") val addedAt: String = "")

@Serializable
data class Shortcut(val id: Long, val label: String, val text: String, val target: String)

@Serializable
data class SearchHit(val kind: String, val title: String, val snippet: String = "", val ref: String = "")

@Serializable
data class AgentStat(val agent: String, val registros: Int = 0, val done: Int = 0, val travado: Int = 0)

@Serializable
data class CommandStats(val total: Int = 0, val done: Int = 0, val bloqueados: Int = 0, val protegidos: Int = 0)

@Serializable
data class TeamStats(val dias: Int = 7, val agentes: List<AgentStat> = emptyList(), val comandos: CommandStats = CommandStats(), val porDia: List<CmdDay> = emptyList())

@Serializable
data class CmdDay(val dia: String, val total: Int = 0, val done: Int = 0)

@Serializable
data class Proc(val nome: String, val mb: Int = 0)

// ---------- uso dos agentes (fila), histórico de chamadas, sobre ----------
@Serializable
data class UsageAgent(
    val agent: String,
    val req: Int = 0,
    val ok: Int = 0,
    val err: Int = 0,
    val r429: Int = 0,
    val pin: Long = 0,
    val pout: Long = 0,
    val msMedio: Int = 0,
    val models: Map<String, Int> = emptyMap(),
)

@Serializable
data class UsageDay(val dia: String, val req: Int = 0, val tokens: Long = 0)

@Serializable
data class UsageSnap(val dias: Int = 7, val agentes: List<UsageAgent> = emptyList(), val porDia: List<UsageDay> = emptyList())

@Serializable
data class CallInfo(val id: String, val path: String, val topic: String = "", val data: String = "", val falas: Int = 0, val tarefas: Int = 0)

@Serializable
data class AboutJarvis(val commit: String = "", val node: String = "", val ligadoHaMin: Int = 0)

@Serializable
data class AboutPc(val nome: String = "", val ligadoHaMin: Int = 0, val nucleos: Int = 0)

@Serializable
data class About(val jarvis: AboutJarvis = AboutJarvis(), val pc: AboutPc = AboutPc(), val app: AppVersion? = null)


// ---------- Modo Time (2026-10-03): pessoas trabalhando junto com os agentes ----------
@Serializable
data class TeamMe(val id: String, val name: String, val role: String, val owner: Boolean = false)

@Serializable
data class TeamPerson(val id: String, val name: String, val role: String, val color: String = "#F97316", val online: Boolean = false, val lastSeen: String? = null, val via: String? = null)

@Serializable
data class TeamInfo(val me: TeamMe, val people: List<TeamPerson> = emptyList())

@Serializable
data class RemoteAddr(val host: String, val port: Int)

@Serializable
data class TeamInvite(val person: TeamPerson, val token: String, val remote: RemoteAddr? = null)
