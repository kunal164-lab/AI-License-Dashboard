// Formula-injection mitigation (CWE-1236), shared by every export format
// (CSV: csvReport.js, Excel: excelReport.js). A string cell starting with
// =, +, -, @, or a leading tab/CR is treated by Excel/LibreOffice/Google
// Sheets as the start of a formula — every exported field ultimately
// traces back to Microsoft Graph profile data, Freshservice records, or a
// manually-uploaded CSV (never something this app itself generates), so
// any of them could carry such a value, deliberately or not. The standard,
// OWASP-recommended mitigation: prefix the value with a single leading
// apostrophe, which every spreadsheet application renders as the literal
// text (apostrophe stripped from display) rather than evaluating it as a
// formula. Only strings are touched — numbers/booleans/dates/null pass
// through unchanged.
export function neutralizeFormula(v) {
  if (typeof v !== 'string') return v
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v
}
