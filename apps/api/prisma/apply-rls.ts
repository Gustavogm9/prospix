import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function applyRLS() {
  console.log('🔄 Executing portable PostgreSQL RLS deployment...');
  
  try {
    const sqlFilePath = path.resolve(__dirname, 'sql', '01_rls.sql');
    
    if (!fs.existsSync(sqlFilePath)) {
      throw new Error(`RLS SQL file not found at: ${sqlFilePath}`);
    }

    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

    console.log('🔌 Connecting to the database...');
    await prisma.$connect();

    console.log('⚡ Applying SQL schema changes and policies directly via Prisma...');
    // We execute the raw SQL text. PostgreSQL supports executing multiple commands in a single raw query block.
    await prisma.$executeRawUnsafe(sqlContent);

    console.log('✅ Row Level Security (RLS) policies successfully enforced!');
  } catch (err: any) {
    console.error('❌ Failed to apply Row Level Security policies:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyRLS();
