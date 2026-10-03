package dev.agentcontrol.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.UiState
import dev.agentcontrol.app.data.chatMeta
import kotlinx.coroutines.delay

/**
 * HUD do celular (2026-10-03): a mesma ideia da faixa do topo do PC. O AgentC fala a última mensagem
 * num balão (boca mexendo por alguns segundos) e embaixo cada agente com o ponto do estado.
 * Tocar no balão abre a sala; tocar num agente abre o diário dele.
 */
@Composable
fun PhoneHud(ui: UiState, openSala: () -> Unit, openAgent: (String) -> Unit) {
    val k = Clay.c
    val last = ui.chat.lastOrNull()
    val line = last?.let { e -> e.chatMeta().text.lineSequence().firstOrNull { it.isNotBlank() }?.trim() }
    val who = when { last == null -> "AgentC"; last.agent == "DONO" -> "Você"; else -> last.agent }
    val text = when {
        ui.offline != null -> "Não alcanço o seu PC agora. Confira o Tailscale."
        line.isNullOrBlank() -> "Tudo calmo. Mande uma ordem quando quiser."
        else -> line
    }
    // Fala por alguns segundos sempre que chega mensagem nova.
    var talking by remember { mutableStateOf(false) }
    LaunchedEffect(last?.id) { if (last != null) { talking = true; delay(2600); talking = false } }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp).clay(RoundedCornerShape(20.dp), elevation = 3.dp).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AgentC(44.dp, stroke = if (ui.pending.isNotEmpty()) k.warn else null, alive = ui.offline == null, talking = talking)
            AnimatedContent(
                targetState = who to text, modifier = Modifier.weight(1f).clickable(onClick = openSala),
                transitionSpec = { (fadeIn() + slideInVertically { it / 3 }) togetherWith fadeOut() }, label = "fala",
            ) { (w, t) ->
                Column(Modifier.fillMaxWidth().background(k.well, RoundedCornerShape(topStart = 4.dp, topEnd = 14.dp, bottomStart = 14.dp, bottomEnd = 14.dp)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Text(w, color = k.brandText, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Text(t, color = k.text, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        // Modo Time: quem mais está online agora (você não aparece).
        val others = ui.team?.people?.filter { it.online && it.id != ui.team.me.id }.orEmpty()
        if (others.isNotEmpty()) Text("Online: " + others.joinToString(", ") { it.name }, color = k.ok, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        if (ui.state.agents.isNotEmpty()) Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            ui.state.agents.forEach { a ->
                val c = statusColor(a.latest?.status, k)
                Column(Modifier.clickable { openAgent(a.id) }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Box {
                        Avatar(a.id, 34)
                        Box(Modifier.align(Alignment.BottomEnd).offset(x = 2.dp, y = 2.dp).size(11.dp).background(c, CircleShape).border(2.dp, k.surface, CircleShape))
                    }
                    Text(a.id.lowercase().replaceFirstChar { it.uppercase() }, color = k.muted, fontSize = 10.sp, maxLines = 1)
                }
            }
        }
    }
}
