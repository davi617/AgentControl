package dev.agentcontrol.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxHeight
import dev.agentcontrol.app.data.Health
import dev.agentcontrol.app.data.PanicInfo
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import dev.agentcontrol.app.data.LoopInfo

/** Saúde: a fila da NVIDIA está andando? Os agentes estão rodando? O PC tem RAM? Tudo do celular. */
@Composable
fun HealthScreen(
    h: Health?, pause: (on: Boolean, agora: Boolean) -> Unit = { _, _ -> }, latencyMs: Long? = null,
    panic: PanicInfo? = null, isOwner: Boolean = true, onPanic: (Boolean) -> Unit = {},
) {
    val k = Clay.c
    if (h == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Conferindo o PC…", color = k.muted) }
        return
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Veredito em uma linha, como o dono pergunta: "tá funcionando?"
        item {
            val bad = h.alertas.any { !it.startsWith("Modo voz") }
            Row(
                Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp, color = if (bad) k.brandSoft else null).padding(16.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(if (bad) Icons.Outlined.Warning else Icons.Outlined.CheckCircle, null, tint = if (bad) k.warn else k.ok)
                Column {
                    Text(if (bad) "Tem coisa precisando de atenção" else "Tudo rodando", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = k.text)
                    Text("atualiza a cada 10 s", color = k.muted, fontSize = 12.sp)
                }
            }
        }
        // Botão de pânico: para todos os agentes (e retoma). Fica no topo, sempre à mão.
        item {
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp, color = if (h.pausa.paused) k.brandSoft else null).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (h.pausa.paused) "Agentes PAUSADOS por você" else "Controle dos agentes", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = k.text)
                Text(
                    if (h.pausa.paused) "Nenhuma rodada nova começa até você retomar." else "Parar: terminam a rodada atual e param. Parar agora: corta na hora.",
                    color = k.muted, fontSize = 13.sp, lineHeight = 18.sp,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (h.pausa.paused) PauseButton("Retomar agentes", k.ok, Modifier.weight(1f)) { pause(false, false) }
                    else {
                        PauseButton("Parar", k.warn, Modifier.weight(1f)) { pause(true, false) }
                        PauseButton("Parar agora", k.err, Modifier.weight(1f)) { pause(true, true) }
                    }
                }
            }
        }
        // Pânico (v4.0): só o dono. Dois toques para não disparar sem querer; o segundo tem 5 s para vir.
        if (isOwner || panic != null) item {
            var armed by remember { mutableStateOf(false) }
            LaunchedEffect(armed) { if (armed) { delay(5_000); armed = false } }
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp, color = if (panic != null) k.brandSoft else null).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (panic != null) "PÂNICO ligado por ${panic.by}" else "Pânico", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = if (panic != null) k.err else k.text)
                Text(
                    if (panic != null) "Agentes parados e acesso fechado para quem não é dono até você desligar."
                    else "Para TODOS os agentes agora, desliga os aparelhos conectados e fecha o acesso do time até você desligar.",
                    color = k.muted, fontSize = 13.sp, lineHeight = 18.sp,
                )
                if (isOwner) {
                    if (panic != null) PauseButton("Desligar o pânico", k.ok, Modifier.fillMaxWidth()) { onPanic(false) }
                    else PauseButton(if (armed) "Toque de novo: parar TUDO" else "Acionar pânico", k.err, Modifier.fillMaxWidth()) {
                        if (!armed) armed = true else { armed = false; onPanic(true) }
                    }
                }
            }
        }
        items(h.alertas) { a ->
            Text("• $a", color = if (a.startsWith("Modo voz")) k.muted else k.warn, fontSize = 14.sp, lineHeight = 20.sp)
        }

        item { SectionTitle("Fila da NVIDIA (anti-429)") }
        item {
            val g = h.gate
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 6.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!g.ok) Text("Fila ${g.erro ?: "fora do ar"}", color = k.err, fontWeight = FontWeight.Bold)
                else {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Stat("rodando", "${g.inFlight ?: 0}/4", Modifier.weight(1f))
                        Stat("esperando", "${g.queued ?: 0}", Modifier.weight(1f), warn = (g.queued ?: 0) > 20)
                        Stat("429 repetidos", "${g.retried429 ?: 0}", Modifier.weight(1f))
                    }
                    if (g.voiceMode == true) Text("Modo voz ligado: agentes esperando a chamada acabar.", color = k.brandText, fontSize = 13.sp)
                    g.ativos.forEach { s ->
                        val min = s.segundos / 60
                        Text(
                            "${if (s.voz) "voz" else "agente"} · ${if (min > 0) "$min min" else "${s.segundos} s"}",
                            color = if (s.segundos > 600) k.err else k.text2, fontSize = 13.sp, fontFamily = FontFamily.Monospace,
                        )
                    }
                    if ((g.cut ?: 0) > 0) Text("${g.cut} pedido(s) pendurado(s) cortado(s) desde que a fila ligou.", color = k.muted, fontSize = 12.sp)
                }
            }
        }

        item { SectionTitle("Agentes em loop") }
        if (h.loops.isEmpty()) item { Text("Nenhum loop registrado no PC.", color = k.muted) }
        items(h.loops, key = { it.agent }) { l -> LoopRow(l) }

        item { SectionTitle("PC") }
        item {
            val used = 1f - h.ram.livreMb.toFloat() / h.ram.totalMb.coerceAtLeast(1)
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 6.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                latencyMs?.let { ms -> Text("Resposta do PC: $ms ms${if (ms > 3000) " (lento: Tailscale ou PC ocupado)" else ""}", color = if (ms > 3000) k.warn else k.text, fontSize = 14.sp) }
                h.ligadoHaMin?.let { m -> Text("PC ligado há ${if (m >= 60) "${m / 60} h ${m % 60} min" else "$m min"}", color = k.text, fontSize = 14.sp) }
                h.cpu?.let { cpu ->
                    Text("CPU: $cpu% em uso", color = k.text, fontSize = 14.sp)
                    Meter(cpu / 100f)
                }
                Text("RAM: ${h.ram.livreMb} MB livres de ${h.ram.totalMb / 1024} GB", color = k.text, fontSize = 14.sp)
                Meter(used)
                if (h.processos.isNotEmpty()) {
                    Text("Quem mais usa RAM", color = k.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    h.processos.forEach { pr -> Text("${pr.nome.removeSuffix(".exe")} · ${pr.mb} MB", color = k.text2, fontSize = 13.sp, fontFamily = FontFamily.Monospace) }
                }
                h.disco?.let { d ->
                    Text("Disco do vault: ${d.livreMb / 1024} GB livres de ${d.totalMb / 1024} GB", color = k.text, fontSize = 14.sp)
                    Meter(1f - d.livreMb.toFloat() / d.totalMb.coerceAtLeast(1))
                }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier, warn: Boolean = false) {
    val k = Clay.c
    Column(modifier.clayWell(RoundedCornerShape(16.dp)).padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = if (warn) k.warn else k.text, fontWeight = FontWeight.Bold, fontSize = 20.sp)
        Text(label, color = k.muted, fontSize = 11.sp)
    }
}

@Composable
private fun LoopRow(l: LoopInfo) {
    val k = Clay.c
    val color: Color = when (l.estado) {
        "rodando" -> if ((l.minutos ?: 0) > 50) k.err else k.ok
        "esperando RAM", "estourou o tempo" -> k.warn
        "terminou", "esperando ordem" -> k.muted
        else -> k.err
    }
    Row(
        Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(l.agent, 34)
        Column(Modifier.weight(1f)) {
            Text(l.agent, color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            Text("${l.rodadas} rodadas · ${l.timeouts} estouros de tempo", color = k.muted, fontSize = 12.sp)
            l.motivo?.let { Text(it, color = k.err, fontSize = 12.sp, maxLines = 2) }
        }
        Column(horizontalAlignment = Alignment.End) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Dot(color); Text(l.estado, color = color, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
            l.minutos?.let { Text(if (it < 60) "há $it min" else "há ${it / 60} h", color = k.muted, fontSize = 11.sp) }
        }
    }
}

@Composable
private fun PauseButton(text: String, color: Color, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(46.dp).clay(RoundedCornerShape(18.dp), elevation = 6.dp, color = color).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = Color(0xFF0B0B0B), fontWeight = FontWeight.Bold, fontSize = 14.sp) }
}
/** Barra de uso: verde até 80%, amarela até 92%, vermelha acima. */
@Composable
private fun Meter(used: Float) {
    val k = Clay.c
    Box(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)).clayWell(RoundedCornerShape(5.dp))) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(used.coerceIn(0f, 1f)).background(if (used > .92f) k.err else if (used > .8f) k.warn else k.ok, RoundedCornerShape(5.dp)))
    }
}
