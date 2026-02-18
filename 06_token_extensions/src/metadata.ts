/**
 * Solana公式ドキュメント: Metadata + MetadataPointer 拡張機能サンプル
 * https://solana.com/docs/tokens/extensions/metadata
 */

import { getCreateAccountInstruction } from "@solana-program/system";
import {
  extension,
  getInitializeAccountInstruction,
  getInitializeMetadataPointerInstruction,
  getInitializeMintInstruction,
  getInitializeTokenMetadataInstruction,
  getMintSize,
  getMintToInstruction,
  getTokenSize,
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
  some,
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
// 2. 拡張機能の定義
// ============================================================

// MetadataとMetadataPointer拡張を有効化
const metadataExtension = extension("TokenMetadata", {
  updateAuthority: some(authority.address),
  mint: mint.address,
  name: "OPOS",
  symbol: "OPS",
  uri: "https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/DeveloperPortal/metadata.json",
  additionalMetadata: new Map().set("description", "Only possible on Solana"),
});

const metadataPointerExtension = extension("MetadataPointer", {
  authority: some(authority.address),
  metadataAddress: some(mint.address), // 必要に応じて別のアカウントを指定可能
});

// ============================================================
// 3. アカウントサイズとRentの計算
// ============================================================

// MetadataPointer拡張のみのMintアカウントサイズを取得
const spaceWithoutTokenMetadataExtension = BigInt(
  getMintSize([metadataPointerExtension]),
);

// 全拡張（Metadata + MetadataPointer）を含むMintアカウントサイズを取得
const spaceWithTokenMetadataExtension = BigInt(
  getMintSize([metadataPointerExtension, metadataExtension]),
);

// Rent免除に必要な最小残高を取得
const rent = await rpc
  .getMinimumBalanceForRentExemption(spaceWithTokenMetadataExtension)
  .send();

// ============================================================
// 4. Mint作成の命令を構築
// ============================================================

// Mint用の新規アカウント作成命令（TokenMetadataを除いたサイズを使用）
const createMintAccountInstruction = getCreateAccountInstruction({
  payer: authority,
  newAccount: mint,
  lamports: rent,
  space: spaceWithoutTokenMetadataExtension,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS,
});

// MetadataPointer拡張の初期化命令
const initializeMetadataPointerInstruction =
  getInitializeMetadataPointerInstruction({
    mint: mint.address,
    authority: authority.address,
    metadataAddress: mint.address,
  });

// Mintアカウントデータの初期化命令
const initializeMintInstruction = getInitializeMintInstruction({
  mint: mint.address,
  decimals: 9,
  mintAuthority: authority.address,
  freezeAuthority: authority.address,
});

// Metadata拡張の初期化命令
const initializeMetadataInstruction = getInitializeTokenMetadataInstruction({
  metadata: mint.address, // メタデータを保持するアカウントアドレス
  updateAuthority: authority.address, // メタデータを更新できる権限者
  mint: mint.address, // Mintアカウントアドレス
  mintAuthority: authority, // 指定されたMint権限者
  name: "OPOS",
  symbol: "OPS",
  uri: "https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/DeveloperPortal/metadata.json",
});

// ============================================================
// 5. トークンアカウント作成の命令を構築
// ============================================================

// トークンアカウントのアドレスとして使用するキーペアを生成
const tokenAccount = await generateKeyPairSigner();

// トークンアカウントサイズを取得（基本）
const tokenAccountLen = BigInt(getTokenSize([]));

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

// 発行量を定義（1,000トークン、decimals=9なので 1,000 * 10^9）
const mintAmount = 1_000_000_000_000n; // 1,000 tokens

// MintTo命令を作成
const mintToInstruction = getMintToInstruction({
  mint: mint.address,
  token: tokenAccount.address,
  mintAuthority: authority,
  amount: mintAmount,
});

// ============================================================
// 7. トランザクションの送信
// ============================================================

// 命令リストを構築
const instructions = [
  createMintAccountInstruction,
  initializeMetadataPointerInstruction,
  initializeMintInstruction,
  initializeMetadataInstruction,
  createTokenAccountInstruction,
  initializeTokenAccountInstruction,
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
// 9. 結果の出力
// ============================================================

// トランザクション署名を取得
const transactionSignature = getSignatureFromTransaction(signedTransaction);

console.log("【Explorer URL】");
console.log(
  `https://explorer.solana.com/tx/${transactionSignature}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `https://explorer.solana.com/address/${mint.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
console.log(
  `https://explorer.solana.com/address/${tokenAccount.address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
);
