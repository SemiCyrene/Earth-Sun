import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 部署时需要设置 base 路径
  // 如果部署到 https://username.github.io/earth-sun/，设置 base: '/earth-sun/'
  // 如果部署到根目录，设置 base: '/'
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    open: true,
  },
});
