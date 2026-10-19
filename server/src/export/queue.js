// Фонова вигрузка після відповіді продавцю: один відкладений запуск на напрямок (коалесценція, не скидання таймера:
// постійний потік замовлень не відкладає вигрузку безкінечно). Помилку логуємо - невигружене підхопить /jobs/tick.
function createExportQueue({ run, delayMs = 2000, setTimer = (fn, ms) => setTimeout(fn, ms) }) {
  const pending = new Set();
  return function queueExport(dirKey) {
    if (pending.has(dirKey)) return;
    pending.add(dirKey);
    setTimer(() => {
      pending.delete(dirKey);                       // нові замовлення під час запуску заплановані окремо
      Promise.resolve().then(() => run(dirKey))
        .catch((e) => console.error('вигрузка ' + dirKey + ' не вдалась (довигрузить tick): ' + e.message));
    }, delayMs);
  };
}

// без налаштованого оточення (тести api) - нічого не робить
function queueExport(dirKey) { void dirKey; }

module.exports = { createExportQueue, queueExport };
