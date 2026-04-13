/**
 * Browser shim for 'pg' — prevents Node.js PostgreSQL client from
 * crashing the browser bundle. All pg operations are server-side only.
 */
export class Pool {
  query() { return Promise.resolve({ rows: [], rowCount: 0 }); }
  connect() { return Promise.resolve(this); }
  end() { return Promise.resolve(); }
  release() {}
}

export class Client extends Pool {}

export default { Pool, Client };
