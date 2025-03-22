const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// In-memory database (gunakan database sesungguhnya untuk production)
let items = {};
let sales = [];
let adminSettings = {
  tax: 0.1 // contoh setting admin
};

// Middleware admin
const isAdmin = (req, res, next) => {
  const adminSecret = req.headers['admin-secret'];
  if (adminSecret === 'rahasiaadmin') {
    next();
  } else {
    res.status(403).json({ error: 'Akses ditolak' });
  }
};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Tambah barang
app.post('/items', isAdmin, (req, res) => {
  const { name, price, stock } = req.body;
  const id = uuidv4();
  items[id] = { id, name, price, stock: stock || 0 };
  res.json(items[id]);
});

// Hapus barang
app.delete('/items/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  if (!items[id]) return res.status(404).json({ error: 'Barang tidak ditemukan' });
  delete items[id];
  res.json({ message: 'Barang berhasil dihapus' });
});

// Set harga barang
app.put('/items/:id/price', isAdmin, (req, res) => {
  const { id } = req.params;
  const { price } = req.body;
  if (!items[id]) return res.status(404).json({ error: 'Barang tidak ditemukan' });
  items[id].price = price;
  res.json(items[id]);
});

// Data penjualan perbulan
app.get('/sales', (req, res) => {
  const { month, year } = req.query;
  const filteredSales = sales.filter(sale => {
    const saleDate = new Date(sale.timestamp);
    return saleDate.getMonth() + 1 === Number(month) && 
           saleDate.getFullYear() === Number(year);
  });
  res.json(filteredSales);
});

// Stok barang
app.get('/stock', (req, res) => {
  res.json(Object.values(items).map(({ id, name, stock }) => ({ id, name, stock })));
});

// Barang paling populer
app.get('/popular', (req, res) => {
  const popularity = {};
  sales.forEach(sale => {
    sale.items.forEach(item => {
      popularity[item.id] = (popularity[item.id] || 0) + item.quantity;
    });
  });
  
  const popular = Object.entries(popularity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({
      item: items[id],
      totalSold: count
    }));
  
  res.json(popular);
});

// Transaksi baru
app.post('/sales', (req, res) => {
  const { buyerName, items: saleItems } = req.body;
  const timestamp = new Date();
  
  // Validasi stok
  for (const item of saleItems) {
    if (!items[item.id] || items[item.id].stock < item.quantity) {
      return res.status(400).json({ error: `Stok ${item.name} tidak cukup` });
    }
  }
  
  // Kurangi stok
  saleItems.forEach(item => {
    items[item.id].stock -= item.quantity;
  });
  
  const total = saleItems.reduce((sum, item) => {
    return sum + (items[item.id].price * item.quantity);
  }, 0);
  
  const sale = {
    id: uuidv4(),
    buyerName,
    items: saleItems,
    total,
    timestamp,
  };
  
  sales.push(sale);
  res.json(sale);
});

// Top pembeli
app.get('/top-buyers', (req, res) => {
  const buyers = {};
  sales.forEach(sale => {
    buyers[sale.buyerName] = (buyers[sale.buyerName] || 0) + sale.total;
  });
  
  const topBuyers = Object.entries(buyers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, total]) => ({ name, total }));
  
  res.json(topBuyers);
});

// Menu admin
app.get('/admin', isAdmin, (req, res) => {
  res.json({
    totalItems: Object.keys(items).length,
    totalSales: sales.length,
    totalRevenue: sales.reduce((sum, sale) => sum + sale.total, 0),
    settings: adminSettings
  });
});

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});