const fetch = global.fetch || require('node-fetch');
const data = {
  fullName: 'ทดสอบ ชื่อ',
  position: 'ฝ่ายแผนงาน',
  role: '0',
  username: 'testreg1',
  password: 'abc123'
};
(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/register', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    });
    console.log('status', res.status);
    const text = await res.text();
    console.log(text);
  } catch (err) {
    console.error('ERROR', err);
  }
})();
