// Секретні посилання закупниць: node scripts/buyer-links.js [адреса]. Посилання НЕ для чату - лише закупниці особисто.
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (e) { /* .env може не бути (Fly) */ }
const { buyerLinks } = require('../src/buyer/link');
const { DIRECTIONS } = require('../src/directions');
const secret = process.env.BUYER_LINK_SECRET || '';
if (!secret) { console.error('BUYER_LINK_SECRET не задано (.env або секрет Fly)'); process.exit(1); }
const base = process.argv[2] || process.env.PUBLIC_URL || 'http://localhost:3000';
for (const [d, url] of Object.entries(buyerLinks(base, secret))) console.log((DIRECTIONS[d].title || d) + ': ' + url);