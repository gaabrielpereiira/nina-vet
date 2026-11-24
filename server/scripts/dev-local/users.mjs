// Cria os usuários fictícios do ambiente LOCAL (chamado por reset.sh).
// Recusa qualquer banco que não esteja em localhost.
import { randomUUID } from 'node:crypto';
import { databaseConfig } from '../../src/config.mjs';
import { createDatabase } from '../../src/database.mjs';
import { hashPassword } from '../../src/passwords.mjs';

const config = databaseConfig(process.env, 'MIGRATION_DATABASE_URL');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.url).hostname)) {
  throw new Error('dev-local/users: only a local database is allowed');
}
const password = process.env.DEV_LOGIN_PASSWORD;
const users = [
  { email: 'admin@nina-dev.test', name: 'Admin Local (fictício)', role: 'admin' },
  { email: 'equipe@nina-dev.test', name: 'Equipe Local (fictícia)', role: 'user' },
];

const db = createDatabase(config);
try {
  const hash = await hashPassword(password);
  await db.transaction(async tx => {
    for (const user of users) {
      const id = randomUUID();
      await tx.query('INSERT INTO nina_auth.users(id,email,full_name,password_hash) VALUES($1,$2,$3,$4)',
        [id, user.email, user.name, hash]);
      await tx.query('INSERT INTO nina_auth.user_roles(user_id,role) VALUES($1,$2)', [id, user.role]);
    }
  });
  console.log(JSON.stringify({ event: 'dev_users_created', emails: users.map(u => u.email) }));
} finally {
  await db.close();
}
