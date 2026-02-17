use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{ self, Mint, TokenAccount, TokenInterface, TransferChecked };
use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct Deposit<'info> {
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
        mut,
        associated_token::mint = mint, 
        associated_token::authority = signer,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>, 
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// 1. ユーザーのトークンアカウントからBankのトークンアカウントへCPI転送
// 2. Bankに追加する新しいシェアを計算
// 3. ユーザーの預金額と預金シェアを更新
// 4. Bankの総預金額と総預金シェアを更新
// 5. ユーザーのヘルスファクターを更新（未実装）

pub fn process_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    // ゼロ額のチェック
    require!(amount > 0, ErrorCode::InvalidAmount);

    // CPI転送の設定
    let transfer_cpi_accounts = TransferChecked {
        from: ctx.accounts.user_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.bank_token_account.to_account_info(),
        authority: ctx.accounts.signer.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, transfer_cpi_accounts);
    let decimals = ctx.accounts.mint.decimals;

    // トークン転送を実行
    token_interface::transfer_checked(cpi_ctx, amount, decimals)?;

    // Bankに追加する新しいシェアを計算
    let bank = &mut ctx.accounts.bank;

    let users_shares: u64;

    if bank.total_deposits == 0 {
        // 初回預金: シェアは1:1の比率
        users_shares = amount;
    } else {
        // シェアを計算: (amount * total_shares) / total_deposits
        // 整数除算による精度損失を避けるため、先に乗算を行う
        users_shares = amount
            .checked_mul(bank.total_deposit_shares)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(bank.total_deposits)
            .ok_or(ErrorCode::MathOverflow)?;
    }

    let user = &mut ctx.accounts.user_account;

    // MintアドレスでアセットタイプをマッチしてUserの残高を更新
    match ctx.accounts.mint.to_account_info().key() {
        key if key == user.usdc_address => {
            user.deposited_usdc += amount;
            user.deposited_usdc_shares += users_shares;
        },
        _ => {
            user.deposited_sol += amount;
            user.deposited_sol_shares += users_shares;
        }
    }

    // 上記のmatch文は、プロトコルに新しいアセットが追加された際に
    // 簡単に新しいブランチを追加できます

    // Bankの総預金額と総シェアを更新
    bank.total_deposits += amount;
    bank.total_deposit_shares += users_shares;

    // 最終更新タイムスタンプを更新
    user.last_updated = Clock::get()?.unix_timestamp;

    Ok(())
}