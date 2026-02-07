# ⚔️ Triumvirat

A tactical marble board game for 2–3 players, playable in the browser.

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.7-010101?logo=socket.io)
![License](https://img.shields.io/badge/License-MIT-blue)

## About

Triumvirat is a strategic board game played on a triangular board. Each player starts with 6 marbles of different sizes (small, medium, large) and tries to eliminate opponents by jumping over their pieces — but only if your marble is equal or larger in size.

**🎮 Play now:** [triumvirat.mke.one](https://triumvirat.mke.one/)

## Features

- **Real-time multiplayer** via WebSockets (Socket.io)
- **AI opponent** with 5 difficulty levels (Minimax + Alpha-Beta pruning)
- **Spectate mode** — watch 3 AIs battle it out
- **Chain jumps** — multi-hop captures in a single turn
- **Responsive design** — works on desktop and mobile
- **Session reconnect** — rejoin on page reload
- **Wood-textured board** with glass marble rendering

## Rules

| | |
|---|---|
| **Goal** | Eliminate opponents' marbles. A player is out when reduced to 1 marble. |
| **Move** | Slide a marble to an adjacent empty space. |
| **Jump** | Hop over an adjacent marble to the space beyond — only over equal or smaller marbles. |
| **Capture** | Jumping over an opponent's marble removes it from the board. |
| **Chain jumps** | After a jump, continue jumping if possible. End your chain anytime. |
| **Corners** | Can only be entered by jumping. A marble in a corner must leave next turn. |
| **Marble sizes** | Large → jumps over all · Medium → medium & small · Small → small only |

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Docker

```bash
docker build -t triumvirat .
docker run -p 3000:3000 triumvirat
```

## Project Structure

```
├── server.js          # Express + Socket.io game server
├── game-logic.js      # Board state, moves, validation
├── ai-player.js       # Minimax AI with alpha-beta pruning
├── test-game.js       # Unit tests (445+ assertions)
├── Dockerfile         # Production container
├── public/
│   ├── index.html     # Game UI
│   ├── style.css      # Styling (wood theme, responsive)
│   ├── game.js        # Client-side rendering & input
│   └── textures/      # Board textures (CC0)
└── package.json
```

## Tests

```bash
node test-game.js
```

## Tech Stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla JS, Canvas API
- **AI:** Minimax with alpha-beta pruning, transposition tables, anti-repetition
- **Deploy:** Docker / Coolify

## License

MIT
