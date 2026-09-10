function checkLogo() {
  try {
    var s = LOGO_DATA_URI;
    console.log('Довжина: ' + s.length);
    console.log('Початок: ' + s.slice(0, 40));
    console.log(s.indexOf('data:image/') === 0 ? 'OK — формат правильний' : 'ПОМИЛКА формату');
  } catch (e) {
    console.log('LOGO_DATA_URI не існує: ' + e.message);
  }
}
