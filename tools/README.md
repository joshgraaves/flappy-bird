`icon.html?s=SIZE` draws the app icon. `test.mjs` drives headless Chrome over CDP
(390x844 mobile emulation), regenerates the icons, plays a few runs and saves screenshots.

    node tools/test.mjs
