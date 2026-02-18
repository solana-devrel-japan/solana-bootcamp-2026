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
  getCreateAssociatedTokenInstructionAsync,
  getMintToInstruction,
  getTransferInstruction,
  getFreezeAccountInstruction,
  getThawAccountInstruction,
  getBurnCheckedInstruction,
  getMintSize,
  getTokenSize,
  TOKEN_2022_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  fetchToken,
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
  freezeAuthority: feePayer.address,
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

const [associatedTokenAccountAddress] = await findAssociatedTokenPda({
  mint: mint.address,
  owner: feePayer.address,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
});

console.log(
  "\nAssociated Token Account Address:",
  associatedTokenAccountAddress,
);

const createAtaInstruction = await getCreateAssociatedTokenInstructionAsync({
  payer: feePayer,
  mint: mint.address,
  owner: feePayer.address,
});

const { value: createAtaLatestBlockhash } = await rpc
  .getLatestBlockhash()
  .send();

const ataTxMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
  (tx) =>
    setTransactionMessageLifetimeUsingBlockhash(createAtaLatestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions([createAtaInstruction], tx),
);

const signedAtaTxMessage =
  await signTransactionMessageWithSigners(ataTxMessage);

const signedAtaTxMessageWithLifetime =
  signedAtaTxMessage as typeof signedAtaTxMessage & {
    lifetimeConstraint: {
      lastValidBlockHeight: bigint;
    };
  };

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedAtaTxMessageWithLifetime,
  { commitment: "confirmed" },
);

const ataTxSignature = getSignatureFromTransaction(
  signedAtaTxMessageWithLifetime,
);

console.log(
  "\nAssociated Token Account Creation Transaction Signature:",
  ataTxSignature,
);

const mintToInstruction = getMintToInstruction({
  mint: mint.address,
  token: associatedTokenAccountAddress,
  mintAuthority: feePayer.address,
  amount: 1_000_000_000n,
});

const { value: mintToLatestBlockhash } = await rpc.getLatestBlockhash().send();

const mintToTxMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
  (tx) =>
    setTransactionMessageLifetimeUsingBlockhash(mintToLatestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions([mintToInstruction], tx),
);

const signedMintToTxMessage =
  await signTransactionMessageWithSigners(mintToTxMessage);

const signedMintToTxMessageWithLifetime =
  signedMintToTxMessage as typeof signedMintToTxMessage & {
    lifetimeConstraint: {
      lastValidBlockHeight: bigint;
    };
  };

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedMintToTxMessageWithLifetime,
  { commitment: "confirmed" },
);

const mintToTxSignature = getSignatureFromTransaction(
  signedMintToTxMessageWithLifetime,
);

console.log("\nMint To Transaction Signature:", mintToTxSignature);

const ataData = await fetchToken(rpc, associatedTokenAccountAddress, {
  commitment: "confirmed",
});

const ataBalance = ataData.data.amount;

console.log(
  "Associated Token Account Balance:",
  Number(ataBalance) / 1_000_000_000,
);

const recipient = await generateKeyPairSigner();

const [recipientAssociatedTokenAddress] = await findAssociatedTokenPda({
  mint: mint.address,
  owner: recipient.address,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
});

console.log(
  "\nRecipient Associated Token Account Address:",
  recipientAssociatedTokenAddress,
);

const createRecipientAtaInstruction =
  await getCreateAssociatedTokenInstructionAsync({
    payer: feePayer,
    mint: mint.address,
    owner: recipient.address,
  });

const { value: createRecipientAtaLatestBlockhash } = await rpc
  .getLatestBlockhash()
  .send();

const recipientAtaTxMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
  (tx) =>
    setTransactionMessageLifetimeUsingBlockhash(
      createRecipientAtaLatestBlockhash,
      tx,
    ),
  (tx) =>
    appendTransactionMessageInstructions([createRecipientAtaInstruction], tx),
);

const signedRecipientAtaTxMessage = await signTransactionMessageWithSigners(
  recipientAtaTxMessage,
);

const signedRecipientAtaTxMessageWithLifetime =
  signedRecipientAtaTxMessage as typeof signedRecipientAtaTxMessage & {
    lifetimeConstraint: {
      lastValidBlockHeight: bigint;
    };
  };
await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedRecipientAtaTxMessageWithLifetime,
  { commitment: "confirmed" },
);

const recipientAtaTxSignature = getSignatureFromTransaction(
  signedRecipientAtaTxMessageWithLifetime,
);

console.log(
  "\nRecipient Associated Token Account Creation Transaction Signature:",
  recipientAtaTxSignature,
);

const transferInstruction = getTransferInstruction({
  source: associatedTokenAccountAddress,
  destination: recipientAssociatedTokenAddress,
  authority: feePayer.address,
  amount: 500_000_000n,
});

const { value: transferLatestBlockhash } = await rpc
  .getLatestBlockhash()
  .send();

const transferTxMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
  (tx) =>
    setTransactionMessageLifetimeUsingBlockhash(transferLatestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
);

const signedTransferTxMessage =
  await signTransactionMessageWithSigners(transferTxMessage);

const signedTransferTxMessageWithLifetime =
  signedTransferTxMessage as typeof signedTransferTxMessage & {
    lifetimeConstraint: {
      lastValidBlockHeight: bigint;
    };
  };

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedTransferTxMessageWithLifetime,
  { commitment: "confirmed" },
);

const transferTxSignature = getSignatureFromTransaction(
  signedTransferTxMessageWithLifetime,
);

console.log("\nTransfer Transaction Signature:", transferTxSignature);

const senderAtaData = await fetchToken(rpc, associatedTokenAccountAddress, {
  commitment: "confirmed",
});

const senderAtaBalance = Number(senderAtaData.data.amount);

console.log(
  "Sender Associated Token Account Balance:",
  senderAtaBalance / 1_000_000_000,
);

const recipientAtaData = await fetchToken(
  rpc,
  recipientAssociatedTokenAddress,
  { commitment: "confirmed" },
);

const recipientAtaBalance = Number(recipientAtaData.data.amount);

console.log(
  "Recipient Associated Token Account Balance:",
  recipientAtaBalance / 1_000_000_000,
);

const freezeInstruction = getFreezeAccountInstruction({
  account: associatedTokenAccountAddress,
  mint: mint.address,
  owner: feePayer.address,
});

const { value: freezeLatestBlockhash } = await rpc.getLatestBlockhash().send();

const freezeTxMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
  (tx) =>
    setTransactionMessageLifetimeUsingBlockhash(freezeLatestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions([freezeInstruction], tx),
);

const signedFreezeTxMessage =
  await signTransactionMessageWithSigners(freezeTxMessage);

const signedFreezeTxMessageWithLifetime =
  signedFreezeTxMessage as typeof signedFreezeTxMessage & {
    lifetimeConstraint: {
      lastValidBlockHeight: bigint;
    };
  };

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedFreezeTxMessageWithLifetime,
  { commitment: "confirmed" },
);

const freezeTxSignature = getSignatureFromTransaction(
  signedFreezeTxMessageWithLifetime,
);

console.log("\nFreeze Account Transaction Signature:", freezeTxSignature);

const thawInstruction = getThawAccountInstruction({
  account: associatedTokenAccountAddress,
  mint: mint.address,
  owner: feePayer.address,
});

const { value: thawLatestBlockhash } = await rpc.getLatestBlockhash().send();

const thawTxMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(thawLatestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions([thawInstruction], tx),
);

const signedThawTxMessage =
  await signTransactionMessageWithSigners(thawTxMessage);

const signedThawTxMessageWithLifetime =
  signedThawTxMessage as typeof signedThawTxMessage & {
    lifetimeConstraint: {
      lastValidBlockHeight: bigint;
    };
  };

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedThawTxMessageWithLifetime,
  { commitment: "confirmed" },
);

const thawTxSignature = getSignatureFromTransaction(
  signedThawTxMessageWithLifetime,
);

console.log("\nThaw Account Transaction Signature:", thawTxSignature);

const ataBeforeBurn = await fetchToken(rpc, associatedTokenAccountAddress, {
  commitment: "confirmed",
});

console.log(
  "\nAssociated Token Account Balance Before Burn:",
  Number(ataBeforeBurn.data.amount) / 1_000_000_000,
);

const burnInstruction = getBurnCheckedInstruction({
  account: associatedTokenAccountAddress,
  mint: mint.address,
  authority: feePayer.address,
  amount: 500_000_000n,
  decimals: 9,
});

const { value: burnLatestBlockhash } = await rpc.getLatestBlockhash().send();

const burnTxMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(burnLatestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions([burnInstruction], tx),
);

const signedBurnTxMessage =
  await signTransactionMessageWithSigners(burnTxMessage);

const signedBurnTxMessageWithLifetime =
  signedBurnTxMessage as typeof signedBurnTxMessage & {
    lifetimeConstraint: {
      lastValidBlockHeight: bigint;
    };
  };

await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedBurnTxMessageWithLifetime,
  { commitment: "confirmed" },
);

const burnTxSignature = getSignatureFromTransaction(
  signedBurnTxMessageWithLifetime,
);

console.log("\nBurn Transaction Signature:", burnTxSignature);

const ataAfterBurn = await fetchToken(rpc, associatedTokenAccountAddress, {
  commitment: "confirmed",
});

console.log(
  "Associated Token Account Balance After Burn:",
  Number(ataAfterBurn.data.amount) / 1_000_000_000,
);
