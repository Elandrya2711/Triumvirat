# 🏗️ Triumvirat Scaling Plan — 1000 Spieler

## Ausgangslage

**Aktuell:** Single Node.js Process, In-Memory State, Worker Threads für AI
**Ziel:** 1000 gleichzeitige Spieler (~500 Spiele), zuverlässig und performant

---

## Phase 1: Isomorphic Game Logic (Client + Server teilen Code)

### Problem
`game-logic.js` läuft nur serverseitig. Für Client-AI und Offline-Solo brauchen wir sie im Browser.

### Lösung
`game-logic.js` und `ai-player.js` als **Universal Modules** umbauen — laufen auf Server (CommonJS) UND im Browser (ES Module).

### Umsetzung
```
game-logic.js    → shared/game-logic.mjs  (isomorphic)
ai-player.js     → shared/ai-player.mjs   (isomorphic)
```

**Wrapper:**
```javascript
// shared/game-logic.mjs
// Kein require(), kein Node-spezifischer Code
export class Game { ... }
export const ADJACENCY = [...]
```

```javascript
// server.js (Node)
import { Game, ADJACENCY } from './shared/game-logic.mjs';

// public/game.js (Browser) 
import { Game, ADJACENCY } from './shared/game-logic.mjs';
```

**package.json:**
```json
{ "type": "module" }
```

### Aufwand: ~2-3 Stunden
### Risiko: Niedrig (reines Refactoring, Tests validieren)

---

## Phase 2: Client-Side AI für Solo-Spiele

### Problem
Jedes AI-Spiel belastet den Server (Worker Thread + WebSocket-Connection + State).
Bei 1000 Spielern und 70% Solo-AI = 700 unnötige Server-Verbindungen.

### Lösung
**Solo vs AI = komplett im Browser.** Kein Server nötig.

### Architektur
```
┌─────────────────────────────────┐
│  Browser (Solo-Modus)           │
│  ┌───────────┐ ┌──────────────┐ │
│  │ Game Logic │ │ AI (Web      │ │
│  │ (shared)   │ │  Worker)     │ │
│  └───────────┘ └──────────────┘ │
│  Kein Server-Kontakt!           │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  Browser (Multiplayer-Modus)    │
│  ┌──────────┐                   │
│  │ Renderer  │◄── WebSocket ──► Server (validiert)
│  └──────────┘                   │
└─────────────────────────────────┘
```

### Client-AI via Web Worker
```javascript
// public/ai-webworker.js
importScripts('./shared/game-logic.mjs', './shared/ai-player.mjs');

onmessage = (e) => {
  const { gameState, difficulty } = e.data;
  const game = Game.fromState(gameState);
  const ai = new AIPlayer(1, 'Mako-Bot', difficulty);
  const move = ai.chooseMove(game);
  postMessage({ move });
};
```

### Spielmodi nach Änderung
| Modus | Wo läuft's | Server nötig? |
|---|---|---|
| Solo vs AI | Browser | ❌ Nein |
| Multiplayer | Server | ✅ Ja |
| Multiplayer + AI | Server (AI als Worker Thread) | ✅ Ja |

### Aufwand: ~3-4 Stunden
### Risiko: Mittel (neuer Codepfad, braucht gute Tests)

---

## Phase 3: Persistenter State (Redis)

### Problem
In-Memory `Map()` = State verloren bei Crash/Restart. Kein Horizontal Scaling möglich.

### Lösung
**Redis** als zentraler Game-State-Store.

### Schema
```
triumvirat:game:{gameId}        → JSON (Game State)
triumvirat:game:{gameId}:meta   → { players, createdAt, vsAI, ... }
triumvirat:game:{gameId}:ttl    → Auto-Expire nach 30min Inaktivität
triumvirat:players:{socketId}   → { gameId, playerIndex }
triumvirat:stats                → { activeGames, totalPlayers }
```

### Vorteile
- State überlebt Server-Restarts
- Mehrere Server-Instanzen teilen sich den State
- Redis TTL = automatische Cleanup (kein manueller Interval)
- Monitoring: `triumvirat:stats` jederzeit abfragbar

### Dependency
```json
{ "dependencies": { "ioredis": "^5.3.0" } }
```

### Aufwand: ~4-5 Stunden
### Risiko: Mittel (neue Dependency, Serialisierung muss robust sein)

---

## Phase 4: Horizontal Scaling

### Problem
Ein Node.js-Prozess hat Limits (CPU, Memory, Connections).

### Lösung
Mehrere Server-Instanzen hinter einem Load Balancer.

### Architektur
```
                   ┌──────────────┐
                   │  Nginx / LB  │
                   │  (Sticky WS) │
                   └──────┬───────┘
                     ╱    │    ╲
              ┌──────┐ ┌──────┐ ┌──────┐
              │Node 1│ │Node 2│ │Node 3│
              └──┬───┘ └──┬───┘ └──┬───┘
                 │        │        │
              ┌──┴────────┴────────┴──┐
              │     Redis Cluster     │
              │  (State + Pub/Sub)    │
              └───────────────────────┘
```

### Socket.io Redis Adapter
```javascript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'ioredis';

const pubClient = new Redis(REDIS_URL);
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

Damit funktioniert `io.to(gameId).emit(...)` über Server-Grenzen hinweg.

### Nginx Config (Sticky Sessions)
```nginx
upstream triumvirat {
    ip_hash;  # Sticky sessions für WebSocket
    server node1:3000;
    server node2:3000;
    server node3:3000;
}

server {
    location / {
        proxy_pass http://triumvirat;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Aufwand: ~3-4 Stunden
### Risiko: Niedrig (Socket.io Redis Adapter ist battle-tested)

---

## Phase 5: Monitoring & Rate Limiting

### Problem
1000 User = Missbrauchspotential (DDoS, Bot-Spam, Game-Flooding).

### Maßnahmen

**Rate Limiting (bereits teilweise vorhanden):**
- Game-Erstellung: 5/Minute pro IP ✅
- Join-Game: 20/Minute pro IP ✅
- Moves: 60/Minute pro Socket (NEU)
- WebSocket-Connections: 10/IP (NEU)

**Monitoring:**
```javascript
// Prometheus-Metriken (optional)
- triumvirat_active_games (Gauge)
- triumvirat_connected_players (Gauge)  
- triumvirat_ai_computation_ms (Histogram)
- triumvirat_moves_total (Counter)
```

**Health Check (bereits vorhanden):**
```dockerfile
HEALTHCHECK CMD curl -f http://localhost:3000/ || exit 1
```

### Aufwand: ~2 Stunden
### Risiko: Niedrig

---

## Kapazitätsplanung

### Pro Server-Instanz (4 CPU, 2GB RAM)
| Ressource | Solo (Client) | Multiplayer | AI-Multiplayer |
|---|---|---|---|
| Server-Last | 0 | Niedrig | Mittel |
| WebSocket Connections | 0 | 2-3 | 2-3 |
| RAM pro Spiel | 0 | ~50KB | ~50KB |
| CPU pro AI-Zug | 0 | 0 | 1 Worker, 2s max |

### Kapazität bei 3 Server-Instanzen
| Szenario | Max gleichzeitige Spiele |
|---|---|
| 100% Solo vs AI | ∞ (läuft im Browser) |
| 100% Multiplayer | ~3000 (Socket-Limit) |
| 70% Solo / 30% Multi | ~1000 Multi + ∞ Solo |
| Mixed mit AI-Multi | ~300 AI-Spiele + ~2000 PvP |

**Fazit: 3 Instanzen reichen für 1000+ Spieler locker.**

---

## Umsetzungsreihenfolge

| Phase | Was | Aufwand | Priorität |
|---|---|---|---|
| **1** | Isomorphic Modules | 2-3h | 🔴 Grundlage für alles |
| **2** | Client-Side AI | 3-4h | 🔴 Größter Impact (70% Last weg) |
| **3** | Redis State | 4-5h | 🟡 Nötig für Scaling |
| **4** | Horizontal Scaling | 3-4h | 🟡 Ab >500 Spieler |
| **5** | Monitoring | 2h | 🟢 Nice-to-have |

**Gesamtaufwand: ~15-18 Stunden**

---

## Was wir NICHT brauchen

- ❌ **Kubernetes** — Overkill, Coolify + Docker reicht
- ❌ **Microservices** — Ein Monolith mit Redis skaliert hier perfekt  
- ❌ **GraphQL** — WebSocket ist effizienter für Echtzeit
- ❌ **CDN für Game Assets** — Wenige KB, Coolify cached das
- ❌ **Database (PostgreSQL)** — Redis reicht, kein persistentes Spieler-System nötig
