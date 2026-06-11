// Path to the SQLite database file. Use ":memory:" for an ephemeral
// in-memory database (useful for tests/demos — data is lost on restart).
export const env = {
  SQLITE_DB_PATH: process.env.SQLITE_DB_PATH ?? './data/softbinding.sqlite',
};
