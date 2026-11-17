package com.liamkkm.mio

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Update-Struktur über das öffentliche Update-Repo (nur Releases):
 *   https://github.com/obipepenobi-hub/mio2-updater/releases/latest/download/android-update.json
 * Ablauf: JSON lesen -> versionCode vergleichen -> Download-Adresse prüfen -> APK laden ->
 * SHA-256 prüfen -> Paketname/Signer prüfen -> System-Installer (immer mit Bestätigung des Nutzers).
 */
class Updater(private val activity: Activity) {
    data class Info(val newer: Boolean, val version: String, val url: String?, val sha256: String, val size: Long, val notes: String)

    companion object {
        // Repo-Besitzer und -Name stehen fest im Code – nichts davon kommt aus Netzantworten.
        const val OWNER = "obipepenobi-hub"
        const val REPO = "mio2-updater"
        const val JSON_URL = "https://github.com/$OWNER/$REPO/releases/latest/download/android-update.json"
        const val MAX_BYTES = 150L * 1024 * 1024
    }

    private val main = Handler(Looper.getMainLooper())

    private fun hostAllowed(h: String?): Boolean {
        val x = (h ?: return false).lowercase()
        return x == "github.com" || x.endsWith(".githubusercontent.com")
    }

    /** Öffnet https-Adressen und folgt Weiterleitungen nur zu github.com / *.githubusercontent.com. */
    private fun open(start: String): HttpURLConnection {
        var u = URL(start)
        for (hop in 0..5) {
            if (u.protocol != "https" || !hostAllowed(u.host)) throw SecurityException("Unerlaubte Adresse")
            val c = u.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 10000; c.readTimeout = 20000
            val code = c.responseCode
            if (code in 301..308) { u = URL(u, c.getHeaderField("Location")); c.disconnect(); continue }
            return c
        }
        throw SecurityException("Zu viele Weiterleitungen")
    }

    /** Download-Adresse aus dem JSON ist nicht vertrauenswürdig und wird streng geprüft. */
    private fun urlAcceptable(s: String): Boolean = try {
        val u = java.net.URI(s)
        u.scheme == "https" && u.host == "github.com" && u.port == -1 && u.userInfo == null &&
            (u.rawPath ?: "").startsWith("/$OWNER/$REPO/releases/download/") && !(u.rawPath ?: "").contains("..") &&
            u.rawQuery == null && u.rawFragment == null
    } catch (e: Exception) { false }

    private fun installedVersionCode(): Long {
        val p = activity.packageManager.getPackageInfo(activity.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) p.longVersionCode else @Suppress("DEPRECATION") p.versionCode.toLong()
    }

    fun check(callback: (Info?) -> Unit) {
        Thread {
            var r = fetchLatest()
            if (r == null) { Thread.sleep(1500); r = fetchLatest() }
            main.post { callback(r) }
        }.start()
    }

    private val none = Info(false, "", null, "", 0, "")

    /** null = Fehler (z. B. offline); Info(newer=false) = kein Update / noch kein Release (404). */
    private fun fetchLatest(): Info? = try {
        val c = open(JSON_URL)
        if (c.responseCode == 404) none else {
            val j = JSONObject(c.inputStream.bufferedReader().readText())
            val url = j.optString("url")
            val code = j.optLong("versionCode", 0)
            val ok = code > installedVersionCode() && urlAcceptable(url) && j.optString("sha256").length == 64
            Info(ok, j.optString("version"), if (ok) url else null, j.optString("sha256").lowercase(), j.optLong("size", 0), j.optString("notes"))
        }
    } catch (e: Exception) { null }

    fun downloadAndInstall(info: Info, done: (String?) -> Unit) {
        Thread {
            try {
                val url = info.url ?: throw IllegalStateException("Keine Update-Adresse")
                if (!urlAcceptable(url)) throw SecurityException("Unerwartete Update-Adresse")
                val dir = File(activity.cacheDir, "updates")
                dir.deleteRecursively(); dir.mkdirs()
                val f = File(dir, "Mio2Update.apk")
                val limit = if (info.size in 1..MAX_BYTES) info.size else MAX_BYTES
                val md = MessageDigest.getInstance("SHA-256")
                open(url).inputStream.use { i ->
                    f.outputStream().use { o ->
                        val buf = ByteArray(64 * 1024); var total = 0L
                        while (true) {
                            val n = i.read(buf); if (n < 0) break
                            total += n
                            if (total > limit) throw SecurityException("Download größer als angekündigt")
                            md.update(buf, 0, n); o.write(buf, 0, n)
                        }
                    }
                }
                val sum = md.digest().joinToString("") { "%02x".format(it) }
                if (sum != info.sha256) { f.delete(); throw SecurityException("Prüfsumme stimmt nicht – Update wurde verworfen") }
                if (!signatureAcceptable(f)) { f.delete(); throw SecurityException("Das Update stammt nicht vom selben Entwickler – abgebrochen") }
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

    /** Paketname und Signer der geladenen APK müssen zur installierten App passen. */
    @Suppress("DEPRECATION")
    private fun signatureAcceptable(apk: File): Boolean {
        val pm = activity.packageManager
        return try {
            fun certs(p: android.content.pm.PackageInfo): Set<String> {
                val sigs = if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners else p.signatures
                return (sigs ?: emptyArray()).map { s -> MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
            }
            val flag = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            val theirs = pm.getPackageArchiveInfo(apk.absolutePath, flag) ?: return false
            if (theirs.packageName != activity.packageName) return false
            val mine = pm.getPackageInfo(activity.packageName, flag)
            val a = certs(theirs)
            a.isNotEmpty() && a == certs(mine)
        } catch (e: Exception) { false }
    }
}
