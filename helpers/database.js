const fs = require('fs').promises;
const path = require('path');

const dataPath = path.join(__dirname, '../data');

const readJSON = async (file, defaultValue = []) => {
  try {
    const data = await fs.readFile(path.join(dataPath, `${file}.json`), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return defaultValue;
    throw error;
  }
};

const writeJSON = async (file, data) => {
  await fs.mkdir(path.dirname(path.join(dataPath, `${file}.json`)), { recursive: true });
  await fs.writeFile(path.join(dataPath, `${file}.json`), JSON.stringify(data, null, 2));
};

const initializeData = async () => {
  try {
    await fs.mkdir(dataPath, { recursive: true });
    await fs.mkdir('uploads', { recursive: true });
    await fs.mkdir(path.join(dataPath, 'reports/daily'), { recursive: true });
    await fs.mkdir(path.join(dataPath, 'reports/monthly'), { recursive: true });

    const initialFiles = {
      'items': [],
      'logs': [],
      'store': {},
      'api-keys': [{ key: 'DEFAULT_KEY', user: 'admin' }]
    };

    for(const [file, data] of Object.entries(initialFiles)) {
      try {
        await readJSON(file);
      } catch (error) {
        if (error.code === 'ENOENT') await writeJSON(file, data);
      }
    }
  } catch (error) {
    throw error;
  }
};

module.exports = { 
  readJSON, 
  writeJSON, 
  initializeData 
};