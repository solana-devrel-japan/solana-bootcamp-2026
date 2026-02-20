import express from 'express';
import type { Request, Response } from 'express';   
import { paymentMiddleware } from '@x402/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactSvmScheme } from '@x402/svm/exact/server';

const app = express();
app.use(express.json());

const facilitatorClient = new HTTPFacilitatorClient({
    url: 'https://x402.org/facilitator',
});

const resourceServer = new x402ResourceServer(facilitatorClient)
    .register('solana:*', new ExactSvmScheme());

const routes = {
    'GET /premium': {
        accepts: {
            scheme: 'exact',
            network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const,
            payTo: '5WeCpRxH4VjH5CRV6Df3qAs8H4isg63CRiWuNXGPxVuC',
            price: '$0.01',
        },
    },
};

// paymentMiddleware はルートハンドラより前に登録する必要がある（402 → 支払い検証 → 200 のフロー）
app.use(paymentMiddleware(routes, resourceServer));

app.get('/free', (req: Request, res: Response) => {
    res.json({ message: 'This is a free endpoint accessible to everyone.' });
});

app.get('/premium', (req: Request, res: Response) => {
    res.json({ message: 'This is a premium endpoint accessible to everyone.' });
});

app.listen(3001, () => {
    console.log('Server is running on http://localhost:3001');
});

