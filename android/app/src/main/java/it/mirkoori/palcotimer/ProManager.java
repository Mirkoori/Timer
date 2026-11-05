package it.mirkoori.palcotimer;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.os.Handler;
import android.os.Looper;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import java.util.Collections;
import java.util.List;

/**
 * Acquisto unico "Pro" con Google Play Billing (prodotto "pro_unlock", non a consumo).
 * L'ultimo esito noto è salvato sul dispositivo, così l'app funziona anche senza connessione;
 * a ogni apertura viene ricontrollato con Google Play (un rimborso toglie Pro).
 */
final class ProManager implements PurchasesUpdatedListener {

    static final String PRODUCT_ID = "pro_unlock";

    private final Context context;
    private final SharedPreferences prefs;
    private final Runnable onChange;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final boolean debuggable;
    private BillingClient billing;
    private ProductDetails details;
    private boolean connecting;

    ProManager(Context context, Runnable onChange) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences("pro", Context.MODE_PRIVATE);
        this.onChange = onChange;
        this.debuggable = (this.context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        this.billing = BillingClient.newBuilder(this.context)
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
    }

    boolean isDebuggable() { return debuggable; }

    boolean isPro() {
        return prefs.getBoolean("pro", false) || (debuggable && prefs.getBoolean("debug_pro", false));
    }

    String price() {
        if (details == null || details.getOneTimePurchaseOfferDetails() == null) return "";
        return details.getOneTimePurchaseOfferDetails().getFormattedPrice();
    }

    /** Solo nelle versioni di prova (non nei pacchetti per il Play Store): sblocca o blocca Pro senza pagare. */
    void debugSet(boolean value) {
        if (!debuggable) return;
        prefs.edit().putBoolean("debug_pro", value).apply();
        notifyChange();
    }

    /** Ricontrolla gli acquisti e il prezzo con Google Play. */
    void refresh() {
        connect(() -> {
            queryDetails();
            queryPurchases();
        });
    }

    void buy(Activity activity) {
        connect(() -> {
            if (details == null) {
                // prodotto non trovato: non configurato nel Play Console, oppure app non installata dal Play Store
                notifyChange();
                return;
            }
            BillingFlowParams params = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(
                            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details).build()))
                    .build();
            billing.launchBillingFlow(activity, params);
        });
    }

    private void connect(Runnable then) {
        if (billing.isReady()) {
            then.run();
            return;
        }
        if (connecting) return;
        connecting = true;
        billing.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) main.post(then);
                else notifyChange();
            }

            @Override
            public void onBillingServiceDisconnected() {
                connecting = false;
            }
        });
    }

    private void queryDetails() {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(
                        QueryProductDetailsParams.Product.newBuilder()
                                .setProductId(PRODUCT_ID)
                                .setProductType(BillingClient.ProductType.INAPP)
                                .build()))
                .build();
        billing.queryProductDetailsAsync(params, (result, list) -> {
            if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && list != null && !list.isEmpty()) {
                details = list.get(0);
                notifyChange();
            }
        });
    }

    private void queryPurchases() {
        billing.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
                (result, purchases) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) return; // senza risposta si tiene l'ultimo esito noto
                    boolean owned = false;
                    for (Purchase p : purchases) owned |= handle(p);
                    setPro(owned);
                });
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            boolean owned = false;
            for (Purchase p : purchases) owned |= handle(p);
            if (owned) setPro(true);
        }
        notifyChange(); // anche se annullato: la pagina aggiorna i messaggi
    }

    /** Vero se l'acquisto è completato. Conferma (acknowledge) gli acquisti nuovi, altrimenti Google li rimborsa dopo 3 giorni. */
    private boolean handle(Purchase p) {
        if (!p.getProducts().contains(PRODUCT_ID) || p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) return false;
        if (!p.isAcknowledged()) {
            billing.acknowledgePurchase(
                    AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
                    r -> { });
        }
        return true;
    }

    private void setPro(boolean value) {
        if (prefs.getBoolean("pro", false) != value) prefs.edit().putBoolean("pro", value).apply();
        notifyChange();
    }

    private void notifyChange() {
        main.post(onChange);
    }
}
