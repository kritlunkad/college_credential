const { sendJson } = require('./_lib/http');

module.exports = async function handler(req, res) {
  return sendJson(res, 200, {
    ok: true,
    service: 'credchain-api',
    now: new Date().toISOString(),
  });
};
