// Sleeper API access layer. Everything here is read-only and unauthenticated.
//
// Sleeper serves `access-control-allow-origin: *` with a five-minute shared
// cache, so the browser can talk to it directly and repeat visits mostly hit
// cache rather than the origin.

import { API, FAAB_BUDGET, LEAGUE_ID, ROSTER_SHAPE, SPORT } from "./config.js";

/* Resolved against this module, so the path holds on nested pages too. */
const PLAYER_MAP = new URL("../data/players.json", import.meta.url);

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sleeper returned ${response.status} for ${url}`);
  }
  return response.json();
};

/* Endpoints that are empty rather than broken in the offseason: a 404 on a
   future week is a normal answer, not a failure worth surfacing. */
const fetchOptional = async (url, fallback) => {
  try {
    return await fetchJson(url);
  } catch {
    return fallback;
  }
};

/* Prefers the trimmed map built at deploy time (~13 KB). Falls back to the
   full 2.4 MB upstream dump so the page still works from a bare checkout. */
const loadPlayers = async () => {
  const trimmed = await fetchOptional(PLAYER_MAP, null);
  if (trimmed) return trimmed;

  const full = await fetchOptional(`${API}/players/${SPORT}`, {});
  return Object.fromEntries(
    Object.entries(full).map(([id, { full_name, position, team }]) => [
      id,
      { name: full_name ?? id, pos: position ?? "", team: team ?? "FA" },
    ]),
  );
};

/* Sleeper splits fantasy points across an integer and a decimal field. */
const points = (settings, key) =>
  Number(settings?.[key] ?? 0) + Number(settings?.[`${key}_decimal`] ?? 0) / 100;

const buildTeams = (rosters, users, players) => {
  const byUser = new Map(users.map((user) => [user.user_id, user]));
  const name = (id) => players[id]?.name ?? "Unknown player";

  return rosters.map((roster) => {
    const { settings, owner_id, roster_id } = roster;
    const user = byUser.get(owner_id);

    const starters = (roster.starters ?? []).filter((id) => id && id !== "0");
    const taxi = roster.taxi ?? [];
    const reserve = roster.reserve ?? [];
    const assigned = new Set([...starters, ...taxi, ...reserve]);
    const bench = (roster.players ?? []).filter((id) => !assigned.has(id));

    const fill = (ids) =>
      ids.map((id) => ({ id, name: name(id), ...(players[id] ?? {}) }));

    return {
      rosterId: roster_id,
      team: user?.metadata?.team_name ?? user?.display_name ?? `Team ${roster_id}`,
      manager: user?.display_name ?? "Unclaimed",
      avatar: user?.avatar
        ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}`
        : null,
      wins: settings?.wins ?? 0,
      losses: settings?.losses ?? 0,
      ties: settings?.ties ?? 0,
      pointsFor: points(settings, "fpts"),
      pointsAgainst: points(settings, "fpts_against"),
      faabLeft: FAAB_BUDGET - (settings?.waiver_budget_used ?? 0),
      moves: settings?.total_moves ?? 0,
      waiverPosition: settings?.waiver_position ?? null,
      starters: fill(starters),
      bench: fill(bench),
      taxi: fill(taxi),
      reserve: fill(reserve),
    };
  });
};

/* Best record first, total points as the tiebreak. */
export const standingsOrder = (teams) =>
  [...teams].sort(
    (a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor,
  );

/* Sleeper has no "all transactions" route, so weeks are pulled in parallel and
   merged. Rounds 1-18 covers the regular season plus the offseason bucket. */
const loadTransactions = async (players, teams) => {
  const byRoster = new Map(teams.map((team) => [team.rosterId, team]));
  const weeks = await Promise.all(
    Array.from({ length: 18 }, (_, index) =>
      fetchOptional(`${API}/league/${LEAGUE_ID}/transactions/${index + 1}`, []),
    ),
  );

  const named = (id) => players[id]?.name ?? "Unknown player";

  return weeks
    .flat()
    .filter(({ status }) => status === "complete")
    .sort((a, b) => b.created - a.created)
    .map(({ type, created, adds, drops, roster_ids, settings }) => ({
      type,
      created,
      bid: settings?.waiver_bid ?? null,
      teams: (roster_ids ?? []).map(
        (id) => byRoster.get(id)?.team ?? `Team ${id}`,
      ),
      adds: Object.entries(adds ?? {}).map(([id, roster]) => ({
        player: named(id),
        team: byRoster.get(roster)?.team ?? `Team ${roster}`,
      })),
      drops: Object.entries(drops ?? {}).map(([id, roster]) => ({
        player: named(id),
        team: byRoster.get(roster)?.team ?? `Team ${roster}`,
      })),
    }));
};

/* Picks already carry first/last name and position, so the draft board needs
   no lookup against the player map at all. */
const loadDraft = async (drafts, teams) => {
  const [draft] = drafts ?? [];
  if (!draft) return null;

  const byRoster = new Map(teams.map((team) => [team.rosterId, team]));
  const picks = await fetchOptional(`${API}/draft/${draft.draft_id}/picks`, []);

  return {
    rounds: draft.settings?.rounds ?? 0,
    teams: draft.settings?.teams ?? teams.length,
    status: draft.status,
    picks: picks.map(({ pick_no, round, roster_id, metadata }) => ({
      overall: pick_no,
      round,
      by: byRoster.get(roster_id)?.team ?? `Team ${roster_id}`,
      player: `${metadata?.first_name ?? ""} ${metadata?.last_name ?? ""}`.trim(),
      pos: metadata?.position ?? "",
      nbaTeam: metadata?.team ?? "",
    })),
  };
};

/* Slot capacities straight from the league config, so the roster cards follow
   Sleeper rather than a constant that could drift after a settings change. */
const rosterShape = ({ roster_positions, settings }) => {
  const positions = roster_positions ?? [];
  if (positions.length === 0) return ROSTER_SHAPE;

  const bench = positions.filter((slot) => slot === "BN").length;

  return [
    {
      key: "starters",
      name: "Starters",
      count: positions.length - bench,
    },
    { key: "bench", name: "Bench", count: bench },
    { key: "taxi", name: "Taxi", count: settings?.taxi_slots ?? 0 },
    { key: "reserve", name: "IR", count: settings?.reserve_slots ?? 0 },
  ];
};

export const loadLeague = async () => {
  const [league, users, rosters, state, drafts, players] = await Promise.all([
    fetchJson(`${API}/league/${LEAGUE_ID}`),
    fetchJson(`${API}/league/${LEAGUE_ID}/users`),
    fetchJson(`${API}/league/${LEAGUE_ID}/rosters`),
    fetchJson(`${API}/state/${SPORT}`),
    fetchOptional(`${API}/league/${LEAGUE_ID}/drafts`, []),
    loadPlayers(),
  ]);

  const teams = buildTeams(rosters, users, players);
  const [transactions, draft] = await Promise.all([
    loadTransactions(players, teams),
    loadDraft(drafts, teams),
  ]);

  return {
    league: {
      name: league.name,
      season: league.season,
      status: league.status,
      playoffTeams: league.settings?.playoff_teams ?? 8,
      avatar: league.avatar
        ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}`
        : null,
    },
    /* season_has_scores stays false until the first tip-off; the standings
       section reads it to decide between real rows and an empty state. */
    hasScores: state.season_has_scores === true,
    week: state.display_week ?? state.week ?? 0,
    shape: rosterShape(league),
    teams,
    draft,
    transactions,
  };
};
