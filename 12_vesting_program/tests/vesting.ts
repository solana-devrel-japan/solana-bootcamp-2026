import * as anchor from "@coral-xyz/anchor";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";
import { BankrunProvider } from "anchor-bankrun";
import { BanksClient, startAnchor, ProgramTestContext } from "solana-bankrun";
import { Program } from "@coral-xyz/anchor";
import { Vesting } from "../target/types/vesting";
import { createMint, mintTo } from "spl-token-bankrun";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

describe("vesting", () => {

  const vestingId = new anchor.BN(1);
  const startTime = new anchor.BN(0);
  const endTime = new anchor.BN(500);
  const cliffTime = new anchor.BN(300);
  const totalAmount = new anchor.BN(1_000_000);

  let beneficiary: anchor.web3.Keypair;
  let programId: anchor.web3.PublicKey;
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let banksClient: BanksClient;
  let program: Program<Vesting>;
  let member: anchor.web3.Keypair;
  let mint: anchor.web3.PublicKey;
  let vestingAccountPda: anchor.web3.PublicKey;
  let memberAccountPda: anchor.web3.PublicKey;
  let treasuryTokenAccountPda: anchor.web3.PublicKey;

  before(async () => {
    beneficiary = new anchor.web3.Keypair();
    programId = new anchor.web3.PublicKey("E59xEv3EjfHdkDBrrgwWNdXtCJoG7yxXyQAYVCj8wjx3");
    context = await startAnchor("",
      [{ name: "vesting", programId }],
      [{ address: beneficiary.publicKey,
        info: {
          executable: false,
          owner: SYSTEM_PROGRAM_ID,
          lamports: 1_000_000_000,
          data: Buffer.alloc(0),
        } }]);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    banksClient = context.banksClient;
    program = await anchor.workspace.vesting as Program<Vesting>;

    member = provider.wallet.payer;

    mint = await createMint(
      banksClient,
      member,
      member.publicKey,
      null,
      9
    );
    [vestingAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vesting"), vestingId.toArrayLike(Buffer, "le", 8)],
      programId
    );
    [memberAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("member"), beneficiary.publicKey.toBuffer(), vestingAccountPda.toBuffer()],
      programId
    );
    [treasuryTokenAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_treasury"), vestingId.toArrayLike(Buffer, "le", 8)],
      programId
    );

  });
  it("should initialize vesting account", async () => {
    await program.methods.initializeVestingAccount(new anchor.BN(1)).accounts({
      owner: member.publicKey,
      treasuryMint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

  });
  it("should initialize member account", async () => {

    await program.methods.initializeMemberAccount(
      vestingId,
      startTime,
      endTime,
      cliffTime,
      totalAmount,
    ).accounts({
      owner: member.publicKey,
      beneficiary: beneficiary.publicKey,
      vestingAccount: vestingAccountPda,
    }).rpc();
  });
  it("should fund to treasury token account", async () => {

    const amount = new anchor.BN(100_000_000);
    await mintTo(
      banksClient,
      member,
      mint,
      treasuryTokenAccountPda,
      member,
      amount,
    );
  });
  it("should claim tokens", async () => {

    // Advance clock past cliff_time
    const currentClock = await banksClient.getClock();
    context.setClock(
      new (await import("solana-bankrun")).Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        BigInt(400),
      )
    );

    const beneficiaryAta = getAssociatedTokenAddressSync(
      mint,
      beneficiary.publicKey,
      false,
      TOKEN_PROGRAM_ID,
    );

    await program.methods.claimTokens(vestingId).accounts({
      beneficiary: beneficiary.publicKey,
      vestingAccount: vestingAccountPda,
      memberAccount: memberAccountPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      treasuryTokenAccount: treasuryTokenAccountPda,
      treasuryMint: mint,
      memberTokenAccount: beneficiaryAta,
    }).signers([beneficiary]).rpc();
  });
});
