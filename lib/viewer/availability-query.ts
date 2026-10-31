import { sql } from "drizzle-orm";
import { episodes } from "@/db/schema";

/** Same calendar-day rule as isUpcoming(), evaluated by Postgres in the platform timezone. */
export const airedEpisode = () => sql`(${episodes.airDate} is null or ${episodes.airDate} <= (now() at time zone 'Asia/Colombo')::date)`;
