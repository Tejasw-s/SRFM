const mysql = require('mysql2/promise');
const crypto = require('crypto');
require('dotenv').config();

const config = {
  host: process.env.DB_HOST || 'gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com',
  port: parseInt(process.env.DB_PORT || '4000'),
  user: process.env.DB_USER || '4E6XwBiHdpn7Khe.root',
  password: process.env.DB_PASS || '5BartcwDx7tbQkQ9',
  database: process.env.DB_NAME || 'test',
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: false
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(config);

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function initDB() {
  console.log('Initializing database tables...');
  let conn;
  try {
    conn = await pool.getConnection();

    // 1. Create users table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 2. Create godowns table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS godowns (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        op_bags DECIMAL(12,2) DEFAULT 0,
        op_qty DECIMAL(12,3) DEFAULT 0,
        op_date DATE,
        op_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 3. Create entries table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS entries (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        godown_id VARCHAR(50) NOT NULL,
        entry_date DATE NOT NULL,
        particulers VARCHAR(500),
        iss_bags DECIMAL(12,2) DEFAULT 0,
        iss_qty DECIMAL(12,3) DEFAULT 0,
        recv_bags DECIMAL(12,2) DEFAULT 0,
        recv_qty DECIMAL(12,3) DEFAULT 0,
        clos_bags DECIMAL(12,2) DEFAULT 0,
        clos_qty DECIMAL(12,3) DEFAULT 0,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW() ON UPDATE NOW()
      );
    `);

    console.log('Tables verified/created.');

    // Seed default users
    console.log('Verifying default users...');
    const adminId = 'u_admin';
    const sarojId = 'u_saroj';
    const sarojNewId = 'u_saroj_new';
    
    const adminPassHash = sha256('admin123');
    const sarojPassHash = sha256('sarojkumarSRFM');
    const sarojNewPassHash = sha256('SAROKJUMAR1234');

    await conn.query(
      `INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE password_hash = ?`,
      [adminId, 'admin@godown.com', adminPassHash, adminPassHash]
    );
    await conn.query(
      `INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE password_hash = ?`,
      [sarojId, 'sarojkumar', sarojPassHash, sarojPassHash]
    );
    await conn.query(
      `INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE password_hash = ?`,
      [sarojNewId, 'SAROJKUMAR', sarojNewPassHash, sarojNewPassHash]
    );
    console.log('Default users verified/seeded successfully!');

    // Seed default godowns
    console.log('Verifying default godowns...');
    await conn.query(
      `INSERT INTO godowns (id, user_id, name, op_bags, op_qty) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [
        'g1', 'u_saroj', 'Godown No 1', 500, 25.000,
        'g2', 'u_saroj', 'Godown No 2', 300, 15.000
      ]
    );
    await conn.query(
      `INSERT INTO godowns (id, user_id, name, op_bags, op_qty) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [
        'g1_new', 'u_saroj_new', 'Godown No 1', 500, 25.000,
        'g2_new', 'u_saroj_new', 'Godown No 2', 300, 15.000
      ]
    );
    await conn.query(
      `INSERT INTO godowns (id, user_id, name, op_bags, op_qty) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [
        'g1_admin', 'u_admin', 'Godown No 1', 100, 5.000,
        'g2_admin', 'u_admin', 'Godown No 2', 200, 10.000
      ]
    );
    console.log('Default godowns verified/seeded successfully!');

  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  pool,
  initDB,
  sha256
};
