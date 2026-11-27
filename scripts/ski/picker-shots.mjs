/* Picker picture shots of one resort (HANDOFF "Sölden"): hides every page element except the canvas, then one fixed camera per pose.
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT --gpu --dpr 2 --size 1200x750 \
 *     --url "/pb/ski.html?resort=<rid>&auto=1&bot=1&q=high&res=fixed&weather=sun&time=midday" --script scripts/ski/picker-shots.mjs
 * POSES="name:x,z,above,tx,tz,above2,fov;name2:..." (env). */
export default async function run(page, { wait, shoot }) {
  await page.addStyleTag({ content: "body *:not(canvas):not(:has(canvas)) { visibility: hidden !important; }" });
  await page.evaluate(() => { const s = window.__ski; s.game.bot = null; s.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); });
  for (const item of (process.env.POSES || "").split(";").filter(Boolean)) {
    const [name, nums] = item.split(":");
    await page.evaluate((a) => window.__ski.setCamera(...a), nums.split(",").map(Number));
    await page.waitForTimeout(wait);
    await shoot(name);
  }
}
