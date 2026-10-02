package dev.agentcontrol.app

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale

/**
 * Voz do app: cada agente fala com uma voz pt-BR diferente e FIXA (TextToSpeech do Android),
 * e o dono fala pelo microfone (SpeechRecognizer).
 * 2026-09-26 (Dono: "as vozes tão uma merda"): antes o tom era distorcido de 0,74 a 1,3 (voz de robô/esquilo),
 * as vozes offline (piores) vinham primeiro, podia cair voz de Portugal e nomes em maiúscula eram soletrados.
 */
class VoiceEngine(private val context: Context) {
    private val ready = CompletableDeferred<Boolean>()
    private var voices: List<Voice> = emptyList()
    private var current: CompletableDeferred<Unit>? = null
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready.complete(status == TextToSpeech.SUCCESS)
    }
    private val prefs = context.getSharedPreferences("jarvis_vozes", Context.MODE_PRIVATE)
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focus: AudioFocusRequest? = null
    var rate = 1f
    /** Encostou o celular no ouvido: fala baixinho no fone (não no viva-voz) e o microfone fica mais sensível. */
    var earpiece = false
        set(v) {
            field = v
            runCatching {
                audioManager.mode = if (v) AudioManager.MODE_IN_COMMUNICATION else AudioManager.MODE_NORMAL
                audioManager.isSpeakerphoneOn = !v
            }
            tts.setAudioAttributes(ttsAttrs())
        }

    private fun ttsAttrs(): AudioAttributes = AudioAttributes.Builder()
        .setUsage(if (earpiece) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_ASSISTANT)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    /** Pede o volume só pra fala do JARVIS (sem abafar quem tocava música, só baixa por um instante). */
    private fun requestFocus() {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(ttsAttrs()).build()
        focus = req
        runCatching { audioManager.requestAudioFocus(req) }
    }

    private fun releaseFocus() { focus?.let { runCatching { audioManager.abandonAudioFocusRequest(it) } }; focus = null }

    init {
        tts.setAudioAttributes(ttsAttrs())
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { releaseFocus(); current?.complete(Unit) }
            @Deprecated("Deprecated in Java") override fun onError(id: String?) { releaseFocus(); current?.complete(Unit) }
            override fun onStop(id: String?, interrupted: Boolean) { releaseFocus(); current?.complete(Unit) }
        })
    }

    /** Só pt-BR instalada; melhores primeiro: qualidade alta, neural (rede) antes de offline. */
    private suspend fun ensure(): Boolean {
        if (!ready.await()) return false
        if (voices.isEmpty()) {
            tts.language = Locale("pt", "BR")
            voices = tts.voices.orEmpty()
                .filter { it.locale.language == "pt" && it.locale.country.equals("BR", true) && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
                .sortedWith(compareByDescending<Voice> { it.quality }.thenByDescending { it.isNetworkConnectionRequired }.thenBy { it.name })
        }
        return true
    }

    /** Lista para a tela Vozes (nome técnico + descrição curta). */
    suspend fun available(): List<Pair<String, String>> {
        if (!ensure()) return emptyList()
        return voices.mapIndexed { i, v -> v.name to "Voz ${i + 1} · ${if (v.isNetworkConnectionRequired) "online, mais natural" else "offline"}${if (v.quality >= Voice.QUALITY_VERY_HIGH) " · alta qualidade" else ""}" }
    }

    /** Voz escolhida pelo dono para [who], ou uma fixa por agente (a mesma sempre, sem distorcer o tom). */
    fun voiceNameFor(who: String): String? {
        prefs.getString("voz_$who", null)?.let { chosen -> if (voices.any { it.name == chosen }) return chosen }
        if (voices.isEmpty()) return null
        val slot = ORDER.indexOf(who.uppercase()).let { if (it < 0) (who.hashCode() and 0x7fffffff) else it }
        return voices[slot % voices.size].name
    }

    fun choose(who: String, voiceName: String) = prefs.edit().putString("voz_$who", voiceName).apply()

    /** Fala e só volta quando terminar (ou for interrompida). [who] = quem fala (JARVIS, CLAUDE, HERMES…). */
    suspend fun speak(who: String, text: String) {
        if (!ensure()) return
        val name = voiceNameFor(who)
        voices.firstOrNull { it.name == name }?.let { tts.voice = it }
        // Mesma voz para dois agentes (celular com poucas vozes): muda o tom só um pouco, para distinguir sem soar falso.
        val slot = ORDER.indexOf(who.uppercase()).coerceAtLeast(0)
        val reused = voices.size in 1..slot
        tts.setPitch(if (reused) SUBTLE[slot % SUBTLE.size] else 1f)
        tts.setSpeechRate(rate)
        val clean = forSpeech(text)
        if (clean.isBlank()) return
        requestFocus()
        val done = CompletableDeferred<Unit>()
        current = done
        tts.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "fala-${System.nanoTime()}")
        // Relógio de segurança caso o motor esqueça o onDone.
        withTimeoutOrNull(8_000L + clean.length * 120L) { done.await() }
    }

    fun stopSpeaking() { tts.stop(); releaseFocus(); current?.complete(Unit) }

    /** Tela do Android para baixar vozes melhores (Google: "Vozes de alta qualidade"). */
    fun installVoicesIntent(): Intent = Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    // ---------- ouvir o dono ----------
    private var recognizer: SpeechRecognizer? = null
    val canListen: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)

    /**
     * Ouve até o dono parar de falar. [partial] recebe o texto parcial para a legenda.
     * Chamar na thread principal. Devolve o texto final ou "" (silêncio/erro).
     */
    suspend fun listen(partial: (String) -> Unit): String {
        stopSpeaking()
        val result = CompletableDeferred<String>()
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onError(error: Int) { result.complete("") }
            override fun onPartialResults(b: Bundle?) { b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(partial) }
            override fun onResults(b: Bundle?) { result.complete(b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()) }
        })
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                // Deixa o dono pensar no meio da frase sem cortar a fala.
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L),
        )
        val text = result.await()
        r.destroy()
        recognizer = null
        return text
    }

    /** Botão "Enviar" enquanto ouve: encerra e entrega o que já ouviu. */
    fun stopListening() { recognizer?.stopListening() }

    fun shutdown() { recognizer?.destroy(); releaseFocus(); runCatching { audioManager.mode = AudioManager.MODE_NORMAL }; tts.shutdown() }

    companion object {
        /** Ordem fixa: cada um pega uma voz diferente (JARVIS = a melhor). */
        val ORDER = listOf("JARVIS", "CLAUDE", "HERMES", "CODEX", "OPENCODE", "QWEN", "OPENCLAW", "DROID", "DESIGNER", "QA", "SEGURANCA", "PRODUTO", "DEVOPS", "DONO")
        private val SUBTLE = floatArrayOf(1f, 0.94f, 1.06f, 0.97f, 1.03f)

        /** Como falar os nomes (em maiúscula o motor soletra "C-O-D-E-X"). */
        private val SAY = mapOf(
            "CLAUDE" to "Clóde", "CODEX" to "Códex", "HERMES" to "Hérmes", "OPENCODE" to "Ôpen Côde",
            "OPENCLAW" to "Ôpen Cló", "QWEN" to "Quén", "DROID" to "Dróid", "JARVIS" to "Jarvis", "DONO" to "você",
            "CHATGPT" to "Chat G P T", "NVIDIA" to "Envídia", "LEADER" to "líder", "STATUS" to "status",
            "SEGURANCA" to "Segurança", "DEVOPS" to "Dev Ops", "DESIGNER" to "Designer", "PRODUTO" to "Produto", "DONE" to "concluído", "BLOCKED" to "bloqueado", "WORKING" to "trabalhando", "REVIEW" to "revisão",
        )

        /** Texto para a voz: sem markdown, emoji, links e caminhos; nomes e códigos do jeito que se fala. */
        fun forSpeech(raw: String): String {
            var s = raw
                .replace(Regex("```[\\s\\S]*?```"), " trecho de código ")
                .replace(Regex("https?://\\S+"), " um link ")
                .replace(Regex("[A-Za-z]:\\\\\\S+|(?:\\.{0,2}/)?(?:[\\w.-]+/){2,}[\\w.-]+"), " um arquivo ")
                .replace(Regex("[*_#`>|~\\[\\]]"), " ")
                .replace(Regex("[\\p{So}\\p{Cn}\\x{1F000}-\\x{1FFFF}]"), " ")
            s = Regex("\\bT-0*(\\d+)\\b").replace(s) { "tarefa ${it.groupValues[1]}" }
            s = Regex("\\bJ-0*(\\d+)\\b").replace(s) { "comando ${it.groupValues[1]}" }
            s = Regex("\\b[A-Z][A-Z0-9_]{2,}\\b").replace(s) { m -> SAY[m.value] ?: m.value }
            return s.replace(Regex("\\s+"), " ").trim()
        }
    }
}
