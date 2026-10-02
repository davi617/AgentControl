@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package dev.agentcontrol.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.WifiOff
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.Live
import dev.agentcontrol.app.MainViewModel
import dev.agentcontrol.app.UiState
import dev.agentcontrol.app.data.Command
import kotlinx.coroutines.launch

enum class Screen(val title: String) { HOME("Início"), VOZ("Falar com o AgentC"), CHAMADA("Chamada em grupo"), SAUDE("Saúde do PC"), CEREBRO("Cérebro (Obsidian)"), TAREFAS("Tarefas"), MODELOS("Modelos e força"), VOZES("Vozes"), NOTAS("Notas rápidas"), BUSCA("Buscar em tudo"), STATS("Estatísticas do time"), AJUSTES("Ajustes e avisos"), USO("Uso dos agentes"), LINHA("Linha do tempo"), CHAMADAS("Histórico de chamadas"), SOBRE("Sobre"), SALA("Sala central"), COMANDOS("Comandos"), AGENTES("Agentes"), RESUMOS("Resumos"), MAIS("Mais") }

@Composable
fun JarvisApp(vm: MainViewModel) {
    val ui by vm.ui.collectAsState()
    val k = Clay.c
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(ui.message) { ui.message?.let { snack.showSnackbar(it); vm.consumeMessage() } }

    if (!ui.configured) {
        Scaffold(containerColor = k.bg, snackbarHost = { SnackbarHost(snack) }) { pad ->
            Box(Modifier.padding(pad).statusBarsPadding()) { SetupScreen(vm.savedUrl, ui.busy, vm::setup) }
        }
        return
    }

    LaunchedEffect(ui.project) {
        while (true) { vm.refreshLimits(); kotlinx.coroutines.delay(10_000) }
    }

    var screen by rememberSaveable { mutableStateOf(Screen.HOME) }
    var approving by remember { mutableStateOf<Command?>(null) }
    // Abre uma nota do vault direto no Cérebro (tarefa, diário do agente).
    fun openNote(path: String) { vm.openNote(path); screen = Screen.CEREBRO }
    // Atalho do ícone do app pediu uma tela.
    LaunchedEffect(ui.openScreen) {
        ui.openScreen?.let { name -> Screen.entries.firstOrNull { it.name == name }?.let { screen = it } }
        vm.consumeOpenScreen()
    }
    val openApprovals = { approving = ui.pending.firstOrNull() }

    // Voltar do Android: de qualquer tela volta ao Início (antes fechava o app). O Cérebro trata a própria volta.
    // Telas abertas pelo "Mais" voltam para o "Mais"; as abas da barra voltam para o Início.
    BackHandler(enabled = screen != Screen.HOME && !(screen == Screen.CEREBRO && ui.brain.note != null)) {
        screen = if (screen in setOf(Screen.AGENTES, Screen.CHAMADA, Screen.COMANDOS, Screen.MAIS)) Screen.HOME else Screen.MAIS
    }

    CompositionLocalProvider(LocalDictate provides vm::dictate) {
        // 2026-09-28 : sem barra lateral; tudo fica na barra de baixo e na aba "Mais".
        val tabs = setOf(Screen.HOME, Screen.AGENTES, Screen.CHAMADA, Screen.COMANDOS, Screen.MAIS)
        val reduced = reducedMotion()
        Scaffold(
            containerColor = k.bg,
            snackbarHost = { SnackbarHost(snack) },
            topBar = { TopBar(ui, screen, back = if (screen in tabs) null else ({ screen = Screen.MAIS }), openAgents = { screen = Screen.AGENTES }) },
            bottomBar = { BottomNav(screen, ui.pending.size, ui.call.active) { screen = it } },
        ) { pad ->
            // pad já traz a barra de navegação; consumir evita somar de novo quando o teclado abre.
            Column(Modifier.padding(pad).consumeWindowInsets(pad).fillMaxSize().imePadding()) {
                ui.offline?.let { OfflineBanner(it, openTailscale = vm::openTailscale, retry = vm::retryNow) }
                AnimatedContent(targetState = screen, transitionSpec = { screenTransition(reduced) }, label = "tela") { atual ->
                Column(Modifier.fillMaxSize()) {
                when (atual) {
                    Screen.HOME -> HomeScreen(ui, openSala = { screen = Screen.SALA }, openApprovals = openApprovals, send = vm::sendChat, onUpdate = { vm.installUpdate() }, openCall = { screen = Screen.CHAMADA }, startGoal = { vm.callStartGoal(); screen = Screen.CHAMADA })
                    Screen.MAIS -> MoreScreen(ui, forget = vm::forget) { screen = it }
                    Screen.NOTAS -> NotesScreen(ui.notes, add = { vm.addNote(it) }, toggle = { id, d -> vm.toggleNote(id, d) }, delete = { vm.deleteNote(it) }, share = vm::shareNotes)
                    Screen.BUSCA -> SearchScreen(ui.searchQuery, ui.searchHits, search = vm::searchAll) { h ->
                        when (h.kind) {
                            "sala" -> screen = Screen.SALA
                            "comando" -> screen = Screen.COMANDOS
                            "tarefa" -> openNote("20-Operations/Memoria/Tarefas/${h.ref}.md")
                            else -> openNote(h.ref)
                        }
                    }
                    Screen.STATS -> StatsScreen(ui.stats) { vm.loadStats(it) }
                    Screen.USO -> UsageScreen(ui.usage, ui.limits) { vm.loadUsage(it) }
                    Screen.LINHA -> FeedScreen(ui.feed, ui.feedAgent, ui.state.agents.map { it.id }) { vm.loadFeed(it) }
                    Screen.CHAMADAS -> CallsHistoryScreen(ui.calls, load = { vm.loadCalls() }) { openNote(it) }
                    Screen.SOBRE -> AboutScreen(ui.about, vm.appVersionName, load = { vm.loadAbout() }, checkUpdate = { vm.checkUpdateNow() })
                    Screen.AJUSTES -> SettingsScreen(ui.readOnly, vm::setReadOnly, ui.alertPrefs, { k2, on -> vm.setAlert(k2, on) }, ui.background, vm::setBackground, { vm.openBatterySettings() },
                        ui.themeMode, vm::setThemeMode, ui.fontScale, vm::setFontScale, ui.muteUntil, vm::setMute)
                    Screen.VOZES -> VoicesScreen(list = { vm.voiceList() }, current = vm::voiceOf, choose = vm::voiceChoose, preview = { vm.voicePreview(it) }, install = { vm.installVoices() })
                    Screen.MODELOS -> ModelsScreen(ui.models, ui.busy, load = { vm.loadModels() }, choose = { a, m, e -> vm.chooseModel(a, m, e) })
                    Screen.VOZ -> {
                        DisposableEffect(Unit) { onDispose { vm.talkStop() } }
                        TalkScreen(ui.talk, start = vm::talkStart, stop = vm::talkStop, continuous = vm::talkContinuous)
                    }
                    Screen.TAREFAS -> TasksScreen(ui.state.goal, ui.state.tasks) { openNote("20-Operations/Memoria/Tarefas/${it.id}.md") }
                    Screen.CEREBRO -> BrainScreen(ui.brain, search = vm::brainSearch, open = { vm.openNote(it) }, back = vm::closeNote, favorites = ui.favorites, toggleFavorite = { p, t -> vm.toggleFavorite(p, t) }, share = vm::shareText)
                    Screen.SAUDE -> {
                        // Atualiza a cada 10 s só enquanto esta tela está aberta.
                        DisposableEffect(Unit) {
                            var open = true
                            vm.watchHealth { open }
                            onDispose { open = false }
                        }
                        HealthScreen(ui.health, pause = { on, agora -> vm.pauseAgents(on, agora) }, latencyMs = ui.healthMs)
                    }
                    Screen.CHAMADA -> {
                        LaunchedEffect(Unit) { vm.callRefresh(); vm.callLoadPeople() }
                        CallScreen(ui.call, ui.busy, round = vm::callRound,
                            // PC ainda sem /api/call/people (JARVIS antigo): usa o time de sempre para o botão Ligar não travar.
                            people = ui.call.people.ifEmpty { ui.state.agents.map { it.id }.filter { it != "CHATGPT" }.map { dev.agentcontrol.app.data.CallPerson(it) } }, start = { t, w, m -> vm.callStart(t, w, m) }, passTurn = { vm.callPassTurn(it) }, sendTask = { a, t -> vm.callTaskToCommand(a, t) }, talk = vm::callTalk, type = { vm.callSend(it) }, pause = vm::callPause, speed = vm::callSpeed, end = { vm.callEnd() }, attach = { vm.callAttach(it) }, handsFree = vm::callHandsFree, mute = vm::callMute, share = vm::shareCall, goal = ui.state.goal, startGoal = { vm.callStartGoal() })
                    }
                    Screen.SALA -> SalaScreen(ui, openApprovals = openApprovals, send = vm::sendChat, share = vm::shareText)
                    Screen.COMANDOS -> CommandsScreen(ui, openApproval = { approving = it }, rejectAll = { vm.rejectAllPending() }, send = vm::sendCommand, runShortcut = { vm.runShortcut(it) }, addShortcut = { l, t, to -> vm.addShortcut(l, t, to) }, deleteShortcut = { vm.deleteShortcut(it) })
                    Screen.AGENTES -> AgentsScreen(ui) { openNote("20-Operations/Memoria/Agentes/Diario $it.md") }
                    Screen.RESUMOS -> SummaryScreen(ui, read = vm::readSummary)
                }
                }
                }
            }
        }
    }
    approving?.let { c -> ApprovalSheet(c, ui.busy, onDismiss = { approving = null }, decide = vm::decide) }
}

@Composable
private fun TopBar(ui: UiState, screen: Screen, back: (() -> Unit)?, openAgents: () -> Unit) {
    val k = Clay.c
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().height(64.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (back != null) ClayIconButton(back, "Voltar") { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, tint = k.text) }
        else Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) { AgentC(28.dp) }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(if (screen == Screen.HOME) "Agent Control" else screen.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = k.text, letterSpacing = if (screen == Screen.HOME) 1.5.sp else 0.sp)
            val (dot, label) = when (ui.live) {
                Live.ON -> k.ok to "${ui.state.agents.size} agentes · ao vivo"
                Live.CONNECTING -> k.warn to "conectando"
                Live.OFF -> k.err to "offline"
            }.let { (c, l) -> if (ui.readOnly) k.warn to "$l · só leitura" else c to l }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Dot(dot, 7)
                Text(label, color = k.muted, fontSize = 12.sp)
            }
        }
        ClayIconButton(openAgents, "Ver agentes") { Icon(Icons.Outlined.Groups, null, tint = k.text) }
    }
}


/** Faixa fixa quando o celular não alcança o PC (no lugar de um aviso repetido a cada 4 s). */
@Composable
private fun OfflineBanner(reason: String, openTailscale: () -> Unit, retry: () -> Unit) {
    val k = Clay.c
    val tailscale = reason.contains("Tailscale") || reason.contains("Sem resposta") || reason.contains("Não achei")
    Column(
        Modifier.padding(horizontal = 14.dp, vertical = 6.dp).fillMaxWidth().clay(RoundedCornerShape(20.dp), elevation = 6.dp, color = k.brandSoft).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Outlined.WifiOff, null, tint = k.warn)
            Column(Modifier.weight(1f)) {
                Text(if (tailscale) "Sem conexão com o PC" else "Problema com o AgentC", color = k.text, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(
                    if (tailscale) "Ligue o Tailscale neste celular (o do PC está ligado). Dica: nas configurações de VPN do Android, deixe o Tailscale como \"VPN sempre ativa\"." else reason,
                    color = k.text2, fontSize = 13.sp, lineHeight = 18.sp,
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (tailscale) BannerButton("Abrir Tailscale", openTailscale, primary = true)
            BannerButton("Tentar agora", retry)
        }
    }
}

@Composable
private fun BannerButton(text: String, onClick: () -> Unit, primary: Boolean = false) {
    val k = Clay.c
    Box(
        Modifier.height(40.dp).clay(RoundedCornerShape(20.dp), elevation = 5.dp, color = if (primary) k.brand else null).clickable(onClick = onClick).padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = if (primary) k.onBrand else k.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
}