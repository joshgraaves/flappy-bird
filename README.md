# Flappy Bird

A one-tap firefly flight through stone pillars. Original pixel art, drawn in code; Web Audio blips.
Single `index.html`, installable as a Home Screen web app (manifest + icons + offline service worker).

- Tap to flap, pass a pillar pair for +1, hit a pillar or the ground and it's over.
- Best score is kept in `localStorage`.
- Fixed 120 Hz sim step, so it plays the same on 60 and 120 Hz screens.

Test: `node tools/test.mjs` (headless Chrome, 390x844 mobile emulation; also regenerates the icons).
