package it.mirkoori.palcotimer;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * La finestra dell'app: mostra il controller (le pagine del timer) servito dal server dell'app, su questo dispositivo.
 * Lo schermo relatore e il moderatore si aprono nel browser, qui o su altri dispositivi.
 */
public class MainActivity extends Activity {

    private static final int REQ_FILE = 1;
    private static final int REQ_NOTIFICATIONS = 2;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private volatile int port = -1;
    private ProManager pro;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // lo schermo resta acceso mentre il controller è aperto

        web = new WebView(this);
        web.setBackgroundColor(0xFF0D0E10);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0D0E10);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // Da Android 15 le app si estendono sotto barra di stato e di navigazione: si lascia lo spazio per le barre, i ritagli e la tastiera.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        pro = new ProManager(this, () -> {
            if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('palco-pro'))", null);
        });
        configureWebView();

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }
        startHost();
    }

    private void configureWebView() {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " PalcoTimerApp/0.1.0");
        web.addJavascriptInterface(new Bridge(), "PalcoApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String path = u.getPath() == null ? "" : u.getPath();
                boolean own = u.getPort() == port && port > 0;
                // schermo relatore e moderatore non si aprono qui dentro: vanno nel browser (stesso telefono o altro dispositivo)
                if (!own || path.endsWith("/viewer.html") || path.endsWith("/moderator.html")) {
                    openExternal(u);
                    return true;
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    private void startHost() {
        Intent svc = new Intent(this, HostService.class);
        startForegroundService(svc);
        new Thread(() -> {
            try {
                int p = HostService.ensureServer(getApplicationContext());
                port = p;
                runOnUiThread(() -> web.loadUrl("http://localhost:" + p + "/"));
            } catch (IOException e) {
                runOnUiThread(() -> web.loadData("<body style='background:#0d0e10;color:#efe8d8;font-family:sans-serif;padding:24px'>"
                        + "<h2>Palco Timer non riesce ad avviare il server</h2><p>Chiudi e riapri l'app. Se continua, riavvia il telefono.</p>", "text/html", "UTF-8"));
            }
        }, "palco-start").start();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Nessun browser per aprire " + uri, Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // il server resta attivo; si ferma dalla notifica
    }

    @Override
    protected void onResume() {
        super.onResume();
        // se il sistema ha fermato il server mentre l'app era in secondo piano, lo si riavvia e si ricarica la pagina
        if (port > 0 && HostService.port() != port) startHost();
        pro.refresh(); // ricontrolla l'acquisto con Google Play (anche dopo un rimborso)
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_LONG).show());
    }

    /** Funzioni dell'app usate dalle pagine (window.PalcoApp). */
    private final class Bridge {
        @JavascriptInterface public boolean isPro() { return pro.isPro(); }
        @JavascriptInterface public String price() { return pro.price(); }
        @JavascriptInterface public boolean isDebug() { return pro.isDebuggable(); }
        @JavascriptInterface public void debugSetPro(boolean value) { pro.debugSet(value); }
        @JavascriptInterface public void restore() { runOnUiThread(() -> pro.refresh()); }
        @JavascriptInterface public void buy() { runOnUiThread(() -> pro.buy(MainActivity.this)); }

        @JavascriptInterface
        public void saveText(String name, String text) {
            String safe = name == null ? "scaletta.csv" : name.replaceAll("[^A-Za-z0-9._-]", "_");
            byte[] bytes = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
            try {
                String where;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, "text/csv");
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IOException("nessuna destinazione");
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os == null) throw new IOException("nessuna destinazione");
                        os.write(bytes);
                    }
                    where = "Download";
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) throw new IOException("nessuna cartella");
                    File f = new File(dir, safe);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                    where = f.getParent();
                }
                toast("Salvato in " + where + ": " + safe);
            } catch (IOException e) {
                toast("Non riesco a salvare il file");
            }
        }
    }
}
