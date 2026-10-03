@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)

package dev.agentcontrol.app.ui

import androidx.compose.ui.draw.clip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material.icons.outlined.Check
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import dev.agentcontrol.app.UiState
import kotlinx.coroutines.launch
import dev.agentcontrol.app.data.Command
import dev.agentcontrol.app.data.chatMeta

// ---------------- peças comuns ----------------

@Composable
private fun ClayButton(text: String, onClick: () -> Unit, enabled: Boolean = true, primary: Boolean = true, height: Int = 54, modifier: Modifier = Modifier) {
    val k = Clay.c
    val shape = RoundedCornerShape(22.dp)
    Box(
        modifier.fillMaxWidth().height(height.dp)
            .clay(shape, elevation = if (primary) 8.dp else 6.dp, color = if (primary) k.brand else k.bg)
            .alpha(if (enabled) 1f else .45f)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (primary) k.onBrand else k.text, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.padding(horizontal = 12.dp))
    }
}

/** Botão redondo de ícone em relevo (menu, agentes, voltar). */
@Composable
fun ClayIconButton(onClick: () -> Unit, description: String, content: @Composable () -> Unit) {
    Box(
        Modifier.size(44.dp).clay(RoundedCornerShape(14.dp), elevation = 6.dp).clickable(onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun ClayField(value: String, onValue: (String) -> Unit, placeholder: String, password: Boolean = false, uri: Boolean = false) {
    val k = Clay.c
    Box(Modifier.fillMaxWidth().heightIn(min = 52.dp).clayWell(RoundedCornerShape(26.dp)).padding(horizontal = 18.dp, vertical = 14.dp)) {
        if (value.isEmpty()) Text(placeholder, color = k.muted, fontSize = 15.sp)
        BasicTextField(
            value, onValue, singleLine = true,
            textStyle = TextStyle(color = k.text, fontSize = 15.sp),
            cursorBrush = SolidColor(k.brand),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (uri) KeyboardType.Uri else KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** Função de ouvir o dono (ditado), fornecida pelo JarvisApp; null = sem microfone. */
val LocalDictate = staticCompositionLocalOf<(suspend () -> String)?> { null }

/**
 * Caixa de mensagem numa linha (estilo app de chat, 2026-10-01): "+" escolhe para quem vai (e colar resposta
 * do ChatGPT), texto que cresce, microfone e enviar. Para quem vai aparece em cima só quando não é "Todos".
 */
@Composable
fun Composer(
    targets: List<String>,
    placeholder: String,
    busy: Boolean,
    tall: Boolean = false,
    onSend: (text: String, to: String, asChatGpt: Boolean) -> Unit,
) {
    val k = Clay.c
    var text by rememberSaveable { mutableStateOf("") }
    var to by rememberSaveable { mutableStateOf(targets.firstOrNull() ?: "TODOS") }
    var asGpt by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 12.dp, top = 4.dp)) {
        if (to != "TODOS" || asGpt) Text(
            if (asGpt) "Colando resposta do ChatGPT · para ${label(to)}" else "Para ${label(to)}",
            color = k.brandText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 16.dp, bottom = 6.dp),
        )
        Row(
            Modifier.fillMaxWidth().clay(RoundedCornerShape(26.dp), elevation = 2.dp).padding(6.dp),
            verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Box {
                Box(
                    Modifier.size(40.dp).clip(CircleShape).clickable { menu = true }.semantics { contentDescription = "Para quem enviar" },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.Add, null, tint = if (to != "TODOS" || asGpt) k.brandText else k.muted) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = k.surface) {
                    Text("Enviar para", color = k.muted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                    targets.forEach { t ->
                        DropdownMenuItem(
                            text = { Text(label(t), color = k.text, fontWeight = if (t == to) FontWeight.SemiBold else FontWeight.Normal) },
                            trailingIcon = { if (t == to) Icon(Icons.Outlined.Check, null, tint = k.brandText) },
                            onClick = { to = t; menu = false },
                        )
                    }
                    HorizontalDivider(color = k.border)
                    DropdownMenuItem(
                        text = { Text(if (asGpt) "Voltar a escrever como você" else "Colar resposta do ChatGPT", color = k.text) },
                        onClick = { asGpt = !asGpt; menu = false },
                    )
                }
            }
            Box(Modifier.weight(1f).heightIn(min = if (tall) 48.dp else 40.dp).padding(vertical = 9.dp, horizontal = 2.dp)) {
                if (text.isEmpty()) Text(if (asGpt) "Cole a resposta do ChatGPT" else placeholder, color = k.muted, fontSize = 16.sp)
                BasicTextField(
                    text, { text = it }, maxLines = 6,
                    textStyle = TextStyle(color = k.text, fontSize = 16.sp, lineHeight = 22.sp),
                    cursorBrush = SolidColor(k.brand), modifier = Modifier.fillMaxWidth(),
                )
            }
            // Ditado: fala em vez de digitar (o texto entra na caixa para revisar antes de enviar).
            val dictate = LocalDictate.current
            if (dictate != null && text.isBlank()) {
                val ctx = LocalContext.current
                val scope = rememberCoroutineScope()
                var listening by remember { mutableStateOf(false) }
                val go = {
                    listening = true
                    scope.launch { val heard = dictate(); listening = false; if (heard.isNotBlank()) text = (text + " " + heard).trim() }
                }
                val mic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) go() }
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(if (listening) k.ok else Color.Transparent)
                        .clickable(enabled = !listening) {
                            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) go()
                            else mic.launch(Manifest.permission.RECORD_AUDIO)
                        }
                        .semantics { contentDescription = if (listening) "Ouvindo" else "Ditar mensagem" },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.Mic, null, tint = if (listening) Color(0xFF03170A) else k.muted) }
            }
            val ready = !busy && text.isNotBlank()
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(if (ready) k.text else k.well)
                    .clickable(enabled = ready) { onSend(text.trim(), to, asGpt); text = ""; asGpt = false }
                    .semantics { contentDescription = "Enviar" },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.ArrowUpward, null, tint = if (ready) k.bg else k.muted, modifier = Modifier.size(20.dp)) }
        }
    }
}

private fun label(t: String) = when (t) { "TODOS" -> "Todos"; "LEADER" -> "Líder"; else -> t }

// ---------------- Conexão ----------------

@Composable
fun SetupScreen(savedUrl: String, busy: Boolean, onConnect: (String, String) -> Unit) {
    val k = Clay.c
    var url by rememberSaveable { mutableStateOf(savedUrl.ifEmpty { "http://100." }) }
    var token by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(40.dp))
        LogoMark(76)
        Text("Agent Control", fontSize = 26.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = k.text)
        Text("Conecte ao seu PC pelo Tailscale.", color = k.muted, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        ClayField(url, { url = it }, "http://100.x.y.z:20150", uri = true)
        ClayField(token, { token = it }, "Token (data/remote-token.txt)", password = true)
        ClayButton(if (busy) "Testando…" else "Conectar", { onConnect(url, token) }, enabled = !busy && url.length > 10 && token.length >= 16)
        Text("O token fica guardado criptografado neste celular.", color = k.muted, fontSize = 12.sp)
    }
}

@Composable
fun LogoMark(size: Int) = AgentC(size.dp)

// ---------------- Início: a conversa (estilo app de chat, 2026-10-01) ----------------
// O Início é a conversa de hoje com o AgentC e o time. Sem mensagem hoje: AgentC, "Como posso ajudar?" e
// sugestões. O histórico inteiro fica na aba Sala; o resto das funções na aba Mais.

@Composable
fun HomeScreen(ui: UiState, openSala: () -> Unit, openApprovals: () -> Unit, send: (String, String, Boolean) -> Unit, onUpdate: () -> Unit = {}, openCall: () -> Unit = {}, startGoal: () -> Unit = {}, resume: () -> Unit = {}, openAgent: (String) -> Unit = {}) {
    val k = Clay.c
    val today = java.time.LocalDate.now().toString()
    val chat = ui.chat.filter { it.ts.startsWith(today) }
    val tasks = ui.state.tasks
    val list = rememberLazyListState()
    LaunchedEffect(chat.size) { if (chat.isNotEmpty()) list.animateScrollToItem(chat.size) }
    Column(Modifier.fillMaxSize()) {
        PhoneHud(ui, openSala, openAgent)
        if (ui.update != null) Box(Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) { Chip("Nova versão do app (${ui.update.versionName}) · atualizar", onUpdate, accent = true) }
        if (ui.pending.isNotEmpty()) Box(Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) { Chip("${ui.pending.size} aprovação esperando você", openApprovals, accent = true) }
        // Avisos do PC no topo do Início (2026-10-03): pausado com Retomar, chamada ao vivo, pouca memória e sem conexão.
        if (ui.offline != null) Box(Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) { Chip("Sem conexão com o PC: ${ui.offline}", {}) }
        if (ui.health?.pausa?.paused == true) Box(Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) { Chip("Agentes pausados · tocar para retomar", resume, accent = true) }
        if (ui.call.active && ui.call.state?.modo != "goal") Box(Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) { Chip("Chamada ao vivo · entrar", openCall, accent = true) }
        ui.health?.ram?.let { r -> if (r.livreMb in 1..1499) Box(Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) { Chip("PC com pouca memória (${r.livreMb} MB): os agentes esperam", {}) } }
        GoalStrip(ui.state.goal, tasks.count { it.status.uppercase().startsWith("DONE") }, tasks.size,
            running = ui.call.active && ui.call.state?.modo == "goal", callActive = ui.call.active, start = startGoal, open = openCall)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (chat.isEmpty()) {
                Column(
                    Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    AgentC(84.dp, Modifier.staggerIn(0))
                    Spacer(Modifier.height(20.dp))
                    Text(greeting(), color = k.muted, fontSize = 15.sp, modifier = Modifier.staggerIn(1))
                    Text("Como posso ajudar?", color = k.text, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.staggerIn(2))
                }
            } else {
                LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(horizontal = 20.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                    items(chat, key = { it.id }) { e -> ChatItem(e) }
                    if (chat.lastOrNull()?.agent == "DONO") item(key = "pensando") { Thinking() }
                }
            }
        }
        if (chat.isEmpty()) Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf(
                "Como está o time agora?" to { send("Como está o time agora? Quem está trabalhando, quem travou e o que falta.", "TODOS", false) },
                "O que falta no Goal?" to { send("O que falta para terminar o Goal ativo? Liste em ordem.", "TODOS", false) },
                "Resumo de hoje" to { send("Faça um resumo curto do que o time fez hoje.", "TODOS", false) },
                "Quem está travado?" to { send("Algum agente está travado ou com erro agora? Diga quem e por quê.", "TODOS", false) },
                "Próxima tarefa" to { send("Qual a próxima tarefa mais importante e quem deve pegar?", "LEADER", false) },
                "Iniciar Modo Goal" to startGoal,
            ).forEach { (t, go) ->
                Text(t, color = k.text, fontSize = 14.sp, modifier = Modifier.clay(RoundedCornerShape(18.dp), elevation = 2.dp).springClick(onClick = go).padding(horizontal = 14.dp, vertical = 10.dp))
            }
        }
        Composer(listOf("TODOS") + ui.state.agents.map { it.id }, "Mensagem para o time", ui.busy) { t, to, gpt -> send(t, to, gpt) }
    }
}

/** Faixa discreta do Goal no topo do Início: progresso e um toque para iniciar (ou abrir) o Modo Goal. */
@Composable
private fun GoalStrip(goal: String?, done: Int, total: Int, running: Boolean, callActive: Boolean, start: () -> Unit, open: () -> Unit) {
    val k = Clay.c
    if (goal.isNullOrBlank()) return
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp).clay(RoundedCornerShape(14.dp), elevation = 2.dp)
            .clickable(onClick = if (callActive) open else start).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(8.dp).background(if (running) k.ok else k.brand, CircleShape))
        Column(Modifier.weight(1f)) {
            Text(goal, color = k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (total > 0) Text("$done de $total tarefas · ${100 * done / total}%", color = k.muted, fontSize = 11.sp)
            if (total > 0) Box(Modifier.padding(top = 6.dp).fillMaxWidth().height(3.dp).background(k.well, RoundedCornerShape(2.dp))) {
                Box(Modifier.fillMaxWidth(fillIn(done.toFloat() / total)).height(3.dp).background(k.brand, RoundedCornerShape(2.dp)))
            }
        }
        Text(when { running -> "Rodando"; callActive -> "Abrir"; else -> "Iniciar" }, color = if (running) k.ok else k.brandText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Uma mensagem: a sua num balão à direita; a dos agentes em texto corrido, com nome e hora. */
/** Quem é "eu" neste celular (Modo Time: um convidado não é o DONO). O JarvisApp atualiza a cada tela. */
var meId: String = "DONO"

@Composable
fun ChatItem(e: dev.agentcontrol.app.data.Entry, modifier: Modifier = Modifier) {
    val k = Clay.c
    val m = e.chatMeta()
    if (e.agent == meId) {
        Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Text(
                m.text, color = k.text, fontSize = 15.5.sp, lineHeight = 23.sp,
                modifier = Modifier.widthIn(max = 300.dp).background(k.well, RoundedCornerShape(20.dp)).padding(horizontal = 16.dp, vertical = 11.dp),
            )
        }
    } else {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (e.agent == "JARVIS") AgentC(22.dp, alive = false) else Avatar(e.agent, 22)
                Text(if (e.agent == "JARVIS") "AgentC" else e.agent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = k.text)
                Text(shortTime(e.ts), color = k.muted, fontSize = 12.sp)
            }
            if (m.assunto != null) Text(m.assunto, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = k.text)
            Text(m.text, color = k.text2, fontSize = 15.5.sp, lineHeight = 24.sp)
        }
    }
}

@Composable
fun Thinking() {
    val k = Clay.c
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        AgentC(22.dp)
        Text("AgentC está pensando…", color = k.muted, fontSize = 14.sp)
    }
}

/** Cartão do Modo Goal: Goal ativo, progresso das tarefas e o botão que liga o time para tocá-lo sem parar. */
@Composable
fun GoalCard(goal: String?, running: Boolean, callActive: Boolean, start: () -> Unit, open: () -> Unit, done: Int = 0, total: Int = 0, modifier: Modifier = Modifier) {
    val k = Clay.c
    Column(
        modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 2.dp).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("GOAL ATIVO", color = k.muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.2.sp, modifier = Modifier.weight(1f))
            if (running) Text("Em execução", color = k.ok, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.background(k.ok.copy(alpha = .12f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 2.dp))
        }
        Text(goal?.takeIf { it.isNotBlank() } ?: "Nenhum Goal ativo no vault.", color = k.text, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium, maxLines = 3, overflow = TextOverflow.Ellipsis)
        if (total > 0) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.fillMaxWidth().height(4.dp).background(k.well, RoundedCornerShape(2.dp))) {
                    Box(Modifier.fillMaxWidth(fillIn(done.toFloat() / total)).height(4.dp).background(k.brand, RoundedCornerShape(2.dp)))
                }
                Text("$done de $total tarefas concluídas", color = k.muted, fontSize = 12.sp)
            }
        }
        Row(
            Modifier.fillMaxWidth().height(46.dp).springClick(onClick = if (callActive) open else start).clay(RoundedCornerShape(12.dp), color = k.brand),
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(if (callActive) Icons.Outlined.Call else Icons.Outlined.PlayArrow, null, tint = k.onBrand, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                when { running -> "Abrir o Modo Goal"; callActive -> "Voltar para a chamada"; else -> "Iniciar Modo Goal" },
                color = k.onBrand, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
            )
        }
        if (!callActive) Text("Os agentes trabalham no Goal de forma contínua, sem aguardar sua intervenção.", color = k.muted, fontSize = 12.sp, lineHeight = 17.sp)
    }
}

@Composable
private fun Chip(text: String, onClick: () -> Unit, accent: Boolean = false) {
    val k = Clay.c
    Row(
        Modifier.fillMaxWidth().height(44.dp).clay(RoundedCornerShape(12.dp), elevation = 2.dp, color = if (accent) k.brandSoft else null).clickable(onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (accent) Icon(Icons.Outlined.Lock, null, tint = k.brandText, modifier = Modifier.size(16.dp))
        Text(text, color = if (accent) k.brandText else k.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, tint = if (accent) k.brandText else k.muted, modifier = Modifier.size(16.dp))
    }
}

// ---------------- Sala ----------------

@Composable
fun SalaScreen(ui: UiState, openApprovals: () -> Unit, send: (String, String, Boolean) -> Unit, share: (String, String) -> Unit = { _, _ -> }) {
    val k = Clay.c
    val list = rememberLazyListState()
    // Filtro por quem falou (null = todos). A lista de nomes sai da própria sala.
    var who by rememberSaveable { mutableStateOf<String?>(null) }
    val chat = if (who == null) ui.chat else ui.chat.filter { it.agent == who }
    LaunchedEffect(chat.size, who) { if (chat.isNotEmpty()) list.animateScrollToItem(chat.size - 1) }
    // Segurar uma mensagem: copiar ou compartilhar.
    var menu by remember { mutableStateOf<Pair<String, String>?>(null) } // quem → texto
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        if (ui.pending.isNotEmpty()) ApprovalBanner(ui.pending, openApprovals)
        val people = ui.chat.map { it.agent }.distinct()
        if (people.size > 1) Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            (listOf<String?>(null) + people).forEach { a ->
                val on = who == a
                Text(
                    a ?: "Todos", color = if (on) k.onBrand else k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clay(RoundedCornerShape(16.dp), elevation = if (on) 6.dp else 3.dp, color = if (on) k.brand else null)
                        .clickable { who = a }.padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
        Box(Modifier.weight(1f)) {
        LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(horizontal = 20.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            if (ui.chat.isEmpty()) item { Text("Sala vazia. Mande a primeira mensagem.", color = k.muted) }
            items(chat, key = { it.id }) { e ->
                val m = e.chatMeta()
                val hold = Modifier.combinedClickable(onClick = {}, onLongClick = { menu = e.agent to m.text })
                if (e.agent == "DONO") {
                    Row(Modifier.fillMaxWidth().then(hold), horizontalArrangement = Arrangement.End) {
                        Text(
                            m.text, color = k.text, fontSize = 15.5.sp, lineHeight = 24.sp,
                            modifier = Modifier.widthIn(max = 290.dp)
                                .clay(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 6.dp, bottomStart = 22.dp), elevation = 8.dp,
                                    color = if (k.dark) k.brandSoft else k.surface)
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                        )
                    }
                } else {
                    // Agentes falam como o assistente no app do Claude: texto corrido, sem balão.
                    Column(hold, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Avatar(e.agent)
                            Text(e.agent, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = k.text)
                            if (e.status != null) StatusBadge(e.status)
                            Text(buildString { append("→ ${m.para}"); if (m.via != null) append(" · colado") ; append(" · ${shortTime(e.ts)}") }, color = k.muted, fontSize = 12.sp)
                        }
                        if (m.assunto != null) Text(m.assunto, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = k.text)
                        Text(m.text, color = k.text2, fontSize = 15.5.sp, lineHeight = 25.sp)
                    }
                }
            }
            // O JARVIS responde toda mensagem do dono; enquanto pensa, mostra que está vindo.
            if (who == null && ui.chat.lastOrNull()?.agent == "DONO") item(key = "pensando") {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Avatar("JARVIS")
                    Text("AgentC está pensando…", color = k.muted, fontSize = 14.sp)
                }
            }
        }
        // Rolou para cima: botão para voltar às mensagens novas.
        if (list.canScrollForward && chat.isNotEmpty()) {
            Box(
                Modifier.align(Alignment.BottomEnd).padding(14.dp).size(44.dp).clay(CircleShape, elevation = 8.dp, color = k.brand)
                    .clickable { scope.launch { list.animateScrollToItem(chat.size - 1) } }.semantics { contentDescription = "Ir para as mensagens novas" },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.KeyboardArrowDown, null, tint = k.onBrand) }
        }
        }
        Composer(listOf("TODOS") + ui.state.agents.map { it.id }, "Responder na sala…", ui.busy, onSend = send)
    }
    menu?.let { (who2, text) ->
        ModalBottomSheet(onDismissRequest = { menu = null }, containerColor = k.bg) {
            Column(Modifier.fillMaxWidth().padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Mensagem de $who2", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = k.text)
                Text(text, color = k.text2, fontSize = 14.sp, maxLines = 4)
                ClayButton("Copiar", { clipboard.setText(androidx.compose.ui.text.AnnotatedString(text)); menu = null })
                ClayButton("Compartilhar", { share("Mensagem de $who2", text); menu = null }, primary = false)
            }
        }
    }
}

@Composable
private fun ApprovalBanner(pending: List<Command>, open: () -> Unit) {
    val k = Clay.c
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth()
            .clay(RoundedCornerShape(18.dp), elevation = 8.dp, color = k.brandSoft).clickable(onClick = open).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Outlined.Lock, null, tint = k.brand)
        Column(Modifier.weight(1f)) {
            Text(if (pending.size == 1) "1 aprovação esperando você" else "${pending.size} aprovações esperando você", fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = k.text)
            Text("${pending.first().code} · ${pending.first().text.take(60)}", color = k.muted, fontSize = 12.sp, maxLines = 1)
        }
        Icon(Icons.Outlined.ChevronRight, null, tint = k.muted)
    }
}

// ---------------- Aprovar (painel de baixo) ----------------

@Composable
fun ApprovalSheet(c: Command, busy: Boolean, onDismiss: () -> Unit, decide: (String, Boolean) -> Unit) {
    val k = Clay.c
    var confirming by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = k.bg, shape = RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp)) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(58.dp).clay(RoundedCornerShape(20.dp), elevation = 8.dp, color = k.brandSoft), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Lock, null, tint = k.brandText, modifier = Modifier.size(26.dp))
                }
                Column {
                    Mono("${c.code} · ação protegida", k.brandText, 13)
                    Text(c.text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = k.text, maxLines = 3)
                }
            }
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row { Text("Quem executa", color = k.muted, fontSize = 14.sp, modifier = Modifier.weight(1f)); Text(if (c.target == "LEADER") "Líder" else c.target, fontWeight = FontWeight.SemiBold, color = k.text) }
                Row { Text("Pedido", color = k.muted, fontSize = 14.sp, modifier = Modifier.weight(1f)); Text(shortTime(c.createdAt), color = k.text) }
            }
            Text("Aprovar libera só este comando. Merge, deploy e release continuam precisando de aprovação própria.", color = k.muted, fontSize = 13.sp, lineHeight = 19.sp)
            if (!confirming) {
                ClayButton("Aprovar ${c.code}", { confirming = true }, enabled = !busy, height = 58)
            } else {
                ClayButton("Confirmar: aprovar só ${c.code}", { decide(c.code, true); onDismiss() }, enabled = !busy, height = 58)
            }
            ClayButton("Recusar", { decide(c.code, false); onDismiss() }, enabled = !busy, primary = false, height = 52)
        }
    }
}

// ---------------- Comandos ----------------

@Composable
fun CommandsScreen(
    ui: UiState,
    openApproval: (Command) -> Unit,
    rejectAll: () -> Unit = {},
    send: (String, String) -> Unit,
    runShortcut: (Long) -> Unit = {},
    addShortcut: (label: String, text: String, target: String) -> Unit = { _, _, _ -> },
    deleteShortcut: (Long) -> Unit = {},
) {
    val k = Clay.c
    // Filtro do histórico por situação.
    var filtro by rememberSaveable { mutableStateOf("todos") }
    val lista = ui.commands.filter { c ->
        when (filtro) {
            "abertos" -> c.status !in setOf("DONE", "BLOCKED", "FAILED", "REJECTED")
            "feitos" -> c.status == "DONE"
            "travados" -> c.status.startsWith("BLOCKED") || c.status.startsWith("FAILED")
            else -> true
        }
    }
    var novoAtalho by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            // Atalhos: comandos prontos, um toque. Segurar apaga.
            item { SectionTitle("Atalhos") }
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ui.shortcuts.forEach { sc ->
                        Text(sc.label, color = k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clay(RoundedCornerShape(16.dp), elevation = 5.dp)
                                .combinedClickable(onClick = { runShortcut(sc.id) }, onLongClick = { deleteShortcut(sc.id) })
                                .padding(horizontal = 14.dp, vertical = 9.dp))
                    }
                    Text("+ atalho", color = k.brandText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clayWell(RoundedCornerShape(16.dp)).clickable { novoAtalho = true }.padding(horizontal = 14.dp, vertical = 9.dp))
                }
            }
            if (ui.shortcuts.isNotEmpty()) item { Text("Toque para mandar · segure para apagar", color = k.muted, fontSize = 11.sp) }
            if (ui.pending.isNotEmpty()) {
                item { SectionTitle("Esperando você") }
                items(ui.pending, key = { "p-" + it.code }) { c -> ApprovalBanner(listOf(c)) { openApproval(c) } }
                if (ui.pending.size > 1) item {
                    Text("Recusar todas (${ui.pending.size})", color = k.err, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = 3.dp).clickable(onClick = rejectAll).padding(horizontal = 14.dp, vertical = 8.dp))
                }
            }
            item { SectionTitle("Histórico") }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("todos" to "Todos", "abertos" to "Abertos", "feitos" to "Feitos", "travados" to "Travados").forEach { (id, label) ->
                        val on = filtro == id
                        Text(label, color = if (on) k.onBrand else k.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = if (on) 5.dp else 2.dp, color = if (on) k.brand else null)
                                .clickable { filtro = id }.padding(horizontal = 12.dp, vertical = 7.dp))
                    }
                }
            }
            if (lista.isEmpty()) item { Text(if (ui.commands.isEmpty()) "Nenhum comando ainda. Escreva abaixo: vira tarefa para o líder." else "Nenhum comando nesse filtro.", color = k.muted, fontSize = 14.sp) }
            items(lista, key = { it.code }) { c ->
                Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(20.dp), elevation = 6.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Mono(c.code, k.brandText, 13)
                        Text("para ${label(c.target)}", color = k.muted, fontSize = 12.sp)
                        Spacer(Modifier.weight(1f))
                        StatusBadge(c.status)
                    }
                    Text(c.text, fontSize = 15.sp, color = k.text)
                    Text("${c.updatedBy ?: ""} · ${shortTime(c.updatedAt)}", color = k.muted, fontSize = 12.sp)
                }
            }
            item {
                Text("deploy, push, merge, release, apagar ou pagar ficam parados até você aprovar.", color = k.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            }
        }
        Composer(listOf("LEADER") + ui.state.agents.map { it.id }, "Novo comando para os agentes…", ui.busy) { t, to, _ -> send(t, to) }
    }
    if (novoAtalho) ShortcutSheet(listOf("LEADER") + ui.state.agents.map { it.id }.filter { it != "CHATGPT" }, onDismiss = { novoAtalho = false }) { l, t, to ->
        addShortcut(l, t, to); novoAtalho = false
    }
}

/** Criar atalho: nome curto + o texto do comando + para quem. */
@Composable
private fun ShortcutSheet(targets: List<String>, onDismiss: () -> Unit, save: (String, String, String) -> Unit) {
    val k = Clay.c
    var nome by rememberSaveable { mutableStateOf("") }
    var text by rememberSaveable { mutableStateOf("") }
    var to by rememberSaveable { mutableStateOf(targets.first()) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = k.bg) {
        Column(Modifier.fillMaxWidth().padding(20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Novo atalho", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = k.text)
            ClayField(nome, { nome = it }, "Nome (ex.: Rodar testes)", uri = true)
            ClayField(text, { text = it }, "Comando (ex.: roda a suíte de testes da API e registra no STATUS)", uri = true)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                targets.forEach { t ->
                    val on = t == to
                    Text(label(t), color = if (on) k.onBrand else k.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clay(RoundedCornerShape(14.dp), elevation = if (on) 5.dp else 2.dp, color = if (on) k.brand else null)
                            .clickable { to = t }.padding(horizontal = 12.dp, vertical = 7.dp))
                }
            }
            ClayButton("Salvar atalho", { save(nome.trim(), text.trim(), to) }, enabled = nome.isNotBlank() && text.isNotBlank())
        }
    }
}

// ---------------- Agentes ----------------

@Composable
fun AgentsScreen(ui: UiState, openDiary: (String) -> Unit = {}) {
    val k = Clay.c
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Mono(ui.state.goal ?: "sem Goal ativo") }
        val working = ui.state.agents.count { it.latest?.status?.uppercase()?.startsWith("WORK") == true }
        item { Text("${ui.state.agents.size} no time · $working trabalhando · toque num agente para ver o diário", color = k.muted, fontSize = 12.sp) }
        // Quem está com problema aparece primeiro.
        items(ui.state.agents.sortedBy { if (statusColor(it.latest?.status, k) == k.err) 0 else 1 }, key = { it.id }) { a ->
            val st = a.latest?.status
            val bad = statusColor(st, k) == k.err
            Row(
                Modifier.fillMaxWidth().clay(RoundedCornerShape(20.dp), elevation = 8.dp, color = if (bad) k.err.copy(alpha = if (k.dark) .10f else .06f).compositeOver(k.surface) else null)
                    .clickable { openDiary(a.id) }.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(a.id, 40)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(a.id, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = k.text)
                    Text(
                        listOfNotNull(a.latest?.task, (a.model ?: a.latest?.model)?.substringAfterLast('/'), a.statusFileMtime?.let { "registro ${ago(it).ifBlank { shortTime(it) }}" }).joinToString(" · "),
                        color = if (bad) k.err else k.muted, fontSize = 12.sp, maxLines = 2,
                    )
                    if (a.vaultCopyStale == true) Text("cópia no vault atrasada", color = k.warn, fontSize = 12.sp)
                }
                StatusBadge(st)
            }
        }
        val orphans = ui.state.locks.filter { !it.alive }
        if (orphans.isNotEmpty()) {
            item {
                Column(Modifier.fillMaxWidth().padding(top = 6.dp).clayWell(RoundedCornerShape(20.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SectionTitle("Alertas")
                    orphans.forEach { l ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Outlined.Warning, null, tint = k.warn, modifier = Modifier.size(16.dp))
                            Text("Lock ${l.name} órfão: PID ${l.pid ?: "?"} não existe.", fontSize = 13.sp, color = k.text)
                        }
                    }
                }
            }
        }
    }
}

// ---------------- Resumos ----------------

@Composable
fun SummaryScreen(ui: UiState, read: () -> Unit = {}) {
    val k = Clay.c
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val llm = ui.summary?.llm?.firstOrNull { it.status == "OK" }
        item {
            // Ouvir o resumo (dá para usar dirigindo / andando). Tocar de novo para.
            Row(
                Modifier.fillMaxWidth().height(52.dp).clay(RoundedCornerShape(26.dp), elevation = 8.dp, color = if (ui.reading) k.brandSoft else k.brand)
                    .clickable(enabled = ui.summary != null, onClick = read),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (ui.reading) Icons.Outlined.Stop else Icons.Outlined.VolumeUp, null, tint = if (ui.reading) k.brandText else k.onBrand)
                Spacer(Modifier.width(8.dp))
                Text(if (ui.reading) "Parar leitura" else "Ouvir o resumo", color = if (ui.reading) k.brandText else k.onBrand, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }
        item { SectionTitle("Resumo por IA") }
        item {
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (llm == null) Text("Sem resumo por IA ainda.", color = k.muted)
                else {
                    Mono("${llm.model?.substringAfterLast('/') ?: ""} · ${shortTime(llm.createdAt)}")
                    Text(llm.text.replace(Regex("\\*\\*(.+?)\\*\\*"), "$1"), color = k.text2, fontSize = 15.sp, lineHeight = 23.sp)
                }
            }
        }
        item { SectionTitle("Agora (sem IA)") }
        item {
            Box(Modifier.fillMaxWidth().clayWell(RoundedCornerShape(22.dp)).padding(16.dp)) {
                Text(ui.summary?.deterministic ?: "…", color = k.text2, fontSize = 12.sp, fontFamily = FontFamily.Monospace, lineHeight = 18.sp)
            }
        }
    }
}

@Composable
fun BackTopBar(title: String, onBack: () -> Unit) {
    val k = Clay.c
    Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        ClayIconButton(onBack, "Voltar") { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, tint = k.text) }
        Text(title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = k.text)
    }
}

@Composable
fun SmallTextButton(text: String, onClick: () -> Unit) = TextButton(onClick = onClick) { Text(text, color = Clay.c.err) }

