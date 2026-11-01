# 🐄 Barnyard Brawl — 3v3 Farm MOBA · Capture the Flag

A browser game for up to 6 players (3 vs 3) over the internet. Players open a link; no install needed.

## Play it on your own computer first (2 minutes)

1. Install **Node.js 18 or newer** from https://nodejs.org (the "LTS" button).
2. Unzip this folder, open a terminal in it, and run:
   ```
   npm install
   npm start
   ```
3. Open **http://localhost:3000** in your browser. Click **Create Room**, add bots, and press **Start Game**.
   (Open a second browser tab and join with the room code to test two players.)

## Put it on the internet for free (Render.com)

1. Create a free account at **https://github.com** and make a new repository (e.g. `barnyard-brawl`).
   Upload every file and folder from this zip **except** `node_modules` (drag-and-drop on the repo page works).
2. Create a free account at **https://render.com** and connect your GitHub account.
3. Click **New + → Blueprint**, pick your repository, and click **Apply**. (`render.yaml` sets everything up.)
   *Or* choose **New + → Web Service** with: Runtime **Node**, Build command `npm install`, Start command `npm start`, Instance type **Free**.
4. When it says **Live**, open the URL Render gives you (like `https://barnyard-brawl.onrender.com`). Share that link with friends.
   Each room has a 4-letter code, and the **Copy invite link** button in the lobby gives a link that fills the code in.

**Free-tier note:** Render's free servers go to sleep after ~15 minutes of no visitors. The first visit after that takes about a minute to wake up. A paid instance (about $7/month) stays awake and gives lower lag. Pick a server region near your players.

Any Node host that supports WebSockets works (Railway, Fly.io, a VPS). The server reads the `PORT` environment variable.

## Rules
- Grab the enemy flag from their base and carry it to **your own** flag stand. **Your flag must be at home** for the capture to count. First to **3** captures wins.
- If the carrier is slain, the flag drops on the spot. Touch your own dropped flag to return it instantly, or it goes home on its own after 20s.
- Flag carriers move 15% slower (Courier's Boots remove this), can't recall, and are always visible to enemies.
- Each flag is guarded by a single **Grain Silo** tower. It can always be attacked and rebuilds 2 minutes after it's destroyed.
- **Tall grass:** enemies can't see you inside a patch unless one of them is in the same patch. Attacking from the grass reveals you for a moment.

## Controls
| Input | Action |
|---|---|
| Right-click | Move / attack / whack a crop (hold to keep moving) |
| Q W E R | Hold to aim, release to cast (left-click while holding also casts). R unlocks at level 5 |
| D / F | Your two special spells (picked in the lobby) |
| M | Music on/off (🎵 / 🔊 buttons too) |
| B | Recall to base (6s) |
| P | Shop (in base or while dead) |
| S | Stop |
| Tab | Scoreboard |
| Space / Y | Center camera / lock-unlock camera (unlocked: move the mouse to the screen edge) |
| Mouse wheel | Zoom |
| Minimap | Left-click to look, right-click to move |
| Enter | Team chat |
| H | Help |

## What's in the game
- **8 champions**, each with 4 farm-themed abilities: Bessie the Cow 🐄 (tank), Porkchop the Pig 🐖 (fighter), Clucky the Chicken 🐔 (mage), Billy the Goat 🐐 (assassin), Thunder the Horse 🐎 (fighter), Wooly the Sheep 🐑 (support), Queenie the Bee 🐝 (marksman), Quackers the Duck 🦆 (mage).
- A **dark, misty forest** map with farm touches (barns, fences, hay bales, scarecrows, lanterns, glowing mushrooms), 3 lanes, a river, and patches of **tall grass** to hide in.
- One **Grain Silo** guards each flag. Minion waves of Chicks 🐥, Field Mice 🐭 and Tractors 🚜 march down every lane.
- Hand-drawn **animated champions** that walk, leap and strike poses for each ability. Spells are shown by their own effects: milk spray, egg arcs, mud pools, sound waves and more.
- **Jungle**: Raccoons 🦝, Wild Turkeys 🦃, Coyotes 🐺, plus two river bosses: the Golden Goose 🦢 (gold for the whole team) and the Prize Bull 🐂 (team damage and speed buff).
- **Crops** 🥕🌽🌾🎃: whack ripe crops with attacks or abilities. The hit that finishes one harvests it for XP and gold. Crops regrow over time.
- **Prized crops** ✨ sprout about once a minute at contested spots: 🥕 Golden Carrot (super speed), 🌶️ Blazing Pepper (+25% damage), 🍉 Quick Melon (cooldowns), 🍇 Iron Berries (armor + health). Each blessing lasts 60s or until you die.
- **Shallow streams** run along every lane and flow toward each team's base, so the current carries a flag carrier home.
- **Special spells (D/F):** pick 2 in the lobby: Hay Hop (Flash), Barn Salve (Heal), Tailwind (Ghost), Bonfire (Ignite), Haystack (Barrier), Muddy Boots (Exhaust), Hose Down (Cleanse).
- **Silly sounds:** a campy kazoo hoedown theme, animal noises for every ability, and over-the-top death sounds (wailing moos, slide whistles, sad trombones). Everything is synthesized in the browser, so there are no audio files.
- **Farm-equipment shop:** Pitchfork, Wheelbarrow, Milking Pail, Tractor Engine, Windmill Blades and more.
- **Levels 1–15**, gold, a 14-item shop, fog of war, and bots that fill empty slots. If a player disconnects, a bot takes over until they rejoin with the same name and room code.

## Changing the game
All balance numbers (champion stats, ability damage and cooldowns, items, map layout, crop XP, towers) are in **`shared/data.js`**. Edit, save, and restart the server.

| File | What it does |
|---|---|
| `shared/data.js` | All game data and balance |
| `server/game.js` | Game simulation (combat, flags, minions, jungle, bots, vision) |
| `server/index.js` | Web server, rooms and lobby |
| `server/nav.js` | Pathfinding around walls |
| `public/client.js` | HUD, controls, map and unit drawing |
| `public/art.js` | Animated champions, spell effects, forest scenery |
| `public/audio.js` | Sound effects and theme song |
