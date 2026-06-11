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
      'SELECT id, name, op_bags as opBags, op_qty as opQty FROM godowns WHERE user_id = ? ORDER BY created_at ASC',
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
      await pool.query(
        'UPDATE godowns SET op_bags = ?, op_qty = ? WHERE id = ? AND user_id = ?',
        [bags, qty, godownId, userId]
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
