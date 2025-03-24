const { readJSON } = require('../helpers/database');

const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  
  if (!apiKey) {
    return res.status(401).json({ status: false, error: 'API Key required' });
  }

  try {
    const keys = await readJSON('api-keys');
    const validKey = keys.find(k => k.key === apiKey);

    if (!validKey) {
      return res.status(403).json({ status: false, error: 'Invalid API Key' });
    }

    req.user = validKey.user;
    next();
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
};

module.exports = apiKeyAuth;