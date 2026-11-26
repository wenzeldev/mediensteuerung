# Mediensteuerung für GNOME

Mediensteuerung ist eine GNOME-Shell-Erweiterung für MPRIS-kompatible Player. In der oberen Leiste kannst du Titel wechseln und eine Übersicht mit Songcover, Titel, Interpret, Album und Wiedergabefortschritt öffnen. Welche Informationen und Aktionen verfügbar sind, hängt vom Player ab.

## Installation

Benötigt GNOME Shell 51, `glib-compile-schemas` und ein GNOME-System mit GdkPixbuf und libsoup 3. Die optionalen Firefox-Funktionen benötigen zusätzlich Python 3 mit PyGObject und AT-SPI.

Führe im Projektordner aus:

```sh
dest="$HOME/.local/share/gnome-shell/extensions/mediensteuerung@local"
install -d "$dest/schemas"
install -m 644 ./*.js metadata.json "$dest/"
install -m 644 schemas/*.gschema.xml "$dest/schemas/"
install -m 755 ./*.py "$dest/"
glib-compile-schemas --strict "$dest/schemas"
```

Melde dich anschließend ab und wieder an, damit GNOME die neue Version lädt. Aktiviere sie bei Bedarf mit `gnome-extensions enable mediensteuerung@local`.

## Tastenkürzel

Klicke auf das animierte Symbol in der Leiste und wähle **Tastenkürzel bearbeiten …**. Alternativ öffnet `gnome-extensions prefs mediensteuerung@local` die Einstellungen.

Trage ein Kürzel wie `<Super>p` oder `<Control><Shift>space` ein und übernimm die Änderung. Du kannst mehrere Kombinationen pro Aktion mit Kommas trennen. Ein leeres Feld deaktiviert das Kürzel für diese Aktion. Der Pfeil neben dem Feld stellt die Voreinstellung wieder her. Der globale Schalter deaktiviert alle Kürzel auf einmal. Wähle Kombinationen, die in GNOME und anderen Erweiterungen frei sind.

## Songcover

Die Übersicht nutzt das Cover, das der Player über `mpris:artUrl` bereitstellt. Unterstützt werden lokale Dateien, HTTP(S)-Adressen und Base64-kodierte Bilddaten. Beim Öffnen der Übersicht kann eine Verbindung zum Bildserver des Players entstehen. Fehlt das Cover oder lässt es sich nicht laden, zeigt die Übersicht ein Musiksymbol.

## Lizenz

Copyright © 2026 wenzeldev

Dieses Projekt steht unter der [Apache License, Version 2.0](LICENSE). Sie erlaubt eine breite Nachnutzung, auch in kommerziellen Projekten, und enthält eine ausdrückliche Patentlizenz der Beitragenden. Bei der Weitergabe gelten die Hinweise und Bedingungen im Lizenztext.

Songcover werden zur Laufzeit vom Player geliefert.
