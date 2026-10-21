// Tạo Express Router tự bắt lỗi của handler async (Express 4 không tự làm việc này):
// mọi handler dạng (req, res) được bọc để lỗi chuyển tới error handler chung.
const express = require('express');

module.exports = function asyncRouter() {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = router[method].bind(router);
    router[method] = (route, ...fns) =>
      original(route, ...fns.map((fn) => (fn.length <= 2 ? (req, res, next) => Promise.resolve(fn(req, res)).catch(next) : fn)));
  }
  return router;
};
