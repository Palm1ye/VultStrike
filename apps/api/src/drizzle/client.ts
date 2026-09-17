import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}
console.log('[drizzle] Using connection string:', connectionString.replace(/:[^:@]+@/, ':***@'));
const client = postgres(connectionString, { max: 10 });
const db = drizzle(client, { schema });
export { db };
