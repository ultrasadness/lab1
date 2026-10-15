// PROTOTYPE, throwaway: renders the Submit tap screenshots once, inside the Playwright image.
// docker run --rm -v "$PWD/shots:/shots" --entrypoint node -e NODE_PATH=/app/node_modules takeover-proto /shots/make-shots.cjs
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 560, height: 640 }, deviceScaleFactor: 2 });
  const html = fs.readFileSync('/shots/form.html', 'utf8');
  const versions = {
    'quill-filled-v1.png': 'Preset by the page; the Walkthrough left it empty',
    'quill-filled-v2.png': 'The page changed it to 11–50 after the first screenshot',
  };
  for (const [name, note] of Object.entries(versions)) {
    let doc = html.replace('TEAM_SIZE_NOTE', note);
    if (name.endsWith('v2.png')) doc = doc.replace('2–10 ▾', '11–50 ▾');
    await page.setContent(doc);
    await page.screenshot({ path: `/shots/${name}`, fullPage: true });
  }
  await browser.close();
})();
