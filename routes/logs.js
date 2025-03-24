const express = require('express');
const router = express.Router();
const { readJSON } = require('../helpers/database');
const apiKeyAuth = require('../middleware/auth');

router.get('/', apiKeyAuth, async (req, res) => {
  console.log('[GET LOGS] Request received');
  try {
    const logs = await readJSON('logs');
    res.json({ status: true, data: logs });
  } catch (error) {
    console.error('[GET LOGS ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

module.exports = router;