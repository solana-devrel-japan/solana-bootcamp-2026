use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{ self, Mint, TokenAccount, TokenInterface, TransferChecked };
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};
use crate::constants::{MAXIMUM_AGE, SOL_USD_FEED_ID, USDC_USD_FEED_ID, INTEREST_RATE_DECIMALS, SECONDS_PER_YEAR};
use crate::state::*;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut, 
        seeds = [mint.key().as_ref()],
        bump,
    )]  
    pub bank: Account<'info, Bank>,
    #[account(
        mut, 
        seeds = [b"treasury", mint.key().as_ref()],
        bump, 
    )]  
    pub bank_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut, 
        seeds = [signer.key().as_ref()],
        bump,
    )]  
    pub user_account: Account<'info, User>,
    #[account( 
        init_if_needed, 
        payer = signer,
        associated_token::mint = mint, 
        associated_token::authority = signer,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>, 
    pub price_update: Account<'info, PriceUpdateV2>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// 1. ユーザーが借入に十分な担保を持っているか確認
// 2. 安全な借入額を超えている場合は警告するが、最大借入可能額内であれば許可
// 3. BankのトークンアカウントからユーザーのトークンアカウントへCPI転送を実行
// 4. ユーザーの借入額と借入総額を更新
// 5. Bankの総借入額と総借入シェアを更新

pub fn process_borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
    // ゼロ額のチェック
    require!(amount > 0, ErrorCode::InvalidAmount);

    // ユーザーが借入に十分な担保を持っているか確認
    let bank = &mut ctx.accounts.bank;
    let user = &mut ctx.accounts.user_account;

    let price_update = &mut ctx.accounts.price_update;

    let total_collateral: u64;

    match ctx.accounts.mint.to_account_info().key() {
        key if key == user.usdc_address => {
            // USDCを借りる場合、担保はSOL
            let sol_feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID)?;
            let sol_price = price_update.get_price_no_older_than(&Clock::get()?, MAXIMUM_AGE, &sol_feed_id)?;

            // 負の価格をチェック
            require!(sol_price.price > 0, ErrorCode::InvalidPrice);

            let accrued_interest = calculate_accrued_interest(
                user.deposited_sol, 
                bank.interest_rate, 
                user.last_updated)?;
            let collateral_amount = user.deposited_sol
                .checked_add(accrued_interest)
                .ok_or(ErrorCode::MathOverflow)?;

            // Pythの価格にexponentを適用: price * 10^exponent
            // オーバーフロー防止のためu128を使用
            total_collateral = apply_price_with_exponent(
                collateral_amount,
                sol_price.price as u64,
                sol_price.exponent
            )?;
        },
        _ => {
            // SOLを借りる場合、担保はUSDC
            let usdc_feed_id = get_feed_id_from_hex(USDC_USD_FEED_ID)?;
            let usdc_price = price_update.get_price_no_older_than(&Clock::get()?, MAXIMUM_AGE, &usdc_feed_id)?;

            // 負の価格をチェック
            require!(usdc_price.price > 0, ErrorCode::InvalidPrice);

            let accrued_interest = calculate_accrued_interest(user.deposited_usdc, bank.interest_rate, user.last_updated)?;
            let collateral_amount = user.deposited_usdc
                .checked_add(accrued_interest)
                .ok_or(ErrorCode::MathOverflow)?;

            // Pythの価格にexponentを適用
            total_collateral = apply_price_with_exponent(
                collateral_amount,
                usdc_price.price as u64,
                usdc_price.exponent
            )?;
        }
    }

    let borrowable_amount = total_collateral
        .checked_mul(bank.max_ltv)
        .ok_or(ErrorCode::MathOverflow)?;

    // このアセットに対するユーザーの既存借入額を取得
    let existing_borrowed = match ctx.accounts.mint.to_account_info().key() {
        key if key == user.usdc_address => user.borrowed_usdc,
        _ => user.borrowed_sol,
    };

    // 新規借入 + 既存借入が借入可能額を超えていないかチェック
    let total_borrow_after = existing_borrowed
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    if borrowable_amount < total_borrow_after {
        return Err(ErrorCode::OverBorrowableAmount.into());
    }       

    let transfer_cpi_accounts = TransferChecked {
        from: ctx.accounts.bank_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.bank_token_account.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let mint_key = ctx.accounts.mint.key();
    let signer_seeds: &[&[&[u8]]] = &[
        &[
            b"treasury",
            mint_key.as_ref(),
            &[ctx.bumps.bank_token_account],
        ],
    ];
    let cpi_ctx = CpiContext::new(cpi_program, transfer_cpi_accounts).with_signer(signer_seeds);
    let decimals = ctx.accounts.mint.decimals;

    token_interface::transfer_checked(cpi_ctx, amount, decimals)?;

    let users_shares: u64;

    if bank.total_borrowed == 0 {
        // 初回借入: シェアは1:1の比率
        users_shares = amount;
    } else {
        // シェアを計算: (amount * total_shares) / total_borrowed
        // 整数除算による精度損失を避けるため、先に乗算を行う
        users_shares = amount
            .checked_mul(bank.total_borrowed_shares)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(bank.total_borrowed)
            .ok_or(ErrorCode::MathOverflow)?;
    }

    bank.total_borrowed += amount;
    bank.total_borrowed_shares += users_shares; 

    match ctx.accounts.mint.to_account_info().key() {
        key if key == user.usdc_address => {
            user.borrowed_usdc += amount;
            user.borrowed_usdc_shares += users_shares;
        },
        _ => {
            user.borrowed_sol += amount;
            user.borrowed_sol_shares += users_shares;
        }
    }

    Ok(())
}

/// 単利計算で発生した利息を計算（浮動小数点を使用しない）
/// 元本+利息ではなく、利息のみを返す
///
/// 計算式: interest = principal * rate * time / (INTEREST_RATE_DECIMALS * SECONDS_PER_YEAR)
///
/// interest_rateはbasis points単位（例: 500 = 年利5%）
fn calculate_accrued_interest(principal: u64, interest_rate: u64, last_update: i64) -> Result<u64> {
    let current_time = Clock::get()?.unix_timestamp;

    // last_updateが未来または同時刻の場合を処理
    if current_time <= last_update {
        return Ok(0);
    }

    let time_elapsed = (current_time - last_update) as u64;

    // 乗算時のオーバーフロー防止のためu128を使用
    // interest = principal * interest_rate * time_elapsed / (INTEREST_RATE_DECIMALS * SECONDS_PER_YEAR)
    let interest = (principal as u128)
        .checked_mul(interest_rate as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_mul(time_elapsed as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div((INTEREST_RATE_DECIMALS as u128) * (SECONDS_PER_YEAR as u128))
        .ok_or(ErrorCode::MathOverflow)?;

    // u64に変換して返す
    Ok(interest as u64)
}

/// Pythの価格にexponentを適用して金額を計算
/// Pythの価格形式: actual_price = price * 10^exponent
/// exponentは通常負の値（例: -8）
fn apply_price_with_exponent(amount: u64, price: u64, exponent: i32) -> Result<u64> {
    // オーバーフロー防止のため中間計算にu128を使用
    let amount_u128 = amount as u128;
    let price_u128 = price as u128;

    let value = amount_u128
        .checked_mul(price_u128)
        .ok_or(ErrorCode::MathOverflow)?;

    // exponentを適用（通常は負なので除算）
    let result = if exponent >= 0 {
        // 正のexponent: 10^exponentを乗算
        let multiplier = 10u128.pow(exponent as u32);
        value.checked_mul(multiplier).ok_or(ErrorCode::MathOverflow)?
    } else {
        // 負のexponent: 10^|exponent|で除算
        let divisor = 10u128.pow((-exponent) as u32);
        value.checked_div(divisor).ok_or(ErrorCode::MathOverflow)?
    };

    // u64に変換して返す
    Ok(result as u64)
}