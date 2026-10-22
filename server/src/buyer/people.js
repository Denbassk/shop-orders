// Закупниці і їхні напрямки: одне посилання - одна людина. bakery - ВК; hlib - хліб Рома, НБХЗ і овочі (одна закупниця).
const BUYERS = {
  bakery: { title: 'Випічка і кулінарія', dirs: ['bakery'] },
  hlib: { title: 'Хліб Рома, НБХЗ, Овочі', dirs: ['bread', 'nbhz', 'veg'] },
};
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function buyerOf(code) { return own(BUYERS, String(code)) ? BUYERS[String(code)] : null; }

// напрямок запиту: лише зі списку закупниці; не вказано -> перший
function dirOf(code, dir) {
  const b = buyerOf(code);
  if (!b) return null;
  if (dir === undefined || dir === null || dir === '') return b.dirs[0];
  return b.dirs.includes(String(dir)) ? String(dir) : null;
}

module.exports = { BUYERS, buyerOf, dirOf };