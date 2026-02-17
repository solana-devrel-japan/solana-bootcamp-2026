use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{ get_feed_id_from_hex ,PriceUpdateV2};

declare_id!("HskMhwqViXDXYCo7CYEmhuW5mf2UrLEgh3G1G6NT3mBq");

// See: https://www.pyth.network/developers/price-feed-ids
pub const SOL_USD_FEED_ID: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const USDC_USD_FEED_ID: &str = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

// Maximum age for price updates (in seconds)
// Devnetでは更新頻度が低いため、テスト用に600秒（10分）に設定
pub const MAXIMUM_AGE: u64 = 600;

#[program]
pub mod oracle {
    use super::*;
    
    pub fn get_sol_price(ctx: Context<GetPrice>) -> Result<()> {
        let price_update = &ctx.accounts.price_update;
        let clock = Clock::get()?;
        let sol_feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID)?;
        let price = price_update.get_price_no_older_than(&clock, MAXIMUM_AGE, &sol_feed_id)?;

        msg!("SOL price: {}", price.price);
        msg!("SOL Confidence: {}", price.conf);
        msg!("SOL Exponent: {}", price.exponent);
        Ok(())
    }

    pub fn get_usdc_price(ctx: Context<GetPrice>) -> Result<()> {
        let price_update = &ctx.accounts.price_update;
        let clock = Clock::get()?;
        let usdc_feed_id = get_feed_id_from_hex(USDC_USD_FEED_ID)?;
        let price = price_update.get_price_no_older_than(&clock, MAXIMUM_AGE, &usdc_feed_id)?;

        msg!("USDC price: {}", price.price);
        msg!("USDC Confidence: {}", price.conf);
        msg!("USDC Exponent: {}", price.exponent);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct GetPrice<'info> {
    pub price_update: Account<'info, PriceUpdateV2>,
}