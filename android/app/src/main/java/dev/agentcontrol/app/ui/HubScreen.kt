package dev.agentcontrol.app.ui

import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.UiState
import dev.agentcontrol.app.data.chatMeta

// Navegação do app no padrão clamoryst (2026-09-28): barra fixa embaixo com as 4 telas do dia a dia
// e a tela "Mais" com todo o resto organizado por assunto (antes ficava escondido no menu lateral).

/** Abas da barra de baixo. Qualquer tela fora delas acende "Mais". */
private val TABS = listOf(
    Triple(Screen.HOME, "Início", Icons.Outlined.Home),
    Triple(Screen.AGENTES, "Agentes", Icons.Outlined.Groups),
    Triple(Screen.CHAMADA, "Chamada", Icons.Outlined.Call),
    Triple(Screen.COMANDOS, "Comandos", Icons.AutoMirrored.Outlined.ArrowForward),
    Triple(Screen.MAIS, "Mais", Icons.Outlined.MoreHoriz),
)

@Composable
fun BottomNav(current: Screen, pending: Int, callLive: Boolean, go: (Screen) -> Unit) {
    val k = Clay.c
    val active = TABS.firstOrNull { it.first == current }?.first ?: Screen.MAIS
    Column(Modifier.fillMaxWidth().background(k.bg)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(k.border))
        Row(Modifier.fillMaxWidth().navigationBarsPadding().height(62.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            TABS.forEach { (screen, label, icon) ->
                val on = screen == active
                Column(
                    Modifier.weight(1f).fillMaxSize().clickable { go(screen) },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    Box {
                        Box(
                            Modifier.size(width = 52.dp, height = 28.dp).background(animateColorAsState(if (on) k.brandSoft else Color.Transparent, tween(260), label = "aba").value, RoundedCornerShape(14.dp)),
                            contentAlignment = Alignment.Center,
                        ) { Icon(icon, label, tint = if (on) k.brandText else k.muted, modifier = Modifier.size(20.dp)) }
                        val badge = when (screen) { Screen.COMANDOS -> pending > 0; Screen.CHAMADA -> callLive; else -> false }
                        if (badge) Box(Modifier.align(Alignment.TopEnd).offset(x = (-8).dp, y = 2.dp).size(8.dp).background(if (screen == Screen.CHAMADA) k.ok else k.err, RoundedCornerShape(4.dp)))
                    }
                    Text(label, fontSize = 11.sp, color = if (on) k.text else k.muted, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
                }
            }
        }
    }
}

private data class HubItem(val screen: Screen, val title: String, val desc: String, val icon: ImageVector)

private val HUB = listOf(
    "Conversar" to listOf(
        HubItem(Screen.VOZ, "Falar com o JARVIS", "Conversa por voz", Icons.Outlined.RecordVoiceOver),
        HubItem(Screen.SALA, "Sala", "Histórico da conversa", Icons.Outlined.ChatBubbleOutline),
        HubItem(Screen.RESUMOS, "Resumos", "O que aconteceu", Icons.Outlined.AutoAwesome),
        HubItem(Screen.CHAMADAS, "Chamadas", "Histórico e atas", Icons.Outlined.History),
    ),
    "Trabalho" to listOf(
        HubItem(Screen.TAREFAS, "Tarefas", "Goal e pendências", Icons.Outlined.Checklist),
        HubItem(Screen.NOTAS, "Notas rápidas", "Lembretes seus", Icons.Outlined.EditNote),
        HubItem(Screen.BUSCA, "Buscar", "Em tudo de uma vez", Icons.Outlined.Search),
        HubItem(Screen.CEREBRO, "Cérebro", "Vault do Obsidian", Icons.Outlined.Psychology),
    ),
    "Monitoramento" to listOf(
        HubItem(Screen.SAUDE, "Saúde do PC", "RAM, CPU e pausa", Icons.Outlined.MonitorHeart),
        HubItem(Screen.USO, "Uso dos agentes", "Tokens e limites", Icons.Outlined.Speed),
        HubItem(Screen.STATS, "Estatísticas", "Produção do time", Icons.Outlined.BarChart),
        HubItem(Screen.LINHA, "Linha do tempo", "Tudo em ordem", Icons.Outlined.Timeline),
    ),
    "Configuração" to listOf(
        HubItem(Screen.MODELOS, "Modelos e força", "Cérebro de cada agente", Icons.Outlined.Tune),
        HubItem(Screen.VOZES, "Vozes", "Voz de cada agente", Icons.Outlined.GraphicEq),
        HubItem(Screen.AJUSTES, "Ajustes", "Tema, avisos, segurança", Icons.Outlined.Settings),
        HubItem(Screen.SOBRE, "Sobre", "Versões e atualização", Icons.Outlined.Info),
    ),
)

/** Tela "Mais": todas as funções em grade, por assunto. */
@Composable
fun MoreScreen(ui: UiState, forget: () -> Unit = {}, go: (Screen) -> Unit) {
    val k = Clay.c
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
        var n = 0
        HUB.forEach { (section, items) ->
            SectionTitle(section)
            items.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    pair.forEach { it2 ->
                        val idx = n++
                        val badge = when (it2.screen) {
                            Screen.NOTAS -> ui.notes.count { n -> n.done == 0 }
                            Screen.SAUDE -> ui.health?.alertas?.size ?: 0
                            else -> 0
                        }
                        Column(
                            Modifier.weight(1f).staggerIn(idx, 30L).springClick { go(it2.screen) }.clay(RoundedCornerShape(16.dp), elevation = 2.dp).padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(36.dp).clayWell(RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                                    Icon(it2.icon, null, tint = k.brandText, modifier = Modifier.size(19.dp))
                                }
                                Spacer(Modifier.weight(1f))
                                if (badge > 0) Text("$badge", color = k.onBrand, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                    modifier = Modifier.background(k.brand, RoundedCornerShape(10.dp)).padding(horizontal = 7.dp, vertical = 1.dp))
                            }
                            Column {
                                Text(it2.title, color = k.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(it2.desc, color = k.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        SectionTitle("Conexão")
        Row(
            Modifier.fillMaxWidth().springClick(onClick = forget).clay(RoundedCornerShape(16.dp), elevation = 2.dp).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.size(36.dp).clayWell(RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.AutoMirrored.Outlined.Logout, null, tint = k.err, modifier = Modifier.size(19.dp))
            }
            Column(Modifier.weight(1f)) {
                Text("Desconectar este celular", color = k.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text("Esquece o PC e o token salvos aqui", color = k.muted, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

/** Número de destaque do Início (agentes, comandos abertos, RAM livre). */
@Composable
fun MetricTile(label: String, value: String, modifier: Modifier = Modifier, tone: Color? = null) {
    // Número puro conta de 0 até o valor (anime.js); texto (ex.: "—") aparece direto.
    val shown = value.toIntOrNull()?.let { "${countUp(it)}" } ?: value
    val k = Clay.c
    Column(modifier.clay(RoundedCornerShape(14.dp), elevation = 2.dp).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text(label.uppercase(), color = k.muted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp, maxLines = 1)
        Text(shown, color = tone ?: k.text, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** Últimas mensagens da sala, em lista com divisórias (Início). */
@Composable
fun RecentActivity(ui: UiState, open: () -> Unit) {
    val k = Clay.c
    val last = ui.chat.takeLast(4).reversed()
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionTitle("Atividade recente")
            Spacer(Modifier.weight(1f))
            Text("Ver sala", color = k.brandText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = open).padding(top = 10.dp, end = 4.dp))
        }
        Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(16.dp), elevation = 2.dp).padding(horizontal = 14.dp)) {
            if (last.isEmpty()) Text("Nenhuma mensagem ainda.", color = k.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 14.dp))
            last.forEachIndexed { i, e ->
                Row(Modifier.fillMaxWidth().staggerIn(i + 4).clickable(onClick = open).padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(e.agent, 28)
                    Column(Modifier.weight(1f)) {
                        Text(if (e.agent == "DONO") "Você" else e.agent, color = k.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        Text(e.chatMeta().text.lineSequence().firstOrNull { it.isNotBlank() }?.trim().orEmpty(), color = k.text2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(shortTime(e.ts), color = k.muted, fontSize = 11.sp)
                }
                if (i < last.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(k.border))
            }
        }
    }
}
