import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let singleQuote = false;
  let doubleQuote = false;
  let lineComment = false;
  let blockComment = false;
  let dollarQuoteTag: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      current += char;
      if (char === '\n') {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        i += 1;
        blockComment = false;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, i)) {
        current += dollarQuoteTag;
        i += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (singleQuote) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        i += 1;
      } else if (char === "'") {
        singleQuote = false;
      }
      continue;
    }

    if (doubleQuote) {
      current += char;
      if (char === '"' && next === '"') {
        current += next;
        i += 1;
      } else if (char === '"') {
        doubleQuote = false;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      current += char + next;
      i += 1;
      lineComment = true;
      continue;
    }

    if (char === '/' && next === '*') {
      current += char + next;
      i += 1;
      blockComment = true;
      continue;
    }

    if (char === "'") {
      current += char;
      singleQuote = true;
      continue;
    }

    if (char === '"') {
      current += char;
      doubleQuote = true;
      continue;
    }

    if (char === '$') {
      const tagMatch = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (tagMatch) {
        dollarQuoteTag = tagMatch[0];
        current += dollarQuoteTag;
        i += dollarQuoteTag.length - 1;
        continue;
      }
    }

    if (char === ';') {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) {
    statements.push(trailing);
  }

  return statements;
}

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
    const statements = splitSqlStatements(sqlContent);
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }

    console.log(`✅ Row Level Security (RLS) policies successfully enforced! Statements: ${statements.length}`);
  } catch (err: any) {
    console.error('❌ Failed to apply Row Level Security policies:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

applyRLS();
