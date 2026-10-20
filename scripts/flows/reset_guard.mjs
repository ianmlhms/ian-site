/* Shared helper for flows that confirm a destructive idle-game reset (investor claim, rebirth).
 * The confirm button is locked for the first second after the dialog opens and, for small gains, needs a real
 * press-and-hold (pb/idle-extras.js makeGuard), so the flows press the way a player does: mouse down, wait, mouse up. */
export async function holdConfirm(h, game, selector, { holdMs = 1800 } = {}) {
  await game.waitForFunction((sel) => { const node = document.querySelector(sel); return node && !node.disabled; }, selector, { timeout: 5000 });
  const button = game.locator(selector);
  if (!(await button.evaluate((node) => node.classList.contains("idle-hold")))) { await button.click(); return false; }
  const box = await button.boundingBox();
  await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await h.page.mouse.down();
  await h.pause(holdMs);
  await h.page.mouse.up();
  return true;
}
