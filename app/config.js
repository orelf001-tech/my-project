// Public connection details. None of these are secrets: the publishable key is designed to be
// shipped to browsers, and every row is protected by row-level security + MFA on the server.
window.CASHFLOW_CONFIG = {
  supabaseUrl: 'https://hoyymkdvzltckgcaivzw.supabase.co',
  supabaseKey: 'sb_publishable_JCsl8LZg9EUp7NaoFZQikQ_DcOnHDk2',
  // Where clients open their form (public GitHub Pages site)
  formUrl: 'https://orelf001-tech.github.io/my-project/form/'
};
