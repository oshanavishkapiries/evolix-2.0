/** Admin dates and day buckets use Sri Lanka time (UTC+5:30, no DST). */
export const TZ = "Asia/Colombo";
export const TZ_LABEL = "Sri Lanka time";

/** YYYY-MM-DD of `d` in TZ. */
export const tzDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
