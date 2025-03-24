const moment = require('../config/timezone'); 
const { readJSON } = require('./database');

const generatePurchaseID = async () => {
  const now = moment();
  const formattedDate = now.format('DDMMYY');
  const today = now.format('YYYY-MM-DD');
  const dailyReportFile = `reports/daily/${today}`;

  try {
    const dailyReport = await readJSON(dailyReportFile);
    const orderNumber = dailyReport.transactions ? dailyReport.transactions.length + 1 : 1;
    return `${formattedDate}${orderNumber.toString().padStart(3, '0')}`;
  } catch (error) {
    return `${formattedDate}001`;
  }
};

module.exports = { 
  generatePurchaseID 
};