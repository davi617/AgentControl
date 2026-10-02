@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package dev.agentcontrol.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.data.TaskRow

/** Ordem de leitura: o que está andando, o que espera alguém, o que travou, o que acabou. */
private val ORDER = listOf("WORKING", "ACK", "REVIEW", "ASSIGNED", "QUEUED", "BLOCKED", "FAILED", "DONE")
private fun rank(s: String) = ORDER.indexOfFirst { s.uppercase().startsWith(it) }.let { if (it < 0) ORDER.size else it }

/** Tarefas do Goal ativo (TASKS.md) agrupadas por status. Tocar abre a nota da tarefa no Cérebro, com o rastro de evidência. */
@Composable
fun TasksScreen(goal: String?, tasks: List<TaskRow>, open: (TaskRow) -> Unit) {
    val k = Clay.c
    var dono by rememberSaveable { mutableStateOf<String?>(null) }
    var busca by rememberSaveable { mutableStateOf("") }
    val donos = tasks.map { it.owner.substringBefore('/').substringBefore(',').trim() }.filter { it.isNotBlank() }.distinct().sorted()
    val all = tasks
    val tasks = all.filter { t ->
        (dono == null || t.owner.contains(dono!!, ignoreCase = true)) &&
            (busca.isBlank() || "${t.id} ${t.task} ${t.owner}".contains(busca.trim(), ignoreCase = true))
    }
    val groups = tasks.groupBy { it.status.uppercase().substringBefore(' ').substringBefore('_').ifEmpty { "—" } }.toSortedMap(compareBy({ rank(it) }, { it }))
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(goal ?: "sem Goal ativo", color = k.muted, fontSize = 12.sp, fontFamily = FontFamily.Monospace, maxLines = 1)
                val done = tasks.count { it.status.uppercase().startsWith("DONE") }
                Text("$done de ${tasks.size} tarefas concluídas", color = k.text, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    groups.forEach { (s, l) -> Text("$s ${l.size}", color = k.text2, fontSize = 12.sp, modifier = Modifier.clayWell(RoundedCornerShape(12.dp)).padding(horizontal = 10.dp, vertical = 5.dp)) }
                }
            }
        }
        item {
            Box(Modifier.fillMaxWidth().clayWell(RoundedCornerShape(22.dp)).padding(horizontal = 16.dp, vertical = 12.dp)) {
                if (busca.isEmpty()) Text("Buscar tarefa…", color = k.muted, fontSize = 14.sp)
                BasicTextField(busca, { busca = it }, singleLine = true, textStyle = TextStyle(color = k.text, fontSize = 14.sp), cursorBrush = SolidColor(k.brand), modifier = Modifier.fillMaxWidth())
            }
        }
        if (donos.size > 1) item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                (listOf<String?>(null) + donos).forEach { d ->
                    val on = d == dono
                    Text(d ?: "Todos", color = if (on) k.onBrand else k.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = if (on) 5.dp else 2.dp, color = if (on) k.brand else null)
                            .clickable { dono = d }.padding(horizontal = 12.dp, vertical = 7.dp))
                }
            }
        }
        if (tasks.isEmpty()) item { Text(if (all.isEmpty()) "Nenhuma tarefa no TASKS.md do Goal ativo." else "Nenhuma tarefa com esse filtro.", color = k.muted) }
        groups.forEach { (status, list) ->
            item(key = "h-$status") { SectionTitle("$status · ${list.size}") }
            items(list) { t ->
                Row(
                    Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).clickable { open(t) }.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Avatar(t.owner.substringBefore('/').substringBefore(',').trim().ifEmpty { "?" }, 34)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("${t.id} · ${t.task}", color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2)
                        Text(t.owner, color = k.muted, fontSize = 12.sp, maxLines = 1)
                    }
                    StatusBadge(t.status)
                }
            }
        }
    }
}
