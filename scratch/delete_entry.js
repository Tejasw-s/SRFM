const { pool } = require('../db');

async function deleteEntry() {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query('DELETE FROM entries WHERE id = ?', ['e_664d1500-a691-4de1-bee8-a874ce3f0711']);
    console.log('Delete result:', result);
  } catch (err) {
    console.error(err);
  } finally {
    if (conn) conn.release();
    process.exit(0);
  }
}

deleteEntry();
