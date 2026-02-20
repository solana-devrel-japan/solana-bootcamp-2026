# Hello World

Solana Playground で Anchor を使用して Hello World プログラムを作成します。

Solana Playground はブラウザ上で動作する Solana の開発環境です。ローカルに何もインストールしなくても、Solana プログラムの作成・ビルド・デプロイ・テストをすべてブラウザ上で行うことができます。

Anchor は Solana プログラムの開発フレームワークです。素の Rust で書くよりもコードが少なく済み、セキュリティチェックも自動で行ってくれるため、初学者にも扱いやすくなっています。

## Solana Playground を開く

[beta.solpg.io](https://beta.solpg.io) にブラウザからアクセス

## ウォレットを作成する

1. 画面左下の「**🔴 Not connected**」をクリック
2. Playground Wallet の作成画面が表示されるので、「**Continue**」をクリック
3. 画面左下に「**🟢 Connected to Playground Wallet**」と表示されれば作成成功

## Devnet SOL を取得する

デプロイには少量の SOL が必要です。
テスト用 SOL を Solana Faucet から取得します。

1. [faucet.solana.com](https://faucet.solana.com) にブラウザからアクセス
2. 「**Connect your GitHub**」をクリックしアカウントをコネクト
3. Amount で「**5 SOL**」を選択
4. Solana Playground 画面左下のウォレットアドレスをコピー
5. Solana Faucet にアドレスを貼り付けて「**Confirm Airdrop**」をクリック
6. `Success` と表示されたら成功
7. Solana Playground 画面左下のウォレットに SOL が入金されていることを確認

## プロジェクトを作成する

1. 左サイドバーの「**+ Create a new project**」をクリック
2. 「Project name」を入力（例: `hello_world`）
3. 「Choose a framework」で「**Anchor (Rust)**」を選択
4. 「**Create**」をクリックしてプロジェクトを作成

## コードを書く

左サイドバーの `src/lib.rs` を開き、既に書かれているコードを全て削除し、以下のコードを記述します。

```rust
// Anchor をインポート
use anchor_lang::prelude::*;

// Solana の各プログラムが持つ固有のアドレス（Program ID）を宣言
// Playground ではビルド時に自動で入力されるため、今は空のままで大丈夫
declare_id!("");

// プログラム本体のモジュール。この中に Instruction（命令）を記述する
#[program]
mod hello_world {
    use super::*;

    // 1つの Instruction を定義する関数
    // Anchor ではすべての Instruction の第1引数に Context を取る
    // Result<()> は成功か失敗かを返す
    pub fn hello(ctx: Context<Hello>) -> Result<()> {
        // Solana 上でのログ出力マクロ
        msg!("Hello, World!");
        Ok(())
    }
}

// Instruction が使用するアカウントを定義
// 今回はアカウントを使用しないため中身は空だが、Anchor の構文上この定義が必要
#[derive(Accounts)]
pub struct Hello {}
```

## ビルドする

左サイドバーの「**Build**」をクリック。

`declare_id!("")` に Program ID が自動入力されていることも確認してください。
ターミナルに `Build successful` と表示されれば OK です。

## デプロイする

左サイドバーの「**Deploy**」をクリック。

ターミナルに `Deployment successful` と表示されれば OK です。
プログラムが Devnet 上に公開されます。

## テストを実行する

左サイドバーの `tests/anchor.test.ts` を開き、既に書かれているコードを全て削除し、以下のコードを記述します。

```typescript
describe("Test", () => {
  it("hello", async () => {
    await pg.program.methods
      .hello()      // Rust で定義した hello Instruction を呼び出す
      .accounts({}) // アカウント不使用のため空
      .rpc();       // トランザクションを送信
  });
});
```

左サイドバーの「**Test**」をクリック。

ターミナルに `1 passing` と表示されれば成功です

## 参考

- [Solana Playground](https://beta.solpg.io)
- [Solana Faucet](https://faucet.solana.com)
- [Anchor Docs](https://www.anchor-lang.com)
