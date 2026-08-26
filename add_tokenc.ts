import fs from 'fs';

let content = fs.readFileSync('server/tests/backend.test.ts', 'utf8');

content = content.replace("let tokenA: string;\nlet tokenB: string;", "let tokenA: string;\nlet tokenB: string;\nlet tokenC: string;");

content = content.replace("tokenB = jwt.sign({ id: userBId, username: 'testuser_b', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });", "tokenB = jwt.sign({ id: userBId, username: 'testuser_b', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });\ntokenC = jwt.sign({ id: userBId + 999, username: 'testuser_c', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });");

content = content.replace("Authorization: 'Bearer fake_token_C'", "Authorization: \`Bearer \${tokenC}\`");

fs.writeFileSync('server/tests/backend.test.ts', content);
