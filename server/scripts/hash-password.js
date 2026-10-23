// Хеш пароля для ADMIN_PASSWORD_HASH / BUYER_<DIR>_HASH. Запуск на машині власника: node scripts/hash-password.js
// Пароль вводиться з клавіатури (не потрапляє в історію команд); виводиться лише хеш - його кладуть у секрети Fly.
const readline = require('node:readline');
const { hashPassword } = require('../src/admin/auth');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Пароль (мінімум 4 символи): ', (pw) => {
  rl.close();
  pw = String(pw || '').trim();
  if (pw.length < 4) { console.error('PIN - мінімум 4 цифри'); process.exit(1); }
  console.log(hashPassword(pw));
});