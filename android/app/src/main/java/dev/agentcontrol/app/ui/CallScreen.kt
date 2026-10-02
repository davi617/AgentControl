@file:OptIn(ExperimentalLayoutApi::class)

package dev.agentcontrol.app.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material.icons.outlined.VolumeOff
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.agentcontrol.app.CallUi
import kotlinx.coroutines.delay

/** Chamada em grupo, estilo call de WhatsApp: rostos em grade, anel em quem fala, legenda e botões redondos. */
@Composable
fun CallScreen(
    call: CallUi,
    busy: Boolean,
    people: List<dev.agentcontrol.app.data.CallPerson>,
    round: () -> Unit = {},
    start: (topic: String, who: List<String>, modo: String) -> Unit,
    passTurn: (String) -> Unit,
    sendTask: (agent: String, text: String) -> Unit,
    talk: () -> Unit,
    type: (String) -> Unit,
    pause: () -> Unit,
    speed: (Float) -> Unit,
    end: () -> Unit,
    attach: (android.net.Uri) -> Unit = {},
    handsFree: (Boolean) -> Unit = {},
    mute: (Boolean) -> Unit = {},
    share: () -> Unit = {},
    goal: String? = null,
    startGoal: () -> Unit = {},
) {
    val k = Clay.c
    val ctx = LocalContext.current
    // Anexar foto/print ou arquivo (texto, código, log). O PC descreve a imagem e os agentes comentam.
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if (uri != null) attach(uri) }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) talk() }
    val onTalk = {
        if (call.listening || ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) talk()
        else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Cabeçalho: assunto + cronômetro + mudo
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(if (call.active) call.state!!.topic else "Chamada em grupo", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = k.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        when {
                            call.active && call.muted -> "${call.state!!.participants.size + 1} na chamada · modo mudo, só texto"
                            call.active -> "${call.state!!.participants.size + 1} na chamada · todo mundo ouve todo mundo"
                            else -> "Você e os agentes, cada um com a sua voz. Eles debatem entre si."
                        },
                        fontSize = 13.sp, color = k.muted,
                    )
                }
                Box(
                    Modifier.size(40.dp).clay(CircleShape, elevation = if (call.muted) 5.dp else 2.dp, color = if (call.muted) k.brand else null)
                        .clickable { mute(!call.muted) }.semantics { contentDescription = if (call.muted) "Ligar a voz dos agentes" else "Deixar mudo: agentes só respondem por texto" },
                    contentAlignment = Alignment.Center,
                ) { Icon(if (call.muted) Icons.Outlined.VolumeOff else Icons.Outlined.VolumeUp, null, tint = if (call.muted) k.onBrand else k.muted, modifier = Modifier.size(20.dp)) }
                if (call.active) { Spacer(Modifier.width(8.dp)); Timer(call.startedAt) }
            }

            if (!call.active) {
                if (call.caption.isNotBlank()) Text(call.caption, color = k.muted, fontSize = 14.sp)
                call.state?.resumo?.let { CallSummaryCard(it, sendTask) }
                if (call.state != null && call.state.turns.isNotEmpty() && !call.active) {
                    val porAgente = call.state.turns.groupingBy { it.speaker }.eachCount().entries.sortedByDescending { it.value }
                    Text("Falas: " + porAgente.joinToString(" · ") { "${it.key} ${it.value}" }, color = k.muted, fontSize = 13.sp)
                }
                if (call.state != null && call.state.turns.isNotEmpty()) {
                    Text("Compartilhar a ata", color = k.brandText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clay(RoundedCornerShape(16.dp), elevation = 4.dp).clickable(onClick = share).padding(horizontal = 16.dp, vertical = 10.dp))
                }
                GoalCard(goal, running = false, callActive = false, start = { if (!busy) startGoal() }, open = {})
                Text("Ou configure a chamada manualmente", color = k.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                StartCall(busy, people, start)
            } else {
                val people = listOf("DONO" to "Você") + call.state!!.participants.map { it.id to it.papel }
                val marks = uniqueMarks(people.map { it.first })
                FlowRow(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    maxItemsInEachRow = 3,
                ) {
                    people.forEach { (id, papel) ->
                        Tile(id, papel, marks.getValue(id), speaking = call.speaking == id, listening = id == "DONO" && call.listening,
                            Modifier.weight(1f).clickable(enabled = id != "DONO" && call.speaking != id) { passTurn(id) })
                    }
                    // completa a última linha para as colunas não esticarem
                    repeat((3 - people.size % 3) % 3) { Spacer(Modifier.weight(1f)) }
                }
                // Legenda de quem está falando
                Box(Modifier.fillMaxWidth().heightIn(min = 76.dp).clay(RoundedCornerShape(20.dp), elevation = 6.dp).padding(16.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (call.captionWho.isNotBlank()) Text(call.captionWho, color = if (call.captionWho == "DONO") k.ok else k.brandText, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Text(
                            call.caption, color = if (call.thinking) k.muted else k.text, fontSize = 17.sp, lineHeight = 25.sp,
                            fontStyle = if (call.thinking) FontStyle.Italic else FontStyle.Normal,
                        )
                    }
                }
                // Novidade (2026-09-27): encostar o celular no rosto, como numa ligação de verdade,
                // abre o microfone sozinho e a voz sai baixinho no fone, não no viva-voz. Sem sentido no modo mudo.
                if (!call.muted) Text("Aproxime o celular do ouvido para falar", color = k.muted, fontSize = 11.5.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                // Anexos desta chamada
                val anexos = call.state!!.attachments
                if (anexos.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    anexos.forEach { a ->
                        Text("Anexo · ${a.name}", color = k.text, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.clayWell(RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                }
                // Transcrição
                Text("Transcrição", color = k.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp)
                call.state!!.turns.takeLast(30).reversed().forEach { t ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(t.speaker, color = if (t.speaker == "DONO") k.ok else k.brandText, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.width(86.dp))
                        Text(t.text, color = k.text2, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.weight(1f))
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
        if (call.active) Controls(call, onTalk, type, pause, speed, end, attach = { picker.launch("*/*") }, handsFree = handsFree, round = round)
    }
}

@Composable
private fun StartCall(busy: Boolean, people: List<dev.agentcontrol.app.data.CallPerson>, start: (String, List<String>, String) -> Unit) {
    val k = Clay.c
    var topic by rememberSaveable { mutableStateOf("") }
    var modo by rememberSaveable { mutableStateOf("debate") }
    // Padrão: o time entra; especialistas (virtuais) o dono liga quando quiser.
    var dentro by remember(people) { mutableStateOf(people.filter { !it.virtual }.map { it.id }.toSet()) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        listOf(false to "Time (agentes que trabalham no código)", true to "Especialistas (só opinam na chamada)").forEach { (virt, title) ->
            val group = people.filter { it.virtual == virt }
            if (group.isNotEmpty()) {
                Text(title, color = k.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    group.forEach { pp ->
                        val on = pp.id in dentro
                        Text(pp.id, color = if (on) k.onBrand else k.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clay(RoundedCornerShape(16.dp), elevation = if (on) 5.dp else 2.dp, color = if (on) k.brand else null)
                                .clickable { dentro = if (on) dentro - pp.id else dentro + pp.id }.padding(horizontal = 14.dp, vertical = 8.dp))
                    }
                }
            }
        }
        Text("Modo", color = k.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("debate" to "Debate", "brainstorm" to "Ideias", "revisao" to "Revisão", "goal" to "Goal contínuo").forEach { (id, label) ->
                val on = modo == id
                Text(label, color = if (on) k.onBrand else k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clay(RoundedCornerShape(16.dp), elevation = if (on) 5.dp else 2.dp, color = if (on) k.brand else null)
                        .clickable { modo = id }.padding(horizontal = 14.dp, vertical = 8.dp))
            }
        }
        if (modo == "goal") Text("Eles tocam o Goal ativo do vault sozinhos, sem esperar a sua vez. Pause quando quiser.", color = k.muted, fontSize = 12.sp)
        Box(Modifier.fillMaxWidth().heightIn(min = 56.dp).clayWell(RoundedCornerShape(28.dp)).padding(horizontal = 20.dp, vertical = 16.dp)) {
            if (topic.isEmpty()) Text("Sobre o que vamos falar?", color = k.muted, fontSize = 16.sp)
            BasicTextField(topic, { topic = it }, textStyle = TextStyle(color = k.text, fontSize = 16.sp), cursorBrush = SolidColor(k.brand), modifier = Modifier.fillMaxWidth())
        }
        Row(
            Modifier.fillMaxWidth().height(58.dp).clay(RoundedCornerShape(29.dp), elevation = 10.dp, color = Color(0xFF22C55E))
                .clickable(enabled = !busy && topic.isNotBlank() && dentro.isNotEmpty()) { start(topic, people.map { it.id }.filter { it in dentro }, modo) },
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Phone, null, tint = Color(0xFF03170A))
            Spacer(Modifier.width(10.dp))
            Text("Ligar para o time", color = Color(0xFF03170A), fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }
    }
}

@Composable
private fun Tile(id: String, papel: String, mark: String, speaking: Boolean, listening: Boolean, modifier: Modifier) {
    val k = Clay.c
    val (bg, fg) = avatarColors(id, k.dark)
    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(1f, 1.08f, infiniteRepeatable(tween(550), RepeatMode.Reverse), label = "pulse")
    val ring = when { listening -> k.ok; speaking -> k.brand; else -> Color.Transparent }
    Column(
        modifier.clay(RoundedCornerShape(20.dp), elevation = if (speaking || listening) 12.dp else 5.dp, color = if (speaking) k.brandSoft else null)
            .padding(vertical = 14.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier.size(64.dp).scale(if (speaking || listening) pulse else 1f).border(3.dp, ring, CircleShape).padding(5.dp)
                .clay(CircleShape, elevation = 3.dp, color = bg),
            contentAlignment = Alignment.Center,
        ) {
            val photo = agentPhoto(id)
            if (photo != 0) androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(photo), contentDescription = id, modifier = Modifier.fillMaxSize())
            else Text(mark, color = fg, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
        Text(if (id == "DONO") "Você" else id, color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(papel, color = k.muted, fontSize = 10.5.sp, maxLines = 2, textAlign = TextAlign.Center, lineHeight = 13.sp, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Controls(call: CallUi, talk: () -> Unit, type: (String) -> Unit, pause: () -> Unit, speed: (Float) -> Unit, end: () -> Unit, attach: () -> Unit, handsFree: (Boolean) -> Unit, round: () -> Unit) {
    val k = Clay.c
    var text by remember { mutableStateOf("") }
    var rate by rememberSaveable { mutableStateOf(1f) }
    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth().height(50.dp).clayWell(RoundedCornerShape(25.dp)).padding(start = 18.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                if (text.isEmpty()) Text("…ou digite a sua fala", color = k.muted, fontSize = 15.sp)
                BasicTextField(text, { text = it }, singleLine = true, textStyle = TextStyle(color = k.text, fontSize = 15.sp), cursorBrush = SolidColor(k.brand), modifier = Modifier.fillMaxWidth())
            }
            if (text.isNotBlank()) Round(Icons.Outlined.Send, "Enviar fala", k.brand, k.onBrand, 40) { type(text); text = "" }
            else Round(Icons.Outlined.AttachFile, "Anexar foto ou arquivo", k.surface, k.text, 40, onClick = attach)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            Round(if (call.paused) Icons.Outlined.PlayArrow else Icons.Outlined.Pause, if (call.paused) "Continuar debate" else "Pausar debate",
                if (call.paused) k.warn else k.surface, if (call.paused) Color(0xFF1A1000) else k.text, 58, onClick = pause)
            // Microfone grande no meio, como numa call
            Round(if (call.listening) Icons.Outlined.Send else Icons.Outlined.Mic, if (call.listening) "Enviar o que falei" else "Falar",
                if (call.listening) k.ok else k.brand, if (call.listening) Color(0xFF03170A) else k.onBrand, 78, onClick = talk)
            Round(Icons.Outlined.CallEnd, "Desligar", Color(0xFFEF4444), Color.White, 58, onClick = end)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            // Mãos livres: quando todos responderem, o microfone abre sozinho.
            Text(
                "Mãos livres", fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                color = if (call.handsFree) k.onBrand else k.muted,
                modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = if (call.handsFree) 5.dp else 1.dp, color = if (call.handsFree) k.brand else null)
                    .clickable { handsFree(!call.handsFree) }.padding(horizontal = 10.dp, vertical = 5.dp),
            )
            // Rodada: todo mundo opina uma vez.
            Text("Rodada", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = k.text,
                modifier = Modifier.padding(start = 6.dp).clay(RoundedCornerShape(14.dp), elevation = 2.dp).clickable(onClick = round).padding(horizontal = 10.dp, vertical = 5.dp))
            listOf(1f, 1.15f, 1.3f).forEach { r ->
                Text(
                    "${r}×".replace('.', ','), fontSize = 12.sp, fontFamily = FontFamily.Monospace,
                    color = if (r == rate) k.brandText else k.muted, fontWeight = if (r == rate) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier.clickable { rate = r; speed(r) }.padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun Round(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, bg: Color, fg: Color, size: Int, onClick: () -> Unit) {
    Box(
        Modifier.size(size.dp).clay(CircleShape, elevation = 10.dp, color = bg).clickable(onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = fg, modifier = Modifier.size((size * 0.42f).dp)) }
}

@Composable
private fun Timer(startedAt: Long) {
    val k = Clay.c
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(startedAt) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
    val s = ((now - startedAt) / 1000).coerceAtLeast(0)
    Text("%02d:%02d".format(s / 60, s % 60), color = k.ok, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
        modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = 3.dp).padding(horizontal = 12.dp, vertical = 6.dp))
}

/** Iniciais que não se repetem: OPENCODE e OPENCLAW não viram os dois "OP" (mesma regra da web). */
private fun uniqueMarks(ids: List<String>): Map<String, String> {
    val used = mutableSetOf("DW")
    return ids.associateWith { id ->
        if (id == "DONO") return@associateWith "DW"
        val s = id.filter { it.isLetterOrDigit() }.uppercase()
        (1 until s.length).map { "${s[0]}${s[it]}" }.firstOrNull { used.add(it) } ?: s.take(2)
    }
}

/** Resumo que o PC gera ao desligar: decisões, tarefas (cada uma vira comando com um toque) e pendências. */
@Composable
private fun CallSummaryCard(s: dev.agentcontrol.app.data.CallSummary, sendTask: (String, String) -> Unit) {
    val k = Clay.c
    var sent by remember { mutableStateOf(setOf<Int>()) }
    Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Resumo da chamada", color = k.text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        when (s.status) {
            "gerando" -> Text("O JARVIS está montando o resumo…", color = k.muted, fontSize = 14.sp, fontStyle = FontStyle.Italic)
            "erro" -> Text("Não consegui resumir (${s.erro}). A conversa inteira está na ata do vault.", color = k.warn, fontSize = 13.sp)
            else -> {
                if (s.decisoes.isNotEmpty()) { Text("Decisões", color = k.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold); s.decisoes.forEach { Text("• $it", color = k.text2, fontSize = 14.sp, lineHeight = 20.sp) } }
                Text("Tarefas", color = k.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                if (s.tarefas.isEmpty()) Text("Nenhuma tarefa combinada.", color = k.muted, fontSize = 13.sp)
                s.tarefas.forEachIndexed { i, t ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(t.agente, color = k.brandText, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            Text(t.tarefa, color = k.text2, fontSize = 14.sp, lineHeight = 20.sp)
                        }
                        val done = i in sent
                        Text(if (done) "Enviado" else "Mandar", color = if (done) k.muted else k.onBrand, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = if (done) 1.dp else 5.dp, color = if (done) null else k.brand)
                                .clickable(enabled = !done) { sendTask(t.agente, t.tarefa); sent = sent + i }.padding(horizontal = 12.dp, vertical = 8.dp))
                    }
                }
                if (s.pendencias.isNotEmpty()) { Text("Pendências", color = k.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold); s.pendencias.forEach { Text("• $it", color = k.text2, fontSize = 14.sp, lineHeight = 20.sp) } }
            }
        }
    }
}