import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UPLOAD_DIR = path.join(backendDir, 'storage', 'uploads');
export const DATABASE_URL = process.env.DATABASE_URL;
export const PORT = Number(process.env.PORT || 3184);
export const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
export const APP_ORIGIN = (process.env.APP_ORIGIN || '').replace(/\/$/, '');
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 250);
if (!DATABASE_URL) throw new Error('Falta DATABASE_URL. Crear backend/.env');
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT inválido');
if (!Number.isFinite(MAX_UPLOAD_MB) || MAX_UPLOAD_MB <= 0 || MAX_UPLOAD_MB > 2048) throw new Error('MAX_UPLOAD_MB inválido');
