package dev.agentcontrol.app

import android.content.Context
import dev.agentcontrol.app.data.Command
import dev.agentcontrol.app.data.Entry
import dev.agentcontrol.app.data.chatMeta

/**
 * Um lugar só para decidir os avisos do celular. O app aberto (ViewModel) e o serviço em segundo plano
 * chamam aqui; como o estado é compartilhado, o mesmo aviso nunca chega duas vezes.
 */
object AlertCenter {
    /** O app está na tela? (MainActivity liga/desliga.) Resposta do JARVIS só avisa com o app fora da tela. */
    @Volatile var foreground = false
    /** Preferências do dono (Ajustes): aprovacao · comando · jarvis. Ausente = ligado. */
    @Volatile var prefs: Map<String, Boolean> = emptyMap()
    /** Não perturbe (Ajustes): até esse horário nada avisa, menos VIOLATION. */
    @Volatile var muteUntil: Long = 0

    private val notified = mutableSetOf<String>()
    private val cmdStatus = mutableMapOf<String, String>()
    private var lastChatId = -1L

    private fun on(key: String) = prefs[key] != false && System.currentTimeMillis() >= muteUntil

    @Synchronized
    fun onCommands(context: Context, cmds: List<Command>) {
        val n = Notifier(context)
        for (c in cmds) {
            val before = cmdStatus.put(c.code, c.status)
            if (before != null && before != c.status && c.status in setOf("DONE", "BLOCKED", "REVIEW", "FAILED") && on("comando")) {
                n.commandDone(c.code, c.updatedBy ?: c.target, c.status, c.text)
            }
        }
        for (c in cmds.filter { it.pending }) if (notified.add(c.code) && on("aprovacao")) n.approval(c.code, c.text)
        // VIOLATION sempre avisa (agente agiu sem aprovação): não dá para desligar.
        for (c in cmds.filter { it.status == "VIOLATION" }) if (notified.add("v-${c.code}")) n.violation(c.code, c.text)
    }

    @Synchronized
    fun onChat(context: Context, chat: List<Entry>) {
        val newest = chat.maxOfOrNull { it.id } ?: return
        if (lastChatId >= 0 && !foreground && on("jarvis")) {
            chat.filter { it.id > lastChatId && it.agent == "JARVIS" }.lastOrNull()?.let { Notifier(context).jarvisReply(it.chatMeta().text) }
        }
        lastChatId = maxOf(lastChatId, newest)
    }
}
