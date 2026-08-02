// Trims Sleeper's player dump down to the players this league actually rosters.
//
// The upstream /v1/players/nba payload is ~2.4 MB because it carries every
// player in the league plus scouting metadata we never render. Rostered players
// number a couple hundred, and we only need four fields each, so the generated
// file lands around 20 KB.
//
// Run locally with `node tools/build-players.mjs`; the deploy workflow runs it
// again on every push so the committed copy can never go stale in production.

import { writeFile, mkdir } from "node:fs/promises";
import { API, LEAGUE_ID, SPORT } from "../scripts/config.js";

const OUT = new URL("../data/players.json", import.meta.url);

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
};

try {
  const [rosters, drafts, players] = await Promise.all([
    fetchJson(`${API}/league/${LEAGUE_ID}/rosters`),
    fetchJson(`${API}/league/${LEAGUE_ID}/drafts`),
    fetchJson(`${API}/players/${SPORT}`),
  ]);

  /* Anyone on a roster, plus anyone who was ever drafted or transacted, so the
     draft board and the transaction feed can resolve historical names too. */
  const wanted = new Set(
    rosters.flatMap(({ players: owned, taxi, reserve }) => [
      ...(owned ?? []),
      ...(taxi ?? []),
      ...(reserve ?? []),
    ]),
  );

  const transactionPages = await Promise.all(
    Array.from({ length: 18 }, (_, index) =>
      fetchJson(`${API}/league/${LEAGUE_ID}/transactions/${index + 1}`).catch(
        () => [],
      ),
    ),
  );

  transactionPages
    .flat()
    .forEach(({ adds, drops }) =>
      [...Object.keys(adds ?? {}), ...Object.keys(drops ?? {})].forEach((id) =>
        wanted.add(id),
      ),
    );

  const draftPicks = await Promise.all(
    drafts.map(({ draft_id }) =>
      fetchJson(`${API}/draft/${draft_id}/picks`).catch(() => []),
    ),
  );

  draftPicks.flat().forEach(({ player_id }) => wanted.add(player_id));

  const trimmed = Object.fromEntries(
    [...wanted]
      .filter((id) => players[id])
      .map((id) => {
        const { full_name, first_name, last_name, position, team } =
          players[id];
        return [
          id,
          {
            name: full_name ?? `${first_name ?? ""} ${last_name ?? ""}`.trim(),
            pos: position ?? "",
            team: team ?? "FA",
          },
        ];
      }),
  );

  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(trimmed)}\n`);

  const bytes = JSON.stringify(trimmed).length;
  console.log(
    `Wrote data/players.json: ${Object.keys(trimmed).length} players, ${(bytes / 1024).toFixed(1)} KB (from ${(JSON.stringify(players).length / 1024 / 1024).toFixed(1)} MB upstream).`,
  );
} catch (error) {
  console.error(`Could not build the player map: ${error.message}`);
  process.exitCode = 1;
}
