import { createNativeClient } from './api-client';

export const client = createNativeClient(import.meta.env.VITE_API_URL || 'https://api.nina.sharkassessoria.tech');
