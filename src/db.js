// Lớp truy cập cơ sở dữ liệu. Chọn loại bằng biến DB_CLIENT trong .env:
// - mssql  : SQL Server (cơ sở dữ liệu chính của dự án)
// - mysql  : MySQL / MariaDB
// - sqlite : SQLite tích hợp của Node (mặc định, chỉ để chạy thử nhanh, cần Node 22.5+)
// Các câu SQL trong ứng dụng dùng dấu ? làm tham số và chỉ dùng cú pháp chung cho cả ba loại.
const path = require('path');
const fs = require('fs');

// Cột dùng chung; mỗi loại CSDL chỉ khác kiểu chữ, khóa tự tăng và kiểu văn bản dài
function schema({ str, id, text, extra = '' }) {
  return `(
  id ${id},
  player_name ${str(160)} NOT NULL,
  team ${str(160)} NOT NULL DEFAULT '',
  season ${str(40)} NOT NULL DEFAULT '',
  year INT NULL,
  manufacturer ${str(120)} NOT NULL DEFAULT '',
  set_name ${str(160)} NOT NULL DEFAULT '',
  card_number ${str(40)} NOT NULL DEFAULT '',
  rarity ${str(20)} NOT NULL DEFAULT 'common',
  card_condition ${str(20)} NOT NULL DEFAULT 'good',
  est_value BIGINT NOT NULL DEFAULT 0,
  acquired_date ${str(10)} NOT NULL DEFAULT '',
  source ${str(200)} NOT NULL DEFAULT '',
  notes ${text} NULL,
  tags ${text} NULL,
  favorite TINYINT NOT NULL DEFAULT 0,
  on_banner TINYINT NOT NULL DEFAULT 0,
  category ${str(20)} NOT NULL DEFAULT 'card',
  signed TINYINT NOT NULL DEFAULT 0,
  extra ${text} NULL,
  gallery ${text} NULL,
  front_image ${str(80)} NOT NULL,
  front_w INT NOT NULL DEFAULT 0,
  front_h INT NOT NULL DEFAULT 0,
  back_image ${str(80)} NULL,
  back_w INT NOT NULL DEFAULT 0,
  back_h INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
)${extra}`;
}

// Các cột thêm sau phiên bản đầu: tự bổ sung vào bảng cards đã có (không mất dữ liệu).
// category: card | jersey | poster | figure; signed: có chữ ký; extra: thông tin riêng theo loại (JSON);
// gallery: danh sách ảnh của áo/poster/tượng (JSON)
function upgradeColumns({ str, text }) {
  return [
    ['on_banner', 'TINYINT NOT NULL DEFAULT 0'],
    ['category', `${str(20)} NOT NULL DEFAULT 'card'`],
    ['signed', 'TINYINT NOT NULL DEFAULT 0'],
    ['extra', `${text} NULL`],
    ['gallery', `${text} NULL`]
  ];
}

// Bảng slide của banner đầu trang. kind: 'image' (ảnh nền) hoặc 'cards' (thẻ xòe);
// card_ids: danh sách id thẻ dạng JSON, tối đa 3
function slidesSchema({ str, id, extra = '' }) {
  return `(
  id ${id},
  kind ${str(10)} NOT NULL DEFAULT 'cards',
  title ${str(160)} NOT NULL,
  subtitle ${str(400)} NOT NULL DEFAULT '',
  button_label ${str(60)} NOT NULL DEFAULT '',
  button_link ${str(300)} NOT NULL DEFAULT '',
  image ${str(80)} NULL,
  image_w INT NOT NULL DEFAULT 0,
  image_h INT NOT NULL DEFAULT 0,
  card_ids ${str(100)} NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
)${extra}`;
}

// ---------- SQL Server ----------
async function initMssql() {
  const sql = require('mssql');
  const pool = await new sql.ConnectionPool({
    server: process.env.DB_HOST || 'localhost',
    // Có DB_INSTANCE (VD: TUANANH) thì tìm cổng qua dịch vụ SQL Browser, không cần DB_PORT
    port: process.env.DB_INSTANCE ? undefined : Number(process.env.DB_PORT || 1433),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    pool: { max: 5 },
    options: {
      instanceName: process.env.DB_INSTANCE || undefined,
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
    }
  }).connect();

  // N'...' để cột có giá trị mặc định là chuỗi Unicode
  await pool.request().query(`IF OBJECT_ID(N'dbo.cards', N'U') IS NULL CREATE TABLE dbo.cards ${schema({
    str: (n) => `NVARCHAR(${n})`,
    id: 'INT IDENTITY(1,1) PRIMARY KEY',
    text: 'NVARCHAR(MAX)'
  })}`);
  // Nâng cấp bảng tạo từ phiên bản cũ
  for (const [col, def] of upgradeColumns({ str: (n) => `NVARCHAR(${n})`, text: 'NVARCHAR(MAX)' })) {
    const typed = def.replace(/DEFAULT (\S+)$/, `CONSTRAINT DF_cards_${col} DEFAULT $1`);
    await pool.request().query(`IF COL_LENGTH(N'dbo.cards', N'${col}') IS NULL ALTER TABLE dbo.cards ADD ${col} ${typed}`);
  }
  await pool.request().query(`IF OBJECT_ID(N'dbo.slides', N'U') IS NULL CREATE TABLE dbo.slides ${slidesSchema({
    str: (n) => `NVARCHAR(${n})`,
    id: 'INT IDENTITY(1,1) PRIMARY KEY'
  })}`);

  // Đổi dấu ? thành @p0, @p1… và gán kiểu: số nguyên lớn (giá trị VNĐ, mốc thời gian) dùng BIGINT
  function prepare(text, params) {
    const req = pool.request();
    let i = 0;
    const query = text.replace(/\?/g, () => `@p${i++}`);
    params.forEach((v, k) => {
      if (typeof v === 'number' && Number.isInteger(v)) req.input(`p${k}`, Math.abs(v) > 2147483647 ? sql.BigInt : sql.Int, v);
      else if (typeof v === 'number') req.input(`p${k}`, sql.Float, v);
      else req.input(`p${k}`, sql.NVarChar, v);
    });
    return { req, query };
  }

  return {
    kind: 'mssql',
    all: async (text, params = []) => {
      const { req, query } = prepare(text, params);
      const res = await req.query(query);
      // SQL Server trả BIGINT dạng chuỗi: đổi lại thành số
      const bigCols = Object.values(res.recordset?.columns || {}).filter((c) => c.type === sql.BigInt).map((c) => c.name);
      return (res.recordset || []).map((row) => {
        bigCols.forEach((c) => { if (row[c] != null) row[c] = Number(row[c]); });
        return row;
      });
    },
    run: async (text, params = []) => {
      const isInsert = /^\s*INSERT/i.test(text);
      const { req, query } = prepare(isInsert ? `${text}; SELECT CAST(SCOPE_IDENTITY() AS INT) AS id` : text, params);
      const res = await req.query(query);
      return { id: isInsert ? res.recordset[0].id : 0, changes: res.rowsAffected[0] || 0 };
    }
  };
}

// ---------- MySQL ----------
async function initMysql() {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    connectionLimit: 5,
    supportBigNumbers: true,
    bigNumberStrings: false
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS cards ${schema({
    str: (n) => `VARCHAR(${n})`,
    id: 'INT AUTO_INCREMENT PRIMARY KEY',
    text: 'TEXT',
    extra: ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  })}`);
  // Nâng cấp bảng cũ (lỗi 1060 = cột đã có)
  for (const [col, def] of upgradeColumns({ str: (n) => `VARCHAR(${n})`, text: 'TEXT' })) {
    await pool.query(`ALTER TABLE cards ADD COLUMN ${col} ${def}`)
      .catch((err) => { if (err.errno !== 1060) throw err; });
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS slides ${slidesSchema({
    str: (n) => `VARCHAR(${n})`,
    id: 'INT AUTO_INCREMENT PRIMARY KEY',
    extra: ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  })}`);
  return {
    kind: 'mysql',
    all: async (text, params = []) => (await pool.query(text, params))[0],
    run: async (text, params = []) => {
      const [res] = await pool.query(text, params);
      return { id: res.insertId, changes: res.affectedRows };
    }
  };
}

// ---------- SQLite (chạy thử) ----------
async function initSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  const file = path.resolve(process.env.SQLITE_FILE || './data/dev.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS cards ${schema({
    str: (n) => `VARCHAR(${n})`,
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    text: 'TEXT'
  })}`);
  // Nâng cấp bảng cũ
  const have = new Set(db.prepare('PRAGMA table_info(cards)').all().map((c) => c.name));
  for (const [col, def] of upgradeColumns({ str: (n) => `VARCHAR(${n})`, text: 'TEXT' })) {
    if (!have.has(col)) db.exec(`ALTER TABLE cards ADD COLUMN ${col} ${def}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS slides ${slidesSchema({
    str: (n) => `VARCHAR(${n})`,
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT'
  })}`);
  return {
    kind: 'sqlite',
    all: async (text, params = []) => db.prepare(text).all(...params),
    run: async (text, params = []) => {
      const res = db.prepare(text).run(...params);
      return { id: Number(res.lastInsertRowid), changes: res.changes };
    }
  };
}

let driver = null;

async function init() {
  const client = (process.env.DB_CLIENT || 'sqlite').toLowerCase();
  const inits = { mssql: initMssql, mysql: initMysql, sqlite: initSqlite };
  if (!inits[client]) throw new Error(`DB_CLIENT không hợp lệ: ${client} (chọn mssql, mysql hoặc sqlite)`);
  driver = await inits[client]();
  console.log(`[db] Đang dùng ${driver.kind}`);
}

module.exports = {
  init,
  all: (text, params) => driver.all(text, params),
  get: async (text, params) => (await driver.all(text, params))[0] || null,
  run: (text, params) => driver.run(text, params),
  kind: () => driver.kind,
  schema
};
