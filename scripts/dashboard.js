// League dashboard: pulls live Sleeper data and renders standings, rosters,
// the draft board, and the transaction feed.

import { FAAB_BUDGET, ROSTER_SHAPE } from "./config.js";
import { loadLeague, standingsOrder } from "./sleeper.js";

const mount = (id) => document.querySelector(`#${id} [data-slot]`);

const html = (markup) => {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content;
};

/* One reflow per section instead of one per row. */
const paint = (target, markup) => {
  if (!target) return;
  const fragment = html(markup);
  requestAnimationFrame(() => target.replaceChildren(fragment));
};

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );

const decimal = (value) =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

const relative = (timestamp) => {
  const days = Math.round((timestamp - Date.now()) / 86_400_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return Math.abs(days) < 1
    ? "today"
    : formatter.format(days, "day");
};

const setCount = (key, value) => {
  const target = document.querySelector(`[data-count="${key}"]`);
  if (target) target.textContent = value;
};

/* ---------- Standings ---------- */

const renderStandings = ({ teams, hasScores, league }) => {
  const ordered = standingsOrder(teams);

  /* Records are all 0-0 until tip-off, so ranking on them would be noise.
     Preseason shows the things that are actually settled instead. */
  if (!hasScores) {
    const rows = [...teams]
      .sort((a, b) => (a.waiverPosition ?? 0) - (b.waiverPosition ?? 0))
      .map(
        (team) => `
        <tr>
          <td class="rank">${escape(team.waiverPosition ?? "")}</td>
          <td class="team">
            <span class="team-name">${escape(team.team)}</span>
            <span class="manager">${escape(team.manager)}</span>
          </td>
          <td class="num">${team.starters.length + team.bench.length}</td>
          <td class="num">${team.taxi.length}</td>
          <td class="num">$${team.faabLeft}</td>
          <td class="num">${team.moves}</td>
        </tr>`,
      )
      .join("");

    return paint(
      mount("standings"),
      `<div class="callout">
         <span class="label">Preseason</span>
         No games have been played yet, so there are no records to rank. This is
         where the league sits going in: waiver order, roster counts, and the
         FAAB each manager still has to spend.
       </div>
       <div class="table-scroll">
         <table class="standings">
           <thead>
             <tr>
               <th scope="col">Waiver</th>
               <th scope="col">Team</th>
               <th scope="col" class="num">Roster</th>
               <th scope="col" class="num">Taxi</th>
               <th scope="col" class="num">FAAB</th>
               <th scope="col" class="num">Moves</th>
             </tr>
           </thead>
           <tbody>${rows}</tbody>
         </table>
       </div>`,
    );
  }

  const rows = ordered
    .map((team, index) => {
      const cutoff = index === league.playoffTeams - 1;
      return `
        <tr class="${index < league.playoffTeams ? "in-playoffs" : ""} ${cutoff ? "cutoff" : ""}">
          <td class="rank">${index + 1}</td>
          <td class="team">
            <span class="team-name">${escape(team.team)}</span>
            <span class="manager">${escape(team.manager)}</span>
          </td>
          <td class="num record">${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}</td>
          <td class="num">${decimal(team.pointsFor)}</td>
          <td class="num soft">${decimal(team.pointsAgainst)}</td>
          <td class="num">$${team.faabLeft}</td>
        </tr>`;
    })
    .join("");

  paint(
    mount("standings"),
    `<div class="table-scroll">
       <table class="standings">
         <thead>
           <tr>
             <th scope="col">#</th>
             <th scope="col">Team</th>
             <th scope="col" class="num">Record</th>
             <th scope="col" class="num">PF</th>
             <th scope="col" class="num">PA</th>
             <th scope="col" class="num">FAAB</th>
           </tr>
         </thead>
         <tbody>${rows}</tbody>
       </table>
     </div>
     <p class="soft legend">
       Top ${league.playoffTeams} make the playoffs, league-wide, per Article VIII.
     </p>`,
  );
};

/* ---------- Rosters ---------- */

const playerChip = ({ name, pos, team }) => `
  <li class="player">
    <span class="pos">${escape(pos || "NA")}</span>
    <span class="who">${escape(name)}</span>
    <span class="nba">${escape(team || "FA")}</span>
  </li>`;

const rosterGroup = (team, { key, name, count }) => {
  const players = team[key] ?? [];
  if (players.length === 0) return "";

  /* Sleeper stops enforcing slot limits in the offseason, so a team can sit
     over its bench cap until it trims down. Mark it rather than let the
     count read like a rendering bug. */
  const over = count > 0 && players.length > count;

  return `
    <div class="group">
      <p class="group-head">
        <span class="label">${escape(name)}</span>
        <span class="fill ${over ? "over" : ""}"${over ? ` title="${players.length - count} over the ${count}-slot limit"` : ""}>${players.length}/${count}</span>
      </p>
      <ul class="players">${players.map(playerChip).join("")}</ul>
    </div>`;
};

const renderRosters = ({ teams, shape = ROSTER_SHAPE }) => {
  const overCapacity = teams.some((team) =>
    shape.some(
      ({ key, count }) => count > 0 && (team[key] ?? []).length > count,
    ),
  );

  const cards = standingsOrder(teams)
    .map(
      (team) => `
      <article class="team-card">
        <header class="team-head">
          ${team.avatar ? `<img class="avatar" src="${escape(team.avatar)}" alt="" width="40" height="40" loading="lazy" />` : ""}
          <div class="who">
            <h3>${escape(team.team)}</h3>
            <p class="manager">${escape(team.manager)}</p>
          </div>
          <p class="faab" title="FAAB remaining of $${FAAB_BUDGET}">$${team.faabLeft}</p>
        </header>
        ${shape.map((slot) => rosterGroup(team, slot)).join("")}
      </article>`,
    )
    .join("");

  const note = overCapacity
    ? `<div class="callout">
         <span class="label">Over the limit</span>
         Some rosters currently carry more players than they have slots for.
         Sleeper does not enforce the caps until the season starts, so those
         teams have until tip-off to trim down. Counts over the limit are
         marked in red.
       </div>`
    : "";

  paint(mount("rosters"), `${note}<div class="team-list">${cards}</div>`);
};

/* ---------- Draft board ---------- */

const renderDraft = ({ draft }) => {
  if (!draft || draft.picks.length === 0) {
    return paint(
      mount("draft"),
      `<div class="callout">
         <span class="label">No draft yet</span>
         Sleeper has not published picks for this league.
       </div>`,
    );
  }

  const rounds = Object.groupBy(draft.picks, ({ round }) => round);

  const board = Object.entries(rounds)
    .map(
      ([round, picks]) => `
      <section class="round">
        <h3 class="round-head">Round ${escape(round)}</h3>
        <ol class="picks">
          ${picks
            .sort((a, b) => a.overall - b.overall)
            .map(
              (pick) => `
              <li class="pick">
                <span class="pick-no">${pick.overall}</span>
                <span class="pick-player">${escape(pick.player)}</span>
                <span class="pick-meta">${escape(pick.pos)} · ${escape(pick.nbaTeam)}</span>
                <span class="pick-by">${escape(pick.by)}</span>
              </li>`,
            )
            .join("")}
        </ol>
      </section>`,
    )
    .join("");

  paint(mount("draft"), board);
};

/* ---------- Transactions ---------- */

const TRANSACTION_LABELS = {
  free_agent: "Free agent",
  waiver: "Waiver",
  trade: "Trade",
  commissioner: "Commissioner",
};

const renderTransactions = ({ transactions }) => {
  if (transactions.length === 0) {
    return paint(
      mount("transactions"),
      `<div class="callout">
         <span class="label">Quiet so far</span>
         No completed transactions yet this season.
       </div>`,
    );
  }

  const feed = transactions
    .slice(0, 40)
    .map(
      ({ type, created, bid, adds, drops }) => `
      <li class="move ${escape(type)}">
        <p class="move-head">
          <span class="kind">${escape(TRANSACTION_LABELS[type] ?? type)}</span>
          ${bid ? `<span class="bid">$${bid}</span>` : ""}
          <time datetime="${new Date(created).toISOString()}">${escape(relative(created))}</time>
        </p>
        <ul class="swaps">
          ${adds
            .map(
              ({ player, team }) =>
                `<li class="add"><span class="arrow" aria-hidden="true">+</span>${escape(player)} <span class="to">to ${escape(team)}</span></li>`,
            )
            .join("")}
          ${drops
            .map(
              ({ player, team }) =>
                `<li class="drop"><span class="arrow" aria-hidden="true">−</span>${escape(player)} <span class="to">from ${escape(team)}</span></li>`,
            )
            .join("")}
        </ul>
      </li>`,
    )
    .join("");

  paint(mount("transactions"), `<ul class="feed">${feed}</ul>`);
};

/* ---------- Boot ---------- */

const renderError = (message) => {
  document.querySelectorAll("[data-slot]").forEach((slot) => {
    slot.replaceChildren(
      html(`<div class="callout error">
              <span class="label">Could not reach Sleeper</span>
              ${escape(message)}
            </div>`),
    );
  });
};

try {
  const data = await loadLeague();

  document.title = `League Dashboard | ${data.league.name}`;
  setCount("season", data.league.season);
  setCount("teams", data.teams.length);
  setCount("moves", data.transactions.length);
  setCount("picks", data.draft?.picks.length ?? 0);

  const subtitle = document.querySelector("[data-league-status]");
  if (subtitle) {
    subtitle.textContent = data.hasScores
      ? `Week ${data.week} of the ${data.league.season} season.`
      : `The ${data.league.season} season has not tipped off yet.`;
  }

  const draw = () => {
    renderStandings(data);
    renderRosters(data);
    renderDraft(data);
    renderTransactions(data);
  };

  /* Softens the swap from skeletons to real content. */
  if (document.startViewTransition) {
    document.startViewTransition(draw);
  } else {
    draw();
  }
} catch (error) {
  renderError(error.message);
}
