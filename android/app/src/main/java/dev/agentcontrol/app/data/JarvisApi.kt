package dev.agentcontrol.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit

class JarvisException(message: String) : Exception(message)

/**
 * Cliente da API do JARVIS no modo remoto (Fase 4): toda chamada leva "Authorization: Bearer <token>".
 * O servidor remoto só escuta no IP do Tailscale e responde 401 sem o token.
 */
class JarvisApi(url: String, private val token: String) {
    companion object {
        /** Aceita "100.x.y.z", "100.x.y.z:20150", "http://100.x.y.z:20150/"… e devolve "http://host:porta". */
        fun normalize(url: String): String {
            var u = url.trim().trimEnd('/')
            if (!u.contains("://")) u = "http://$u"
            val hostPart = u.substringAfter("://")
            if (!hostPart.contains(':')) u = "$u:20150"
            return u
        }
    }

    private val baseUrl = normalize(url)
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val sseClient = client.newBuilder().readTimeout(0, TimeUnit.SECONDS).build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun url(path: String, project: String? = null) =
        (baseUrl + path).toHttpUrl().newBuilder().apply { if (project != null) addQueryParameter("project", project) }.build()

    private fun request(path: String, project: String? = null) =
        Request.Builder().url(url(path, project)).header("Authorization", "Bearer $token")

    private fun Response.bodyOrThrow(): String {
        val text = body?.string().orEmpty()
        if (!isSuccessful) {
            val msg = runCatching { json.decodeFromString<ErrorResponse>(text).error }.getOrNull()
            throw JarvisException(
                when (code) {
                    401 -> "Token recusado. Confira o token do JARVIS."
                    403 -> msg ?: if (text.contains("host recusado")) "Use o IP 100.x do PC no endereço (o nome do PC não é aceito)." else "Pedido recusado pelo JARVIS."
                    404 -> msg ?: "Endereço errado (404). Use só http://100.x.y.z:20150"
                    else -> msg ?: "Erro HTTP $code"
                },
            )
        }
        return text
    }

    /** Erro de rede vira mensagem que diz o que conferir (em vez de "failed to connect to /100.x…"). */
    private inline fun <T> network(block: () -> T): T = try {
        block()
    } catch (e: java.io.IOException) {
        val host = baseUrl.substringAfter("://")
        throw JarvisException(
            when (e) {
                is java.net.UnknownHostException -> "Não achei $host. Use o IP 100.x do PC."
                is java.net.SocketTimeoutException, is java.net.ConnectException, is java.net.NoRouteToHostException ->
                    "Sem resposta do PC em $host. Confira: Tailscale ligado no celular, PC ligado e firewall do PC liberando a porta 20150."
                else -> "Falha de rede com $host: ${e.message}"
            },
        )
    }

    private suspend fun get(path: String, project: String? = null): String = withContext(Dispatchers.IO) {
        network { client.newCall(request(path, project).get().build()).execute().use { it.bodyOrThrow() } }
    }

    private suspend fun post(path: String, payload: String): String = withContext(Dispatchers.IO) {
        network { client.newCall(request(path).post(payload.toRequestBody(jsonType)).build()).execute().use { it.bodyOrThrow() } }
    }

    suspend fun projects(): List<Project> = json.decodeFromString(get("/api/projects"))

    suspend fun health(project: String): Health = json.decodeFromString(get("/api/health", project))

    // ---------- modelos (CLAUDE e CODEX) ----------
    suspend fun models(project: String): List<AgentModels> = json.decodeFromString(get("/api/models", project))
    suspend fun setModel(project: String, agent: String, model: String, effort: String?): AgentModels =
        json.decodeFromString(post("/api/models", json.encodeToString(buildJsonObject {
            put("project", project); put("agent", agent); put("model", model); if (effort != null) put("effort", effort)
        })))

    /** Parar/retomar todos os agentes (arquivo PAUSE no PC). agora=true corta também a rodada em andamento. */
    suspend fun pauseAgents(project: String, on: Boolean, agora: Boolean): PauseInfo =
        json.decodeFromString(post("/api/agents/pause", json.encodeToString(buildJsonObject { put("project", project); put("on", on); put("agora", agora) })))

    // ---------- notas rápidas, favoritos, atalhos, busca, avisos, estatísticas ----------
    private fun body(project: String, f: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit) =
        json.encodeToString(buildJsonObject { put("project", project); f() })
    suspend fun notes(project: String): List<QuickNote> = json.decodeFromString(get("/api/notes", project))
    suspend fun addNote(project: String, text: String): QuickNote = json.decodeFromString(post("/api/notes", body(project) { put("text", text) }))
    suspend fun noteDone(project: String, id: Long, done: Boolean) { post("/api/notes/done", body(project) { put("id", id); put("done", done) }) }
    suspend fun noteDelete(project: String, id: Long) { post("/api/notes/delete", body(project) { put("id", id) }) }
    suspend fun favorites(project: String): List<Favorite> = json.decodeFromString(get("/api/vault/favorites", project))
    suspend fun toggleFavorite(project: String, path: String, title: String) { post("/api/vault/favorite", body(project) { put("path", path); put("title", title) }) }
    suspend fun search(project: String, q: String): List<SearchHit> = withContext(Dispatchers.IO) {
        network {
            val u = url("/api/search", project).newBuilder().addQueryParameter("q", q).build()
            client.newCall(Request.Builder().url(u).header("Authorization", "Bearer $token").get().build()).execute()
                .use { json.decodeFromString<List<SearchHit>>(it.bodyOrThrow()) }
        }
    }
    suspend fun shortcuts(project: String): List<Shortcut> = json.decodeFromString(get("/api/shortcuts", project))
    suspend fun addShortcut(project: String, label: String, text: String, target: String) {
        post("/api/shortcuts", body(project) { put("label", label); put("text", text); put("target", target) })
    }
    suspend fun deleteShortcut(project: String, id: Long) { post("/api/shortcuts/delete", body(project) { put("id", id) }) }
    suspend fun runShortcut(project: String, id: Long): CommandResponse = json.decodeFromString(post("/api/shortcuts/run", body(project) { put("id", id) }))
    suspend fun alertPrefs(project: String): Map<String, Boolean> = json.decodeFromString(get("/api/alerts/prefs", project))
    suspend fun setAlertPrefs(project: String, prefs: Map<String, Boolean>) {
        post("/api/alerts/prefs", body(project) { put("prefs", buildJsonObject { prefs.forEach { (k, v) -> put(k, v) } }) })
    }
    suspend fun stats(project: String, dias: Int): TeamStats = withContext(Dispatchers.IO) {
        network {
            val u = url("/api/stats", project).newBuilder().addQueryParameter("dias", dias.toString()).build()
            client.newCall(Request.Builder().url(u).header("Authorization", "Bearer $token").get().build()).execute()
                .use { json.decodeFromString<TeamStats>(it.bodyOrThrow()) }
        }
    }

    // ---------- cérebro ----------
    suspend fun vaultSearch(project: String, q: String): NoteSearch = withContext(Dispatchers.IO) {
        network {
            val u = url("/api/vault/search", project).newBuilder().addQueryParameter("q", q).build()
            client.newCall(Request.Builder().url(u).header("Authorization", "Bearer $token").get().build()).execute()
                .use { json.decodeFromString<NoteSearch>(it.bodyOrThrow()) }
        }
    }
    suspend fun vaultNote(project: String, path: String): Note = withContext(Dispatchers.IO) {
        network {
            val u = url("/api/vault/note", project).newBuilder().addQueryParameter("path", path).build()
            client.newCall(Request.Builder().url(u).header("Authorization", "Bearer $token").get().build()).execute()
                .use { json.decodeFromString<Note>(it.bodyOrThrow()) }
        }
    }

    // ---------- chamada de voz ----------
    private fun callBody(project: String, text: String = "") = json.encodeToString(buildJsonObject { put("project", project); put("text", text) })
    suspend fun callGet(project: String): CallState? = get("/api/call", project).let { if (it.trim() == "null") null else json.decodeFromString<CallState>(it) }
    suspend fun callStart(project: String, topic: String, who: List<String> = emptyList(), modo: String = "debate"): CallState =
        json.decodeFromString(post("/api/call/start", json.encodeToString(buildJsonObject {
            put("project", project); put("text", topic); put("modo", modo)
            put("who", kotlinx.serialization.json.JsonArray(who.map { kotlinx.serialization.json.JsonPrimitive(it) }))
        })))
    suspend fun callPeople(project: String): List<CallPerson> = json.decodeFromString(get("/api/call/people", project))
    /** Rodada: todo mundo da chamada opina uma vez. */
    suspend fun callRound(project: String): CallState = json.decodeFromString(post("/api/call/round", callBody(project)))
    /** Toque no rosto do agente: ele fala em seguida. */
    suspend fun callTurn(project: String, agent: String): CallState =
        json.decodeFromString(post("/api/call/turn", json.encodeToString(buildJsonObject { put("project", project); put("agent", agent) })))
    suspend fun callSay(project: String, text: String): CallState = json.decodeFromString(post("/api/call/say", callBody(project, text)))
    /** Pode demorar (o agente "pensa" e a fila NVIDIA pode estar cheia): timeout maior. */
    suspend fun callNext(project: String): CallNext = withContext(Dispatchers.IO) {
        network {
            client.newBuilder().readTimeout(240, TimeUnit.SECONDS).build()
                .newCall(request("/api/call/next").post(callBody(project).toRequestBody(jsonType)).build()).execute()
                .use { json.decodeFromString<CallNext>(it.bodyOrThrow()) }
        }
    }
    suspend fun callEnd(project: String) { post("/api/call/end", callBody(project)) }

    /** Anexo na chamada (imagem ou texto, até 5 MB). Imagem demora: o PC pede para um modelo com visão descrever. */
    suspend fun callAttach(project: String, name: String, mime: String, bytes: ByteArray): CallState = withContext(Dispatchers.IO) {
        val body = json.encodeToString(buildJsonObject {
            put("project", project); put("name", name); put("mime", mime)
            put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
        })
        network {
            client.newBuilder().readTimeout(150, TimeUnit.SECONDS).build()
                .newCall(request("/api/call/attach").post(body.toRequestBody(jsonType)).build()).execute()
                .use { json.decodeFromString<CallState>(it.bodyOrThrow()) }
        }
    }

    /** null = nenhum app publicado no PC. */
    suspend fun appVersion(): AppVersion? = runCatching { json.decodeFromString<AppVersion>(get("/api/app/version")) }.getOrNull()

    /** Baixa o APK publicado para [dest] e confere o SHA-256 (arquivo corrompido não chega ao instalador). */
    suspend fun downloadApp(v: AppVersion, dest: java.io.File) = withContext(Dispatchers.IO) {
        network {
            client.newBuilder().readTimeout(120, TimeUnit.SECONDS).build()
                .newCall(request("/api/app/apk").get().build()).execute().use { r ->
                    if (!r.isSuccessful) r.bodyOrThrow()
                    dest.parentFile?.mkdirs()
                    val md = java.security.MessageDigest.getInstance("SHA-256")
                    r.body!!.byteStream().use { input ->
                        dest.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n); out.write(buf, 0, n) }
                        }
                    }
                    val sha = md.digest().joinToString("") { "%02x".format(it) }
                    if (sha != v.sha256) { dest.delete(); throw JarvisException("Download corrompido (SHA-256 não bate). Tente de novo.") }
                }
        }
    }
    suspend fun state(project: String): JarvisState = json.decodeFromString(get("/api/state", project))
    suspend fun chat(project: String): List<Entry> = json.decodeFromString(get("/api/chat", project))
    suspend fun commands(project: String): List<Command> = json.decodeFromString(get("/api/commands", project))
    suspend fun summary(project: String): SummaryResponse = json.decodeFromString(get("/api/summary", project))

    // ---------- uso dos agentes, linha do tempo, histórico de chamadas, sobre ----------
    private suspend fun getQ(path: String, project: String, vararg q: Pair<String, String>): String = withContext(Dispatchers.IO) {
        network {
            val u = url(path, project).newBuilder().apply { q.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
            client.newCall(Request.Builder().url(u).header("Authorization", "Bearer $token").get().build()).execute().use { it.bodyOrThrow() }
        }
    }
    suspend fun usage(project: String, dias: Int): UsageSnap = json.decodeFromString(getQ("/api/usage", project, "dias" to dias.toString()))
    suspend fun feed(project: String, agent: String?): List<Entry> =
        json.decodeFromString(if (agent == null) getQ("/api/feed", project, "limit" to "150") else getQ("/api/feed", project, "limit" to "150", "agent" to agent))
    suspend fun calls(project: String): List<CallInfo> = json.decodeFromString(get("/api/calls", project))
    suspend fun about(project: String): About = json.decodeFromString(get("/api/about", project))

    suspend fun sendChat(project: String, text: String, to: String, asChatGpt: Boolean) {
        post("/api/chat", json.encodeToString(buildJsonObject {
            put("project", project); put("text", text); put("to", to); put("as", if (asChatGpt) "CHATGPT" else "DONO")
        }))
    }

    suspend fun sendCommand(project: String, text: String, to: String): CommandResponse =
        json.decodeFromString(post("/api/commands", json.encodeToString(buildJsonObject {
            put("project", project); put("text", text); put("to", to)
        })))

    suspend fun decide(project: String, code: String, approve: Boolean): CommandResponse =
        json.decodeFromString(post("/api/commands/decide", json.encodeToString(buildJsonObject {
            put("project", project); put("code", code); put("decision", if (approve) "approve" else "reject")
        })))

    /** SSE /events: chat, commands, agents, tasks, summary. O chamador reconecta quando cair. */
    fun events(project: String, handleEvent: (type: String) -> Unit, handleClosed: (Throwable?) -> Unit): EventSource =
        EventSources.createFactory(sseClient).newEventSource(
            request("/events", project).header("Accept", "text/event-stream").build(),
            object : EventSourceListener() {
                override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                    if (type != null) handleEvent(type)
                }
                override fun onClosed(eventSource: EventSource) {
                    handleClosed(null)
                }
                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    handleClosed(t ?: JarvisException(if (response?.code == 401) "Token recusado" else "Conexão caiu"))
                }
            },
        )
}
