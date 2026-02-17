import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Oracle } from "../target/types/oracle";
import { PublicKey } from "@solana/web3.js";

describe("oracle", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.oracle as Program<Oracle>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const SOL_USD_ACCOUNT_ADDRESS =
    "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";

  const SOL_USD_FEED_ACCOUNT = new PublicKey(SOL_USD_ACCOUNT_ADDRESS);

  it("Get SOL price", async () => {
    const accountInfo = await provider.connection.getAccountInfo(
      SOL_USD_FEED_ACCOUNT
    );

    const tx = await program.methods
      .getSolPrice()
      .accounts({
        priceUpdate: SOL_USD_FEED_ACCOUNT,
      })
      .rpc();

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    console.log("TX Details:", txDetails);
  });
});
