use anchor_lang::prelude::*;
use anchor_spl::token_interface::{ Mint, TokenAccount, TokenInterface };
use crate::state::*;

#[derive(Accounts)]
pub struct InitBank<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, 
        space = 8 + Bank::INIT_SPACE, 
        payer = signer,
        seeds = [mint.key().as_ref()],
        bump, 
    )]
    pub bank: Account<'info, Bank>,
    #[account(
        init, 
        token::mint = mint, 
        token::authority = bank_token_account,
        payer = signer,
        seeds = [b"treasury", mint.key().as_ref()],
        bump,
    )]
    pub bank_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>, 
    pub system_program: Program <'info, System>,
}

#[derive(Accounts)]
pub struct InitUser<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    /// USDCのMintアカウント（検証済みのアドレスを取得するため）
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = signer,
        space = 8 + User::INIT_SPACE,
        seeds = [signer.key().as_ref()],
        bump,
    )]
    pub user_account: Account<'info, User>,
    pub system_program: Program <'info, System>,
}

pub fn process_init_bank(
    ctx: Context<InitBank>,
    liquidation_threshold: u64,
    max_ltv: u64,
    liquidation_bonus: u64,
    liquidation_close_factor: u64,
    interest_rate: u64,
) -> Result<()> {
    let bank = &mut ctx.accounts.bank;

    // 基本設定
    bank.mint_address = ctx.accounts.mint.key();
    bank.authority = ctx.accounts.signer.key();

    // 清算パラメータ
    bank.liquidation_threshold = liquidation_threshold;  // 例: 80 = 80%
    bank.max_ltv = max_ltv;                              // 例: 70 = 70%
    bank.liquidation_bonus = liquidation_bonus;          // 例: 5 = 5%ボーナス
    bank.liquidation_close_factor = liquidation_close_factor; // 例: 50 = 50%清算

    // 利率設定
    bank.interest_rate = interest_rate;                  // 例: 500 = 年利5%

    // 初期値（預金・借入は0から開始）
    bank.total_deposits = 0;
    bank.total_deposit_shares = 0;
    bank.total_borrowed = 0;
    bank.total_borrowed_shares = 0;

    // タイムスタンプ
    bank.last_updated = Clock::get()?.unix_timestamp;

    Ok(())
}

pub fn process_init_user(ctx: Context<InitUser>) -> Result<()> {
    let user = &mut ctx.accounts.user_account;
    user.owner = ctx.accounts.signer.key();
    // Mintアカウントから検証済みのUSDCアドレスを取得
    user.usdc_address = ctx.accounts.usdc_mint.key();

    let now = Clock::get()?.unix_timestamp;
    user.last_updated = now;

    Ok(())
}