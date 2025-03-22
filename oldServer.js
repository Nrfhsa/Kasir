const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const app = express();
const port = 3000;

app.set('trust proxy', 1);
app.set('json spaces', 2);

// Konfigurasi
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Helper functions
const dataPath = path.join(__dirname, 'data');
const readJSON = async (file) => {
  try {
    const data = await fs.readFile(path.join(dataPath, `${file}.json`), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const writeJSON = async (file, data) => {
  await fs.writeFile(path.join(dataPath, `${file}.json`), JSON.stringify(data, null, 2));
};

// Middleware API Key
const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  console.log(`[AUTH] Checking API Key: ${apiKey}`);

  if (!apiKey) {
    console.log('[AUTH] No API Key provided');
    return res.status(401).json({ error: 'API Key required' });
  }

  try {
    const keys = await readJSON('api-keys');
    const validKey = keys.find(k => k.key === apiKey);

    if (!validKey) {
      console.log('[AUTH] Invalid API Key');
      return res.status(403).json({ error: 'Invalid API Key' });
    }

    req.user = validKey.user;
    console.log(`[AUTH] Authenticated user: ${validKey.user}`);
    next();
  } catch (error) {
    console.error('[AUTH ERROR]', error);
    res.status(500).json({ error: error.message });
  }
};

// Generate ID
const generateID = () => {
  const id = Math.random().toString(36).substr(2, 6).toUpperCase();
  console.log(`[GENERATE ID] New ID: ${id}`);
  return id;
};

// Logging
const logAction = async (user, action) => {
  console.log(`[LOG ACTION] User: ${user}, Action: ${action}`);
  try {
    const logs = await readJSON('logs');
    logs.push({ 
      timestamp: new Date().toISOString(),
      user,
      action 
    });
    await writeJSON('logs', logs);
  } catch (error) {
    console.error('[LOG ACTION ERROR]', error);
  }
};

// Routes
app.get('/items/:id', apiKeyAuth, async (req, res) => {
  console.log(`[GET ITEM] ID: ${req.params.id}`);
  try {
    const items = await readJSON('items');
    const item = items.find(i => i.id === req.params.id);

    if (!item) {
      console.log(`[GET ITEM] Item not found: ${req.params.id}`);
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(item);
  } catch (error) {
    console.error('[GET ITEM ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/items', apiKeyAuth, async (req, res) => {
  console.log('[CREATE ITEM] Request body:', req.body);
  try {
    const items = await readJSON('items');
    const existing = items.find(i => i.name === req.body.name);

    if(existing) {
      console.log(`[CREATE ITEM] Updating stock for: ${existing.name}`);
      existing.stock += parseInt(req.body.stock) || 0;
      await logAction(req.user, `Stock updated for ${existing.name}`);
    } else {
      const newItem = {
        id: generateID(),
        ...req.body,
        photo: null,
        discount: 0,
        stock: parseInt(req.body.stock) || 0
      };
      console.log(`[CREATE ITEM] New item created: ${newItem.name}`);
      items.push(newItem);
      await logAction(req.user, `New item created: ${newItem.name}`);
    }

    await writeJSON('items', items);
    res.status(201).json(items);
  } catch (error) {
    console.error('[CREATE ITEM ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/items/:id', apiKeyAuth, async (req, res) => {
  console.log(`[UPDATE ITEM] ID: ${req.params.id}, Body:`, req.body);
  try {
    const items = await readJSON('items');
    const item = items.find(i => i.id === req.params.id);

    if(!item) {
      console.log(`[UPDATE ITEM] Item not found: ${req.params.id}`);
      return res.status(404).json({ error: 'Item not found' });
    }

    Object.assign(item, req.body);
    await writeJSON('items', items);
    await logAction(req.user, `Item updated: ${item.name}`);
    res.json(item);
  } catch (error) {
    console.error('[UPDATE ITEM ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/items/:id', apiKeyAuth, async (req, res) => {
  console.log(`[DELETE ITEM] ID: ${req.params.id}`);
  try {
    let items = await readJSON('items');
    const initialLength = items.length;
    items = items.filter(i => i.id !== req.params.id);

    if(items.length === initialLength) {
      console.log(`[DELETE ITEM] Item not found: ${req.params.id}`);
      return res.status(404).json({ error: 'Item not found' });
    }

    await writeJSON('items', items);
    await logAction(req.user, `Item deleted: ${req.params.id}`);
    res.status(204).send();
  } catch (error) {
    console.error('[DELETE ITEM ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/sales', apiKeyAuth, async (req, res) => {
  console.log('[CREATE SALE] Request body:', req.body);
  try {
    const { buyer, items: saleItems } = req.body;

    if (!buyer || !saleItems || !Array.isArray(saleItems)) {
      console.log('[CREATE SALE] Invalid request format');
      return res.status(400).json({ error: 'Invalid request format' });
    }

    const date = new Date();
    const salesFile = `sales-${date.getFullYear()}-${date.getMonth()+1}`;
    console.log(`[CREATE SALE] Using sales file: ${salesFile}`);

    const store = await readJSON('store');
    const sale = {
      id: uuidv4(),
      timestamp: date.toISOString(),
      cashier: store.cashier || 'Unknown',
      buyer,
      items: [],
      total: 0
    };

    const allItems = await readJSON('items');
    for (const item of saleItems) {
      console.log(`[CREATE SALE] Processing item: ${item.id}`);
      const product = allItems.find(p => p.id === item.id);

      if (!product) {
        console.log(`[CREATE SALE] Item not found: ${item.id}`);
        return res.status(400).json({ error: `Item ${item.id} not found` });
      }

      if (product.stock < item.qty) {
        console.log(`[CREATE SALE] Insufficient stock for: ${product.name}`);
        return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
      }

      product.stock -= item.qty;
      const price = product.price * (1 - (product.discount/100));
      sale.items.push({
        ...item,
        name: product.name,
        price,
        total: item.qty * price
      });
      sale.total += item.qty * price;
    }

    const sales = await readJSON(salesFile);
    sales.push(sale);

    await Promise.all([
      writeJSON('items', allItems),
      writeJSON(salesFile, sales)
    ]);

    await logAction(req.user, `New sale: ${sale.id}`);
    console.log(`[CREATE SALE] Success: ${sale.id}`);
    res.status(201).json(sale);
  } catch (error) {
    console.error('[CREATE SALE ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/reports/stock', apiKeyAuth, async (req, res) => {
  console.log('[REPORT STOCK] Request received');
  try {
    const items = await readJSON('items');
    res.json(items);
  } catch (error) {
    console.error('[REPORT STOCK ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/reports/popular', apiKeyAuth, async (req, res) => {
  console.log('[REPORT POPULAR] Request received');
  try {
    const files = await fs.readdir(dataPath);
    const salesFiles = files.filter(f => f.startsWith('sales-') && f.endsWith('.json'));
    console.log(`[REPORT POPULAR] Found ${salesFiles.length} sales files`);

    const allSales = [];
    for(const file of salesFiles) {
      const sales = await readJSON(path.parse(file).name);
      allSales.push(...sales);
    }

    const itemCounts = allSales.reduce((acc, sale) => {
      sale.items.forEach(item => {
        acc[item.id] = (acc[item.id] || 0) + item.qty;
      });
      return acc;
    }, {});

    const popularItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    res.json(popularItems);
  } catch (error) {
    console.error('[REPORT POPULAR ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/reports/top-customers', apiKeyAuth, async (req, res) => {
  console.log('[REPORT TOP CUSTOMERS] Request received');
  try {
    const files = await fs.readdir(dataPath);
    const salesFiles = files.filter(f => f.startsWith('sales-') && f.endsWith('.json'));
    console.log(`[REPORT TOP CUSTOMERS] Found ${salesFiles.length} sales files`);

    const allSales = [];
    for(const file of salesFiles) {
      const sales = await readJSON(path.parse(file).name);
      allSales.push(...sales);
    }

    const customerSpending = allSales.reduce((acc, sale) => {
      acc[sale.buyer] = (acc[sale.buyer] || 0) + sale.total;
      return acc;
    }, {});

    const topCustomers = Object.entries(customerSpending)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    res.json(topCustomers);
  } catch (error) {
    console.error('[REPORT TOP CUSTOMERS ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/store', apiKeyAuth, async (req, res) => {
  console.log('[UPDATE STORE] Request body:', req.body);
  try {
    await writeJSON('store', req.body);
    await logAction(req.user, 'Store settings updated');
    console.log('[UPDATE STORE] Success');
    res.json(req.body);
  } catch (error) {
    console.error('[UPDATE STORE ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/store/logo', apiKeyAuth, upload.single('logo'), async (req, res) => {
  console.log('[UPLOAD LOGO] File received:', req.file);
  try {
    const store = await readJSON('store');
    store.logo = `/uploads/${req.file.filename}`;
    await writeJSON('store', store);
    console.log('[UPLOAD LOGO] Success');
    res.json(store);
  } catch (error) {
    console.error('[UPLOAD LOGO ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/logs', apiKeyAuth, async (req, res) => {
  console.log('[GET LOGS] Request received');
  try {
    const logs = await readJSON('logs');
    res.json(logs);
  } catch (error) {
    console.error('[GET LOGS ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

// Inisialisasi
app.listen(port, async () => {
  console.log(`Server running at http://localhost:${port}`);

  try {
    await fs.mkdir(dataPath, { recursive: true });
    console.log('[INIT] Created data directory');
    await fs.mkdir('uploads', { recursive: true });
    console.log('[INIT] Created uploads directory');

    const initialFiles = {
      'items': [],
      'logs': [],
      'store': {},
      'api-keys': [{ key: 'DEFAULT_KEY', user: 'admin' }]
    };

    for(const [file, data] of Object.entries(initialFiles)) {
      try {
        await readJSON(file);
        console.log(`[INIT] File ${file}.json already exists`);
      } catch (error) {
        if (error.code === 'ENOENT') {
          await writeJSON(file, data);
          console.log(`[INIT] Created ${file}.json`);
        }
      }
    }
  } catch (error) {
    console.error('[INIT ERROR]', error);
    process.exit(1);
  }
});