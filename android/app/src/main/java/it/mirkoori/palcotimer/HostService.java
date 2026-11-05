package it.mirkoori.palcotimer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import java.io.IOException;

/**
 * Tiene vivo il server dell'app anche quando lo schermo si spegne o si cambia app, con una notifica fissa.
 * Dalla notifica si può fermare. Mentre è attivo il dispositivo non si addormenta e il Wi-Fi resta attivo.
 */
public class HostService extends Service {

    static final String ACTION_STOP = "it.mirkoori.palcotimer.STOP";
    private static final String CHANNEL = "host";
    private static final int NOTIFICATION_ID = 1;
    private static final int PREFERRED_PORT = 3000;

    private static RelayServer server;
    private static Context appContext;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    /** Avvia il server se non è già attivo e restituisce la porta. Da chiamare fuori dal thread principale. */
    public static synchronized int ensureServer(Context context) throws IOException {
        appContext = context.getApplicationContext();
        if (server == null || !server.isRunning()) {
            server = new RelayServer(path -> appContext.getAssets().open(path), PREFERRED_PORT);
            server.start();
        }
        return server.port();
    }

    public static synchronized int port() {
        return server != null && server.isRunning() ? server.port() : -1;
    }

    private static synchronized void stopServer() {
        if (server != null) {
            server.stop();
            server = null;
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForegroundWithNotification();
        try {
            ensureServer(this);
        } catch (IOException e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        acquireLocks();
        return START_STICKY;
    }

    private void startForegroundWithNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW));

        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, HostService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE);

        Notification.Action stopAction = new Notification.Action.Builder(
                Icon.createWithResource(this, R.drawable.ic_stat), getString(R.string.notif_stop), stopPi).build();
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(getString(R.string.notif_title))
                .setContentText("Gli altri schermi si collegano a questo dispositivo")
                .setOngoing(true)
                .setContentIntent(openPi)
                .addAction(stopAction)
                .build();

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    @SuppressWarnings("deprecation")
    private void acquireLocks() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "palco:host");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "palco:host");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        }
    }

    @Override
    public void onDestroy() {
        stopServer();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wakeLock = null;
        wifiLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
