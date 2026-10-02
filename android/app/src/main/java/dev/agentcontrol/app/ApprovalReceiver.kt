package dev.agentcontrol.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.agentcontrol.app.data.JarvisApi
import dev.agentcontrol.app.data.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Botões "Aprovar"/"Recusar" do aviso de aprovação: decide sem abrir o app (o Android pede desbloquear a tela antes). */
class ApprovalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val code = intent.getStringExtra(EXTRA_CODE) ?: return
        val approve = intent.getBooleanExtra(EXTRA_APPROVE, false)
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val s = Settings(context)
            val msg = runCatching { JarvisApi(s.baseUrl, s.token).decide(s.project, code, approve).reply }
                .getOrElse { "Não consegui ${if (approve) "aprovar" else "recusar"}: ${it.message}" }
            Notifier(context).decided(code, msg)
            pending.finish()
        }
    }

    companion object {
        const val EXTRA_CODE = "code"
        const val EXTRA_APPROVE = "approve"
    }
}