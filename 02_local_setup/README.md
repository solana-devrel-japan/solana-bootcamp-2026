# ローカル環境セットアップ

ローカルの開発環境を構築していきます。
Solanaの開発に必要なツールをすべてインストールできるコマンドがありまして、Macの方はそのコマンドを実行すると開発を始められます。Windowsの方はWSL環境で開発をする必要がありまして、まずはWSLのセットアップを進めていきます。WSLのセットアップが終わったらMacの方と同様に開発で必要なツールすべてをインストールできるコマンドを実行すれば完了です。Macの方はWSLセットアップ手順の部分はスキップしていただいて大丈夫です。

# WSLセットアップ

1. Windows PowerShellを起動します。起動するときに「管理者として実行する」を選択して管理者モードで起動します。
2. アカウント制御に関する表示がでるので「はい」をクリックします。
3. PowerShellが起動できたら`wsl --install`コマンドを実行します。少し時間がかかります。
4. 無事インストールが完了しました。一度コンピュータを再起動しましょう。  
   **インストール成功ログ**

```
PS C:\Windows\system32> wsl --install
Windows オプション コンポーネントをインストールしています: VirtualMachinePlatform

展開イメージのサービスと管理ツール
バージョン: 10.0.26100.5074

イメージのバージョン: 10.0.26200.7623

機能を有効にしています
[==========================100.0%==========================]
操作は正常に完了しました。
要求された操作は正常に終了しました。変更を有効にするには、システムを再起動する必要があります。
```

5. 再起動ができたら再度Windows PowerShellを起動します。
6. WSLでインストールできるLinuxディストリビューションを確認してみます。`wsl --list --online`コマンドで確認できます。
7. 一覧が表示されたら一番上にあるUbuntuをインストールします。
8. `wsl --install -d Ubuntu`コマンドでインストールします。
9. インストール後はデフォルトユーザをセットアップします。まずはユーザ名です。
10. デフォルトユーザのパスワードを入力します。Root権限を使う際などにこちらのパスワードを使います。任意のパスワードを入れましょう。
11. 再度パスワードを聞かれるのでもう一度入力します。
12. 検索バーからも「Ubuntu」と検索することでUbuntuターミナルを開くことができます。

# WSL Visual Studio Codeでの確認

1. Visual Studio Codeを利用している場合はWSLの拡張機能をインストールすると一緒に利用ができます。
2. 拡張機能検索バーから「WSL」と入力してみましょう。
3. Microsoft公式の拡張機能をインストールします。
4. Visual Studio Codeの左のメニューの「Remote Explorer」をクリックすると、インストールしたUbuntuが表示されます。
5. Ubuntuをクリックすると新しいVisual Studio Codeエディタが立ち上がります。左下に「WSL:Ubuntu」と表示されるとVisual Studio CodeでもUbuntu環境が利用できます。
6. terminalを開くとセットアップしたユーザでUbuntu環境を使うことができます。

# Solana依存関係インストール

1. インストール方法はWindows・Mac共通です。Windowsの方はWSLのUbuntu環境を、Macの方はターミナルを開いてください。
2. 公式ドキュメントにインストールコマンドが掲載されているので確認してみます。[公式ドキュメント](`https://solana.com/ja/docs/intro/installation`)
3. 公式ドキュメント内に記載されているcurlコマンドをコピーしてターミナル上で実行します。
   ```
   curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
   ```
4. 管理者権限がインストール時に必要なため、実行時に管理者権限を利用するパスワードを入力します。
5. 今回インストールするツールの簡単な説明です。

- rustc: Rustのコンパイラです。SolanaではRustを使ってオンチェーン上のプログラムを実装します。
- Solana cli: テスト用ウォレットの作成やテストで利用するSOLの発行などができます。
- Anchor cli: AnchorはSolanaのプログラムを実装する際の開発フレームワークです。このCLIは開発したプログラムをテストやDevnet、MainnetBetaにデプロイすることができます。
- Surfpool cli: ローカル環境にバリデータノードを立てることができます。DevnetやMainnetにデプロイする前にローカルのバリデータノードで動作確認をしてデプロイします。
- Node.js: Onchain上のプログラムとのやり取りやDappsのフロントエンド、トークンの発行などがJavascriptやTypeScriptで実装できます。
- Yarn: Nodejsのパッケージ管理ツールです。

6. インストールが完了するとインストールされたツールのバージョンが表示されます。Surfpoolだけ'Not installed'となることがあるのでターミナルを再起動するとバージョンが確認できます。
   **バージョン確認コマンド**

```
rustc --version && solana --version && anchor --version && surfpool --version && node --version && yarn --version
```

# 参考

- [クイックインストール](https://solana.com/ja/docs/intro/installation)
  https://solana.com/ja/docs/intro/installation
- [WSL を使用して Windows に Linux をインストールする方法](https://learn.microsoft.com/ja-jp/windows/wsl/install)
