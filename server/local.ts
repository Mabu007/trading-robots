import app from './index';

const port = Number(process.env.API_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('API_PORT must be an integer between 1 and 65535.');
app.listen(port, '127.0.0.1', () => console.log(`TradeFoundry API listening on 127.0.0.1:${port}`));
