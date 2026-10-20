import { INTERNAL, readRows, write } from '../../src/server/db.js';

function bind(text, args) {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const values = args[0];
    const names = [];
    const sql = text.replace(/(?<![:\w]):([A-Za-z_]\w*)/g, (_, name) => {
      names.push(name);
      return '?';
    });
    return { sql, params: names.map((name) => values[name]) };
  }
  return { sql: text, params: args };
}

export function prepare(db, text) {
  return {
    async run(...args) {
      const { sql, params } = bind(text, args);
      return write(db, sql, params);
    },
    async all(...args) {
      const { sql, params } = bind(text, args);
      return readRows(db, sql, params);
    },
    async get(...args) {
      const { sql, params } = bind(text, args);
      return (await readRows(db, sql, params))[0];
    }
  };
}

export async function insertUser(db, id, email, createdAt) {
  await write(
    db,
    "INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, '', '', ?)",
    [id, email, createdAt]
  );
}

export function tableSchema(name) {
  const start = INTERNAL.SCHEMA_SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  if (start === -1) {
    throw new Error(`tabellen ${name} finns inte i schemat`);
  }
  const end = INTERNAL.SCHEMA_SQL.indexOf('\n);', start);
  return INTERNAL.SCHEMA_SQL.slice(start, end + 3);
}
