/**
 * Solana公式ドキュメント: Permanent Delegate 拡張機能サンプル
 * https://solana.com/docs/tokens/extensions/permanent-delegate
 */

import { getCreateAccountInstruction } from "@solana-program/system";
import {
  extension,
  fetchToken,
  getInitializeAccountInstruction,
  getInitializeMintInstruction,
  getInitializePermanentDelegateInstruction,
  getMintSize,
  getMintToInstruction,
  getTokenSize,
  getTransferCheckedInstruction,
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

// Mintの権限者を生成（手数料支払者およびPermanent Delegateも兼ねる）
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
// 2. Permanent Delegate拡張の定義
// ============================================================

// Permanent Delegate拡張を有効化
const permanentDelegateExtension = extension("PermanentDelegate", {
  delegate: authority.address,
});

// ============================================================
// 3. アカウントサイズとRentの計算
// ============================================================

// Permanent Delegate拡張を含むMintアカウントサイズを取得
const space = BigInt(getMintSize([permanentDelegateExtension]));

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

// Permanent Delegate拡張の初期化命令
const initializePermanentDelegateInstruction =
  getInitializePermanentDelegateInstruction({
    mint: mint.address,
    delegate: authority.address,
  });

// Mintアカウントデータの初期化命令
const initializeMintInstruction = getInitializeMintInstruction({
  mint: mint.address,
  decimals: 9,
  mintAuthority: authority.address,
  freezeAuthority: authority.address,
});

// ============================================================
// 5. ユーザーのトークンアカウント作成（差し押さえ対象）
// ============================================================

// 異なるユーザーを生成（authority とは別のユーザー）
const user = await generateKeyPairSigner();

// トークンアカウントのアドレスとして使用するキーペアを生成
const userTokenAccount = await generateKeyPairSigner();

// トークンアカウントサイズを取得（基本）
const tokenAccountLen = BigInt(getTokenSize([]));

// Rent免除に必要な最小残高を取得
const tokenAccountRent = await rpc
  .getMinimumBalanceForRentExemption(tokenAccountLen)
  .send();

// ユーザーのトークンアカウント作成命令
const createUserTokenAccountInstruction = getCreateAccountInstruction({
  payer: authority,
  newAccount: userTokenAccount,
  lamports: tokenAccountRent,
  space: tokenAccountLen,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS,
});

// ユーザーのトークンアカウント初期化命令（owner は user）
const initializeUserTokenAccountInstruction = getInitializeAccountInstruction({
  account: userTokenAccount.address,
  mint: mint.address,
  owner: user.address, // ユーザーが所有者
});

// ============================================================
// 6. 権限者のトークンアカウント作成（差し押さえ先）
// ============================================================

// 権限者のトークンアカウントを生成
const authorityTokenAccount = await generateKeyPairSigner();

// 権限者のトークンアカウント作成命令
const createAuthorityTokenAccountInstruction = getCreateAccountInstruction({
  payer: authority,
  newAccount: authorityTokenAccount,
  lamports: tokenAccountRent,
  space: tokenAccountLen,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS,
});

// 権限者のトークンアカウント初期化命令
const initializeAuthorityTokenAccountInstruction =
  getInitializeAccountInstruction({
    account: authorityTokenAccount.address,
    mint: mint.address,
    owner: authority.address,
  });

// ============================================================
// 7. トークン発行（MintTo）の命令を構築
// ============================================================

// 発行量を定義（1,000トークン、decimals=9なので 1,000 * 10^9）
const mintAmount = 1_000_000_000_000n; // 1,000 tokens

// ユーザーのトークンアカウントにMint
const mintToInstruction = getMintToInstruction({
  mint: mint.address,
  token: userTokenAccount.address,
  mintAuthority: authority,
  amount: mintAmount,
});

// ============================================================
// 8. トランザクションの送信（Mint作成〜MintTo）
// ============================================================

// 命令リストを構築
const instructions = [
  createMintAccountInstruction,
  initializePermanentDelegateInstruction,
  initializeMintInstruction,
  createUserTokenAccountInstruction,
  initializeUserTokenAccountInstruction,
  createAuthorityTokenAccountInstruction,
  initializeAuthorityTokenAccountInstruction,
  mintToInstruction,
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
// 9. 差し押さえ前の残高確認
// ============================================================

// ユーザーのトークンアカウント残高を取得
const userBalanceBefore = (await fetchToken(rpc, userTokenAccount.address)).data
  .amount;

// 権限者のトークンアカウント残高を取得
const authorityBalanceBefore = (
  await fetchToken(rpc, authorityTokenAccount.address)
).data.amount;

// ============================================================
// 10. 差し押さえ実行（Permanent Delegateによる強制Transfer）
// ============================================================

// 差し押さえ額を定義（全額）
const seizeAmount = userBalanceBefore; // 全額差し押さえ

// Permanent Delegateとして、ユーザーのトークンを強制的に移動
// ※ ユーザー（user）の署名なしで、authority が transfer できる
const seizeInstruction = getTransferCheckedInstruction({
  source: userTokenAccount.address,
  mint: mint.address,
  destination: authorityTokenAccount.address,
  authority: authority, // Permanent Delegate として署名
  amount: seizeAmount,
  decimals: 9,
});

// 新しいブロックハッシュを取得
const { value: latestBlockhash2 } = await rpc.getLatestBlockhash().send();

// 差し押さえトランザクションを作成
const seizeTransactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(authority, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash2, tx),
  (tx) => appendTransactionMessageInstructions([seizeInstruction], tx),
);

// 署名（authority のみで署名、user の署名は不要）
const signedSeizeTransaction = await signTransactionMessageWithSigners(
  seizeTransactionMessage,
);

// blockhash lifetimeであることをアサート
assertIsTransactionWithBlockhashLifetime(signedSeizeTransaction);

// 送信
await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedSeizeTransaction,
  { commitment: "confirmed", skipPreflight: true },
);

// ============================================================
// 11. 差し押さえ後の残高確認
// ============================================================

// ユーザーのトークンアカウント残高を取得
const userBalanceAfter = (await fetchToken(rpc, userTokenAccount.address)).data
  .amount;

// 権限者のトークンアカウント残高を取得
const authorityBalanceAfter = (
  await fetchToken(rpc, authorityTokenAccount.address)
).data.amount;

// ============================================================
// 12. 結果の出力
// ============================================================

// トランザクション署名を取得
const setupSignature = getSignatureFromTransaction(signedTransaction);

// 差し押さえトランザクション署名を取得
const seizeSignature = getSignatureFromTransaction(signedSeizeTransaction);

console.log("【差し押さえ前の残高】");
console.log(`  ユーザー: ${userBalanceBefore}`);
console.log(`  権限者:   ${authorityBalanceBefore}`);
console.log("");
console.log("【差し押さえ後の残高】");
console.log(`  ユーザー: ${userBalanceAfter}`);
console.log(`  権限者:   ${authorityBalanceAfter}`);
console.log("");
console.log("【Explorer URL】");
console.log(
  `Mint: https://explorer.solana.com/address/${mint.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `権限者(Permanent Delegate): https://explorer.solana.com/address/${authority.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `ユーザー: https://explorer.solana.com/address/${user.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `ユーザーTokenAccount: https://explorer.solana.com/address/${userTokenAccount.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `権限者TokenAccount: https://explorer.solana.com/address/${authorityTokenAccount.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `セットアップTX: https://explorer.solana.com/tx/${setupSignature}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `差し押さえTX: https://explorer.solana.com/tx/${seizeSignature}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
