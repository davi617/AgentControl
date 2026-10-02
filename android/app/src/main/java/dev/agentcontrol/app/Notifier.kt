package dev.agentcontrol.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Avisos no celular: aprovação esperando, VIOLATION, comando concluído e resposta do JARVIS. Só com o app em memória. */
class Notifier(private val context: Context) {
    private val channel = "jarvis_aprovacoes"

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(channel, "Aprovações do JARVIS", NotificationManager.IMPORTANCE_HIGH))
        }
    }

    private fun allowed(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun show(id: Int, title: String, text: String, actions: List<NotificationCompat.Action> = emptyList()) {
        if (!allowed()) return
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_jarvis)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .apply { actions.forEach { addAction(it) } }
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id, n) }
    }

    fun approval(code: String, text: String) = show(
        code.hashCode(), "Aprovação esperando: $code", text.take(200),
        listOf(decision(code, true, "Aprovar"), decision(code, false, "Recusar")),
    )

    /** Resultado da decisão pelo aviso: troca o aviso de aprovação pela resposta do JARVIS. */
    fun decided(code: String, reply: String) = show(code.hashCode(), code, reply)

    private fun decision(code: String, approve: Boolean, label: String): NotificationCompat.Action {
        val pi = PendingIntent.getBroadcast(
            context, code.hashCode() * 2 + if (approve) 1 else 0,
            Intent(context, ApprovalReceiver::class.java)
                .putExtra(ApprovalReceiver.EXTRA_CODE, code).putExtra(ApprovalReceiver.EXTRA_APPROVE, approve),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // Ação protegida (push, deploy…): o Android exige desbloquear a tela antes de aprovar.
        return NotificationCompat.Action.Builder(0, label, pi).setAuthenticationRequired(true).build()
    }
    fun commandDone(code: String, agent: String, status: String, text: String) = show(("d" + code + status).hashCode(), "$code: $agent → $status", text.take(200))
    fun jarvisReply(text: String) = show("jarvis-reply".hashCode(), "JARVIS respondeu", text.take(300))
    fun violation(code: String, text: String) = show(("v" + code).hashCode(), "VIOLATION em $code", "Um agente executou sem aprovação: ${text.take(160)}")
}
