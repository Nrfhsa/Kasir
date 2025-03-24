const express = require('express');
const app = express();
const port = 3000;

require('./config/timezone');
const upload = require('./config/multer');

const itemsRouter = require('./routes/items');
const salesRouter = require('./routes/sales');
const stockRouter = require('./routes/stock');
const reportsRouter = require('./routes/reports');
const logsRouter = require('./routes/logs');
const storeRouter = require('./routes/store');

app.set('trust proxy', 1);
app.set('json spaces', 2);

app.use(express.json());
app.use('/uploads', express.static('uploads'));

app.use('/items', itemsRouter);
app.use('/sales', salesRouter);
app.use('/stock', stockRouter);
app.use('/reports', reportsRouter);
app.use('/logs', logsRouter);
app.use('/store', storeRouter);

app.listen(port, async () => {
  console.log(`Server running at http://localhost:${port}`);
  const { initializeData } = require('./helpers/database');
  await initializeData();
});