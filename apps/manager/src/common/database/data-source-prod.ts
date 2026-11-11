import { DataSource } from 'typeorm';
import { join } from 'node:path';
import { loadDockerSecrets } from '../util/secrets.util';

loadDockerSecrets();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USER || 'agentpier',
  password: process.env.DB_PASSWORD || 'local-agentpier',
  database: process.env.DB_NAME || 'agentpier',
  entities: [join(__dirname, '../../**/*.entity.js')],
  migrations: [join(__dirname, '../../../migrations/*.js')],
  synchronize: false,
});
