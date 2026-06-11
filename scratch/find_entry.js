const { pool } = require('../db');

async function findEntry() {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT * FROM entries WHERE particulers LIKE ? OR iss_bags = ?', ['%Pipariya%', 394]);
    console.log(rows);
  } catch (err) {
    console.error(err);
  } finally {
    if (conn) conn.release();
    process.exit(0);
  }
}

findEntry();
