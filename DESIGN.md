# Triumvirat — Design-Konzept "Premium Holzspiel"

## Vision
Das Spiel soll aussehen wie ein **fotografiertes Luxus-Brettspiel** — als würde man von oben auf einen echten Spieltisch schauen. Skeuomorphismus, aber modern und elegant.

## Schichten (von hinten nach vorne)

### 1. Hintergrund — Der Spieltisch
- **Dunkelgrüner Filz** (wie ein Casino/Poker-Tisch) ODER dunkler Stoff
- Sehr subtil, nicht ablenkend
- Leichte Vignette am Rand (Spotlight-Effekt von oben)
- Kein Holz hier — das reservieren wir fürs Brett

### 2. Das Brett — Massives Holz
- **Echte Holztextur** (dark_wood von Poly Haven, funktioniert schon gut)
- **Erhabener Rand**: Das Brett ist nicht flach — es hat einen 3D-Rahmen
  - Äußerer Rand: dunkleres Holz, 2px shadow nach innen = "Fase"
  - Innere Spielfläche: leicht vertieft (inner shadow)
- **Lacklicht**: Diagonaler Glanzstreifen über das Brett (subtil, 5% opacity)
- Die Dreieck-Form ist das Brett selbst

### 3. Die Rillen (Verbindungen)
- **Eingefräst**: Dunkle Linie + heller Versatz = V-Nut-Optik
- Dünn (2-3px), nicht dominant
- Folgen der Holzstruktur

### 4. Die Mulden (leere Positionen)
- **Gedrechselte Vertiefungen**: 
  - Kreisförmiger dunkler Schatten (radial gradient)
  - Heller Ring am oberen Rand (Lichtreflex)
  - Sichtbare Holztextur am Boden der Mulde (etwas dunkler)
- Müssen groß genug sein, dass man sieht: "hier kann eine Kugel rein"

### 5. Die Murmeln — Glasmurmeln
- **Mehrschichtiger Aufbau**:
  1. Schatten unter der Murmel (in der Mulde, oval, versetzt)
  2. Hauptkörper: Radiales Gradient mit mind. 4 Stops
  3. Innerer Wirbel: Leicht versetzter dunklerer Bereich (wie echtes Glas)
  4. Hauptreflex: Großer heller Spot oben-links (Fenster-Spiegelung)
  5. Kleiner scharfer Glanzpunkt (Lichtquelle direkt)
  6. Sekundärreflex: Kleiner, unten-rechts (Tischreflexion)
  7. Rand: Leichte Verdunklung am Rand (Fresnel-Effekt)
- **Farben**: 
  - Rot: Tiefrotes Glas wie Rubin
  - Grün: Smaragd-Grün, leicht transparent
  - Blau: Saphir-Blau, tiefes Glas

### 6. UI-Elemente
- **Header/Status**: Halbtransparent, dark glass blur (backdrop-filter)
- **Buttons**: Leichter 3D-Effekt, Goldakzente für Primary Actions
- **Schrift**: Cinzel für Titel (bleibt), Crimson Text für Body (bleibt)
- **Goldakzente**: Dezent — Titel, aktiver Spieler-Rand, Auswahl

## Licht-Setup
- **Hauptlicht**: Oben-links (bestimmt alle Schatten und Reflexe)
- **Fülllicht**: Schwach von rechts (verhindert harte Schatten)
- **Konsequent**: Alle Schatten gehen nach rechts-unten

## Animationen
- **Marmor-Roll**: Beim Bewegen rotiert der Hauptreflex leicht
- **Einsetzen**: Kurzer "Bounce" (scale 1.05 → 1.0) + subtle shadow expand
- **Capture**: Murmel sinkt nach unten (scale + opacity fade, 400ms)
- **Selection Glow**: Pulsierender goldener Ring (wie Kerzenlicht-Flackern)

## Farbpalette
```
Spieltisch:     #1a2618 (dunkelgrüner Filz)
Brett dunkel:   #3e2518 (Rand)
Brett hell:     #7a5636 (Spielfläche)
Gold:           #d4a017 (Akzente)
Pergament:      #f5e6c8 (Text)

Rot-Murmel:     #a82020 → #e84040
Grün-Murmel:    #1a7a3a → #30c060
Blau-Murmel:    #1a4a8a → #3080d0
```

## Technische Umsetzung
- Board-Textur: Poly Haven `dark_wood` (bereits vorhanden, 738KB)
- Hintergrund: CSS Gradient (kein Bild nötig)
- Murmeln: Rein Canvas-basiert (5+ Gradients übereinander)
- Mulden: Canvas radial gradients
- Performance: Board-Textur einmal in offscreen canvas rendern, dann kopieren
