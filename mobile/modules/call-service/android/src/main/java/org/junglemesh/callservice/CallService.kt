//* Foreground service of a call: keeps the microphone and the app alive while JungleMesh is in the background
// Android stops recording as soon as an app leaves the screen, unless it runs a foreground service of type
// "microphone" with a visible notification (privacy rule). The service does nothing by itself: WebRTC
// and the P2P worker keep running in the app's process, the service only keeps that process "in use".
// It must be started while the app is on screen (Android 12+ refuses it from the background).
package org.junglemesh.callservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class CallService : Service() {
  companion object {
    const val ACTION_START = "org.junglemesh.callservice.START"
    const val ACTION_HANGUP = "org.junglemesh.callservice.HANGUP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_HANGUP = "hangup"
    const val EXTRA_CHANNEL = "channel"
    private const val CHANNEL_ID = "calls"
    private const val NOTIFICATION_ID = 4242
    private const val TAG = "CallService"

    // Read by JS (isRunning): the service really went to the foreground
    @Volatile
    var running = false
      private set

    // "Hang up" button of the notification → the module sends the event to JS
    @Volatile
    var onHangup: (() -> Unit)? = null
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_HANGUP) {
      onHangup?.invoke()
      return START_NOT_STICKY
    }
    try {
      // Also called again to update the text of a running call (same notification id)
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(intent), type)
      running = true
    } catch (e: Exception) {
      // Microphone permission missing, or started from the background: the call stays foreground-only
      Log.w(TAG, "foreground service refused", e)
      running = false
      stopSelf()
    }
    // Killed by the system: not restarted (the call is gone with the process anyway)
    return START_NOT_STICKY
  }

  // App swiped away from the recent apps: the call ends with it
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  //& The notification: who we are calling, a tap opens the app, a button hangs up
  private fun notification(intent: Intent?): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    // Low importance: no sound, no pop-up, just the line in the shade (the ringing is handled elsewhere)
    val channelName = intent?.getStringExtra(EXTRA_CHANNEL) ?: "Calls"
    manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_LOW))

    val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    // The launcher's intent brings the existing screen back to the front (like tapping the app icon)
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, flags)
    }
    val hangup = PendingIntent.getService(this, 1, Intent(this, CallService::class.java).setAction(ACTION_HANGUP), flags)

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.jm_call_notification)
      .setContentTitle(intent?.getStringExtra(EXTRA_TITLE) ?: "")
      .setContentText(intent?.getStringExtra(EXTRA_TEXT) ?: "")
      .setContentIntent(open)
      .addAction(0, intent?.getStringExtra(EXTRA_HANGUP) ?: "Hang up", hangup)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setUsesChronometer(true) // call duration, counted by Android
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }
}
