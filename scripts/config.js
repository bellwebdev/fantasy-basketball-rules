// League identity and API endpoints.
//
// The league ID is deliberately in plain sight. Sleeper's API is unauthenticated
// and read-only, and every /users and /rosters payload echoes `league_id` back
// in the response body, so there is nothing here that the network tab would not
// reveal on the first render anyway.

export const LEAGUE_ID = "1336715693395054592";
export const SPORT = "nba";
export const API = "https://api.sleeper.app/v1";

/* Article VI: each manager gets $100 of FAAB per season. */
export const FAAB_BUDGET = 100;

/* Slot counts from Article III. Only a fallback: the live shape is read from
   the league's own `roster_positions` so the page follows Sleeper if the
   league is ever reconfigured. */
export const ROSTER_SHAPE = [
  { key: "starters", name: "Starters", count: 7 },
  { key: "bench", name: "Bench", count: 6 },
  { key: "taxi", name: "Taxi", count: 4 },
  { key: "reserve", name: "IR", count: 2 },
];
