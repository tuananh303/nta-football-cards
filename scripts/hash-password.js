// Tạo chuỗi băm bcrypt cho mật khẩu admin để dán vào ADMIN_PASSWORD_HASH.
// Cách dùng: npm run hash-password -- "mat-khau-cua-ban"
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('Hãy nhập mật khẩu dài ít nhất 8 ký tự: npm run hash-password -- "mat-khau"');
  process.exit(1);
}
console.log(bcrypt.hashSync(password, 12));
