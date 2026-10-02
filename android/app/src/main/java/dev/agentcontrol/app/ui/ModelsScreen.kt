@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package dev.agentcontrol.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.data.AgentModels

/** Escolher o modelo e a força (raciocínio) de cada agente. A lista e as forças vêm do PC (/api/models). */
@Composable
fun ModelsScreen(models: List<AgentModels>?, busy: Boolean, load: () -> Unit, choose: (agent: String, model: String, effort: String?) -> Unit) {
    val k = Clay.c
    LaunchedEffect(Unit) { load() }
    if (models == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Lendo os modelos…", color = k.muted) }
        return
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Text(
                "Cada agente com o modelo e a força que você quiser. Muda só os agentes do time: o Claude e o Codex que você usa no PC continuam iguais. Vale a partir da próxima rodada.",
                color = k.muted, fontSize = 13.sp, lineHeight = 19.sp,
            )
        }
        models.forEach { m ->
            item(key = m.id) {
                Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Avatar(m.id, 36)
                        Column {
                            Text(m.id, color = k.text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Text(m.route, color = k.muted, fontSize = 12.sp)
                        }
                    }
                    m.note?.let { Text(it, color = k.warn, fontSize = 12.sp, lineHeight = 17.sp) }
                    if (m.options.isEmpty()) Text("Nenhum modelo encontrado.", color = k.warn)
                    m.options.forEach { o ->
                        val on = o.id == m.current
                        Row(
                            Modifier.fillMaxWidth().clay(RoundedCornerShape(16.dp), elevation = if (on) 6.dp else 2.dp, color = if (on) k.brandSoft else null)
                                .clickable(enabled = !busy && !on) { choose(m.id, o.id, if (m.id == "CODEX") (m.effort?.takeIf { it in o.efforts } ?: "high") else m.effort) }
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Box(Modifier.size(18.dp).clay(CircleShape, elevation = 2.dp, color = if (on) k.brand else null))
                            Column(Modifier.weight(1f)) {
                                Text(o.label, color = k.text, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium, fontSize = 15.sp)
                                o.note?.let { Text(it, color = k.muted, fontSize = 12.sp) }
                                Text(o.id, color = k.muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace, maxLines = 1)
                            }
                        }
                    }
                    // Força (raciocínio): lista que o PC mandou para este agente (no Codex depende do modelo).
                    val cur = m.options.firstOrNull { it.id == m.current }
                    if (cur != null && m.efforts.isNotEmpty()) {
                        SectionTitle("Força")
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            m.efforts.forEach { e ->
                                val on = e == m.effort
                                Text(
                                    e, color = if (on) k.onBrand else k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.clay(RoundedCornerShape(16.dp), elevation = if (on) 6.dp else 3.dp, color = if (on) k.brand else null)
                                        .clickable(enabled = !busy && !on) { choose(m.id, cur.id, e) }.padding(horizontal = 14.dp, vertical = 8.dp),
                                )
                            }
                        }
                        Text("Mais força = pensa mais antes de agir: melhor e mais lento. Leve = rápido para tarefas simples.", color = k.muted, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
