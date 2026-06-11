const { pool } = require('../db');

async function dump() {
  let conn;
  try {
    conn = await pool.getConnection();
    const [godowns] = await conn.query('SELECT id, name, op_bags, op_qty FROM godowns WHERE user_id = ?', ['u_saroj_new']);
    const [entries] = await conn.query('SELECT id, godown_id, entry_date, iss_bags, clos_bags FROM entries WHERE user_id = ?', ['u_saroj_new']);
    console.log("Godowns:", godowns);
    console.log("Entries:", entries);
  } catch(e) {
    console.error(e);
  } finally {
    if(conn) conn.release();
    process.exit(0);
  }
}
dump();
