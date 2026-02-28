import { readFileSync } from 'fs';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { toClientSvmSigner } from "@x402/svm";
import { registerExactSvmScheme } from "@x402/svm/exact/client";

async function loadPayer() {
    const keypairData = JSON.parse(readFileSync("client.json", "utf-8"));
    const signer = await createKeyPairSignerFromBytes(Uint8Array.from(keypairData));
    return signer;
}

async function payAndAccess() { 
    const payer = await loadPayer();
    console.log(`Payer address: ${payer.address}`);

    const signer = toClientSvmSigner(payer);

    const coreClient = new x402Client();
    registerExactSvmScheme(coreClient, { signer });

    const client = new x402HTTPClient(coreClient);

    const response = await fetch('http://localhost:3001/premium');
    if (response.status !== 402) {
        console.error(`Expected 402 Payment Required, got ${response.status}`);
        return;
    }

    const body = await response.json();

    const paymentRequirement = client.getPaymentRequiredResponse(
        (name) => response.headers.get(name) || undefined,
        body,
    );

    console.log('Payment required:', paymentRequirement);

    try {
        const paymentPayload = await client.createPaymentPayload(paymentRequirement);

        const paymentHeaders = client.encodePaymentSignatureHeader(paymentPayload);

        const paidResponse = await fetch('http://localhost:3001/premium', {
            headers: {
                ...paymentHeaders,
            },
        });

        if (paidResponse.status !== 200) {
            console.error(`Expected 200 OK after payment, got ${paidResponse.status}`);
            return;
        }

        const data = await paidResponse.json();
        console.log('Accessed premium content:', data);
    } catch (err) {
        console.error('Payment failed:', err);
    }
}

payAndAccess().catch((err) => {
    console.error('Error in payAndAccess:', err);
});

