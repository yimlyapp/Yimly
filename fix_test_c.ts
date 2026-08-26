import fs from 'fs';

let content = fs.readFileSync('server/tests/backend.test.ts', 'utf8');

content = content.replace("let userBId: number;", "let userBId: number;\n  let userCId: number;");

const setupC = `
    const existingC = await db.select().from(users).where(eq(users.username, 'testuser_c')).limit(1);
    if (existingC.length > 0) userCId = existingC[0].id;
    else {
      const ins = await db.select().from(users);
      const newC = await db.insert(users).values({ username: 'testuser_c', password: hashedPass, createdAt: new Date(), updatedAt: new Date() }).returning();
      userCId = newC[0].id;
    }
`;

content = content.replace("} catch (e) {", setupC + "} catch (e) {");

content = content.replace("tokenC = jwt.sign({ id: userBId + 999", "tokenC = jwt.sign({ id: userCId");

fs.writeFileSync('server/tests/backend.test.ts', content);
