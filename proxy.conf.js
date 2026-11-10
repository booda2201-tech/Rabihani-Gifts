module.exports = {
  '/api': {
    target: 'https://api.rabahni.com',
    secure: true,
    changeOrigin: true,
    onProxyReq(proxyReq) {
      proxyReq.removeHeader('origin');
    }
  }
};
