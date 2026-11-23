# 🚕 London Cabbie

A 3D browser game about driving a black cab around London. Pick up fares, run the meter, take card or cash, and try to finish your shift with good ratings and no fines.

It's plain HTML and JavaScript using [three.js](https://threejs.org), with nothing to build or install. Open it and drive.

## Play

- **Online:** turn on GitHub Pages for this repo (see below), then visit `https://<your-username>.github.io/londonTaxi/`
- **Locally:** browsers block ES modules on `file://`, so serve the folder with any static server:
  ```bash
  python3 -m http.server 8000
  # then open http://localhost:8000
  ```

## What's in it

**The cab interior**
- Right-hand-drive cockpit. The steering wheel turns with your steering.
- Digital instrument cluster with speed, PRND gear, battery, indicators and door-lock status.
- Taximeter on the dash that ticks up in 20p steps on time or distance, with Tariffs 1, 2 and 3 set by the time of day.
- **Card terminal**: press `1` for SALE, key in the fare, press ENTER and pass it through the partition. The passenger picks a tip, then taps their card, or uses chip & PIN over the £100 contactless limit. Cards can be declined. You choose whether to print a receipt.
- **Cash**: the passenger hands over notes and you count out the change yourself from a money bag of real UK notes and coins. There's no calculator. Short-change someone and they'll notice.
- A live rear-view mirror with your passenger in it, a sat-nav screen, windscreen wipers that clear the rain, yellow grab handles, partition stickers and an intercom.
- Doors lock themselves above walking pace. You unlock them with `L` to let passengers in and out.

**The city**
- A compact London with the River Thames and four bridges: Westminster, Waterloo, London Bridge and Tower Bridge.
- Landmarks: Big Ben (its clock shows the in-game time), Houses of Parliament, London Eye (it turns), Tower Bridge, Tower of London, St Paul's, The Shard, The Gherkin, Buckingham Palace (with guards), Trafalgar Square, Piccadilly Circus screens, Harrods, the British Museum, Westminster Abbey, Tate Modern, Covent Garden, Borough Market, Hyde Park, and the King's Cross, Paddington, Waterloo, Liverpool Street and London Bridge stations.
- Proper street-name signs with postcodes. Traffic drives on the left and stops at red, red-amber, green and amber lights. Red double-deckers, other black cabs, vans and cars share the roads with you.
- Day and night cycle with lit windows at night, plus rain showers and wet roads.

**Being a cabbie**
- Passengers have personalities (tourists, bankers, pensioners, students, commuters, people on a night out). They chat to you, and you can reply with `1` or `2`.
- Their mood depends on smooth driving, how long the trip takes, crashes and red lights. Mood sets the tip and the star rating.
- If you forget to start the meter, the ride is free.
- Red-light cameras, speed cameras (20 mph in the City, 30 elsewhere) and crash damage all cost you money.
- The battery drains as you drive. When it's flat, the petrol range extender takes over and costs fuel. You can charge at ⚡ points.
- **Knowledge mode** turns off the sat-nav route. You have to find your own way, and you get 25% bigger tips.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake. Hold it while stopped to select reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake |
| `L` | Lock or unlock the doors (to let passengers in and out) |
| `M` | Start the meter, or stop it and take payment |
| `1` `2` | Reply to a passenger |
| `Q` / `E` | Left / right indicator |
| `Z` / `H` / `N` / `V` | Hazards / horn / headlights / wipers |
| `C` | Switch between cockpit and chase camera |
| Mouse drag | Look around the cab |
| `Tab` | Full map |
| `F` | Charge at a ⚡ charger |
| `R` | Put the cab back on the road if you're stuck |
| `Esc` | Pause |

It also works with a gamepad (left stick, RT and LT) and has basic touch controls on phones.

## Turning on GitHub Pages

1. Merge this branch into `main`.
2. In the repo on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. The workflow in `.github/workflows/pages.yml` deploys the game every time you push to `main`.

## Project layout

```
index.html        page, HUD and overlays
style.css         all UI styling (meter, card terminal, notes and coins…)
lib/              three.js (vendored, MIT licence)
js/main.js        game loop, input, fares, rules, HUD, maps
js/city.js        roads, buildings, landmarks, traffic lights, routing
js/taxi.js        cab physics and the detailed interior
js/payment.js     card terminal and cash-handling UI
js/meter.js       taximeter and tariffs
js/traffic.js     AI traffic (drives on the left, obeys lights)
js/people.js      pedestrians and passenger personalities
js/vehicles.js    cab, car, van and bus models
js/textures.js    procedural textures (facades, shopfronts, signs…)
js/audio.js       synthesised sound effects
```

The tariff figures are approximate and the map is a compressed, game-sized version of central London.
