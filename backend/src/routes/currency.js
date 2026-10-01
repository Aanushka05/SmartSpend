// src/routes/currency.js
// Live + cached exchange rates via exchangerate-api.com

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');

// In-memory cache (TTL: 1 hour)
let ratesCache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'MXN', 'SGD', 'HKD', 'NZD'];

// Fallback static rates (used if API key not configured)
const STATIC_RATES = {
  USD: 1.000, EUR: 0.921, GBP: 0.789, INR: 83.12, JPY: 149.50,
  CAD: 1.364, AUD: 1.532, CHF: 0.899, CNY: 7.240, MXN: 17.15,
  SGD: 1.348, HKD: 7.820, NZD: 1.628,
};

async function fetchRates() {
  const apiKey = process.env.CURRENCY_API_KEY;
  const baseUrl = process.env.CURRENCY_API_URL || 'https://v6.exchangerate-api.com/v6';

  if (!apiKey || apiKey === 'your_api_key_here') {
    // Return static rates as fallback
    return { rates: STATIC_RATES, source: 'static', updatedAt: new Date().toISOString() };
  }

  if (ratesCache && Date.now() < cacheExpiry) {
    return ratesCache;
  }

  try {
    const fetch = require('node-fetch');
    const response = await fetch(`${baseUrl}/${apiKey}/latest/USD`, { timeout: 5000 });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json();
    if (data.result !== 'success') throw new Error(data['error-type']);

    const rates = {};
    for (const cur of SUPPORTED_CURRENCIES) {
      if (data.conversion_rates[cur]) rates[cur] = data.conversion_rates[cur];
    }

    ratesCache = { rates, source: 'live', updatedAt: new Date().toISOString() };
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return ratesCache;
  } catch (err) {
    console.error('[Currency] API fetch failed, using static rates:', err.message);
    return { rates: STATIC_RATES, source: 'static', updatedAt: new Date().toISOString() };
  }
}

// ── GET /api/currency/rates ───────────────────────────────────────────
router.get('/rates', requireAuth, async (req, res) => {
  try {
    const data = await fetchRates();
    res.json({ ...data, currencies: SUPPORTED_CURRENCIES });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exchange rates.' });
  }
});

// ── GET /api/currency/convert ─────────────────────────────────────────
// ?amount=100&from=USD&to=EUR
router.get('/convert', requireAuth, async (req, res) => {
  const { amount, from = 'USD', to = 'USD' } = req.query;

  if (!amount || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: 'Valid amount required.' });
  }
  if (!SUPPORTED_CURRENCIES.includes(from) || !SUPPORTED_CURRENCIES.includes(to)) {
    return res.status(400).json({ error: 'Unsupported currency.', supported: SUPPORTED_CURRENCIES });
  }

  try {
    const { rates } = await fetchRates();
    const amountUSD = parseFloat(amount) / rates[from];
    const converted = amountUSD * rates[to];

    res.json({
      from,
      to,
      amount: parseFloat(amount),
      converted: parseFloat(converted.toFixed(6)),
      rate: parseFloat((rates[to] / rates[from]).toFixed(6)),
    });
  } catch (err) {
    res.status(500).json({ error: 'Conversion failed.' });
  }
});

module.exports = router;
