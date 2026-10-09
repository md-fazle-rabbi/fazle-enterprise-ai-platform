// Renders social-preview.html to social-preview.png at 1280x640, GitHub's social preview size.
// Run it from apps/web after `npm ci`, so @playwright/test and the Geist font files exist:
//   node ../../docs/branding/render-social-preview.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Why: this file lives outside apps/web, so a plain import cannot find the package. This
// resolves it from the folder the command is run in.
const require = createRequire(path.join(process.cwd(), "package.json"));
const { chromium } = require("@playwright/test");

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlUrl = pathToFileURL(path.join(here, "social-preview.html")).href;
const outPath = path.join(here, "social-preview.png");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.goto(htmlUrl);
  // Why: a picture rendered in the fallback font would look fine at a glance and be wrong.
  // This fails loudly if either Geist file did not load.
  const fonts = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('600 20px "Geist Local"'),
      document.fonts.load('600 20px "Geist Mono Local"'),
    ]);
    return [...document.fonts].map((font) => `${font.family}:${font.status}`);
  });
  if (fonts.length === 0 || !fonts.every((entry) => entry.endsWith(":loaded"))) {
    throw new Error(`Fonts did not load: ${fonts.join(", ")}`);
  }
  await page.screenshot({ path: outPath });
  console.log(`wrote ${outPath} (${fonts.join(", ")})`);
} finally {
  await browser.close();
}
