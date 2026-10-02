@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package dev.agentcontrol.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.data.About
import dev.agentcontrol.app.data.CallInfo
import dev.agentcontrol.app.data.Entry
import dev.agentcontrol.app.data.UsageSnap

/** Número grande de tokens em texto curto: 30627 → "30,6 mil". */
fun shortNum(n: Long): String = when {
    n >= 1_000_000 -> "%.1f mi".format(n / 1_000_000.0).replace('.', ',')
    n >= 1_000 -> "%.1f mil".format(n / 1_000.0).replace('.', ',')
    else -> n.toString()
}

private fun duration(min: Int): String = when {
    min >= 1440 -> "${min / 1440} d ${min % 1440 / 60} h"
    min >= 60 -> "${min / 60} h ${min % 60} min"
    else -> "$min min"
}

@Composable
private fun PeriodChips(dias: Int, set: (Int) -> Unit, options: List<Pair<Int, String>> = listOf(1 to "Hoje", 7 to "7 dias", 30 to "30 dias")) {
    val k = Clay.c
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (d, label) ->
            val on = d == dias
            Text(label, color = if (on) k.onBrand else k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clay(RoundedCornerShape(16.dp), elevation = if (on) 5.dp else 2.dp, color = if (on) k.brand else null)
                    .clickable { set(d) }.padding(horizontal = 14.dp, vertical = 8.dp))
        }
    }
}

/** Barras verticais simples (por dia). */
@Composable
fun DayBars(values: List<Pair<String, Float>>, height: Int = 90) {
    val k = Clay.c
    val max = (values.maxOfOrNull { it.second } ?: 0f).coerceAtLeast(1f)
    Row(Modifier.fillMaxWidth().height(height.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
        values.forEach { (_, v) ->
            Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
                Box(Modifier.fillMaxWidth().fillMaxHeight((v / max).coerceIn(0.02f, 1f)).clip(RoundedCornerShape(topStart = 5.dp, topEnd = 5.dp)).background(if (v > 0) k.brand else k.well))
            }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        values.forEach { (label, _) -> Text(label, color = k.muted, fontSize = 9.sp, modifier = Modifier.weight(1f), maxLines = 1) }
    }
}

// ---------------- Uso dos agentes ----------------

/** Quem gasta quanto da NVIDIA: pedidos, tokens, erros, 429 e tempo médio; por dia e por modelo. */
@Composable
fun UsageScreen(u: UsageSnap?, load: (Int) -> Unit) {
    val k = Clay.c
    var dias by rememberSaveable { mutableIntStateOf(7) }
    LaunchedEffect(dias) { load(dias) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PeriodChips(dias, { dias = it }) }
        if (u == null) { item { Text("Carregando…", color = k.muted) }; return@LazyColumn }
        val totReq = u.agentes.sumOf { it.req }
        val totTok = u.agentes.sumOf { it.pin + it.pout }
        val tot429 = u.agentes.sumOf { it.r429 }
        item {
            Row(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp).padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("pedidos" to totReq.toString(), "tokens" to shortNum(totTok), "429" to tot429.toString()).forEach { (l, v) ->
                    Column(Modifier.weight(1f).clayWell(RoundedCornerShape(14.dp)).padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(v, color = k.text, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                        Text(l, color = k.muted, fontSize = 11.sp)
                    }
                }
            }
        }
        if (u.porDia.size > 1) item {
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 6.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Tokens por dia", color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                DayBars(u.porDia.map { it.dia.takeLast(2) to it.tokens.toFloat() })
            }
        }
        item { SectionTitle("Por agente") }
        if (u.agentes.isEmpty()) item { Text("Nenhum uso no período. (A contagem por agente começou em 27/09.)", color = k.muted, fontSize = 13.sp) }
        val maxTok = (u.agentes.maxOfOrNull { it.pin + it.pout } ?: 1L).coerceAtLeast(1L)
        items(u.agentes, key = { it.agent }) { a ->
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(a.agent, 32)
                    Text(a.agent, color = k.text, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    Text("${shortNum(a.pin + a.pout)} tokens", color = k.brandText, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                }
                Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).clayWell(RoundedCornerShape(4.dp))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(((a.pin + a.pout).toFloat() / maxTok).coerceIn(0f, 1f)).background(k.brand, RoundedCornerShape(4.dp)))
                }
                Text("${a.req} pedidos · ${a.err} erros · ${a.r429}× 429 · ${a.msMedio / 1000.0}s em média".replace('.', ','), color = k.muted, fontSize = 12.sp)
                Text("entrada ${shortNum(a.pin)} · saída ${shortNum(a.pout)}", color = k.muted, fontSize = 12.sp)
                if (a.models.isNotEmpty()) Text(a.models.entries.sortedByDescending { it.value }.joinToString(" · ") { "${it.key.substringAfterLast('/')} ${it.value}" },
                    color = k.text2, fontSize = 11.sp, fontFamily = FontFamily.Monospace, maxLines = 2)
            }
        }
        item { Text("CHAMADA = falas da chamada de voz · JARVIS = respostas no chat e resumos · OUTRO = sem nome.", color = k.muted, fontSize = 11.sp) }
    }
}

// ---------------- Linha do tempo ----------------

/** Tudo o que os agentes registraram (STATUS, líder, eventos), mais novo primeiro, com filtro por agente. */
@Composable
fun FeedScreen(feed: List<Entry>?, agent: String?, agents: List<String>, load: (String?) -> Unit) {
    val k = Clay.c
    LaunchedEffect(Unit) { load(agent) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                (listOf<String?>(null) + agents).forEach { a ->
                    val on = a == agent
                    Text(a ?: "Todos", color = if (on) k.onBrand else k.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = if (on) 5.dp else 2.dp, color = if (on) k.brand else null)
                            .clickable { load(a) }.padding(horizontal = 12.dp, vertical = 7.dp))
                }
            }
        }
        if (feed == null) { item { Text("Carregando…", color = k.muted) }; return@LazyColumn }
        if (feed.isEmpty()) item { Text("Nada registrado.", color = k.muted) }
        items(feed, key = { it.id }) { e ->
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 3.dp).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Avatar(e.agent, 26)
                    Text(e.agent, color = k.text, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    Text(e.kind, color = k.muted, fontSize = 11.sp)
                    Box(Modifier.weight(1f))
                    if (e.status != null) StatusBadge(e.status)
                }
                if (e.heading.isNotBlank()) Text(e.heading, color = k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2)
                Text(e.body.replace(Regex("\\s+"), " ").take(240), color = k.text2, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 4)
                Text(shortTime(e.ts), color = k.muted, fontSize = 11.sp)
            }
        }
    }
}

// ---------------- Histórico de chamadas ----------------

@Composable
fun CallsHistoryScreen(calls: List<CallInfo>?, load: () -> Unit, open: (String) -> Unit) {
    val k = Clay.c
    LaunchedEffect(Unit) { load() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (calls == null) { item { Text("Carregando…", color = k.muted) }; return@LazyColumn }
        if (calls.isEmpty()) item { Text("Nenhuma chamada ainda.", color = k.muted) }
        items(calls, key = { it.id }) { c ->
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).clickable { open(c.path) }.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(c.topic.ifBlank { c.id }, color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2)
                Text("${c.id.removePrefix("CALL-").take(16).replace('-', ' ')} · ${c.falas} falas · ${c.tarefas} tarefas", color = k.muted, fontSize = 12.sp)
            }
        }
        item { Text("Toque para abrir a ata no Cérebro.", color = k.muted, fontSize = 11.sp) }
    }
}

// ---------------- Sobre ----------------

@Composable
fun AboutScreen(about: About?, appVersion: String, load: () -> Unit, checkUpdate: () -> Unit) {
    val k = Clay.c
    LaunchedEffect(Unit) { load() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("JARVIS", color = k.text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text("App neste celular: $appVersion", color = k.text2, fontSize = 14.sp)
                about?.app?.let { Text("Publicado no PC: ${it.versionName}", color = k.text2, fontSize = 14.sp) }
                about?.let {
                    Text("Servidor: commit ${it.jarvis.commit.ifBlank { "?" }} · Node ${it.jarvis.node}", color = k.text2, fontSize = 14.sp)
                    Text("JARVIS ligado há ${duration(it.jarvis.ligadoHaMin)}", color = k.text2, fontSize = 14.sp)
                    Text("PC ${it.pc.nome} ligado há ${duration(it.pc.ligadoHaMin)} · ${it.pc.nucleos} núcleos", color = k.text2, fontSize = 14.sp)
                } ?: Text("Carregando…", color = k.muted)
                Text("Verificar atualização agora", color = k.onBrand, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                    modifier = Modifier.padding(top = 6.dp).clay(RoundedCornerShape(16.dp), elevation = 5.dp, color = k.brand).clickable(onClick = checkUpdate).padding(horizontal = 16.dp, vertical = 10.dp))
            }
        }
    }
}
