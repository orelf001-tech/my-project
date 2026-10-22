// Public connection details for the encrypted mailbox (Supabase).
// Both values are public by design: the publishable key only allows calling
// form_open / form_submit, and everything submitted is encrypted in the browser.
window.CASHFLOW_CONFIG = {
  supabaseUrl: '',
  supabaseKey: ''
};
