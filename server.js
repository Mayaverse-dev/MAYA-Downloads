require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data', 'downloads.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function checkAdmin(req) {
  const pw = req.headers['x-admin-password'] || req.query.pw;
  return pw && pw === process.env.ADMIN_PASSWORD;
}

async function readData() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

async function writeData(data) {
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/wallpapers', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wallpapers.html'));
});
app.get('/ebook', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ebook.html'));
});
app.get('/stl', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'stl.html'));
});

app.get('/api/downloads', async (req, res) => {
  try {
    const data = await readData();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load downloads' });
  }
});

app.get('/api/admin/downloads', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await readData();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load' });
  }
});

app.post('/api/admin/downloads', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await readData();
    const body = req.body;
    const item = {
      id: uuidv4(),
      title: body.title,
      description: body.description,
      category: body.category,
      thumbnailUrl: body.thumbnailUrl || '',
      variants: body.variants || [],
      tags: body.tags || [],
      chapter: body.chapter,
      createdAt: new Date().toISOString(),
    };
    data.unshift(item);
    await writeData(data);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: 'Failed to save' });
  }
});

app.delete('/api/admin/downloads', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.body;
    let data = await readData();
    data = data.filter((i) => i.id !== id);
    await writeData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.listen(PORT, () => {
  console.log('MAYA Downloads running at http://localhost:' + PORT);
});
