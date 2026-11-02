import postgres from 'postgres';

function connection(client) {
  return {
    query: (text, parameters = []) => client.unsafe(text, parameters),
    exec: text => client.unsafe(text).simple(),
    transaction: fn => client.begin(tx => fn(connection(tx))),
  };
}

export function createDatabase(config) {
  const client = postgres(config.url, {
    max: config.max,
    ssl: config.ssl,
    connect_timeout: 5,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connection: { application_name: 'nina-api', statement_timeout: 10000 },
    onnotice: () => {},
  });
  return { ...connection(client), close: () => client.end({ timeout: 5 }) };
}

export async function assertRuntimeRole(db) {
  const [role] = await db.query(`
    SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls,
      r.rolreplication,
      pg_has_role(current_user, 'pg_database_owner', 'MEMBER') AS owns_database,
      EXISTS (SELECT 1 FROM pg_namespace n
        WHERE n.nspname IN ('nina_auth', 'nina_meta', 'nina_mail', 'nina_clinic')
        AND pg_has_role(current_user, n.nspowner, 'MEMBER')) AS owns_schema
    FROM pg_roles r WHERE r.rolname = current_user
  `);
  if (!role || Object.values(role).some(Boolean)) {
    const error = new Error('Use a limited runtime database role');
    error.code = 'UNSAFE_DATABASE_ROLE';
    throw error;
  }
}
