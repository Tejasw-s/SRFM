const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { pool, initDB, sha256 } = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auto-initialize database on first request
let dbInitialized = false;
app.use(async (req, res, next) => {
  if (!dbInitialized) {
    try {
      await initDB();
      dbInitialized = true;
    } catch (err) {
      console.error('Database initialization failed on request:', err);
    }
  }
  next();
});

// Authentication
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email/Username and password required.' });
  }

  try {
    const passHash = sha256(password);
    const [rows] = await pool.query(
      'SELECT id, email FROM users WHERE (email = ? OR email = ?) AND password_hash = ?',
      [email.trim().toLowerCase(), email.trim(), passHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  const { userId, newPassword } = req.body;
  if (!userId || !newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, message: 'Invalid user or password length (min 4 characters).' });
  }

  try {
    const passHash = sha256(newPassword);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passHash, userId]);
    res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ success: false, message: 'Server error changing password.' });
  }
});

// Godowns
app.get('/api/godowns', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const [rows] = await pool.query(
      'SELECT id, name, op_bags as opBags, op_qty as opQty, op_date as opDate, op_name as opName FROM godowns WHERE user_id = ? ORDER BY created_at ASC',
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get godowns error:', err);
    res.status(500).json({ error: 'Server error fetching godowns.' });
  }
});

app.post('/api/godowns', async (req, res) => {
  const { userId, name } = req.body;
  if (!userId || !name) return res.status(400).json({ error: 'userId and name required' });

  const id = 'g_' + crypto.randomUUID();
  try {
    await pool.query(
      'INSERT INTO godowns (id, user_id, name, op_bags, op_qty) VALUES (?, ?, ?, 0, 0.000)',
      [id, userId, name.trim()]
    );
    res.json({ success: true, godown: { id, name: name.trim(), opBags: 0, opQty: 0 } });
  } catch (err) {
    console.error('Create godown error:', err);
    res.status(500).json({ error: 'Server error creating godown.' });
  }
});

app.put('/api/godowns/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    await pool.query('UPDATE godowns SET name = ? WHERE id = ?', [name.trim(), id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Rename godown error:', err);
    res.status(500).json({ error: 'Server error renaming godown.' });
  }
});

app.delete('/api/godowns/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Delete both the entries and the godown
    await pool.query('DELETE FROM entries WHERE godown_id = ?', [id]);
    await pool.query('DELETE FROM godowns WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete godown error:', err);
    res.status(500).json({ error: 'Server error deleting godown.' });
  }
});

// Opening Stock
app.post('/api/opstock', async (req, res) => {
  const { userId, opStock } = req.body; // opStock: { godownId: { bags, qty }, ... }
  if (!userId || !opStock) return res.status(400).json({ error: 'userId and opStock details required' });

  try {
    for (const [godownId, values] of Object.entries(opStock)) {
      const bags = parseFloat(values.bags) || 0;
      const qty = parseFloat(values.qty) || 0;
      const date = values.date || null;
      const name = values.name || '';
      await pool.query(
        'UPDATE godowns SET op_bags = ?, op_qty = ?, op_date = ?, op_name = ? WHERE id = ? AND user_id = ?',
        [bags, qty, date, name, godownId, userId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Save op stock error:', err);
    res.status(500).json({ error: 'Server error saving opening stock.' });
  }
});

// Entries
app.get('/api/entries', async (req, res) => {
  const { userId, godownId, fromDate, toDate, day, search } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    let sql = 'SELECT * FROM entries WHERE user_id = ?';
    const params = [userId];

    if (godownId) {
      sql += ' AND godown_id = ?';
      params.push(godownId);
    }
    if (fromDate) {
      sql += ' AND entry_date >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      sql += ' AND entry_date <= ?';
      params.push(toDate);
    }
    if (search) {
      sql += ' AND LOWER(particulers) LIKE ?';
      params.push(`%${search.toLowerCase()}%`);
    }

    const [rows] = await pool.query(sql + ' ORDER BY entry_date DESC, created_at DESC', params);

    // Map database fields to front-end keys
    let entries = rows.map(r => ({
      id: r.id,
      date: r.entry_date.toISOString().split('T')[0],
      godownId: r.godown_id,
      particulers: r.particulers,
      issBags: parseFloat(r.iss_bags) || 0,
      issQty: parseFloat(r.iss_qty) || 0,
      recvBags: parseFloat(r.recv_bags) || 0,
      recvQty: parseFloat(r.recv_qty) || 0,
      closBags: parseFloat(r.clos_bags) || 0,
      closQty: parseFloat(r.clos_qty) || 0,
      remarks: r.remarks
    }));

    // Filter by day of week if specified (0 = Sunday, 1 = Monday, etc.)
    if (day !== undefined && day !== null && day !== '') {
      const dayNum = parseInt(day);
      entries = entries.filter(e => {
        const d = new Date(e.date + 'T00:00:00');
        return d.getDay() === dayNum;
      });
    }

    res.json(entries);
  } catch (err) {
    console.error('Fetch entries error:', err);
    res.status(500).json({ error: 'Server error fetching entries.' });
  }
});

app.post('/api/entries', async (req, res) => {
  const {
    userId, godownId, date, particulers,
    issBags, issQty, recvBags, recvQty, closBags, closQty, remarks
  } = req.body;

  if (!userId || !godownId || !date) {
    return res.status(400).json({ error: 'userId, godownId, and date required' });
  }

  const id = 'e_' + crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO entries 
      (id, user_id, godown_id, entry_date, particulers, iss_bags, iss_qty, recv_bags, recv_qty, clos_bags, clos_qty, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, userId, godownId, date, particulers || '',
        parseFloat(issBags) || 0, parseFloat(issQty) || 0,
        parseFloat(recvBags) || 0, parseFloat(recvQty) || 0,
        parseFloat(closBags) || 0, parseFloat(closQty) || 0,
        remarks || ''
      ]
    );

    res.json({ success: true, entryId: id });
  } catch (err) {
    console.error('Create entry error:', err);
    res.status(500).json({ error: 'Server error saving entry.' });
  }
});

app.put('/api/entries/:id', async (req, res) => {
  const { id } = req.params;
  const {
    godownId, date, particulers,
    issBags, issQty, recvBags, recvQty, closBags, closQty, remarks
  } = req.body;

  try {
    await pool.query(
      `UPDATE entries SET 
        godown_id = ?, entry_date = ?, particulers = ?, 
        iss_bags = ?, iss_qty = ?, recv_bags = ?, recv_qty = ?, 
        clos_bags = ?, clos_qty = ?, remarks = ?
      WHERE id = ?`,
      [
        godownId, date, particulers || '',
        parseFloat(issBags) || 0, parseFloat(issQty) || 0,
        parseFloat(recvBags) || 0, parseFloat(recvQty) || 0,
        parseFloat(closBags) || 0, parseFloat(closQty) || 0,
        remarks || '',
        id
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update entry error:', err);
    res.status(500).json({ error: 'Server error updating entry.' });
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM entries WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete entry error:', err);
    res.status(500).json({ error: 'Server error deleting entry.' });
  }
});

// Production Runs API
app.get('/api/production', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const [runs] = await pool.query(
      'SELECT id, run_date as runDate, kotha_stock as kothaStock, production_total as productionTotal, balance_kotha as balanceKotha, created_at as createdAt FROM production_runs WHERE user_id = ? ORDER BY run_date DESC, created_at DESC',
      [userId]
    );

    // Map and fetch items for each run
    const results = [];
    for (const run of runs) {
      const [items] = await pool.query(
        'SELECT product_name as productName, bags, kgs FROM production_items WHERE run_id = ?',
        [run.id]
      );
      results.push({
        ...run,
        items
      });
    }

    res.json(results);
  } catch (err) {
    console.error('Fetch production runs error:', err);
    res.status(500).json({ error: 'Server error fetching production history.' });
  }
});

app.post('/api/production', async (req, res) => {
  const {
    userId, runDate, kothaStock, productionTotal, balanceKotha, items, sourceGodownId
  } = req.body;

  if (!userId || !runDate || !items) {
    return res.status(400).json({ error: 'userId, runDate, and items are required' });
  }

  const runId = 'pr_' + crypto.randomUUID();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Insert production run
    await conn.query(
      `INSERT INTO production_runs (id, user_id, run_date, kotha_stock, production_total, balance_kotha)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [runId, userId, runDate, parseFloat(kothaStock) || 0, parseFloat(productionTotal) || 0, parseFloat(balanceKotha) || 0]
    );

    // 2. Insert items
    for (const item of items) {
      if (parseFloat(item.bags) > 0 || parseFloat(item.kgs) > 0) {
        const itemId = 'pi_' + crypto.randomUUID();
        await conn.query(
          `INSERT INTO production_items (id, run_id, product_name, bags, kgs)
           VALUES (?, ?, ?, ?, ?)`,
          [itemId, runId, item.productName, parseFloat(item.bags) || 0, parseFloat(item.kgs) || 0]
        );
      }
    }

    // 3. If source godown was selected, auto-create a ledger entry for wheat consumption
    if (sourceGodownId) {
      const entryId = 'e_' + crypto.randomUUID();
      const issQtyMt = (parseFloat(productionTotal) || 0) / 1000.0;
      
      // We calculate closing stock for the entry
      // We first query the latest entry before this run date to get its closing balance
      const [prior] = await conn.query(
        `SELECT clos_bags, clos_qty FROM entries 
         WHERE user_id = ? AND godown_id = ? AND entry_date <= ? 
         ORDER BY entry_date DESC, id DESC LIMIT 1`,
        [userId, sourceGodownId, runDate]
      );
      
      let prevB = 0;
      let prevQ = 0;
      if (prior.length > 0) {
        prevB = parseFloat(prior[0].clos_bags) || 0;
        prevQ = parseFloat(prior[0].clos_qty) || 0;
      } else {
        // Fallback to opening stock
        const [gd] = await conn.query(
          `SELECT op_bags, op_qty FROM godowns WHERE id = ?`,
          [sourceGodownId]
        );
        if (gd.length > 0) {
          prevB = parseFloat(gd[0].op_bags) || 0;
          prevQ = parseFloat(gd[0].op_qty) || 0;
        }
      }

      const closB = Math.max(0, prevB - 0); // Bags issued is 0 by default for bulk wheat
      const closQ = Math.max(0, prevQ - issQtyMt);

      await conn.query(
        `INSERT INTO entries 
        (id, user_id, godown_id, entry_date, particulers, iss_bags, iss_qty, recv_bags, recv_qty, clos_bags, clos_qty, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entryId, userId, sourceGodownId, runDate, 'WHEAT CONSUMPTION (PRODUCTION)',
          0, issQtyMt, 0, 0, closB, closQ, `Auto-generated from Production Run ${runDate}`
        ]
      );
    }

    await conn.commit();
    res.json({ success: true, runId });
  } catch (err) {
    await conn.rollback();
    console.error('Create production run error:', err);
    res.status(500).json({ error: 'Server error saving production run.' });
  } finally {
    conn.release();
  }
});

app.delete('/api/production/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM production_runs WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete production run error:', err);
    res.status(500).json({ error: 'Server error deleting production run.' });
  }
});

// Server startup and DB init is handled below

// Initialize database then start server
if (process.env.NODE_ENV !== 'production') {
  initDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  }).catch(err => {
    console.error('Failed to start server due to DB init error:', err);
  });
}

// Export the Express API for Vercel
module.exports = app;
