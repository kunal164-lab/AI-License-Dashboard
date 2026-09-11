// The single money-formatting function every page should use, so the
// application's configured display currency (src/pages/Cost.jsx,
// GET /api/settings/currency) is shown consistently everywhere instead of
// each page hardcoding its own '$' + toLocaleString().
export const SUPPORTED_CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AUD', 'NZD', 'CAD']

const SYMBOLS = { USD: '$', GBP: '£', EUR: '€', INR: '₹', AUD: 'A$', NZD: 'NZ$', CAD: 'C$' }

export function formatMoney(amount, currency = 'USD', { maximumFractionDigits = 0 } = {}) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return 'N/A'
  const code = currency || 'USD'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits }).format(Number(amount))
  } catch (e) {
    // Intl throws on an unrecognized currency code — fall back to a plain
    // symbol-prefixed number rather than crashing the page over a typo'd
    // admin-entered currency code.
    const symbol = SYMBOLS[code] || code + ' '
    return symbol + Number(amount).toLocaleString(undefined, { maximumFractionDigits })
  }
}
