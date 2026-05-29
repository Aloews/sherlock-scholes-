# Sherlock Scholes — Setup Guide

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure Supabase
Create a project at [supabase.com](https://supabase.com), then:

```bash
cp .env.example .env
# Fill in your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

Run the schema in Supabase SQL Editor:
```
supabase/schema.sql   ← run first
supabase/seed.sql     ← run second (football players data)
```

### 3. Development
```bash
npm run dev
# Opens at http://localhost:5173
# Dev mode mocks Telegram auth automatically
```

### 4. Build for Telegram
```bash
npm run build
# Deploy the dist/ folder to any static host (Vercel, Netlify, etc.)
# Register the HTTPS URL in @BotFather → Bot Settings → Menu Button
```

---

## Architecture Overview

```
src/
├── app/            # BrowserRouter + route guards
├── features/
│   ├── auth/       # Telegram auth → Supabase upsert
│   ├── room/       # Create/join/leave room, team assignment
│   ├── lobby/      # Realtime lobby subscriptions
│   └── game/       # State machine, timer, card randomizer
├── screens/        # HomeScreen, LobbyScreen, GameScreen, EndScreen
├── shared/
│   ├── lib/        # Supabase client, Telegram WebApp adapter
│   ├── store/      # Zustand stores (auth, game)
│   ├── types/      # Database + game TypeScript types
│   └── ui/         # Button, Avatar, Timer, PlayerCard, Scoreboard
└── supabase/
    ├── schema.sql  # Full DB schema with RLS + Realtime
    └── seed.sql    # 50+ football players (easy/medium/hard)
```

## Game Flow

```
idle → lobby → countdown → round_active → round_summary
                               ↑               ↓
                            (next round)    (or game_end)
```

## Key Design Decisions

- **Timer sync**: `round.started_at` (server timestamp) is source of truth.
  All clients compute `remaining = time_seconds - elapsed` identically.
  
- **Explainer authority**: Only the explainer's client calls `endRound()` on timer expiry.

- **Card randomizer**: Weighted by difficulty (40% easy / 40% medium / 20% hard).

- **Realtime**: Supabase Postgres Changes on `rooms`, `room_players`, `rounds`, `round_cards`.

- **State machine**: Valid phase transitions enforced in `stateMachine.ts`.

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
