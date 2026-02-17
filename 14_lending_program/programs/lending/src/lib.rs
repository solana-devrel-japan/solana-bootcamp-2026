use anchor_lang::prelude::*;
use instructions::*;

pub mod state;
pub mod instructions;
pub mod error;
pub mod constants;

pub use state::*;

declare_id!("CdZeD33fXsAHfZYS8jdxg4qHgXYJwBQ1Bv6GJyETtLST");

#[program]
pub mod lending_protocol {

    use super::*;

    pub fn init_bank(
        ctx: Context<InitBank>,
        liquidation_threshold: u64,
        max_ltv: u64,
        liquidation_bonus: u64,
        liquidation_close_factor: u64,
        interest_rate: u64,
    ) -> Result<()> {
        process_init_bank(
            ctx,
            liquidation_threshold,
            max_ltv,
            liquidation_bonus,
            liquidation_close_factor,
            interest_rate,
        )
    }

    pub fn init_user(ctx: Context<InitUser>) -> Result<()> {
        process_init_user(ctx)
    }

    pub fn deposit (ctx: Context<Deposit>, amount: u64) -> Result<()> {
        process_deposit(ctx, amount)
    }

    pub fn withdraw (ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        process_withdraw(ctx, amount)
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        process_borrow(ctx, amount)
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        process_repay(ctx, amount)
    }

    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        process_liquidate(ctx)
    }
}
