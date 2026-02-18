/**
 * Solana公式ドキュメント: Transfer Fee 拡張機能サンプル
 * https://solana.com/docs/tokens/extensions/transfer-fees
 */

import { getCreateAccountInstruction } from "@solana-program/system";
import {
  extension,
  fetchToken,
  getInitializeAccountInstruction,
  getInitializeMintInstruction,
  getInitializeTransferFeeConfigInstruction,
  getMintSize,
  getMintToInstruction,
  getTokenSize,
  getTransferCheckedWithFeeInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  airdropFactory,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
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

// ============================================================
// 1. 接続とキーペアの準備
// ============================================================

// 接続を作成（この例ではローカルバリデータを使用）
const rpc = createSolanaRpc("http://localhost:8899");
const rpcSubscriptions = createSolanaRpcSubscriptions("ws://localhost:8900");

// Mintの権限者を生成（手数料支払者も兼ねる）
const authority = await generateKeyPairSigner();

// 権限者/手数料支払者にSOLを付与
await airdropFactory({ rpc, rpcSubscriptions })({
  recipientAddress: authority.address,
  lamports: lamports(5_000_000_000n), // 5 SOL
  commitment: "confirmed",
});

// Mintのアドレスとして使用するキーペアを生成
const mint = await generateKeyPairSigner();

// ============================================================
// 2. Transfer Fee拡張の定義
// ============================================================

// Transfer Fee設定を定義
const transferFees = {
  epoch: 0n,
  maximumFee: 1_000_000n,
  transferFeeBasisPoints: 100, // 1%
};

// Transfer Fee拡張を有効化
const transferFeeConfigExtension = extension("TransferFeeConfig", {
  transferFeeConfigAuthority: authority.address,
  withdrawWithheldAuthority: authority.address,
  withheldAmount: 0n,
  newerTransferFee: transferFees,
  olderTransferFee: transferFees,
});

// ============================================================
// 3. アカウントサイズとRentの計算
// ============================================================

// Transfer Fee拡張を含むMintアカウントサイズを取得
const space = BigInt(getMintSize([transferFeeConfigExtension]));

// Rent免除に必要な最小残高を取得
const rent = await rpc.getMinimumBalanceForRentExemption(space).send();

// ============================================================
// 4. Mint作成の命令を構築
// ============================================================

// Mint用の新規アカウント作成命令
const createMintAccountInstruction = getCreateAccountInstruction({
  payer: authority,
  newAccount: mint,
  lamports: rent,
  space,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS,
});

// Transfer Fee設定拡張の初期化命令
const initializeTransferFeeConfigInstruction =
  getInitializeTransferFeeConfigInstruction({
    mint: mint.address,
    transferFeeConfigAuthority: authority.address,
    withdrawWithheldAuthority: authority.address,
    transferFeeBasisPoints: 100, // 1%
    maximumFee: 1_000_000n,
  });

// Mintアカウントデータの初期化命令
const initializeMintInstruction = getInitializeMintInstruction({
  mint: mint.address,
  decimals: 6,
  mintAuthority: authority.address,
  freezeAuthority: authority.address,
});

// ============================================================
// 5. トークンアカウント作成の命令を構築
// ============================================================

// トークンアカウントのアドレスとして使用するキーペアを生成
const tokenAccount = await generateKeyPairSigner();

// トークンアカウントにもTransferFeeAmount拡張用のスペースが必要
const transferFeeAmountExtension = extension("TransferFeeAmount", {
  withheldAmount: 0n,
});

// TransferFeeAmount拡張を含むトークンアカウントサイズを取得
const tokenAccountLen = BigInt(getTokenSize([transferFeeAmountExtension]));

// Rent免除に必要な最小残高を取得
const tokenAccountRent = await rpc
  .getMinimumBalanceForRentExemption(tokenAccountLen)
  .send();

// 新規トークンアカウント作成命令
const createTokenAccountInstruction = getCreateAccountInstruction({
  payer: authority,
  newAccount: tokenAccount,
  lamports: tokenAccountRent,
  space: tokenAccountLen,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS,
});

// 作成したトークンアカウントの初期化命令
const initializeTokenAccountInstruction = getInitializeAccountInstruction({
  account: tokenAccount.address,
  mint: mint.address,
  owner: authority.address,
});

// ============================================================
// 6. トークン発行（MintTo）の命令を構築
// ============================================================

// 発行量を定義（1,000トークン、decimals=6なので 1,000 * 10^6）
const mintAmount = 1_000_000_000n; // 1,000 tokens

// MintTo命令を作成
const mintToInstruction = getMintToInstruction({
  mint: mint.address,
  token: tokenAccount.address,
  mintAuthority: authority,
  amount: mintAmount,
});

// ============================================================
// 7. 2つ目のトークンアカウント作成（送金先）
// ============================================================

// 送金先のトークンアカウントを生成
const tokenAccount2 = await generateKeyPairSigner();

// 新規トークンアカウント作成命令（送金先）
const createTokenAccount2Instruction = getCreateAccountInstruction({
  payer: authority,
  newAccount: tokenAccount2,
  lamports: tokenAccountRent,
  space: tokenAccountLen,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS,
});

// 送金先トークンアカウントの初期化命令
const initializeTokenAccount2Instruction = getInitializeAccountInstruction({
  account: tokenAccount2.address,
  mint: mint.address,
  owner: authority.address,
});

// ============================================================
// 8. トランザクションの送信（Mint作成〜MintTo）
// ============================================================

// 命令リストを構築
const instructions = [
  createMintAccountInstruction,
  initializeTransferFeeConfigInstruction,
  initializeMintInstruction,
  createTokenAccountInstruction,
  initializeTokenAccountInstruction,
  mintToInstruction,
  createTokenAccount2Instruction,
  initializeTokenAccount2Instruction,
];

// トランザクションに含める最新のブロックハッシュを取得
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

// トランザクションメッセージを作成
const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(authority, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions(instructions, tx),
);

// 必要な全ての署名者でトランザクションメッセージに署名
const signedTransaction =
  await signTransactionMessageWithSigners(transactionMessage);

// blockhash lifetimeであることをアサート
assertIsTransactionWithBlockhashLifetime(signedTransaction);

// トランザクションを送信して確認
await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedTransaction,
  { commitment: "confirmed", skipPreflight: true },
);

// ============================================================
// 9. Transfer（手数料付き送金）
// ============================================================

// 送金額を定義（100トークン）
const transferAmount = 100_000_000n; // 100 tokens

// 手数料を計算（1% = 1トークン、ただし上限1トークンなので1トークン）
const transferFee = 1_000_000n; // 1 token (1% of 100 = 1)

// Transfer命令を作成（手数料付き）
const transferInstruction = getTransferCheckedWithFeeInstruction({
  source: tokenAccount.address,
  mint: mint.address,
  destination: tokenAccount2.address,
  authority: authority,
  amount: transferAmount,
  decimals: 6,
  fee: transferFee,
});

// 新しいブロックハッシュを取得
const { value: latestBlockhash2 } = await rpc.getLatestBlockhash().send();

// Transferトランザクションを作成
const transferTransactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(authority, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash2, tx),
  (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
);

// 署名
const signedTransferTransaction = await signTransactionMessageWithSigners(
  transferTransactionMessage,
);

// blockhash lifetimeであることをアサート
assertIsTransactionWithBlockhashLifetime(signedTransferTransaction);

// 送信
await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedTransferTransaction,
  { commitment: "confirmed", skipPreflight: true },
);

// Transfer トランザクション署名を取得
const transferSignature = getSignatureFromTransaction(
  signedTransferTransaction,
);

// ============================================================
// 11. 結果の出力
// ============================================================

// トランザクション署名を取得
const transactionSignature = getSignatureFromTransaction(signedTransaction);

console.log("");
console.log("【Explorer URL】");
console.log(
  `Authority: https://explorer.solana.com/address/${authority.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `Mint: https://explorer.solana.com/address/${mint.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `送金元TokenAccount: https://explorer.solana.com/address/${tokenAccount.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `送金先TokenAccount: https://explorer.solana.com/address/${tokenAccount2.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `Mint作成TX: https://explorer.solana.com/tx/${transactionSignature}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `TransferTX: https://explorer.solana.com/tx/${transferSignature}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
