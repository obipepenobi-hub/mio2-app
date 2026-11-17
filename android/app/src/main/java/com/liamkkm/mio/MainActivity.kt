package com.liamkkm.mio

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var updater: Updater
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null
    private var pageReady = false
    private var pendingShare: String? = null

    // Nur diese Hosts darf der Link-Leser abrufen (wie die Allowlist in server.py)
    private val allowed = listOf("tiktok.com", "instagram.com", "instagr.am", "cdninstagram.com", "fbcdn.net",
        "tiktokv.com", "tiktokv.us", "byteimg.com", "ibyteimg.com", "ibytedtos.com")
    private val cdn = Regex("([\\w-]+\\.)*tiktokcdn[\\w-]*\\.com")

    private fun hostOk(h: String?): Boolean {
        val x = (h ?: return false).lowercase()
        return cdn.matches(x) || allowed.any { x == it || x.endsWith(".$it") }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        updater = Updater(this)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
        }
        web.addJavascriptInterface(Bridge(), "MioNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? {
                val u = r.url
                if (u.host == "appassets.androidplatform.net" && u.path == "/proxy") return proxy(u)
                return loader.shouldInterceptRequest(u)
            }

            override fun onPageFinished(v: WebView, url: String) {
                pageReady = true
                deliverShare()
            }

            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                if (r.url.host == "appassets.androidplatform.net") return false
                try { startActivity(Intent(Intent.ACTION_VIEW, r.url)) } catch (_: Exception) { }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String, cb: GeolocationPermissions.Callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false)
                } else {
                    geoCallback = cb; geoOrigin = origin
                    requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 7)
                }
            }
        }
        // Zurück-Taste/-Geste: erst Fenster schließen, dann Kartenansicht zurücksetzen – die App schließt sich nie
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript(
                    "(()=>{if(document.querySelector('.sheet.open,#orgMenu.open')){document.getElementById('scrim').click();return 1}" +
                        "if(document.getElementById('regionTitle').textContent!=='Mio²'||document.querySelector('#chips .chip.on')){document.getElementById('btnBack').click()}return 1})()", null)
            }
        })
        web.loadUrl("https://appassets.androidplatform.net/index.html")
        takeShare(intent)
        // beim Start still nach Updates suchen
        updater.check { i -> if (i != null && i.newer) offer(i) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeShare(intent)
    }

    private fun takeShare(i: Intent?) {
        if (i?.action == Intent.ACTION_SEND && i.type?.startsWith("text/") == true) {
            pendingShare = i.getStringExtra(Intent.EXTRA_TEXT)
            deliverShare()
        }
    }

    private fun deliverShare() {
        val t = pendingShare ?: return
        if (!pageReady) return
        pendingShare = null
        web.evaluateJavascript("window.MioShare && window.MioShare(" + org.json.JSONObject.quote(t) + ")", null)
    }

    override fun onRequestPermissionsResult(code: Int, p: Array<out String>, r: IntArray) {
        super.onRequestPermissionsResult(code, p, r)
        if (code == 7) {
            geoCallback?.invoke(geoOrigin, r.any { it == PackageManager.PERMISSION_GRANTED }, false)
            geoCallback = null
        }
    }

    /** Native HTTP-Abfrage für den Link-Leser (umgeht CORS), nur erlaubte Hosts über https. */
    private fun proxy(u: Uri): WebResourceResponse {
        fun err(code: Int, msg: String) =
            WebResourceResponse("text/plain", "utf-8", code, msg, mapOf<String, String>(), ByteArrayInputStream(msg.toByteArray()))
        try {
            var target = URL(u.getQueryParameter("url") ?: "")
            val accept = u.getQueryParameter("accept") ?: "text/html,*/*"
            for (hop in 0..4) {
                if (target.protocol != "https" || !hostOk(target.host)) return err(403, "not allowed")
                val c = target.openConnection() as HttpURLConnection
                c.instanceFollowRedirects = false
                c.connectTimeout = 12000; c.readTimeout = 15000
                c.setRequestProperty("User-Agent", "Mio2-LinkReader/1.0 (personal travel notes app)")
                c.setRequestProperty("Accept", accept)
                c.setRequestProperty("Accept-Language", "en-US,en;q=0.9")
                val code = c.responseCode
                if (code in 301..308) { target = URL(target, c.getHeaderField("Location")); continue }
                val ct = (c.contentType ?: "application/octet-stream").substringBefore(";")
                val s = if (code >= 400) c.errorStream else c.inputStream
                val raw = s?.use { it.readBytes() } ?: ByteArray(0)
                val body = if (raw.size > 3_000_000) raw.copyOf(3_000_000) else raw
                return WebResourceResponse(ct, "utf-8", code, "OK", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(body))
            }
            return err(502, "too many redirects")
        } catch (e: Exception) {
            return err(502, e.message ?: "error")
        }
    }

    private fun offer(i: Updater.Info) {
        AlertDialog.Builder(this).setTitle("Update ${i.version} verfügbar")
            .setMessage(i.notes.take(600).ifBlank { "Eine neue Version von Mio² ist da." })
            .setPositiveButton("Jetzt aktualisieren") { _, _ ->
                Toast.makeText(this, "Lade Update …", Toast.LENGTH_SHORT).show()
                updater.downloadAndInstall(i.url!!) { e -> if (e != null) Toast.makeText(this, e, Toast.LENGTH_LONG).show() }
            }.setNegativeButton("Später", null).show()
    }

    inner class Bridge {
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface fun checkUpdate() {
            runOnUiThread {
                updater.check { i ->
                    when {
                        i == null -> Toast.makeText(this@MainActivity, "Update-Suche fehlgeschlagen – online?", Toast.LENGTH_SHORT).show()
                        i.newer -> offer(i)
                        else -> Toast.makeText(this@MainActivity, "Mio² ${BuildConfig.VERSION_NAME} ist aktuell", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }
}
