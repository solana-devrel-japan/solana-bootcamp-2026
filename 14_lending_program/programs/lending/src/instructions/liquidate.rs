use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{ self, Mint, TokenAccount, TokenInterface, TransferChecked };
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};
use crate::constants::{MAXIMUM_AGE, SOL_USD_FEED_ID, USDC_USD_FEED_ID};
use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,
    pub price_update: Account<'info, PriceUpdateV2>,
    pub collateral_mint: InterfaceAccount<'info, Mint>,
    pub borrowed_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut, 
        seeds = [collateral_mint.key().as_ref()],
        bump,
    )]  
    pub collateral_bank: Account<'info, Bank>,
    #[account(
        mut, 
        seeds = [b"treasury", collateral_mint.key().as_ref()],
        bump, 
    )]  
    pub collateral_bank_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut, 
        seeds = [borrowed_mint.key().as_ref()],
        bump,
    )]  
    pub borrowed_bank: Account<'info, Bank>,
    #[account(
        mut, 
        seeds = [b"treasury", borrowed_mint.key().as_ref()],
        bump, 
    )]  
    pub borrowed_bank_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut, 
        seeds = [liquidator.key().as_ref()],
        bump,
    )]  
    pub user_account: Account<'info, User>,
    #[account( 
        init_if_needed, 
        payer = liquidator,
        associated_token::mint = collateral_mint, 
        associated_token::authority = liquidator,
        associated_token::token_program = token_program,
    )]
    pub liquidator_collateral_token_account: InterfaceAccount<'info, TokenAccount>, 
    #[account( 
        init_if_needed, 
        payer = liquidator,
        associated_token::mint = borrowed_mint, 
        associated_token::authority = liquidator,
        associated_token::token_program = token_program,
    )]
    pub liquidator_borrowed_token_account: InterfaceAccount<'info, TokenAccount>, 
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// 1. ユーザーが担保不足かどうかをチェック
// 2. 清算額を計算
// 3. 清算者のトークンアカウントからBankのトークンアカウントへCPI転送
// 4. ユーザーとBankの状態を更新
// 5. 手数料と報酬を処理

// 精度定数（パーセンテージ計算用: 100 = 100%）
const PERCENTAGE_PRECISION: u64 = 100;

pub fn process_liquidate(ctx: Context<Liquidate>) -> Result<()> {
    let collateral_bank = &mut ctx.accounts.collateral_bank;
    let borrowed_bank = &mut ctx.accounts.borrowed_bank;
    let user = &mut ctx.accounts.user_account;

    let price_update = &mut ctx.accounts.price_update;

    let sol_feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID)?;
    let usdc_feed_id = get_feed_id_from_hex(USDC_USD_FEED_ID)?;

    let sol_price = price_update.get_price_no_older_than(&Clock::get()?, MAXIMUM_AGE, &sol_feed_id)?;
    let usdc_price = price_update.get_price_no_older_than(&Clock::get()?, MAXIMUM_AGE, &usdc_feed_id)?;

    // 負の価格をチェック
    require!(sol_price.price > 0, ErrorCode::InvalidPrice);
    require!(usdc_price.price > 0, ErrorCode::InvalidPrice);

    // 注意: 簡略化のため、利息は計算に含まれていない

    // Pythの価格にexponentを適用して担保と借入の総額を計算（USD価値）
    let sol_collateral_value = apply_price_with_exponent(
        user.deposited_sol,
        sol_price.price as u64,
        sol_price.exponent
    )?;
    let usdc_collateral_value = apply_price_with_exponent(
        user.deposited_usdc,
        usdc_price.price as u64,
        usdc_price.exponent
    )?;
    let total_collateral_value = sol_collateral_value
        .checked_add(usdc_collateral_value)
        .ok_or(ErrorCode::MathOverflow)?;

    let sol_borrowed_value = apply_price_with_exponent(
        user.borrowed_sol,
        sol_price.price as u64,
        sol_price.exponent
    )?;
    let usdc_borrowed_value = apply_price_with_exponent(
        user.borrowed_usdc,
        usdc_price.price as u64,
        usdc_price.exponent
    )?;
    let total_borrowed_value = sol_borrowed_value
        .checked_add(usdc_borrowed_value)
        .ok_or(ErrorCode::MathOverflow)?;

    // ゼロ除算を防ぐ（借入がない場合は清算不可）
    require!(total_borrowed_value > 0, ErrorCode::NotUndercollateralized);

    // Health factorを計算: (担保価値 * 清算閾値) / (借入価値 * 100)
    // Health factor < 100 の場合、担保不足
    let health_factor = (total_collateral_value as u128)
        .checked_mul(collateral_bank.liquidation_threshold as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(total_borrowed_value as u128)
        .ok_or(ErrorCode::MathOverflow)? as u64;

    // Health factor >= 100 の場合、担保は十分
    if health_factor >= PERCENTAGE_PRECISION {
        return Err(ErrorCode::NotUndercollateralized.into());
    }

    // 清算額を計算（借入価値の一部をトークン数量に変換）
    // liquidation_close_factor はパーセンテージ（例: 50 = 50%）
    let liquidation_value = (total_borrowed_value as u128)
        .checked_mul(collateral_bank.liquidation_close_factor as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(PERCENTAGE_PRECISION as u128)
        .ok_or(ErrorCode::MathOverflow)? as u64;

    // 借入トークンの価格を取得して、USD価値からトークン数量に変換
    let borrowed_token_price = match ctx.accounts.borrowed_mint.to_account_info().key() {
        key if key == user.usdc_address => usdc_price.price as u64,
        _ => sol_price.price as u64,
    };
    let borrowed_token_exponent = match ctx.accounts.borrowed_mint.to_account_info().key() {
        key if key == user.usdc_address => usdc_price.exponent,
        _ => sol_price.exponent,
    };

    // USD価値からトークン数量に変換（価格で割る）
    let liquidation_amount = convert_value_to_amount(
        liquidation_value,
        borrowed_token_price,
        borrowed_token_exponent
    )?;

    // 清算者が借入額をBankに返済
    let transfer_to_bank = TransferChecked {
        from: ctx.accounts.liquidator_borrowed_token_account.to_account_info(),
        mint: ctx.accounts.borrowed_mint.to_account_info(),
        to: ctx.accounts.borrowed_bank_token_account.to_account_info(),
        authority: ctx.accounts.liquidator.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx_to_bank = CpiContext::new(cpi_program.clone(), transfer_to_bank);
    let decimals = ctx.accounts.borrowed_mint.decimals;

    token_interface::transfer_checked(cpi_ctx_to_bank, liquidation_amount, decimals)?;

    // 担保トークンの価格を取得
    let collateral_token_price = match ctx.accounts.collateral_mint.to_account_info().key() {
        key if key == user.usdc_address => usdc_price.price as u64,
        _ => sol_price.price as u64,
    };
    let collateral_token_exponent = match ctx.accounts.collateral_mint.to_account_info().key() {
        key if key == user.usdc_address => usdc_price.exponent,
        _ => sol_price.exponent,
    };

    // 清算ボーナスを含めた担保額を計算
    // liquidation_bonus はパーセンテージ（例: 5 = 5%ボーナス）
    let liquidation_value_with_bonus = (liquidation_value as u128)
        .checked_mul((PERCENTAGE_PRECISION + collateral_bank.liquidation_bonus) as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(PERCENTAGE_PRECISION as u128)
        .ok_or(ErrorCode::MathOverflow)? as u64;

    // USD価値からトークン数量に変換
    let collateral_to_liquidator = convert_value_to_amount(
        liquidation_value_with_bonus,
        collateral_token_price,
        collateral_token_exponent
    )?;

    // 清算者に担保+ボーナスを転送
    let transfer_to_liquidator = TransferChecked {
        from: ctx.accounts.collateral_bank_token_account.to_account_info(),
        mint: ctx.accounts.collateral_mint.to_account_info(),
        to: ctx.accounts.liquidator_collateral_token_account.to_account_info(),
        authority: ctx.accounts.collateral_bank_token_account.to_account_info(),
    };

    let mint_key = ctx.accounts.collateral_mint.key();
    let signer_seeds: &[&[&[u8]]] = &[
        &[
            b"treasury",
            mint_key.as_ref(),
            &[ctx.bumps.collateral_bank_token_account],
        ],
    ];
    let cpi_ctx_to_liquidator = CpiContext::new(cpi_program.clone(), transfer_to_liquidator)
        .with_signer(signer_seeds);
    let collateral_decimals = ctx.accounts.collateral_mint.decimals;
    token_interface::transfer_checked(cpi_ctx_to_liquidator, collateral_to_liquidator, collateral_decimals)?;

    // 借入シェアを計算
    let borrowed_shares_to_remove = if borrowed_bank.total_borrowed > 0 {
        (liquidation_amount as u128)
            .checked_mul(borrowed_bank.total_borrowed_shares as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(borrowed_bank.total_borrowed as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64
    } else {
        0
    };

    // 担保シェアを計算
    let collateral_shares_to_remove = if collateral_bank.total_deposits > 0 {
        (collateral_to_liquidator as u128)
            .checked_mul(collateral_bank.total_deposit_shares as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(collateral_bank.total_deposits as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64
    } else {
        0
    };

    // ユーザーの借入額とシェアを更新
    match ctx.accounts.borrowed_mint.to_account_info().key() {
        key if key == user.usdc_address => {
            user.borrowed_usdc = user.borrowed_usdc.saturating_sub(liquidation_amount);
            user.borrowed_usdc_shares = user.borrowed_usdc_shares.saturating_sub(borrowed_shares_to_remove);
        },
        _ => {
            user.borrowed_sol = user.borrowed_sol.saturating_sub(liquidation_amount);
            user.borrowed_sol_shares = user.borrowed_sol_shares.saturating_sub(borrowed_shares_to_remove);
        }
    }

    // ユーザーの担保額とシェアを更新
    match ctx.accounts.collateral_mint.to_account_info().key() {
        key if key == user.usdc_address => {
            user.deposited_usdc = user.deposited_usdc.saturating_sub(collateral_to_liquidator);
            user.deposited_usdc_shares = user.deposited_usdc_shares.saturating_sub(collateral_shares_to_remove);
        },
        _ => {
            user.deposited_sol = user.deposited_sol.saturating_sub(collateral_to_liquidator);
            user.deposited_sol_shares = user.deposited_sol_shares.saturating_sub(collateral_shares_to_remove);
        }
    }

    // Bankの総借入額とシェアを更新
    borrowed_bank.total_borrowed = borrowed_bank.total_borrowed.saturating_sub(liquidation_amount);
    borrowed_bank.total_borrowed_shares = borrowed_bank.total_borrowed_shares.saturating_sub(borrowed_shares_to_remove);

    // Bankの総預金額とシェアを更新
    collateral_bank.total_deposits = collateral_bank.total_deposits.saturating_sub(collateral_to_liquidator);
    collateral_bank.total_deposit_shares = collateral_bank.total_deposit_shares.saturating_sub(collateral_shares_to_remove);

    Ok(())
}

/// Pythの価格にexponentを適用して金額を計算
/// Pythの価格形式: actual_price = price * 10^exponent
fn apply_price_with_exponent(amount: u64, price: u64, exponent: i32) -> Result<u64> {
    let amount_u128 = amount as u128;
    let price_u128 = price as u128;

    let value = amount_u128
        .checked_mul(price_u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let result = if exponent >= 0 {
        let multiplier = 10u128.pow(exponent as u32);
        value.checked_mul(multiplier).ok_or(ErrorCode::MathOverflow)?
    } else {
        let divisor = 10u128.pow((-exponent) as u32);
        value.checked_div(divisor).ok_or(ErrorCode::MathOverflow)?
    };

    Ok(result as u64)
}

/// USD価値からトークン数量に変換（価格で割る）
fn convert_value_to_amount(value: u64, price: u64, exponent: i32) -> Result<u64> {
    let value_u128 = value as u128;
    let price_u128 = price as u128;

    // exponentが負の場合、価格で割るには乗算が必要
    let result = if exponent >= 0 {
        let multiplier = 10u128.pow(exponent as u32);
        value_u128
            .checked_div(price_u128.checked_mul(multiplier).ok_or(ErrorCode::MathOverflow)?)
            .ok_or(ErrorCode::MathOverflow)?
    } else {
        let multiplier = 10u128.pow((-exponent) as u32);
        value_u128
            .checked_mul(multiplier)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(price_u128)
            .ok_or(ErrorCode::MathOverflow)?
    };

    Ok(result as u64)
}