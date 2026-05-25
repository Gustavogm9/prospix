import { env } from '../../src/config/env.js';

if (env.DATABASE_URL) {
  env.DATABASE_URL = env.DATABASE_URL.replace('//prospix:', '//prospix_app:');
}
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('//prospix:', '//prospix_app:');
}
