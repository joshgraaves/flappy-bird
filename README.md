# Flappy Bird

A one-tap pixel game with blue skies, green pipes, and the supplied bird image.
Tap or press Space / Up to flap. Pass a pipe pair for +1; hit a pipe or the ground and the run ends.

- The first five points have wider gaps and slower pipes; difficulty increases gradually through score twenty.
- Best score and optional custom character are saved on this device.
- The image button on the title screen lets you pick a custom character; reset restores the default bird.
- Fixed 120 Hz simulation, with touch support and an offline Home Screen app.
- Keep `bird.png` alongside `index.html` when copying or hosting the game.

Test: `node tools/test.mjs` (headless Chrome mobile emulation; also regenerates icons).
