use anchor_lang::prelude::*;

declare_id!("pNfihHVweHWNYyd8jQdFdjKshAtjg6Raoq7Q5JYyh1h");

#[program]
pub mod my_project {
    use super::*;

    // Create
    pub fn create(ctx: Context<Create>, id: u64, content: String) -> Result<()> {
        require!(content.len() <= 280, CrudError::ContentTooLong);

        let crud_account = &mut ctx.accounts.crud_account;
        crud_account.id = id;
        crud_account.owner = ctx.accounts.signer.key();
        crud_account.content = content;
        msg!("Created: id={}, content={}", crud_account.id, crud_account.content);
        Ok(())
    }

    // Read (データはアカウントから直接取得可能なのでログ出力のみ)
    pub fn read(ctx: Context<Read>) -> Result<()> {
        let crud_account = &ctx.accounts.crud_account;
        msg!("Read: id={}, content={}", crud_account.id, crud_account.content);
        Ok(())
    }

    // Update
    pub fn update(ctx: Context<Update>, content: String) -> Result<()> {
        require!(content.len() <= 280, CrudError::ContentTooLong);

        let crud_account = &mut ctx.accounts.crud_account;
        crud_account.content = content;
        msg!("Updated: id={}, content={}", crud_account.id, crud_account.content);
        Ok(())
    }

    // Delete
    pub fn delete(_ctx: Context<Delete>) -> Result<()> {
        msg!("Deleted account");
        Ok(())
    }
}

// Create用のアカウント構造体
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Create<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + CrudAccount::INIT_SPACE,
        seeds = [b"crud", signer.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub crud_account: Account<'info, CrudAccount>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// Read用のアカウント構造体
#[derive(Accounts)]
#[instruction()]
pub struct Read<'info> {
    pub crud_account: Account<'info, CrudAccount>,
}

// Update用のアカウント構造体
#[derive(Accounts)]
pub struct Update<'info> {
    #[account(
        mut,
        has_one = owner @ CrudError::Unauthorized  // 所有者チェック
    )]
    pub crud_account: Account<'info, CrudAccount>,
    pub owner: Signer<'info>,
}

// Delete用のアカウント構造体
#[derive(Accounts)]
pub struct Delete<'info> {
    #[account(
        mut,
        close = owner,
        has_one = owner @ CrudError::Unauthorized  // 所有者チェック
    )]
    pub crud_account: Account<'info, CrudAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

// エラー定義
#[error_code]
pub enum CrudError {
    #[msg("You are not authorized to perform this action")]
    Unauthorized,
    #[msg("Content exceeds maximum length of 280 characters")]
    ContentTooLong,
}

// CRUDプログラムのアカウント
#[account]
#[derive(InitSpace)]
pub struct CrudAccount {
    pub id: u64,
    pub owner: Pubkey,  // 所有者を追跡
    #[max_len(280)]
    pub content: String,
}
