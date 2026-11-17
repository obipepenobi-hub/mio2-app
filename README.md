# Mio²

Reise-Spots aus TikToks/Instagram-Reels sammeln – als Web-App (`python server.py`) und als Android-App.

## Android-App
- `android/` – WebView-App (Kotlin), bündelt die Web-App (`index.html`, `app.js`, `resolve.js` …) als Assets.
  TikTok-/Instagram-Links liest ein nativer Proxy (nur erlaubte Hosts, https), ein Server ist nicht nötig.
- Installation: APK aus dem neuesten [Release](../../releases/latest) laden und installieren.

## Updates
Die App fragt beim Start `releases/latest` dieses Repos ab. Ist der Tag (`vX.Y.Z`) neuer als die installierte
Version, bietet sie die Installation der Release-APK an (Tipp auf den Avatar = manuell suchen).

Neues Release veröffentlichen:
```
python release.py "Was ist neu"          # --minor / --major für größere Sprünge
```
Das zählt `VERSION` hoch, baut die signierte APK, committet, taggt, pusht und erstellt das GitHub-Release.

**Wichtig:** `android/keystore/` (Signierschlüssel) ist nicht im Repo. Geht er verloren, lassen sich installierte
Apps nicht mehr aktualisieren – sichere ihn zusätzlich außerhalb dieses Rechners.
