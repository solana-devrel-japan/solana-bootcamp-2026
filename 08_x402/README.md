# x402

HTTP 402 Payment Required プロトコル（x402）を用いた Solana 上でのマイクロペイメントのサンプルコード集です。

```
solana-bootcamp/
├── x402-app/    # Next.js テンプレート（x402-next、ルート別価格設定）
└── x402-demo/   # Express + x402 SDK（ハンズオン用、最小実装）
```

## 前提条件

- Node.js v18+
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)

## サンプル

### 1. x402-app（Next.js テンプレート）

Next.js + `x402-next` を使った Web アプリ。`middleware.ts` でルートごとに価格を設定し、402 → 支払い → 200 のフローをブラウザで体験できます。

```bash
cd x402-app
pnpm install
cp .env.example .env.local
pnpm dev
```

`http://localhost:3000` でアプリを開き、`/content/cheap`（$0.01）、`/content/expensive`（$0.25）、`/content/premium`（$1.00）などの有料コンテンツにアクセスできます。`.env.local` の `NEXT_PUBLIC_RECEIVER_ADDRESS` に受取先アドレス、`NEXT_PUBLIC_NETWORK` にネットワークを設定してください。

### 2. x402-demo（ハンズオン）

Express + `@x402/express` の最小実装。`server.ts` と `client.ts` で、402 → 署名 → 決済 → 200 のフローをコマンドラインから体験できます。

**準備:** クライアント用キーペアの生成と Devnet USDC の入金

```bash
cd x402-demo
pnpm install
solana-keygen new --outfile client.json --no-bip39-passphrase
```

[Circle Faucet](https://faucet.circle.com/) で生成したアドレスに Devnet USDC を入金してください。

**実行:** ターミナルを2つ開く

```bash
# ターミナル1
pnpm server

# ターミナル2
pnpm client
```

成功時は `Accessed premium content: {...}` と表示されます。

| エンドポイント | 説明 |
|---------------|------|
| `GET /free` | 無料 |
| `GET /premium` | $0.01（x402支払いが必要） |

`server.ts` の `payTo` に受取先アドレスを指定してください。受取先には事前に Devnet USDC を入金してください（ATA作成用）。

## 使用ライブラリ

| サンプル | 主なライブラリ |
|---------|---------------|
| x402-app | `x402-next`, Next.js, Viem |
| x402-demo | `@x402/core`, `@x402/express`, `@x402/svm`, `@solana/kit`, Express |

## セキュリティ

- `x402-demo/client.json` には秘密鍵が含まれます。`.gitignore` に追加し、Mainnet では使用しないでください
- 本番ではウォレット接続（Phantom等）を利用し、秘密鍵をファイルに保存しないでください

## 参考

- [x402 Network Support](https://docs.cdp.coinbase.com/x402/network-support)
- [Solana Explorer (Devnet)](https://explorer.solana.com/?cluster=devnet)
