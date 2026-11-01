import { config } from '../config.js';

export default async function routes(app) {
  app.get('/public/imprint', async () => ({ ...config.imprint }));
}
