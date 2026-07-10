// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: bus;
//
// ian.lu Lock-Screen Widget
// -------------------------
// 06:50 → bus gone:  live departure of the D02 at Niederanven Laach (with delay)
// rest of the day:   date + weather (Niederanven)
//
// Setup: see scripts/WIDGET-SETUP.md. Works as a Lock Screen widget
// (rectangular or inline) and as a small Home Screen widget.

const FN_URL = "https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/transport?action=widget";
const ANON_KEY = "sb_publishable_aqZ5h0dyxzgwqnpAv-oiuA_2O60dNH2"; // public client key

async function fetchData() {
  const r = new Request(FN_URL);
  r.headers = { apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY };
  r.timeoutInterval = 15;
  return await r.loadJSON();
}

function busLine(d) {
  let t = `🚌 ${d.line}  ${d.time}`;
  if (d.cancelled) t += "  ✖";
  else if (d.delay > 0) t += `  +${d.delay}`;
  return t;
}

let data, error = null;
try { data = await fetchData(); } catch (e) { error = String(e); }

const w = new ListWidget();
w.backgroundColor = new Color("#0d0d1a");

const isAccessory = config.widgetFamily && config.widgetFamily.startsWith("accessory");

if (error || !data) {
  const t = w.addText("ian.lu net erreechbar");
  t.font = Font.mediumSystemFont(isAccessory ? 12 : 14);
  t.textColor = Color.gray();
} else if (data.mode === "bus") {
  if (config.widgetFamily === "accessoryInline") {
    const t = w.addText(busLine(data));
    t.font = Font.mediumSystemFont(13);
  } else {
    const top = w.addText("🚌 " + data.line + (data.cancelled ? "  ✖ ausgefall" : ""));
    top.font = Font.mediumSystemFont(isAccessory ? 12 : 14);
    top.textColor = new Color(data.cancelled ? "#ff5d6c" : "#8888aa");
    w.addSpacer(2);
    const big = w.addText(data.time + (data.delay > 0 ? ` +${data.delay}` : ""));
    big.font = Font.boldSystemFont(isAccessory ? 22 : 30);
    big.textColor = data.cancelled ? new Color("#ff5d6c")
      : data.delay > 0 ? new Color("#f0b429") : new Color("#e8e8f0");
    if (!isAccessory) {
      w.addSpacer(2);
      const sub = w.addText("Laach · live");
      sub.font = Font.systemFont(11);
      sub.textColor = new Color("#8888aa");
    }
  }
  // bus window → refresh often so the delay stays live
  w.refreshAfterDate = new Date(Date.now() + 3 * 60 * 1000);
} else {
  if (config.widgetFamily === "accessoryInline") {
    const t = w.addText(`${data.icon} ${data.temp}°  ${data.date}`);
    t.font = Font.mediumSystemFont(13);
  } else {
    const d1 = w.addText(data.date || "");
    d1.font = Font.mediumSystemFont(isAccessory ? 12 : 14);
    d1.textColor = new Color("#8888aa");
    w.addSpacer(2);
    const big = w.addText(data.temp == null ? "–" : `${data.icon} ${data.temp}°`);
    big.font = Font.boldSystemFont(isAccessory ? 22 : 30);
    big.textColor = new Color("#e8e8f0");
    if (!isAccessory && data.min != null) {
      w.addSpacer(2);
      const sub = w.addText(`${data.min}° – ${data.max}° · Nidderaanwen`);
      sub.font = Font.systemFont(11);
      sub.textColor = new Color("#8888aa");
    }
  }
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
}

if (config.runsInWidget) {
  Script.setWidget(w);
} else {
  await w.presentSmall();
}
Script.complete();
