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
const readJSON = async (file) => JSON.parse(await fs.readFile(path.join(dataPath, `${file}.json`), 'utf8').catch(() => []));
const writeJSON = async (file, data) => await fs.writeFile(path.join(dataPath, `${file}.json`), JSON.stringify(data, null, 2));

// Middleware API Key
const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey) return res.status(401).json({ error: 'API Key required' });
  
  try {
    const keys = await readJSON('api-keys');
    const validKey = keys.find(k => k.key === apiKey);
    
    if (!validKey) return res.status(403).json({ error: 'Invalid API Key' });
    req.user = validKey.user;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Generate ID
const generateID = () => Math.random().toString(36).substr(2, 6).toUpperCase();

// Logging
const logAction = async (user, action) => {
  const logs = await readJSON('logs');
  logs.push({ 
    timestamp: new Date().toISOString(),
    user,
    action 
  });
  await writeJSON('logs', logs);
};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Manajemen Barang
app.post('/items', apiKeyAuth, async (req, res) => {
  try {
    const items = await readJSON('items');
    const existing = items.find(i => i.name === req.body.name);
    
    if(existing) {
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
      items.push(newItem);
      await logAction(req.user, `New item created: ${newItem.name}`);
    }
    
    await writeJSON('items', items);
    res.status(201).json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/items/:id', apiKeyAuth, async (req, res) => {
  try {
    const items = await readJSON('items');
    const item = items.find(i => i.id === req.params.id);
    
    if(!item) return res.status(404).send('Item not found');
    
    Object.assign(item, req.body);
    await writeJSON('items', items);
    await logAction(req.user, `Item updated: ${item.name}`);
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/items/:id', apiKeyAuth, async (req, res) => {
  try {
    let items = await readJSON('items');
    items = items.filter(i => i.id !== req.params.id);
    
    await writeJSON('items', items);
    await logAction(req.user, `Item deleted: ${req.params.id}`);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manajemen Penjualan
app.post('/sales', apiKeyAuth, async (req, res) => {
  try {
    const { buyer, items: saleItems } = req.body;
    const date = new Date();
    const salesFile = `sales-${date.getFullYear()}-${date.getMonth()+1}`;
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
    for(const item of saleItems) {
      const product = allItems.find(p => p.id === item.id);
      if(!product) throw new Error(`Item ${item.id} not found`);
      if(product.stock < item.qty) throw new Error(`Insufficient stock for ${product.name}`);
      
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
    res.status(201).json(sale);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Laporan
app.get('/reports/stock', apiKeyAuth, async (req, res) => {
  try {
    const items = await readJSON('items');
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/reports/popular', apiKeyAuth, async (req, res) => {
  try {
    const salesFiles = (await fs.readdir(dataPath))
      .filter(f => f.startsWith('sales-') && f.endsWith('.json'));
    
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/reports/top-customers', apiKeyAuth, async (req, res) => {
  try {
    const salesFiles = (await fs.readdir(dataPath))
      .filter(f => f.startsWith('sales-') && f.endsWith('.json'));
    
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
    res.status(500).json({ error: error.message });
  }
});

// Manajemen Toko
app.put('/store', apiKeyAuth, async (req, res) => {
  try {
    await writeJSON('store', req.body);
    await logAction(req.user, 'Store settings updated');
    res.json(req.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/store/logo', apiKeyAuth, upload.single('logo'), async (req, res) => {
  try {
    const store = await readJSON('store');
    store.logo = `/uploads/${req.file.filename}`;
    await writeJSON('store', store);
    res.json(store);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Inisialisasi
app.listen(port, async () => {
  console.log(`Server running at http://localhost:${port}`);
  
  // Buat direktori jika belum ada
  await fs.mkdir(dataPath, { recursive: true });
  await fs.mkdir('uploads', { recursive: true });
  
  // File inisialisasi
  const initialFiles = {
    'items': [],
    'logs': [],
    'store': {},
    'api-keys': [{ key: 'DEFAULT_KEY', user: 'admin' }]
  };
  
  for(const [file, data] of Object.entries(initialFiles)) {
    try {
      await readJSON(file);
    } catch {
      await writeJSON(file, data);
    }
  }
});
