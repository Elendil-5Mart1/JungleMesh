//* JS side of the call service: start / stop / isRunning, and the "onHangup" event (notification button)
package org.junglemesh.callservice

import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CallServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallService")

    Events("onHangup")

    OnCreate {
      CallService.onHangup = { sendEvent("onHangup", mapOf<String, Any?>()) }
    }

    OnDestroy {
      CallService.onHangup = null
    }

    // Texts come from JS (translations). Returns false when Android refuses to start the service.
    Function("start") { title: String, text: String, hangup: String, channel: String ->
      val intent = Intent(context, CallService::class.java)
        .setAction(CallService.ACTION_START)
        .putExtra(CallService.EXTRA_TITLE, title)
        .putExtra(CallService.EXTRA_TEXT, text)
        .putExtra(CallService.EXTRA_HANGUP, hangup)
        .putExtra(CallService.EXTRA_CHANNEL, channel)
      try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (e: Exception) {
        Log.w("CallService", "start refused", e)
        false
      }
    }

    Function("stop") {
      context.stopService(Intent(context, CallService::class.java))
    }

    Function("isRunning") {
      CallService.running
    }

    // Sends the app to the background without closing its screen (like the Home button). The default back
    // of Android 10 and 11 would close the activity instead.
    Function("moveToBack") {
      appContext.currentActivity?.moveTaskToBack(true)
    }
  }

  private val context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }
}
