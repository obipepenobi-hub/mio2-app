package com.liamkkm.mio

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Update-Struktur über GitHub: fragt das neueste Release des Repos ab, vergleicht
 * den Tag (z. B. v1.2.0) mit BuildConfig.VERSION_NAME, lädt die .apk des Releases
 * herunter und übergibt sie dem System-Installer.
 * Android verlangt dabei immer eine Bestätigung durch den Nutzer.
 */
class Updater(private val activity: Activity) {
    data class Info(val newer: Boolean, val version: String, val url: String?, val notes: String)

    companion object { const val REPO = "obipepenobi-hub/mio2-app" }

    private val main = Handler(Looper.getMainLooper())

    fun check(callback: (Info?) -> Unit) {
        Thread {
            var r = fetchLatest()
            if (r == null) { Thread.sleep(1500); r = fetchLatest() }
            main.post { callback(r) }
        }.start()
    }

    private fun fetchLatest(): Info? = try {
        val c = URL("https://api.github.com/repos/$REPO/releases/latest").openConnection() as HttpURLConnection
        c.setRequestProperty("Accept", "application/vnd.github+json")
        c.connectTimeout = 8000; c.readTimeout = 8000
        val j = JSONObject(c.inputStream.bufferedReader().readText())
        val tag = j.optString("tag_name")
        var apk: String? = null
        val assets = j.optJSONArray("assets")
        if (assets != null) for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            if (a.optString("name").endsWith(".apk", true)) { apk = a.optString("browser_download_url"); break }
        }
        Info(apk != null && tag.isNotEmpty() && isNewer(tag, BuildConfig.VERSION_NAME), tag.trimStart('v'), apk, j.optString("body"))
    } catch (e: Exception) { null }

    private fun isNewer(remote: String, local: String): Boolean {
        fun p(v: String) = v.trim().trimStart('v').split(".").map { it.toIntOrNull() ?: 0 }
        val r = p(remote); val l = p(local)
        for (i in 0 until maxOf(r.size, l.size)) {
            val a = r.getOrElse(i) { 0 }; val b = l.getOrElse(i) { 0 }
            if (a != b) return a > b
        }
        return false
    }

    fun downloadAndInstall(url: String, done: (String?) -> Unit) {
        Thread {
            try {
                if (!url.startsWith("https://github.com/$REPO/")) throw IllegalArgumentException("Unerwartete Update-URL")
                val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
                val f = File(dir, "Mio2Update.apk")
                val c = URL(url).openConnection() as HttpURLConnection
                c.instanceFollowRedirects = true
                c.inputStream.use { i -> f.outputStream().use { o -> i.copyTo(o) } }
                main.post {
                    if (!activity.packageManager.canRequestPackageInstalls()) {
                        activity.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
                        done("Bitte „Aus dieser Quelle installieren“ erlauben und das Update erneut starten.")
                    } else {
                        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", f)
                        activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, "application/vnd.android.package-archive")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        })
                        done(null)
                    }
                }
            } catch (e: Exception) { main.post { done(e.message ?: "Download fehlgeschlagen") } }
        }.start()
    }
}
