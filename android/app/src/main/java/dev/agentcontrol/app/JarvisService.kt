package dev.agentcontrol.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dev.agentcontrol.app.data.JarvisApi
import dev.agentcontrol.app.data.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.sse.EventSource

/**
 * JARVIS em segundo plano (pedido do dono, 2026-09-27): fica conectado ao PC pelo Tailscale e avisa
 * aprovação esperando, comando concluído/travado e resposta do JARVIS mesmo com o app fechado.
 * Mostra um aviso fixo e discreto ("de olho no time"), como o Android exige para serviço em segundo plano.
 */
class JarvisService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var sse: EventSource? = null
    private var loop: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "JARVIS em segundo plano", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
        }
        val open = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_jarvis)
            .setContentTitle("JARVIS de olho no time")
            .setContentText("Avisa aprovação, comando concluído e resposta do JARVIS.")
            .setContentIntent(open)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        ServiceCompat.startForeground(this, ID, n, if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
        if (loop?.isActive != true) loop = scope.launch { watch() }
        return START_STICKY // o Android recria o serviço se matar por falta de memória
    }

    /** Conecta no /events do PC; caiu (Tailscale desligado, PC reiniciando), tenta de novo com espera crescente. */
    private suspend fun watch() {
        var wait = 5_000L
        while (true) {
            val s = Settings(applicationContext)
            AlertCenter.muteUntil = getSharedPreferences("jarvis_app", MODE_PRIVATE).getLong("muteUntil", 0)
            if (!s.configured || s.project.isBlank()) { stopSelf(); return }
            val api = JarvisApi(s.baseUrl, s.token)
            val p = s.project
            val ok = runCatching {
                AlertCenter.prefs = api.alertPrefs(p)
                AlertCenter.onChat(applicationContext, api.chat(p)) // marca onde parou (não avisa o que é velho)
                AlertCenter.onCommands(applicationContext, api.commands(p))
            }.isSuccess
            if (ok) {
                wait = 5_000L
                val closed = kotlinx.coroutines.CompletableDeferred<Unit>()
                sse = api.events(
                    p,
                    handleEvent = { type ->
                        scope.launch {
                            runCatching {
                                when (type) {
                                    "commands" -> AlertCenter.onCommands(applicationContext, api.commands(p))
                                    "chat" -> AlertCenter.onChat(applicationContext, api.chat(p))
                                }
                            }
                        }
                    },
                    handleClosed = { closed.complete(Unit) },
                )
                closed.await()
                sse = null
            }
            delay(wait)
            wait = (wait * 2).coerceAtMost(60_000L)
        }
    }

    override fun onDestroy() {
        sse?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "jarvis_fundo"
        private const val ID = 4242

        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, JarvisService::class.java)) }
        }

        fun stop(context: Context) { context.stopService(Intent(context, JarvisService::class.java)) }
    }
}

/** Celular ligou: se o dono deixou o segundo plano ligado, o JARVIS volta a vigiar sozinho. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val on = context.getSharedPreferences("jarvis_app", Context.MODE_PRIVATE).getBoolean("background", true)
        if (on && Settings(context).configured) JarvisService.start(context)
    }
}
