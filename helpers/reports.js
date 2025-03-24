const moment = require('../config/timezone');
const { 
    readJSON, 
    writeJSON 
} = require('./database');

const createDailyReport = async (transaction) => {
  const today = moment().format('YYYY-MM-DD');
  const dailyReportFile = `reports/daily/${today}`;

  let dailyReport = await readJSON(dailyReportFile);
  if (!dailyReport || Array.isArray(dailyReport)) {
    dailyReport = {
      date: today,
      totalRevenue: 0,
      transactionCount: 0,
      transactions: []
    };
  }

  dailyReport.transactions.push(transaction);
  dailyReport.totalRevenue = dailyReport.transactions.reduce((sum, t) => sum + t.total, 0);
  dailyReport.transactionCount = dailyReport.transactions.length;

  await writeJSON(dailyReportFile, dailyReport);
  await updateMonthlyReport(transaction);
  
  return dailyReport;
};

const updateMonthlyReport = async (transaction) => {
  const yearMonth = moment().format('YYYY-MM');
  const monthlyReportFile = `reports/monthly/${yearMonth}`;

  let monthlyReport = await readJSON(monthlyReportFile);
  if (!monthlyReport || !monthlyReport.transactions) {
    monthlyReport = {
      yearMonth,
      totalRevenue: 0,
      transactionCount: 0,
      topCustomers: [],
      popularItems: {},
      transactions: []
    };
  }

  monthlyReport.transactions.push(transaction);
  monthlyReport.totalRevenue = monthlyReport.transactions.reduce((sum, t) => sum + t.total, 0);
  monthlyReport.transactionCount = monthlyReport.transactions.length;

  await writeJSON(monthlyReportFile, monthlyReport);
  return monthlyReport;
};

module.exports = { 
  createDailyReport, 
  updateMonthlyReport 
};