/** Bootstrap only. Application settings are asynchronous: use await getConfig(). */
export const env = {
  get DATABASE_URL() {
    const value = process.env.DATABASE_URL;
    if (!value) throw new Error("Invalid or missing environment variable: DATABASE_URL");
    return value;
  },
  get CONFIG_ENCRYPTION_KEY() { return process.env.CONFIG_ENCRYPTION_KEY; },
  get NODE_ENV() { return process.env.NODE_ENV ?? "development"; },
};
