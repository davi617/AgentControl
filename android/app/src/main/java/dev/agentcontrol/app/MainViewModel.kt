package dev.agentcontrol.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import android.content.Intent
import android.net.Uri
import android.provider.Settings as AndroidSettings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import dev.agentcontrol.app.data.AppVersion
import dev.agentcontrol.app.data.AgentModels
import dev.agentcontrol.app.data.CallState
import dev.agentcontrol.app.data.CallTurn
import dev.agentcontrol.app.data.Command
import dev.agentcontrol.app.data.Health
import dev.agentcontrol.app.data.Entry
import dev.agentcontrol.app.data.JarvisApi
import dev.agentcontrol.app.data.JarvisState
import dev.agentcontrol.app.data.Note
import dev.agentcontrol.app.data.NoteSearch
import dev.agentcontrol.app.data.Project
import dev.agentcontrol.app.data.Settings
import dev.agentcontrol.app.data.SummaryResponse
import dev.agentcontrol.app.data.chatMeta
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.sse.EventSource

enum class Live { OFF, CONNECTING, ON }

/** Estado da chamada em grupo na tela: quem fala, legenda, microfone. */
data class CallUi(
    val state: CallState? = null,
    val speaking: String? = null,
    val captionWho: String = "",
    val caption: String = "",
    val thinking: Boolean = false,
    val listening: Boolean = false,
    val paused: Boolean = false,
    val startedAt: Long = 0,
    val handsFree: Boolean = false,
    val muted: Boolean = false, // modo mudo: só texto, sem voz (pedido do dono, 2026-09-28)
    val people: List<dev.agentcontrol.app.data.CallPerson> = emptyList(), // quem pode entrar (time + especialistas)
) {
    val active: Boolean get() = state != null && state.status != "ENCERRADA"
}

/** Falar com o JARVIS: você fala, ele responde falando (a resposta vem da sala, gerada no PC). */
data class TalkUi(
    val state: String = "parado", // parado | ouvindo | pensando | falando
    val partial: String = "",
    val turns: List<Pair<String, String>> = emptyList(), // quem → o quê, desta conversa
    val continuous: Boolean = false, // depois de responder, volta a ouvir sozinho
)

/** Cérebro: busca no vault do Obsidian e a nota aberta. */
data class BrainUi(val query: String = "", val result: NoteSearch? = null, val note: Note? = null, val loading: Boolean = false, val history: List<String> = emptyList())

data class UiState(
    val configured: Boolean = false,
    val live: Live = Live.OFF,
    val projects: List<Project> = emptyList(),
    val project: String = "",
    val chat: List<Entry> = emptyList(),
    val commands: List<Command> = emptyList(),
    val state: JarvisState = JarvisState(),
    val summary: SummaryResponse? = null,
    val message: String? = null, // resposta do JARVIS ou erro, mostrado num snackbar
    val busy: Boolean = false,
    val update: AppVersion? = null, // versão mais nova publicada no PC
    val call: CallUi = CallUi(),
    val health: Health? = null,
    val limits: dev.agentcontrol.app.data.LimitsSnap? = null,
    val reading: Boolean = false, // lendo o resumo em voz alta
    val offline: String? = null, // motivo de não alcançar o PC (ex.: Tailscale do celular desligado); some ao reconectar
    val brain: BrainUi = BrainUi(),
    val talk: TalkUi = TalkUi(),
    val models: List<AgentModels>? = null,
    val notes: List<dev.agentcontrol.app.data.QuickNote> = emptyList(),
    val favorites: List<dev.agentcontrol.app.data.Favorite> = emptyList(),
    val shortcuts: List<dev.agentcontrol.app.data.Shortcut> = emptyList(),
    val alertPrefs: Map<String, Boolean> = emptyMap(), // aprovacao · comando · jarvis (ausente = ligado)
    val stats: dev.agentcontrol.app.data.TeamStats? = null,
    val searchQuery: String = "",
    val searchHits: List<dev.agentcontrol.app.data.SearchHit>? = null,
    val readOnly: Boolean = false, // modo só leitura: nada sai do celular sem querer
    val background: Boolean = true, // serviço em segundo plano ligado (avisos com o app fechado)
    val usage: dev.agentcontrol.app.data.UsageSnap? = null,
    val feed: List<Entry>? = null,
    val feedAgent: String? = null,
    val calls: List<dev.agentcontrol.app.data.CallInfo>? = null,
    val about: dev.agentcontrol.app.data.About? = null,
    val themeMode: String = "sistema", // sistema · claro · escuro
    val fontScale: Float = 1f,
    val muteUntil: Long = 0, // não perturbe: avisos calados até esse horário
    val healthMs: Long? = null, // quanto o PC demorou para responder a Saúde (latência)
    val openScreen: String? = null, // atalho do ícone do app pediu uma tela
) {
    val pending: List<Command> get() = commands.filter { it.pending }
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val settings = Settings(app)
    private val _ui = MutableStateFlow(UiState(configured = settings.configured, project = settings.project))
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private var api: JarvisApi? = null
    private var sse: EventSource? = null
    private var reconnect: Job? = null

    /** Status já visto de cada comando: avisa só quando MUDA para DONE/BLOCKED/REVIEW (não no 1º carregamento). */


    var foreground: Boolean
        get() = AlertCenter.foreground
        set(v) { AlertCenter.foreground = v }

    val savedUrl: String get() = settings.baseUrl

    init {
        if (settings.configured) connect()
    }

    /** Tela de conexão: testa antes de salvar, para não guardar endereço/token errados. */
    fun setup(url: String, token: String) = viewModelScope.launch {
        _ui.update { it.copy(busy = true, message = null) }
        val candidate = JarvisApi(url, token.trim())
        runCatching { candidate.projects() }
            .onSuccess {
                settings.baseUrl = JarvisApi.normalize(url)
                settings.token = token
                _ui.update { s -> s.copy(configured = true, busy = false) }
                if (appPrefs.getBoolean("background", true)) JarvisService.start(getApplication())
                connect()
            }
            .onFailure { e -> _ui.update { it.copy(busy = false, message = "Não conectei: ${e.message}") } }
    }

    fun forget() {
        // Botão "Desconectar" do menu: apaga endereço e token deste celular.
        sse?.cancel(); reconnect?.cancel()
        JarvisService.stop(getApplication())
        settings.clear()
        api = null
        _ui.value = UiState()
    }

    private fun connect() {
        api = JarvisApi(settings.baseUrl, settings.token)
        viewModelScope.launch {
            runCatching { api!!.projects() }
                .onSuccess { list ->
                    val chosen = list.firstOrNull { it.id == settings.project }?.id ?: list.firstOrNull()?.id.orEmpty()
                    settings.project = chosen
                    _ui.update { it.copy(projects = list, project = chosen, offline = null) }
                    refreshAll()
                    listen()
                    checkUpdate()
                    loadExtras()
                }
                .onFailure { e -> _ui.update { it.copy(live = Live.OFF, offline = e.message) }; scheduleReconnect() }
        }
    }

    fun selectProject(id: String) {
        settings.project = id
        _ui.update { it.copy(project = id) }
        sse?.cancel()
        viewModelScope.launch { refreshAll(); listen() }
    }

    suspend fun refreshLimits() {
        val a = api ?: return
        val p = _ui.value.project.ifEmpty { return }
        runCatching { a.limits(p) }.onSuccess { q -> _ui.update { it.copy(limits = q) } }
            .onFailure { _ui.update { it.copy(limits = null) } }
    }

    private suspend fun refreshAll() {
        val a = api ?: return
        val p = _ui.value.project.ifEmpty { return }
        runCatching {
            val st = a.state(p)
            val chat = a.chat(p)
            val cmds = a.commands(p)
            val sum = a.summary(p)
            _ui.update { it.copy(state = st, chat = chat, commands = cmds, summary = sum, offline = null) }
            AlertCenter.onChat(getApplication(), chat) // 1ª carga só marca onde parou (sem avisar o que é velho)
            notifyPending(cmds)
        }.onFailure { e -> _ui.update { it.copy(offline = e.message) } }
    }

    private fun listen() {
        val a = api ?: return
        val p = _ui.value.project.ifEmpty { return }
        sse?.cancel()
        _ui.update { it.copy(live = Live.CONNECTING) }
        sse = a.events(
            p,
            handleEvent = { type ->
                _ui.update { it.copy(live = Live.ON, offline = null) }
                viewModelScope.launch {
                    runCatching {
                        when (type) {
                            "chat" -> a.chat(p).also { c -> _ui.update { it.copy(chat = c) }; notifyReplies(c) }
                            "commands" -> a.commands(p).also { c -> _ui.update { it.copy(commands = c) }; notifyPending(c) }
                            "agents", "tasks" -> _ui.update { it.copy(state = a.state(p)) }
                            "summary" -> _ui.update { it.copy(summary = a.summary(p)) }
                            // Chamada mexida em outro aparelho (ex.: no PC): atualiza a transcrição.
                            "call" -> if (!pumping) a.callGet(p).let { c -> _ui.update { it.copy(call = it.call.copy(state = c)) } }
                        }
                    }
                }
            },
            handleClosed = { _ ->
                _ui.update { it.copy(live = Live.OFF) }
                scheduleReconnect()
            },
        )
        // O SSE só manda eventos quando algo muda; o primeiro byte já prova que conectou.
        viewModelScope.launch { delay(1500); if (_ui.value.live == Live.CONNECTING) _ui.update { it.copy(live = Live.ON) } }
    }

    private fun scheduleReconnect() {
        if (reconnect?.isActive == true) return
        reconnect = viewModelScope.launch {
            delay(4000)
            if (!settings.configured) return@launch
            // Se a 1ª conexão falhou (ex.: app aberto antes do Tailscale), ainda não há projeto: refaz o connect.
            if (_ui.value.projects.isEmpty()) {
                reconnect = null
                connect()
            } else {
                refreshAll(); listen()
            }
        }
    }

    /** Botão "Tentar agora" da faixa de offline. */
    fun retryNow() {
        reconnect?.cancel(); reconnect = null
        _ui.update { it.copy(live = Live.CONNECTING) }
        if (_ui.value.projects.isEmpty()) connect() else viewModelScope.launch { refreshAll(); listen() }
    }

    /** Abre o app do Tailscale (ou a loja, se não estiver instalado) para ligar a VPN do celular. */
    fun openTailscale() {
        val app = getApplication<Application>()
        val intent = app.packageManager.getLaunchIntentForPackage("com.tailscale.ipn")
            ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.tailscale.ipn"))
        app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // ---------- Cérebro (vault do Obsidian) ----------
    private var brainJob: Job? = null
    private fun setBrain(f: (BrainUi) -> BrainUi) = _ui.update { it.copy(brain = f(it.brain)) }

    /** Busca com pausa de 300 ms entre letras (não dispara uma busca por tecla). */
    fun brainSearch(q: String) {
        setBrain { it.copy(query = q) }
        brainJob?.cancel()
        brainJob = viewModelScope.launch {
            delay(if (q.isEmpty()) 0 else 300)
            val a = api ?: return@launch
            setBrain { it.copy(loading = true) }
            runCatching { a.vaultSearch(_ui.value.project, q.trim()) }
                .onSuccess { r -> setBrain { it.copy(result = r, loading = false) } }
                .onFailure { e -> setBrain { it.copy(loading = false) }; _ui.update { it.copy(message = "Não busquei: ${e.message}") } }
        }
    }

    fun openNote(path: String) = viewModelScope.launch {
        val a = api ?: return@launch
        setBrain { it.copy(loading = true) }
        runCatching { a.vaultNote(_ui.value.project, path) }
            .onSuccess { n -> setBrain { b -> b.copy(note = n, loading = false, history = b.note?.let { b.history + it.path } ?: b.history) } }
            .onFailure { e -> setBrain { it.copy(loading = false) }; _ui.update { it.copy(message = "Não abri a nota: ${e.message}") } }
    }

    /** Voltar dentro do cérebro: nota anterior (seguiu um link) ou a lista. */
    fun closeNote() {
        val h = _ui.value.brain.history
        setBrain { it.copy(note = null, history = h.dropLast(1)) }
        h.lastOrNull()?.let { openNote(it) }
    }

    // Avisos: a decisão fica no AlertCenter (compartilhado com o serviço em segundo plano, sem aviso duplicado).
    private fun notifyReplies(chat: List<Entry>) = AlertCenter.onChat(getApplication(), chat)
    private fun notifyPending(cmds: List<Command>) = AlertCenter.onCommands(getApplication(), cmds)

    fun sendChat(text: String, to: String, asChatGpt: Boolean) = act {
        blockIfReadOnly()
        api!!.sendChat(_ui.value.project, text, to, asChatGpt)
        null
    }

    /** Botão "Perguntar ao AgentC": manda a pergunta na sala; ele responde lá em segundos. */
    fun askJarvis(question: String) = sendChat(question, "JARVIS", false)

    fun sendCommand(text: String, to: String) = act { blockIfReadOnly(); api!!.sendCommand(_ui.value.project, text, to).reply }

    fun decide(code: String, approve: Boolean) = act { if (approve) blockIfReadOnly(); api!!.decide(_ui.value.project, code, approve).reply }

    // ---------- só leitura, avisos, notas, favoritos, atalhos, busca, estatísticas ----------
    private val appPrefs = app.getSharedPreferences("jarvis_app", android.content.Context.MODE_PRIVATE)
    init {
        _ui.update {
            it.copy(
                readOnly = appPrefs.getBoolean("readOnly", false), background = appPrefs.getBoolean("background", true),
                themeMode = appPrefs.getString("themeMode", "sistema") ?: "sistema", fontScale = appPrefs.getFloat("fontScale", 1f),
                muteUntil = appPrefs.getLong("muteUntil", 0),
            )
        }
        AlertCenter.muteUntil = appPrefs.getLong("muteUntil", 0)
        if (settings.configured && appPrefs.getBoolean("background", true)) JarvisService.start(app)
    }

    private fun blockIfReadOnly() { if (_ui.value.readOnly) throw IllegalStateException("modo só leitura ligado (desligue no menu)") }
    private fun alertOn(key: String) = _ui.value.alertPrefs[key] != false

    /** Segundo plano: serviço que fica conectado ao PC e avisa com o app fechado (liga no boot também). */
    fun setBackground(on: Boolean) {
        appPrefs.edit().putBoolean("background", on).apply()
        _ui.update { it.copy(background = on) }
        val app = getApplication<Application>()
        if (on) JarvisService.start(app) else JarvisService.stop(app)
    }

    /** Tela do Android para tirar o JARVIS da economia de bateria (senão a Infinix mata o serviço). */
    fun openBatterySettings() = runCatching {
        getApplication<Application>().startActivity(Intent(AndroidSettings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }.onFailure { _ui.update { it.copy(message = "Abra Configurações → Bateria → AgentC → Sem restrições.") } }

    fun setReadOnly(on: Boolean) {
        appPrefs.edit().putBoolean("readOnly", on).apply()
        _ui.update { it.copy(readOnly = on, message = if (on) "Modo só leitura: o app não manda nada até você desligar." else "Modo só leitura desligado.") }
    }

    fun loadExtras() = viewModelScope.launch {
        val a = api ?: return@launch
        val p = _ui.value.project
        runCatching { a.notes(p) }.onSuccess { n -> _ui.update { it.copy(notes = n) } }
        runCatching { a.favorites(p) }.onSuccess { f -> _ui.update { it.copy(favorites = f) } }
        runCatching { a.shortcuts(p) }.onSuccess { sc -> _ui.update { it.copy(shortcuts = sc) } }
        runCatching { a.alertPrefs(p) }.onSuccess { ap -> AlertCenter.prefs = ap; _ui.update { it.copy(alertPrefs = ap) } }
    }

    fun addNote(text: String) = viewModelScope.launch {
        val a = api ?: return@launch
        if (text.isBlank()) return@launch
        runCatching { a.addNote(_ui.value.project, text.trim()); a.notes(_ui.value.project) }
            .onSuccess { n -> _ui.update { it.copy(notes = n, message = "Anotado. Também ficou no vault (20-Operations/Notas Rapidas).") } }
            .onFailure { e -> _ui.update { it.copy(message = "Não anotei: ${e.message}") } }
    }

    fun toggleNote(id: Long, done: Boolean) = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.noteDone(_ui.value.project, id, done); a.notes(_ui.value.project) }.onSuccess { n -> _ui.update { it.copy(notes = n) } }
    }

    fun deleteNote(id: Long) = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.noteDelete(_ui.value.project, id); a.notes(_ui.value.project) }.onSuccess { n -> _ui.update { it.copy(notes = n) } }
    }

    fun toggleFavorite(path: String, title: String) = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.toggleFavorite(_ui.value.project, path, title); a.favorites(_ui.value.project) }
            .onSuccess { f -> _ui.update { it.copy(favorites = f, message = if (f.any { x -> x.path == path }) "Adicionada aos favoritos." else "Removida dos favoritos.") } }
    }

    private var searchJob: Job? = null
    fun searchAll(q: String) {
        _ui.update { it.copy(searchQuery = q) }
        searchJob?.cancel()
        if (q.isBlank()) { _ui.update { it.copy(searchHits = null) }; return }
        searchJob = viewModelScope.launch {
            delay(350)
            val a = api ?: return@launch
            runCatching { a.search(_ui.value.project, q.trim()) }
                .onSuccess { h -> _ui.update { it.copy(searchHits = h) } }
                .onFailure { e -> _ui.update { it.copy(message = "Não busquei: ${e.message}") } }
        }
    }

    fun addShortcut(label: String, text: String, target: String) = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.addShortcut(_ui.value.project, label, text, target); a.shortcuts(_ui.value.project) }
            .onSuccess { sc -> _ui.update { it.copy(shortcuts = sc, message = "Atalho \"$label\" criado.") } }
            .onFailure { e -> _ui.update { it.copy(message = "Não criei o atalho: ${e.message}") } }
    }

    fun deleteShortcut(id: Long) = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.deleteShortcut(_ui.value.project, id); a.shortcuts(_ui.value.project) }.onSuccess { sc -> _ui.update { it.copy(shortcuts = sc) } }
    }

    fun runShortcut(id: Long) = act { blockIfReadOnly(); api!!.runShortcut(_ui.value.project, id).reply }

    fun setAlert(key: String, on: Boolean) = viewModelScope.launch {
        val a = api ?: return@launch
        val prefs = _ui.value.alertPrefs + (key to on)
        AlertCenter.prefs = prefs
        _ui.update { it.copy(alertPrefs = prefs) }
        runCatching { a.setAlertPrefs(_ui.value.project, prefs) }.onFailure { e -> _ui.update { it.copy(message = "Não salvei os avisos: ${e.message}") } }
    }

    // ---------- tema, texto, não perturbe, uso, linha do tempo, chamadas, sobre ----------
    fun setThemeMode(m: String) { appPrefs.edit().putString("themeMode", m).apply(); _ui.update { it.copy(themeMode = m) } }
    fun setFontScale(f: Float) {
        val v = f.coerceIn(0.85f, 1.4f)
        appPrefs.edit().putFloat("fontScale", v).apply(); _ui.update { it.copy(fontScale = v) }
    }

    /** Não perturbe: cala os avisos por [horas] (0 = desliga). VIOLATION continua avisando. */
    fun setMute(horas: Int) {
        val until = if (horas <= 0) 0L else System.currentTimeMillis() + horas * 3_600_000L
        appPrefs.edit().putLong("muteUntil", until).apply()
        AlertCenter.muteUntil = until
        _ui.update { it.copy(muteUntil = until, message = if (horas <= 0) "Avisos ligados de novo." else "Não perturbe por $horas h (VIOLATION ainda avisa).") }
    }

    fun loadUsage(dias: Int) = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.usage(_ui.value.project, dias) }
            .onSuccess { u -> _ui.update { it.copy(usage = u) } }
            .onFailure { e -> _ui.update { it.copy(message = "Não li o uso: ${e.message}") } }
    }

    fun loadFeed(agent: String?) = viewModelScope.launch {
        val a = api ?: return@launch
        _ui.update { it.copy(feedAgent = agent) }
        runCatching { a.feed(_ui.value.project, agent) }
            .onSuccess { f -> _ui.update { it.copy(feed = f) } }
            .onFailure { e -> _ui.update { it.copy(message = "Não li a linha do tempo: ${e.message}") } }
    }

    fun loadCalls() = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.calls(_ui.value.project) }.onSuccess { c -> _ui.update { it.copy(calls = c) } }
    }

    fun loadAbout() = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.about(_ui.value.project) }.onSuccess { ab -> _ui.update { it.copy(about = ab) } }
    }

    /** "Verificar atualização agora" (antes só conferia ao abrir o app). */
    fun checkUpdateNow() = viewModelScope.launch {
        checkUpdate()
        _ui.update { it.copy(message = it.update?.let { v -> "Tem versão nova: ${v.versionName}. Toque em Atualizar app na tela inicial." } ?: "O app já está na última versão.") }
    }

    /** Recusar todas as aprovações esperando (aprovar em lote não existe: cada ação protegida é um toque). */
    fun rejectAllPending() = act {
        val a = api!!
        val codes = _ui.value.pending.map { it.code }
        codes.forEach { a.decide(_ui.value.project, it, false) }
        "Recusei ${codes.size} comando(s) protegido(s)."
    }

    /** Compartilhar texto (mensagem, nota, notas) pelo Android. */
    fun shareText(title: String, text: String) {
        val app = getApplication<Application>()
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, text)
        app.startActivity(Intent.createChooser(send, "Compartilhar").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun shareNotes() = shareText("Notas rápidas", _ui.value.notes.joinToString("\n") { "${if (it.done == 1) "[x]" else "[ ]"} ${it.text}" })

    fun openScreenFromShortcut(screen: String?) { if (screen != null) _ui.update { it.copy(openScreen = screen) } }
    fun consumeOpenScreen() = _ui.update { it.copy(openScreen = null) }

    fun loadStats(dias: Int) = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.stats(_ui.value.project, dias) }
            .onSuccess { st -> _ui.update { it.copy(stats = st) } }
            .onFailure { e -> _ui.update { it.copy(message = "Não li as estatísticas: ${e.message}") } }
    }

    /** Compartilhar a ata da chamada (WhatsApp, e-mail, Drive…) como texto. */
    fun shareCall() {
        val c = _ui.value.call.state ?: return
        val r = c.resumo
        val text = buildString {
            appendLine("Chamada do AgentC: ${c.topic}")
            appendLine()
            c.turns.forEach { appendLine("${it.speaker}: ${it.text}") }
            if (r != null && r.status == "ok") {
                appendLine(); appendLine("Decisões:"); r.decisoes.forEach { appendLine("• $it") }
                appendLine(); appendLine("Tarefas:"); r.tarefas.forEach { appendLine("• ${it.agente}: ${it.tarefa}") }
                if (r.pendencias.isNotEmpty()) { appendLine(); appendLine("Pendências:"); r.pendencias.forEach { appendLine("• $it") } }
            }
        }
        val app = getApplication<Application>()
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, "Chamada: ${c.topic}").putExtra(Intent.EXTRA_TEXT, text)
        app.startActivity(Intent.createChooser(send, "Compartilhar ata").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun consumeMessage() = _ui.update { it.copy(message = null) }

    // ---------- Chamada em grupo (voz) ----------
    // O JARVIS decide quem fala e gera o texto; o celular dá a voz de cada agente e ouve o dono.
    private val voice by lazy { VoiceEngine(getApplication()).also { it.rate = appPrefs.getFloat("voiceRate", 1f) } }
    private var pumping = false
    private var handsFreeListen = false
    private var pertoDoRosto = false

    /** Mãos livres na chamada: depois que todos respondem, o microfone abre sozinho (sem tocar no botão). */
    fun callHandsFree(on: Boolean) = setCall { it.copy(handsFree = on) }

    /**
     * Sensor de proximidade (pedido do dono, 2026-09-27): encostou o celular no rosto como numa ligação
     * de verdade → abre o microfone sozinho e a voz sai baixinho no fone, não no viva-voz. Afastou → envia.
     */
    fun callProximity(perto: Boolean) {
        if (perto == pertoDoRosto) return
        pertoDoRosto = perto
        val c = _ui.value.call
        if (!c.active) { voice.earpiece = false; return }
        voice.earpiece = perto
        if (perto && !c.listening) callTalk()
        else if (!perto && c.listening) callTalk()
    }

    // ---------- Vozes (tela Vozes) ----------
    suspend fun voiceList(): List<Pair<String, String>> = voice.available()
    fun voiceOf(who: String): String? = voice.voiceNameFor(who)
    fun voiceChoose(who: String, name: String) { voice.choose(who, name); voicePreview(who) }
    fun voicePreview(who: String) = viewModelScope.launch {
        voice.stopSpeaking()
        voice.speak(who, if (who == "JARVIS") "Oi você, eu sou o AgentC. Essa é a minha voz." else "Oi você, aqui é o $who. Essa é a minha voz na chamada.")
    }
    fun installVoices() = runCatching { getApplication<Application>().startActivity(voice.installVoicesIntent()) }
        .onFailure { _ui.update { it.copy(message = "Abra Configurações → Acessibilidade → Saída de texto para fala → Instalar dados de voz.") } }

    private fun setCall(f: (CallUi) -> CallUi) = _ui.update { it.copy(call = f(it.call)) }
    private fun indexOf(id: String) = _ui.value.call.state?.participants?.indexOfFirst { it.id == id }?.coerceAtLeast(0) ?: 0

    fun callStart(topic: String, who: List<String> = emptyList(), modo: String = "debate") = viewModelScope.launch {
        val a = api ?: return@launch
        if (_ui.value.readOnly) { _ui.update { it.copy(message = "Modo só leitura ligado: desligue no menu para ligar.") }; return@launch }
        if (topic.isBlank()) { _ui.update { it.copy(message = "Diga o assunto da chamada.") }; return@launch }
        val mudo = appPrefs.getBoolean("callMuted", false)
        runCatching { a.callStart(_ui.value.project, topic.trim(), who, modo) }
            .onSuccess { c -> setCall { CallUi(state = c, startedAt = System.currentTimeMillis(), muted = mudo) }; pump() }
            .onFailure { e -> _ui.update { it.copy(message = "Não liguei: ${e.message}") } }
    }

    /** Botão "Modo Goal" (início e chamada): liga para o time no modo goal com o Goal ativo como assunto, sem digitar nada. */
    fun callStartGoal() = callStart(_ui.value.state.goal?.takeIf { it.isNotBlank() } ?: "Tocar o Goal ativo", emptyList(), "goal")

    /** Modo mudo: os agentes só respondem por texto na transcrição, sem falar nada (pedido do dono: "só conversarem por msg"). */
    fun callMute(on: Boolean) {
        appPrefs.edit().putBoolean("callMuted", on).apply()
        if (on) voice.stopSpeaking()
        setCall { it.copy(muted = on) }
    }

    private fun pump() {
        if (pumping) return
        pumping = true
        viewModelScope.launch {
            val a = api
            try {
                while (a != null && _ui.value.call.state?.status == "ATIVA" && !_ui.value.call.paused && !_ui.value.call.listening) {
                    setCall { it.copy(thinking = true, captionWho = "", caption = "pensando…") }
                    // Fila da NVIDIA cheia (429) ou modelo pendurado: tenta de novo sozinho, avisando, em vez de parar calado.
                    var r: dev.agentcontrol.app.data.CallNext? = null
                    for (tentativa in 1..4) {
                        r = runCatching { a.callNext(_ui.value.project) }.getOrElse { e ->
                            if (tentativa == 4) throw e
                            setCall { it.copy(caption = "A fila da NVIDIA está cheia. Tentando de novo ($tentativa/3)…") }
                            delay(5_000L * tentativa)
                            null
                        }
                        if (r != null || _ui.value.call.paused || _ui.value.call.state?.status != "ATIVA") break
                    }
                    if (r == null) break
                    setCall { it.copy(thinking = false, state = r!!.call ?: it.state) }
                    val t: CallTurn = r!!.turn ?: break
                    setCall { it.copy(speaking = t.speaker, captionWho = t.speaker, caption = t.text) }
                    if (_ui.value.call.paused || _ui.value.call.listening) break
                    if (!_ui.value.call.muted) voice.speak(t.speaker, t.text)
                    // Mãos livres: todos já responderam desde a última fala do dono → abre o microfone sozinho.
                    val sinceDono = _ui.value.call.state?.turns?.takeLastWhile { it.speaker != "DONO" }?.size ?: 0
                    if (_ui.value.call.handsFree && sinceDono >= (_ui.value.call.state?.participants?.size ?: 99)) { handsFreeListen = true; break }
                    setCall { it.copy(speaking = null) }
                }
                if (_ui.value.call.state?.status == "AGUARDANDO_DONO") setCall { it.copy(captionWho = "", caption = "Eles estão esperando você. Toque em Falar.") }
            } catch (e: Exception) {
                setCall { it.copy(thinking = false, paused = true, captionWho = "JARVIS", caption = "Os agentes não conseguiram responder (${e.message}). A NVIDIA pode estar sobrecarregada: toque em Continuar em alguns instantes.") }
            } finally {
                pumping = false
                setCall { it.copy(thinking = false, speaking = null) }
                // Bug: se o dono já tinha aberto o microfone (botão ou encostando no rosto) nesse meio-tempo,
                // chamar callTalk() de novo aqui ia contar como "2º toque" e mandar a fala dele cortada na metade.
                if (handsFreeListen) { handsFreeListen = false; if (!_ui.value.call.listening) callTalk() }
            }
        }
    }

    /** Microfone: 1º toque começa a ouvir (e interrompe quem está falando); 2º toque envia. */
    fun callTalk() {
        val c = _ui.value.call
        if (!c.active) return
        if (c.listening) { voice.stopListening(); return }
        if (!voice.canListen) { _ui.update { it.copy(message = "Este celular não tem reconhecimento de voz. Digite a fala.") }; return }
        voice.stopSpeaking()
        setCall { it.copy(listening = true, speaking = "DONO", captionWho = "DONO", caption = "ouvindo…") }
        viewModelScope.launch {
            val heard = voice.listen { part -> setCall { it.copy(caption = part) } }
            setCall { it.copy(listening = false, speaking = null) }
            callSend(heard)
        }
    }

    fun callSend(text: String) = viewModelScope.launch {
        val a = api ?: return@launch
        if (!_ui.value.call.active) return@launch
        if (text.isNotBlank()) {
            voice.stopSpeaking()
            runCatching { a.callSay(_ui.value.project, text.trim()) }
                .onSuccess { c -> setCall { it.copy(state = c, paused = false, captionWho = "DONO", caption = text.trim()) } }
                .onFailure { e -> _ui.update { it.copy(message = "Não enviei sua fala: ${e.message}") } }
        }
        pump()
    }

    /** Anexo do dono (foto ou arquivo) na chamada: o PC salva, descreve a imagem e os agentes comentam. */
    fun callAttach(uri: Uri) = viewModelScope.launch {
        val a = api ?: return@launch
        if (!_ui.value.call.active) return@launch
        val app = getApplication<Application>()
        val cr = app.contentResolver
        val name = runCatching {
            cr.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        }.getOrNull() ?: "anexo"
        val mime = cr.getType(uri) ?: "application/octet-stream"
        val bytes = runCatching { cr.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
        if (bytes == null || bytes.isEmpty()) { _ui.update { it.copy(message = "Não consegui ler o arquivo.") }; return@launch }
        if (bytes.size > 5 * 1024 * 1024) { _ui.update { it.copy(message = "Arquivo grande demais (máx. 5 MB).") }; return@launch }
        voice.stopSpeaking()
        setCall { it.copy(captionWho = "DONO", caption = if (mime.startsWith("image/")) "Enviando a imagem… o AgentC está olhando." else "Enviando $name…", thinking = true) }
        runCatching { a.callAttach(_ui.value.project, name, mime, bytes) }
            .onSuccess { c -> setCall { it.copy(state = c, paused = false, thinking = false, caption = "Anexo enviado: $name. Os agentes vão comentar.") }; pump() }
            .onFailure { e -> setCall { it.copy(thinking = false) }; _ui.update { it.copy(message = "Não anexei: ${e.message}") } }
    }

    /** Toque no rosto: esse agente fala em seguida (interrompe quem está falando). */
    fun callPassTurn(agent: String) = viewModelScope.launch {
        val a = api ?: return@launch
        if (!_ui.value.call.active) return@launch
        voice.stopSpeaking()
        runCatching { a.callTurn(_ui.value.project, agent) }
            .onSuccess { c -> setCall { it.copy(state = c, paused = false, captionWho = "", caption = "Vez do $agent…") }; pump() }
            .onFailure { e -> _ui.update { it.copy(message = "Não passei a vez: ${e.message}") } }
    }

    fun callLoadPeople() = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.callPeople(_ui.value.project) }.onSuccess { p -> setCall { it.copy(people = p) } }
    }

    /** Botão Rodada: cada um da chamada dá a opinião dele, na ordem. */
    fun callRound() = viewModelScope.launch {
        val a = api ?: return@launch
        if (!_ui.value.call.active) return@launch
        voice.stopSpeaking()
        runCatching { a.callRound(_ui.value.project) }
            .onSuccess { c -> setCall { it.copy(state = c, paused = false, captionWho = "", caption = "Rodada: cada um vai opinar.") }; pump() }
            .onFailure { e -> _ui.update { it.copy(message = "Não comecei a rodada: ${e.message}") } }
    }

    /** Tarefa do resumo da chamada vira comando J-xxx para o agente (o dono toca em cada uma). */
    fun callTaskToCommand(agent: String, text: String) = sendCommand(text, agent)

    fun callPause() {
        val paused = !_ui.value.call.paused
        if (paused) voice.stopSpeaking()
        setCall { it.copy(paused = paused, caption = if (paused) "Debate pausado." else it.caption) }
        if (!paused) pump()
    }

    fun callSpeed(rate: Float) { voice.rate = rate; appPrefs.edit().putFloat("voiceRate", rate).apply() }

    fun callEnd() = viewModelScope.launch {
        voice.stopSpeaking()
        voice.stopListening()
        voice.earpiece = false
        pertoDoRosto = false
        val c = runCatching { api?.let { a -> a.callEnd(_ui.value.project); a.callGet(_ui.value.project) } }.getOrNull()
        setCall { CallUi(state = c, caption = "Chamada encerrada · ${c?.turns?.size ?: 0} falas. A ata ficou no vault.") }
    }

    /** Ao abrir a tela: retoma uma chamada que já existe (ex.: aberta no PC) sem falar as falas antigas. */
    fun callRefresh() = viewModelScope.launch {
        val c = runCatching { api?.callGet(_ui.value.project) }.getOrNull()
        if (c != null && c.status != "ENCERRADA") setCall { it.copy(state = c, startedAt = if (it.startedAt == 0L) System.currentTimeMillis() else it.startedAt) }
    }

    // ---------- Modelo dos agentes CLAUDE e CODEX ----------
    fun loadModels() = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.models(_ui.value.project) }
            .onSuccess { m -> _ui.update { it.copy(models = m) } }
            .onFailure { e -> _ui.update { it.copy(message = "Não li os modelos: ${e.message}") } }
    }

    fun chooseModel(agent: String, model: String, effort: String?) = viewModelScope.launch {
        val a = api ?: return@launch
        _ui.update { it.copy(busy = true) }
        runCatching { a.setModel(_ui.value.project, agent, model, effort) }
            .onSuccess { r ->
                val label = r.options.firstOrNull { it.id == r.current }?.label ?: r.current
                _ui.update { s -> s.copy(busy = false, models = s.models?.map { if (it.id == r.id) r else it },
                    message = "$agent agora usa $label${r.effort?.let { e -> " ($e)" } ?: ""}. Vale a partir da próxima rodada dele.") }
            }
            .onFailure { e -> _ui.update { it.copy(busy = false, message = "Não troquei: ${e.message}") } }
    }

    fun pauseAgents(on: Boolean, agora: Boolean = false) = viewModelScope.launch {
        val a = api ?: return@launch
        runCatching { a.pauseAgents(_ui.value.project, on, agora) }
            .onSuccess { p ->
                _ui.update { s -> s.copy(health = s.health?.copy(pausa = p), message = when {
                    !p.paused -> "Agentes liberados. Voltam a rodar quando chegar ordem nova."
                    p.agora -> "Todos os agentes PARADOS agora (a rodada em andamento foi cortada)."
                    else -> "Agentes pausados: terminam a rodada atual e não começam outra."
                }) }
                runCatching { a.health(_ui.value.project) }.onSuccess { h -> _ui.update { it.copy(health = h) } }
            }
            .onFailure { e -> _ui.update { it.copy(message = "Não consegui: ${e.message}") } }
    }

    // ---------- Falar com o JARVIS (voz) ----------
    private var talkJob: Job? = null
    private fun setTalk(f: (TalkUi) -> TalkUi) = _ui.update { it.copy(talk = f(it.talk)) }
    fun talkContinuous(on: Boolean) = setTalk { it.copy(continuous = on) }

    fun talkStart() {
        val a = api ?: return
        if (!voice.canListen) { _ui.update { it.copy(message = "Este celular não tem reconhecimento de voz.") }; return }
        if (talkJob?.isActive == true) { talkStop(); return }
        voice.stopSpeaking()
        talkJob = viewModelScope.launch {
            val p = _ui.value.project
            do {
                setTalk { it.copy(state = "ouvindo", partial = "") }
                val heard = voice.listen { part -> setTalk { it.copy(partial = part) } }.trim()
                if (heard.isBlank()) break
                setTalk { it.copy(state = "pensando", partial = "", turns = it.turns + ("DONO" to heard)) }
                val since = runCatching { a.chat(p) }.getOrNull()?.maxOfOrNull { it.id } ?: 0L
                val sent = runCatching { a.sendChat(p, heard, "JARVIS", false) }
                if (sent.isFailure) { setTalk { it.copy(turns = it.turns + ("JARVIS" to "Não enviei: ${sent.exceptionOrNull()?.message}")) }; break }
                // A resposta chega na sala em alguns segundos (fila da NVIDIA com prioridade).
                var reply: String? = null
                for (i in 0 until 75) {
                    delay(2000)
                    reply = runCatching { a.chat(p) }.getOrNull()?.filter { it.id > since && it.agent == "JARVIS" }?.lastOrNull()?.chatMeta()?.text
                    if (reply != null) break
                }
                if (reply == null) { setTalk { it.copy(turns = it.turns + ("JARVIS" to "Demorei demais para responder. Tente de novo.")) }; break }
                setTalk { it.copy(state = "falando", turns = it.turns + ("JARVIS" to reply)) }
                speakLong(reply)
            } while (_ui.value.talk.continuous)
            setTalk { it.copy(state = "parado", partial = "") }
        }
    }

    fun talkStop() {
        voice.stopListening(); voice.stopSpeaking()
        talkJob?.cancel(); talkJob = null
        setTalk { it.copy(state = "parado", partial = "") }
    }

    /** Fala texto longo em pedaços (o motor de fala do Android corta textos grandes), sem markdown. */
    private suspend fun speakLong(raw: String) {
        val text = raw.replace(Regex("[*#`_>|]"), " ").replace(Regex("\\s+"), " ").trim()
        for (part in text.split(Regex("(?<=[.!?])\\s+")).chunked(3).map { it.joinToString(" ") }) voice.speak("JARVIS", part)
    }

    // ---------- Saúde, ditado e resumo falado ----------
    /** Tela Saúde aberta: atualiza a cada 10 s enquanto [keep] devolver true. */
    fun watchHealth(keep: () -> Boolean) = viewModelScope.launch {
        while (keep()) {
            api?.let { a ->
                val t0 = System.currentTimeMillis()
                runCatching { a.health(_ui.value.project) }.onSuccess { h -> _ui.update { it.copy(health = h, healthMs = System.currentTimeMillis() - t0) } }
            }
            delay(10_000)
        }
    }

    /** Ditado das caixas de mensagem: devolve o que o dono falou ("" se nada). */
    suspend fun dictate(): String = if (voice.canListen) voice.listen { } else {
        _ui.update { it.copy(message = "Este celular não tem reconhecimento de voz.") }; ""
    }

    /** Lê o resumo por IA (ou o calculado, se não houver) em voz alta. Tocar de novo para. */
    fun readSummary() {
        if (_ui.value.reading) { voice.stopSpeaking(); _ui.update { it.copy(reading = false) }; return }
        val s = _ui.value.summary ?: return
        val text = (s.llm.firstOrNull { it.status == "OK" }?.text ?: s.deterministic)
            .replace(Regex("[*#`_>|]"), " ").replace(Regex("\\s+"), " ").trim()
        if (text.isBlank()) return
        _ui.update { it.copy(reading = true) }
        viewModelScope.launch {
            // Divide em frases: o motor de fala do Android corta textos muito longos.
            for (part in text.split(Regex("(?<=[.!?])\\s+")).chunked(3).map { it.joinToString(" ") }) {
                if (!_ui.value.reading) break
                voice.speak("JARVIS", part)
            }
            _ui.update { it.copy(reading = false) }
        }
    }

    // ---------- Atualização pelo PC (tools/publicar-app.ps1) ----------
    /** Versão instalada neste celular (tela Sobre). */
    val appVersionName: String by lazy {
        val app = getApplication<Application>()
        runCatching { app.packageManager.getPackageInfo(app.packageName, 0).versionName }.getOrNull() ?: "?"
    }

    private val installedVersion: Long by lazy {
        val app = getApplication<Application>()
        PackageInfoCompat.getLongVersionCode(app.packageManager.getPackageInfo(app.packageName, 0))
    }

    private suspend fun checkUpdate() {
        val v = api?.appVersion() ?: return
        _ui.update { it.copy(update = if (v.versionCode > installedVersion) v else null) }
    }

    /** Baixa, confere o SHA-256 e abre o instalador do Android (ele sempre pede o "Instalar" do dono). */
    fun installUpdate() = viewModelScope.launch {
        val a = api ?: return@launch
        val v = _ui.value.update ?: return@launch
        val app = getApplication<Application>()
        if (!app.packageManager.canRequestPackageInstalls()) {
            app.startActivity(
                Intent(AndroidSettings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            _ui.update { it.copy(message = "Permita \"instalar apps desconhecidos\" para o Agent Control e toque em Atualizar de novo.") }
            return@launch
        }
        _ui.update { it.copy(busy = true, message = "Baixando ${v.versionName}…") }
        val file = java.io.File(app.cacheDir, "updates/jarvis.apk")
        runCatching { a.downloadApp(v, file) }
            .onSuccess {
                _ui.update { it.copy(busy = false) }
                val uri = FileProvider.getUriForFile(app, "${app.packageName}.updates", file)
                app.startActivity(
                    Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
            .onFailure { e -> _ui.update { it.copy(busy = false, message = "Não atualizei: ${e.message}") } }
    }

    private fun act(block: suspend () -> String?) = viewModelScope.launch {
        if (api == null) return@launch
        _ui.update { it.copy(busy = true) }
        runCatching { block() }
            .onSuccess { reply -> _ui.update { it.copy(busy = false, message = reply) }; refreshAll() }
            .onFailure { e -> _ui.update { it.copy(busy = false, message = "Não enviei: ${e.message}") } }
    }

    override fun onCleared() {
        sse?.cancel()
        runCatching { voice.shutdown() }
        super.onCleared()
    }
}
