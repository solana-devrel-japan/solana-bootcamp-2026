import {
  airdropFactory,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";

import { getCreateAccountInstruction } from "@solana-program/system";

import {
  getInitializeMintInstruction,
  getInitializeAccount2Instruction,
  getMintSize,
  getTokenSize,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";

const rpc = createSolanaRpc("http://localhost:8899");
const rpcSubscriptions = createSolanaRpcSubscriptions("ws://localhost:8900");

const feePayer = await generateKeyPairSigner();

await airdropFactory({ rpc, rpcSubscriptions })({
  recipientAddress: feePayer.address,
  lamports: lamports(1_000_000_000n),
  commitment: "confirmed",
});

const mint = await generateKeyPairSigner();

const space = BigInt(getMintSize());

const rent = await rpc.getMinimumBalanceForRentExemption(space).send();

const createAccountInstruction = getCreateAccountInstruction({
  payer: feePayer,
  newAccount: mint,
  lamports: rent,
  space,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS,
});

const initializeMintInstruction = getInitializeMintInstruction({
  mint: mint.address,
  decimals: 9,
  mintAuthority: feePayer.address,
});

const instructions = [createAccountInstruction, initializeMintInstruction];

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions(instructions, tx),
);

const signedTransactionMessage =
  await signTransactionMessageWithSigners(transactionMessage);

const signedTransactionWithLifetime =
  signedTransactionMessage as typeof signedTransactionMessage & {
    lifetimeConstraint: {
      lastValidBlockHeight: bigint;
    };
  };

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedTransactionWithLifetime,
  { commitment: "confirmed" },
);

const transactionSignature = getSignatureFromTransaction(
  signedTransactionWithLifetime,
);

console.log("Mint Address:", mint.address);
console.log("Transaction Signature:", transactionSignature);

const tokenAccount = await generateKeyPairSigner();

const tokenAccountSpace = BigInt(getTokenSize());
const tokenAccountRent = await rpc
  .getMinimumBalanceForRentExemption(tokenAccountSpace)
  .send();

const createTokenAccountInstruction = getCreateAccountInstruction({
  payer: feePayer,
  newAccount: tokenAccount,
  lamports: tokenAccountRent,
  space: tokenAccountSpace,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS,
});

const initializeTokenAccountInstruction = getInitializeAccount2Instruction({
  account: tokenAccount.address,
  mint: mint.address,
  owner: feePayer.address,
});

const tokenAccountInstructions = [
  createTokenAccountInstruction,
  initializeTokenAccountInstruction,
];

const { value: createTokenAccountLatestBlockhash } = await rpc
  .getLatestBlockhash()
  .send();

const tokenAccountTxMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
  (tx) =>
    setTransactionMessageLifetimeUsingBlockhash(
      createTokenAccountLatestBlockhash,
      tx,
    ),
  (tx) => appendTransactionMessageInstructions(tokenAccountInstructions, tx),
);

const signedTokenAccountTxMessage = await signTransactionMessageWithSigners(
  tokenAccountTxMessage,
);

const signedTokenAccountTxMessageWithLifetime =
  signedTokenAccountTxMessage as typeof signedTokenAccountTxMessage & {
    lifetimeConstraint: {
      lastValidBlockHeight: bigint;
    };
  };

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedTokenAccountTxMessageWithLifetime,
  { commitment: "confirmed" },
);

const tokenAccountTxSignature = getSignatureFromTransaction(
  signedTokenAccountTxMessageWithLifetime,
);

console.log("\nToken Account Address:", tokenAccount.address);
console.log("Token Account Transaction Signature:", tokenAccountTxSignature);
