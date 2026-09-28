import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'e2e',workers:1,fullyParallel:false,timeout:60_000,
  use:{baseURL:'http://127.0.0.1:5178',trace:'retain-on-failure',screenshot:'only-on-failure',viewport:{width:1280,height:900}},
  webServer:[
    {command:'DEV_AUTH=synthetic-local node backend/dist/main.js',url:'http://127.0.0.1:3018/api/v1/auth/session',reuseExistingServer:!process.env.CI},
    {command:'npm run dev:web',url:'http://127.0.0.1:5178',reuseExistingServer:!process.env.CI}
  ]
});
