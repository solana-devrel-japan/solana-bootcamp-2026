import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LendingProtocol } from "../target/types/lending_protocol";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("lending", () => {
  // プロバイダーの設定
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LendingProtocol as Program<LendingProtocol>;
  const connection = provider.connection;

  // テスト用のキーペア
  const admin = Keypair.generate();
  const user = Keypair.generate();

  // Mintアドレス
  let solMint: PublicKey;
  let usdcMint: PublicKey;

  // Bank PDA
  let solBankPda: PublicKey;
  let solBankBump: number;
  let usdcBankPda: PublicKey;
  let usdcBankBump: number;

  // Treasury PDA
  let solTreasuryPda: PublicKey;
  let usdcTreasuryPda: PublicKey;

  // User PDA
  let userAccountPda: PublicKey;
  let userAccountBump: number;

  // ユーザーのトークンアカウント
  let userSolAta: PublicKey;
  let userUsdcAta: PublicKey;

  // テスト用の定数
  const LIQUIDATION_THRESHOLD = 80; // 80%
  const MAX_LTV = 70; // 70%
  const LIQUIDATION_BONUS = 5; // 5%ボーナス
  const LIQUIDATION_CLOSE_FACTOR = 50; // 50%清算
  const INTEREST_RATE = 500; // 年利5% (basis points)
  const DEPOSIT_AMOUNT = 1_000_000_000; // 1 SOL (9 decimals)
  const USDC_DEPOSIT_AMOUNT = 100_000_000; // 100 USDC (6 decimals)

  before(async () => {
    // Airdrop SOL to admin and user
    const adminAirdrop = await connection.requestAirdrop(
      admin.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(adminAirdrop);

    const userAirdrop = await connection.requestAirdrop(
      user.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(userAirdrop);

    // SOL Mintの作成（テスト用のwrapped SOL的なもの）
    solMint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      9 // 9 decimals
    );

    // USDC Mintの作成
    usdcMint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      6 // 6 decimals
    );

    // Bank PDAの計算
    [solBankPda, solBankBump] = PublicKey.findProgramAddressSync(
      [solMint.toBuffer()],
      program.programId
    );

    [usdcBankPda, usdcBankBump] = PublicKey.findProgramAddressSync(
      [usdcMint.toBuffer()],
      program.programId
    );

    // Treasury PDAの計算
    [solTreasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), solMint.toBuffer()],
      program.programId
    );

    [usdcTreasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), usdcMint.toBuffer()],
      program.programId
    );

    // User Account PDAの計算
    [userAccountPda, userAccountBump] = PublicKey.findProgramAddressSync(
      [user.publicKey.toBuffer()],
      program.programId
    );

    // ユーザーのATAを作成
    userSolAta = await createAssociatedTokenAccount(
      connection,
      user,
      solMint,
      user.publicKey
    );

    userUsdcAta = await createAssociatedTokenAccount(
      connection,
      user,
      usdcMint,
      user.publicKey
    );

    // ユーザーにトークンをミント
    await mintTo(
      connection,
      admin,
      solMint,
      userSolAta,
      admin,
      DEPOSIT_AMOUNT * 10
    );

    await mintTo(
      connection,
      admin,
      usdcMint,
      userUsdcAta,
      admin,
      USDC_DEPOSIT_AMOUNT * 10
    );

    console.log("=== セットアップ完了 ===");
    console.log("SOL Mint:", solMint.toBase58());
    console.log("USDC Mint:", usdcMint.toBase58());
    console.log("SOL Bank PDA:", solBankPda.toBase58());
    console.log("USDC Bank PDA:", usdcBankPda.toBase58());
    console.log("User Account PDA:", userAccountPda.toBase58());
  });

  describe("init_bank", () => {
    it("SOL Bankを初期化できる", async () => {
      const tx = await program.methods
        .initBank(
          new anchor.BN(LIQUIDATION_THRESHOLD),
          new anchor.BN(MAX_LTV),
          new anchor.BN(LIQUIDATION_BONUS),
          new anchor.BN(LIQUIDATION_CLOSE_FACTOR),
          new anchor.BN(INTEREST_RATE)
        )
        .accounts({
          signer: admin.publicKey,
          mint: solMint,
          bank: solBankPda,
          bankTokenAccount: solTreasuryPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      console.log("SOL Bank初期化 tx:", tx);

      // Bankアカウントの確認
      const bankAccount = await program.account.bank.fetch(solBankPda);
      assert.equal(
        bankAccount.authority.toBase58(),
        admin.publicKey.toBase58()
      );
      assert.equal(bankAccount.mintAddress.toBase58(), solMint.toBase58());
      assert.equal(
        bankAccount.liquidationThreshold.toNumber(),
        LIQUIDATION_THRESHOLD
      );
      assert.equal(bankAccount.maxLtv.toNumber(), MAX_LTV);
      assert.equal(bankAccount.liquidationBonus.toNumber(), LIQUIDATION_BONUS);
      assert.equal(bankAccount.liquidationCloseFactor.toNumber(), LIQUIDATION_CLOSE_FACTOR);
      assert.equal(bankAccount.interestRate.toNumber(), INTEREST_RATE);
      assert.equal(bankAccount.totalDeposits.toNumber(), 0);
      assert.equal(bankAccount.totalDepositShares.toNumber(), 0);
    });

    it("USDC Bankを初期化できる", async () => {
      const tx = await program.methods
        .initBank(
          new anchor.BN(LIQUIDATION_THRESHOLD),
          new anchor.BN(MAX_LTV),
          new anchor.BN(LIQUIDATION_BONUS),
          new anchor.BN(LIQUIDATION_CLOSE_FACTOR),
          new anchor.BN(INTEREST_RATE)
        )
        .accounts({
          signer: admin.publicKey,
          mint: usdcMint,
          bank: usdcBankPda,
          bankTokenAccount: usdcTreasuryPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      console.log("USDC Bank初期化 tx:", tx);

      const bankAccount = await program.account.bank.fetch(usdcBankPda);
      assert.equal(bankAccount.mintAddress.toBase58(), usdcMint.toBase58());
      assert.equal(bankAccount.liquidationBonus.toNumber(), LIQUIDATION_BONUS);
    });
  });

  describe("init_user", () => {
    it("ユーザーアカウントを初期化できる", async () => {
      const tx = await program.methods
        .initUser()
        .accounts({
          signer: user.publicKey,
          usdcMint: usdcMint,
          userAccount: userAccountPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      console.log("ユーザー初期化 tx:", tx);

      const userAccount = await program.account.user.fetch(userAccountPda);
      assert.equal(userAccount.owner.toBase58(), user.publicKey.toBase58());
      assert.equal(userAccount.usdcAddress.toBase58(), usdcMint.toBase58());
      assert.equal(userAccount.depositedSol.toNumber(), 0);
      assert.equal(userAccount.depositedUsdc.toNumber(), 0);
    });
  });

  describe("deposit", () => {
    it("SOLを預金できる", async () => {
      const tx = await program.methods
        .deposit(new anchor.BN(DEPOSIT_AMOUNT))
        .accounts({
          signer: user.publicKey,
          mint: solMint,
          bank: solBankPda,
          bankTokenAccount: solTreasuryPda,
          userAccount: userAccountPda,
          userTokenAccount: userSolAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      console.log("SOL預金 tx:", tx);

      // Userアカウントの確認
      const userAccount = await program.account.user.fetch(userAccountPda);
      assert.equal(userAccount.depositedSol.toNumber(), DEPOSIT_AMOUNT);

      // Bankアカウントの確認
      const bankAccount = await program.account.bank.fetch(solBankPda);
      assert.equal(bankAccount.totalDeposits.toNumber(), DEPOSIT_AMOUNT);
      assert.equal(bankAccount.totalDepositShares.toNumber(), DEPOSIT_AMOUNT);
    });

    it("USDCを預金できる", async () => {
      const tx = await program.methods
        .deposit(new anchor.BN(USDC_DEPOSIT_AMOUNT))
        .accounts({
          signer: user.publicKey,
          mint: usdcMint,
          bank: usdcBankPda,
          bankTokenAccount: usdcTreasuryPda,
          userAccount: userAccountPda,
          userTokenAccount: userUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      console.log("USDC預金 tx:", tx);

      const userAccount = await program.account.user.fetch(userAccountPda);
      assert.equal(userAccount.depositedUsdc.toNumber(), USDC_DEPOSIT_AMOUNT);
    });

    it("ゼロ額の預金は失敗する", async () => {
      try {
        await program.methods
          .deposit(new anchor.BN(0))
          .accounts({
            signer: user.publicKey,
            mint: solMint,
            bank: solBankPda,
            bankTokenAccount: solTreasuryPda,
            userAccount: userAccountPda,
            userTokenAccount: userSolAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();

        assert.fail("ゼロ額の預金が成功してしまった");
      } catch (error) {
        assert.include(error.message, "InvalidAmount");
        console.log("ゼロ額の預金は正しく拒否された");
      }
    });
  });

  describe("withdraw", () => {
    it("SOLを引き出せる", async () => {
      const withdrawAmount = DEPOSIT_AMOUNT / 2;

      const tx = await program.methods
        .withdraw(new anchor.BN(withdrawAmount))
        .accounts({
          signer: user.publicKey,
          mint: solMint,
          bank: solBankPda,
          bankTokenAccount: solTreasuryPda,
          userAccount: userAccountPda,
          userTokenAccount: userSolAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      console.log("SOL引き出し tx:", tx);

      const userAccount = await program.account.user.fetch(userAccountPda);
      assert.equal(
        userAccount.depositedSol.toNumber(),
        DEPOSIT_AMOUNT - withdrawAmount
      );

      const bankAccount = await program.account.bank.fetch(solBankPda);
      assert.equal(
        bankAccount.totalDeposits.toNumber(),
        DEPOSIT_AMOUNT - withdrawAmount
      );
    });

    it("預金額を超える引き出しは失敗する", async () => {
      const userAccount = await program.account.user.fetch(userAccountPda);
      const currentDeposit = userAccount.depositedSol.toNumber();

      try {
        await program.methods
          .withdraw(new anchor.BN(currentDeposit + 1))
          .accounts({
            signer: user.publicKey,
            mint: solMint,
            bank: solBankPda,
            bankTokenAccount: solTreasuryPda,
            userAccount: userAccountPda,
            userTokenAccount: userSolAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();

        assert.fail("預金額を超える引き出しが成功してしまった");
      } catch (error) {
        assert.include(error.message, "InsufficientFunds");
        console.log("預金額を超える引き出しは正しく拒否された");
      }
    });
  });

  describe("repay", () => {
    it("借入がない状態での返済は失敗する", async () => {
      try {
        await program.methods
          .repay(new anchor.BN(1000))
          .accounts({
            signer: user.publicKey,
            mint: solMint,
            bank: solBankPda,
            bankTokenAccount: solTreasuryPda,
            userAccount: userAccountPda,
            userTokenAccount: userSolAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();

        assert.fail("借入がない状態での返済が成功してしまった");
      } catch (error) {
        assert.include(error.message, "OverRepay");
        console.log("借入がない状態での返済は正しく拒否された");
      }
    });
  });

  describe("アカウント状態の確認", () => {
    it("Bankアカウントの状態を確認できる", async () => {
      const solBank = await program.account.bank.fetch(solBankPda);
      const usdcBank = await program.account.bank.fetch(usdcBankPda);

      console.log("\n=== SOL Bank ===");
      console.log("Authority:", solBank.authority.toBase58());
      console.log("Total Deposits:", solBank.totalDeposits.toString());
      console.log("Total Deposit Shares:", solBank.totalDepositShares.toString());
      console.log("Liquidation Threshold:", solBank.liquidationThreshold.toString(), "%");
      console.log("Max LTV:", solBank.maxLtv.toString(), "%");
      console.log("Liquidation Bonus:", solBank.liquidationBonus.toString(), "%");
      console.log("Liquidation Close Factor:", solBank.liquidationCloseFactor.toString(), "%");
      console.log("Interest Rate:", solBank.interestRate.toString(), "basis points");

      console.log("\n=== USDC Bank ===");
      console.log("Authority:", usdcBank.authority.toBase58());
      console.log("Total Deposits:", usdcBank.totalDeposits.toString());
      console.log("Liquidation Bonus:", usdcBank.liquidationBonus.toString(), "%");
    });

    it("Userアカウントの状態を確認できる", async () => {
      const userAccount = await program.account.user.fetch(userAccountPda);

      console.log("\n=== User Account ===");
      console.log("Owner:", userAccount.owner.toBase58());
      console.log("Deposited SOL:", userAccount.depositedSol.toString());
      console.log("Deposited SOL Shares:", userAccount.depositedSolShares.toString());
      console.log("Deposited USDC:", userAccount.depositedUsdc.toString());
      console.log("Deposited USDC Shares:", userAccount.depositedUsdcShares.toString());
      console.log("Borrowed SOL:", userAccount.borrowedSol.toString());
      console.log("Borrowed USDC:", userAccount.borrowedUsdc.toString());
    });
  });
});
