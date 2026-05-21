const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Generate RSA key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

// Generate Secrets Encryption Key
const secretsKey = crypto.randomBytes(32).toString('base64');

// Read example env
const examplePath = path.join(__dirname, '.env.example');
let envContent = fs.readFileSync(examplePath, 'utf8');

// Replace JWT keys and SECRETS_ENCRYPTION_KEY
envContent = envContent.replace('JWT_PRIVATE_KEY=', `JWT_PRIVATE_KEY="${privateKey.trim().replace(/\r?\n/g, '\\n')}"`);
envContent = envContent.replace('JWT_PUBLIC_KEY=', `JWT_PUBLIC_KEY="${publicKey.trim().replace(/\r?\n/g, '\\n')}"`);
envContent = envContent.replace('SECRETS_ENCRYPTION_KEY=', `SECRETS_ENCRYPTION_KEY="${secretsKey}"`);

// Also fill in other required fields for testing if any
envContent = envContent.replace('EVOLUTION_GUILDS_API_KEY=', 'EVOLUTION_GUILDS_API_KEY="mock_guilds_api_key"');

const envPath = path.join(__dirname, '.env');
fs.writeFileSync(envPath, envContent, 'utf8');
console.log('.env file generated successfully with RSA keys and SECRETS_ENCRYPTION_KEY!');
