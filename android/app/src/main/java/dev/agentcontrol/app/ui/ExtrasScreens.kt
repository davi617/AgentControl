package dev.agentcontrol.app.ui

import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.data.QuickNote
import dev.agentcontrol.app.data.SearchHit
import dev.agentcontrol.app.data.TeamStats

/** Caixa de texto em relevo, usada nas telas novas. */
@Composable
private fun Field(value: String, onValue: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, single: Boolean = true) {
    val k = Clay.c
    Box(modifier.heightIn(min = 50.dp).clayWell(RoundedCornerShape(24.dp)).padding(horizontal = 18.dp, vertical = 14.dp)) {
        if (value.isEmpty()) Text(placeholder, color = k.muted, fontSize = 15.sp)
        BasicTextField(value, onValue, singleLine = single, maxLines = if (single) 1 else 5, textStyle = TextStyle(color = k.text, fontSize = 15.sp), cursorBrush = SolidColor(k.brand), modifier = Modifier.fillMaxWidth())
    }
}

// ---------------- Notas rápidas ----------------

/** Anotar algo na hora, sem passar pela sala e sem gastar a NVIDIA. Fica no vault também. */
@Composable
fun NotesScreen(notes: List<QuickNote>, add: (String) -> Unit, toggle: (Long, Boolean) -> Unit, delete: (Long) -> Unit, share: () -> Unit = {}) {
    val k = Clay.c
    var text by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Field(text, { text = it }, "Anotar… (ex.: ver o login do Droid amanhã)", Modifier.weight(1f), single = false)
            Box(
                Modifier.size(48.dp).clay(CircleShape, elevation = 8.dp, color = k.brand).clickable(enabled = text.isNotBlank()) { add(text); text = "" },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.Add, "Anotar", tint = k.onBrand) }
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (notes.isNotEmpty()) item {
                Text("Compartilhar todas", color = k.brandText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = 3.dp).clickable(onClick = share).padding(horizontal = 14.dp, vertical = 8.dp))
            }
            if (notes.isEmpty()) item { Text("Nenhuma nota ainda. O que você anotar aqui vai também para o vault, em 20-Operations/Notas Rapidas.", color = k.muted, fontSize = 14.sp) }
            items(notes, key = { it.id }) { n ->
                val done = n.done == 1
                Row(
                    Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = if (done) 1.dp else 4.dp).padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        Modifier.size(28.dp).clip(CircleShape).clayWell(CircleShape).clickable { toggle(n.id, !done) },
                        contentAlignment = Alignment.Center,
                    ) { if (done) Icon(Icons.Outlined.Check, "Feito", tint = k.ok, modifier = Modifier.size(18.dp)) }
                    Column(Modifier.weight(1f)) {
                        Text(n.text, color = if (done) k.muted else k.text, fontSize = 15.sp, lineHeight = 21.sp, textDecoration = if (done) TextDecoration.LineThrough else null)
                        Text(shortTime(n.createdAt), color = k.muted, fontSize = 11.sp)
                    }
                    Icon(Icons.Outlined.Close, "Apagar", tint = k.muted, modifier = Modifier.size(20.dp).clickable { delete(n.id) })
                }
            }
        }
    }
}

// ---------------- Buscar em tudo ----------------

/** Uma busca só: sala, comandos, tarefas e cérebro. Tocar leva para o lugar certo. */
@Composable
fun SearchScreen(query: String, hits: List<SearchHit>?, search: (String) -> Unit, open: (SearchHit) -> Unit) {
    val k = Clay.c
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.padding(14.dp).fillMaxWidth().heightIn(min = 52.dp).clayWell(RoundedCornerShape(26.dp)).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Outlined.Search, null, tint = k.muted, modifier = Modifier.size(20.dp))
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) Text("Buscar na sala, comandos, tarefas e cérebro…", color = k.muted, fontSize = 15.sp)
                BasicTextField(query, search, singleLine = true, textStyle = TextStyle(color = k.text, fontSize = 15.sp), cursorBrush = SolidColor(k.brand), modifier = Modifier.fillMaxWidth())
            }
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when {
                query.isBlank() -> item { Text("Digite uma palavra: \"deploy\", \"T-007\", \"Hermes\"…", color = k.muted, fontSize = 14.sp) }
                hits == null -> item { Text("Buscando…", color = k.muted) }
                hits.isEmpty() -> item { Text("Nada encontrado.", color = k.muted) }
            }
            items(hits.orEmpty()) { h ->
                Row(
                    Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).clickable { open(h) }.padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    androidx.compose.material3.Icon(
                        when (h.kind) { "sala" -> Icons.Outlined.ChatBubbleOutline; "comando" -> Icons.AutoMirrored.Outlined.ArrowForward; "tarefa" -> Icons.Outlined.Checklist; else -> Icons.Outlined.Psychology },
                        null, tint = k.muted, modifier = Modifier.size(20.dp),
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("${h.kind.replaceFirstChar { it.uppercase() }} · ${h.title}", color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1)
                        if (h.snippet.isNotBlank()) Text(h.snippet, color = k.text2, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 3)
                    }
                }
            }
        }
    }
}

// ---------------- Estatísticas do time ----------------

/** Quem mais registrou, quanto concluiu e quanto travou; e como estão os seus comandos. */
@Composable
fun StatsScreen(stats: TeamStats?, load: (Int) -> Unit) {
    val k = Clay.c
    var dias by rememberSaveable { mutableIntStateOf(7) }
    LaunchedEffect(dias) { load(dias) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(1 to "Hoje", 7 to "7 dias", 30 to "30 dias").forEach { (d, label) ->
                    val on = d == dias
                    Text(label, color = if (on) k.onBrand else k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clay(RoundedCornerShape(16.dp), elevation = if (on) 5.dp else 2.dp, color = if (on) k.brand else null)
                            .clickable { dias = d }.padding(horizontal = 14.dp, vertical = 8.dp))
                }
            }
        }
        if (stats == null) { item { Text("Carregando…", color = k.muted) }; return@LazyColumn }
        item {
            val c = stats.comandos
            Row(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp).padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("comandos" to c.total, "concluídos" to c.done, "travados" to c.bloqueados, "protegidos" to c.protegidos).forEach { (l, v) ->
                    Column(Modifier.weight(1f).clayWell(RoundedCornerShape(14.dp)).padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("$v", color = k.text, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                        Text(l, color = k.muted, fontSize = 10.sp)
                    }
                }
            }
        }
        if (stats.porDia.size > 1) item {
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 6.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Comandos por dia", color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                DayBars(stats.porDia.map { it.dia.takeLast(2) to it.total.toFloat() })
            }
        }
        item { SectionTitle("Agentes (registros no STATUS)") }
        if (stats.agentes.isEmpty()) item { Text("Nenhum registro no período.", color = k.muted) }
        val max = (stats.agentes.maxOfOrNull { it.registros } ?: 1).coerceAtLeast(1)
        items(stats.agentes, key = { it.agent }) { a ->
            Row(
                Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(a.agent, 34)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(a.agent, color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).clayWell(RoundedCornerShape(4.dp))) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(a.registros.toFloat() / max).background(k.brand, RoundedCornerShape(4.dp)))
                    }
                    Text("${a.registros} registros · ${a.done} concluídos · ${a.travado} travados", color = k.muted, fontSize = 12.sp)
                }
            }
        }
    }
}

// ---------------- Ajustes (só leitura + avisos) ----------------

@Composable
private fun Toggle(title: String, sub: String, on: Boolean, change: (Boolean) -> Unit) {
    val k = Clay.c
    Row(
        Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(sub, color = k.muted, fontSize = 12.sp, lineHeight = 17.sp)
        }
        Switch(checked = on, onCheckedChange = change)
    }
}

@Composable
fun SettingsScreen(readOnly: Boolean, setReadOnly: (Boolean) -> Unit, alerts: Map<String, Boolean>, setAlert: (String, Boolean) -> Unit, background: Boolean = true, setBackground: (Boolean) -> Unit = {}, battery: () -> Unit = {},
    themeMode: String = "sistema", setTheme: (String) -> Unit = {}, fontScale: Float = 1f, setFont: (Float) -> Unit = {},
    muteUntil: Long = 0, setMute: (Int) -> Unit = {},
) {
    val k = Clay.c
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { SectionTitle("Segurança") }
        item { Toggle("Modo só leitura", "Olhar sem risco: bloqueia mensagem, comando, aprovação e ligar chamada até você desligar.", readOnly, setReadOnly) }
        item { SectionTitle("Aparência") }
        item {
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Tema", color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("sistema" to "Do celular", "claro" to "Claro", "escuro" to "Escuro").forEach { (id, label) ->
                        val on = themeMode == id
                        Text(label, color = if (on) k.onBrand else k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = if (on) 5.dp else 2.dp, color = if (on) k.brand else null)
                                .clickable { setTheme(id) }.padding(horizontal = 12.dp, vertical = 7.dp))
                    }
                }
                Text("Tamanho do texto: ${(fontScale * 100).toInt()}%", color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("A−" to fontScale - 0.1f, "Normal" to 1f, "A+" to fontScale + 0.1f).forEach { (label, v) ->
                        Text(label, color = k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = 3.dp).clickable { setFont(v) }.padding(horizontal = 14.dp, vertical = 7.dp))
                    }
                }
            }
        }
        item { SectionTitle("Não perturbe") }
        item {
            val muted = muteUntil > System.currentTimeMillis()
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (muted) "Avisos calados até ${java.text.SimpleDateFormat("HH:mm", java.util.Locale("pt", "BR")).format(java.util.Date(muteUntil))}" else "Avisos ligados",
                    color = if (muted) k.warn else k.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(1 to "1 h", 8 to "8 h", 0 to "Desligar").forEach { (h, label) ->
                        Text(label, color = k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = 3.dp).clickable { setMute(h) }.padding(horizontal = 14.dp, vertical = 7.dp))
                    }
                }
                Text("VIOLATION (agente agindo sem aprovação) avisa mesmo assim.", color = k.muted, fontSize = 12.sp)
            }
        }
        item { SectionTitle("Segundo plano") }
        item { Toggle("Agent Control em segundo plano", "Fica conectado ao PC e avisa mesmo com o app fechado. Liga sozinho quando o celular reinicia.", background, setBackground) }
        item {
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Economia de bateria", color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text("Alguns celulares Android fecham apps em segundo plano para economizar. Na tela que abrir, procure Agent Control e escolha \"Não otimizar\" / \"Sem restrições\".", color = k.muted, fontSize = 12.sp, lineHeight = 17.sp)
                Text("Abrir ajuste de bateria", color = k.onBrand, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                    modifier = Modifier.clay(RoundedCornerShape(16.dp), elevation = 5.dp, color = k.brand).clickable(onClick = battery).padding(horizontal = 16.dp, vertical = 10.dp))
            }
        }
        item { SectionTitle("Avisos no celular") }
        item { Toggle("Aprovação esperando", "Comando protegido (push, deploy…) parado até você aprovar.", alerts["aprovacao"] != false) { setAlert("aprovacao", it) } }
        item { Toggle("Comando concluído ou travado", "Quando um agente termina ou trava um comando seu.", alerts["comando"] != false) { setAlert("comando", it) } }
        item { Toggle("Resposta do AgentC", "Quando o AgentC responde e o app não está aberto.", alerts["jarvis"] != false) { setAlert("jarvis", it) } }
        item { Text("VIOLATION (agente que agiu sem aprovação) sempre avisa: não dá para desligar.", color = k.muted, fontSize = 12.sp) }
    }
}
