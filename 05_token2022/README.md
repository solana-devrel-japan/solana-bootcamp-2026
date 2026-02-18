# トークン作成

今のところ私たちがお話しした唯一のトークンはSOLで、SOLはプログラムを実装した時にオンチェーンプログラムを動作させるために必要でしたね。
SOLはSolanaのネイティブトークンであり、Solana自体に組み込まれています。ただし、実世界でブロックチェーンを利用する場合、SOL以外の多くのトークンを使用することになるでしょう。Solanaでは、これらをSPLトークンと呼びます。名前について気になる方もいると思いますが、SPLはSolana Program Libraryの略称です。これは、トークンを作成、転送など、トークンに関する一連のプログラムが含まれています。

トークンはブロックチェーン上で様々なものを表現するために使用されます。USDCのようなステーブルコイン、NFT、株式や金属のような実世界の資産をブロックチェーン上で表現するためのトークンなど様々なトークンが存在します。

そしてトークンはトークンミントアカウントによって発行されます。ブロックチェーンの世界ではトークンを発行することをミントと呼びます。そして、トークンミントアカウントは大量のトークンを作るための工場のようなものです。工場の例で例えると、この工場ではMint Authorityと呼ばれるトークンを発行する権限を持った人によって運営されています。Mint Authorityは大量のトークンを発行する全ての取引に署名をする必要があります。

Solana上のトークンはそれぞれこの独自のミントアカウントを持っています。 例えばステーブルコインのUSDCはCircleという会社によって作られており、彼らのウェブサイトにはトークンのミントアカウントのアドレスが公開されています。Circle社はUSDCの発行権を持つMint Authorityということができます。

私たち自身のトークンを作成するには、私たち自身をMint Authorityとして設定します。Mint Authorityには任意のアドレスを設定することができて、そのアドレスを使って新しいSPLトークンを作成することができます。このアドレスはもちろん自分達が所持しているアドレスでも作成可能です。

また、私たちが所持している各ウォレットアドレスがトークンを受け取ると、このトークンを保存する箱が必要になります。通常のアドレスはネイティブトークンのSOLのみが保存できます。そのためAssociated Token Accountと呼ばれるSPLトークンを保存するためのアカウントを作成します。Associated Token Accountはウォレットアドレスとトークンミントアドレスから生成されたシードを元に作られたプログラム派生アドレス、PDAです。例えばアリスさんのウォレットアドレスとUSDCのミントアドレスを元にPDAを算出すればアリスさんのUSDCのAssociated Token Accountを見つけることができます。

## トークンミントの作成

[./01_create_token_mint/index.ts](./01_create_token_mint/index.ts)

## トークンアカウントの作成

[./02_create_token_account/index.ts](./02_create_token_account/index.ts)

## Associated Token Accountの作成

[./03_create_associated_token_account/index.ts](./03_create_associated_token_account/index.ts)

## トークンのミント

[./04_mint_token/index.ts](./04_mint_token/index.ts)

## トークンの転送

[./05_transfer_token/index.ts](./05_transfer_token/index.ts)

## アカウントのフリーズ

[./06_freeze_token/index.ts](./06_freeze_token/index.ts)

## アカウントの解凍

[./07_thaw_token/index.ts](./07_thaw_token/index.ts)

## トークンをバーンする

[./08_burn_token/index.ts](./08_burn_token/index.ts)

## トークンアカウントを閉じる

[./09_close_token_account/index.ts](./09_close_token_account/index.ts)
