const moment = require('../config/timezone'); 
const { 
    readJSON, 
    writeJSON 
} = require('./database');

const logAction = async (user, action) => {
  const logs = await readJSON('logs');
  logs.push({ 
    timestamp: moment().format(),
    user,
    action 
  });
  await writeJSON('logs', logs);
};

module.exports = { 
  logAction 
};