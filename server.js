const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://globalfx_db_user:7Wk1eQ2pZArFnaIunsJNDqE2CQiY78io@dpg-d46mamfgi27c73au94f0-a/globalfx_db',
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'mysecret123';

// Routes
app.post('/api/register', async (req, res) => {
  const { email, username, password } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, username, password, balance, is_active, verified_email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [email, username, hash, 0, false, false]
    );
    res.status(201).json({ message: 'Registration successful. Please check your email to verify.' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email or username already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(password, user.rows[0].password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    // Check if email verified
    if (!user.rows[0].verified_email) {
      return res.status(403).json({ error: 'Please verify your email before logging in.' });
    }

    const token = jwt.sign({ userId: user.rows[0].id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      token,
      user: {
        id: user.rows[0].id,
        email: user.rows[0].email,
        username: user.rows[0].username,
        balance: user.rows[0].balance,
        isActive: user.rows[0].is_active,
        verified_email: user.rows[0].verified_email
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/user/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const user = await pool.query('SELECT id, email, username, balance, is_active, verified_email FROM users WHERE id = $1', [id]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(user.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/transactions/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const transactions = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.json(transactions.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/deposit', async (req, res) => {
  const { userId, method, amount } = req.body;
  const txId = Math.random().toString(36).substring(2, 10);

  // Validate
  if (!method || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid data' });
  }

  // Simulate processing
  const status = ['pending', 'successful', 'failed'][Math.floor(Math.random() * 3)];
  let success = status === 'successful';

  // For crypto, show address
  let address = '';
  if (method === 'BTC') address = '35DrUNecGXnuhQvizUTxYD42WN9PqcHUHz';
  else if (method === 'ETH') address = '0x86a2fda85b8978cd747c28ba7f5bdb5e855c7db0';
  else if (method === 'USDT') address = 'TZ3jxLmbSEDKHLcEgw5uwM9kqUiSHj9njD';

  // Insert transaction
  try {
    await pool.query(
      'INSERT INTO transactions (user_id, type, method, amount, status, tx_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
      [userId, 'deposit', method, amount, status, txId]
    );

    // Update balance if successful
    if (success) {
      await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, userId]);
    }

    if (address) {
      res.json({
        message: `Send $${amount} to this address: ${address}\nTX ID: ${txId}`,
        address,
        txId
      });
    } else {
      res.json({ message: `Deposit of $${amount} via ${method} is being reviewed.` });
    }
  } catch (err) {
    res.status(500).json({ error: 'Error saving transaction' });
  }
});

app.post('/api/approve-deposit', async (req, res) => {
  const { txId } = req.body;
  try {
    await pool.query('UPDATE transactions SET status = "successful" WHERE tx_id = $1', [txId]);
    res.json({ message: 'Deposit approved!' });
  } catch (err) {
    res.status(500).json({ error: 'Error approving deposit' });
  }
});

app.post('/api/freeze-account', async (req, res) => {
  const { userId } = req.body;
  try {
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [userId]);
    res.json({ message: 'Account frozen.' });
  } catch (err) {
    res.status(500).json({ error: 'Error freezing account' });
  }
});

app.post('/api/unfreeze-account', async (req, res) => {
  const { userId } = req.body;
  try {
    await pool.query('UPDATE users SET is_active = TRUE WHERE id = $1', [userId]);
    res.json({ message: 'Account unfrozen.' });
  } catch (err) {
    res.status(500).json({ error: 'Error unfreezing account' });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const messages = await pool.query('SELECT m.id, m.message, m.created_at, u.username FROM messages m JOIN users u ON m.user_id = u.id ORDER BY m.created_at DESC');
    res.json(messages.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/send-message', async (req, res) => {
  const { userId, message } = req.body;
  try {
    await pool.query('INSERT INTO messages (user_id, message) VALUES ($1, $2)', [userId, message]);
    res.json({ message: 'Message sent successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Error saving message' });
  }
});

app.post('/api/verify-email', async (req, res) => {
  const { userId, token } = req.body;
  try {
    await pool.query('UPDATE users SET verified_email = TRUE WHERE id = $1 AND email_verification_token = $2', [userId, token]);
    res.json({ message: 'Email verified successfully!' });
  } catch (err) {
    res.status(500).json({ error: 'Error verifying email' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
