const express = require('express');
const router = express.Router();
const { 
    readJSON, 
    writeJSON 
} = require('../helpers/database');
const { logAction } = require('../helpers/logger');
const apiKeyAuth = require('../middleware/auth');
const upload = require('../config/multer');

router.put('/', apiKeyAuth, async (req, res) => {
  console.log('[UPDATE STORE] Request body:', req.body);
  try {
    await writeJSON('store', req.body);
    await logAction(req.user, 'Store settings updated');
    console.log('[UPDATE STORE] Success');
    res.json({ status: true, data: req.body });
  } catch (error) {
    console.error('[UPDATE STORE ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

router.post('/logo', apiKeyAuth, upload.single('logo'), async (req, res) => {
  console.log('[UPLOAD LOGO] File received:', req.file);
  try {
    const store = await readJSON('store');
    store.logo = `/uploads/${req.file.filename}`;
    await writeJSON('store', store);
    console.log('[UPLOAD LOGO] Success');
    res.json({ status: true, data: store });
  } catch (error) {
    console.error('[UPLOAD LOGO ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

module.exports = router;