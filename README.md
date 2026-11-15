# DUSTLINE — Yard 7

Entry for the make.fun bounty **threejs-fps-02**: a round-based tactical FPS in
three.js, in the style Counter-Strike made famous — two teams, short rounds, a
bomb to plant and defuse, money between rounds to buy weapons, and gunfire
where accuracy counts more than speed.

## The game

Yard 7 is a container yard at dusk. Vanguard (you and three teammates) defend
two bomb sites, A and B. Four Raiders push up three lanes — A Long, Mid, B
Long — to plant the bomb. First team to five rounds takes the match.

- **Gunplay:** five weapons (pistol, rifle, SMG, shotgun, sniper) plus a frag
  grenade, all hitscan with headshot damage, recoil and spread that punish
  firing on the move, and movement with acceleration, crouching and collision.
- **Tactics:** a bomb to plant and defuse, a buy menu with round money, and
  bots that follow waypoint routes through the map, hold positions, and react
  to what they see and hear.
- **The map:** an original yard with lanes, corners and sightlines, lit by a
  low dusk sun, built from styled geometry — no borrowed art, no textures, no
  network requests.

## How to play

Serve it and open it in desktop Chrome:

```
node serve.ts
# open http://localhost:8080
```

WASD to move, mouse to look, click to fire, R to reload, B for the buy menu
(freeze time), G to throw a grenade, E to defuse the bomb, 1–5 to switch
weapons, Ctrl to crouch, Space to jump. Right-click scopes the sniper.

## How it is built

`game/` is plain static files, ES modules loaded with no build step, three.js
0.187.0 vendored under `game/vendor/three/`. The source is one module per job:

- `src/main.js` — boot, the fixed 60 Hz simulation, the render loop, the one
  state store, and the deterministic `?shot=` scenes the screenshots use.
- `src/map.js` — Yard 7: the lanes, the cover, the bomb sites, the waypoint
  graph the bots walk, and the dusk lighting.
- `src/player.js` — movement: acceleration, friction, crouch, jump, and
  box-against-box collision.
- `src/weapons.js` — the armoury: five guns and a grenade, one damage table.
- `src/bots.js` — the bot AI: routes, holds, vision, hearing, bursts, plant
  and defuse.
- `src/rounds.js` — the round machine and the economy.
- `src/hud.js`, `src/input.js`, `src/audio.js`, `src/effects.js` — the HUD and
  buy menu, the keyboard and pointer lock, synthesized WebAudio sound, and
  pooled tracers and sparks.

`main.ts` hands the game in: it copies `game/` and `screenshots/` to `/output`
and writes `/output/dossier.json` with the kit's `vendor/makefun-threejs.ts`.

## License

MIT. See [LICENSE](LICENSE).
