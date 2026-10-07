// Plain-text route summary for the Share button, and last-train wording (PLAN.md §4h). Pure module.

export const clock = (sec) => {
  const s = ((Math.round(sec / 60) * 60) % 86400 + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;
};

// leg.last_train from router.js: {last_sec, reach_sec, slack_min, missed}
export function lastTrainText(leg, stationName) {
  const lt = leg.last_train;
  const line = leg.line_name;
  if (lt.missed) {
    return `The last ${line} train from ${stationName} is around ${clock(lt.last_sec)}, before you'd reach the platform (~${clock(lt.reach_sec)}). This leg may not run.`;
  }
  return `The last ${line} train from ${stationName} leaves around ${clock(lt.last_sec)}. You'd reach the platform ~${clock(lt.reach_sec)} (${lt.slack_min} min to spare). If you miss it there's no later train.`;
}

const DAY_TEXT = { weekday: "Weekday", saturday: "Saturday", sunday: "Sunday" };
const min = (m) => `${Math.round(m)} min`;
const walkMin = (m) => `${Math.max(1, Math.round(m))} min`;   // a short walk is still "~1 min", not "~0"

// ctx: {fromName, toName, day, time, stopName(id), fare (text or null), fareKind, url}
export function routeSummaryText(r, ctx) {
  const lines = [];
  lines.push(`KL Rail Planner: ${ctx.fromName} → ${ctx.toName}`);
  const changes = r.transfers === 0 ? "direct" : `${r.transfers} change${r.transfers === 1 ? "" : "s"}`;
  lines.push(`${DAY_TEXT[ctx.day] || ctx.day}, depart ${ctx.time} · ~${min(r.journey_min)} + up to ${min(r.initial_headway_min)} first wait · ${changes}`);
  let n = 0;
  for (const leg of r.legs) {
    if (leg.type === "access") {
      lines.push(leg.far ? `Start: ${ctx.stopName(leg.stop)} is ${Math.round(leg.dist_m)} m away (consider e-hailing)`
        : `Walk ~${walkMin(leg.walk_min)} (${Math.round(leg.dist_m)} m) to ${ctx.stopName(leg.stop)}`);
    } else if (leg.type === "egress") {
      lines.push(leg.far ? `End: ${leg.place} is ${Math.round(leg.dist_m)} m from ${ctx.stopName(leg.stop)} (consider e-hailing)`
        : `Walk ~${walkMin(leg.walk_min)} (${Math.round(leg.dist_m)} m) to ${leg.place}`);
    } else if (leg.type === "ride") {
      n++;
      const stops = leg.stops.length - 1;
      lines.push(`${n}. ${leg.line_number ? `${leg.line_number} ` : ""}${leg.line_name} towards ${ctx.stopName(leg.towards)}: ${ctx.stopName(leg.from)} → ${ctx.stopName(leg.to)} (${stops} stop${stops === 1 ? "" : "s"}, ~${min(leg.ride_min)})`);
    } else if (leg.kind === "same_stop") {
      lines.push(`   Change trains at ${ctx.stopName(leg.from)}`);
    } else if (leg.type === "transfer") {
      lines.push(`   Change: walk ~${walkMin(leg.walk_min)} to ${ctx.stopName(leg.to)}${leg.exits_gates === true ? " (exit fare gates)" : ""}`);
    }
  }
  if (ctx.fare) lines.push(`Fare: ${ctx.fare}${ctx.fareKind ? ` (${ctx.fareKind})` : ""}`);
  for (const leg of r.legs) if (leg.last_train) lines.push(`Warning: ${lastTrainText(leg, ctx.stopName(leg.from))}`);
  lines.push(`Times are estimates from average train frequency, not a live timetable${r.uses_estimate ? "; some values are estimated" : ""}.`);
  if (ctx.url) lines.push(ctx.url);
  return lines.join("\n");
}
